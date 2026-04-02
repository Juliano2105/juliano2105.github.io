/**
 * APP.JS - Lógica principal da página pública de campanha
 * Fluxo: Telefone → Verificação 24h → WhatsApp → Confirmação real → Countdown → Roleta → Resultado
 *
 * CONFIGURAÇÃO: edite config.js com sua URL do Supabase e chave anon.
 */

// ============================================================
// ESTADO GLOBAL
// ============================================================
const App = {
  phone: '',
  sessionToken: '',
  campaignId: getCampaignId(),
  roulette: null,
  pollingInterval: null,
  POLL_INTERVAL_MS: 3000,
  MAX_POLL_ATTEMPTS: 100, // ~5 minutos
  pollAttempts: 0,
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadCampaign();
  showStep('phone');
  document.getElementById('btnCheckPhone').addEventListener('click', handlePhoneSubmit);
  document.getElementById('btnOpenWhatsApp').addEventListener('click', handleOpenWhatsApp);
  document.getElementById('phoneInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') handlePhoneSubmit();
  });
  // Máscara de telefone
  document.getElementById('phoneInput').addEventListener('input', maskPhone);
});

// ============================================================
// CAMPANHA - Carrega dados da campanha via API
// ============================================================
async function loadCampaign() {
  try {
    const campaign = await api('GET', `/campaigns/${App.campaignId}/public`);
    if (!campaign) return;
    document.getElementById('campaignName').textContent = campaign.name || '';
    document.getElementById('campaignTitle').textContent = campaign.title || 'Gire a Roleta e Ganhe!';
    document.getElementById('campaignDesc').textContent = campaign.description || 'Participe da nossa promoção exclusiva.';
    document.getElementById('campaignNameWhats').textContent = campaign.name || '';
    // Salva dados para uso posterior
    App.campaign = campaign;
  } catch (e) {
    console.warn('Campanha não carregada:', e.message);
  }
}

// ============================================================
// PASSO 1 - Validar telefone e checar cooldown 24h
// ============================================================
function maskPhone(e) {
  let v = e.target.value.replace(/\D/g, '');
  if (v.length > 11) v = v.slice(0, 11);
  if (v.length <= 2) e.target.value = v;
  else if (v.length <= 7) e.target.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
  else e.target.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
}

async function handlePhoneSubmit() {
  const rawPhone = document.getElementById('phoneInput').value.replace(/\D/g, '');
  const errorEl = document.getElementById('phoneError');

  if (rawPhone.length < 10 || rawPhone.length > 11) {
    errorEl.textContent = 'Digite um número de telefone válido com DDD.';
    errorEl.classList.add('show');
    document.getElementById('phoneInput').classList.add('error');
    return;
  }
  errorEl.classList.remove('show');
  document.getElementById('phoneInput').classList.remove('error');

  App.phone = rawPhone;
  const btn = document.getElementById('btnCheckPhone');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Verificando...';

  try {
    const result = await api('POST', '/participants/check', {
      phone: App.phone,
      campaign_id: App.campaignId,
    });

    if (result.status === 'cooldown') {
      // Jogou nas últimas 24h
      const nextAllowed = new Date(result.next_allowed_at);
      showCooldownMessage(nextAllowed);
    } else if (result.status === 'ok') {
      // Pode participar - vai para passo WhatsApp
      App.sessionToken = result.session_token;
      showStep('whatsapp');
      updateStepDots(1);
    } else {
      throw new Error(result.message || 'Erro desconhecido');
    }
  } catch (e) {
    showToast('Erro ao verificar telefone: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Continuar →';
  }
}

function showCooldownMessage(nextAllowed) {
  const now = new Date();
  const diff = nextAllowed - now;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);

  document.getElementById('phoneStep').classList.remove('active');
  document.getElementById('cooldownStep').classList.add('active');
  document.getElementById('cooldownTime').textContent =
    hours > 0 ? `${hours}h ${mins}min` : `${mins} minutos`;
}

// ============================================================
// PASSO 2 - Abrir WhatsApp e iniciar polling
// ============================================================
function handleOpenWhatsApp() {
  const campaign = App.campaign || {};
  const groupLink = campaign.whatsapp_group_link || '#';

  if (!groupLink || groupLink === '#') {
    showToast('Link do grupo não configurado.', 'error');
    return;
  }

  // Registra tentativa no backend antes de abrir o WA
  api('POST', '/participants/whatsapp-click', {
    phone: App.phone,
    session_token: App.sessionToken,
    campaign_id: App.campaignId,
  }).catch(() => {});

  // Abre o link do grupo
  window.open(groupLink, '_blank');

  // Inicia monitoramento de entrada
  startPolling();
}

// ============================================================
// POLLING - Verifica se entrou no grupo
// ============================================================
function startPolling() {
  const btn = document.getElementById('btnOpenWhatsApp');
  btn.textContent = '✓ Link aberto — verificando entrada...';
  btn.disabled = true;

  setStatus('whatsappStatus', 'waiting', '⏳ Aguardando confirmação de entrada no grupo...');
  App.pollAttempts = 0;

  App.pollingInterval = setInterval(async () => {
    App.pollAttempts++;

    if (App.pollAttempts > App.MAX_POLL_ATTEMPTS) {
      clearInterval(App.pollingInterval);
      setStatus('whatsappStatus', 'error', '⚠️ Tempo esgotado. Verifique se entrou no grupo e tente novamente.');
      btn.disabled = false;
      btn.textContent = '📲 Abrir Grupo do WhatsApp';
      return;
    }

    try {
      const result = await api('GET',
        `/participants/check-join?phone=${App.phone}&campaign_id=${App.campaignId}&session_token=${App.sessionToken}`
      );

      if (result.joined === true) {
        clearInterval(App.pollingInterval);
        setStatus('whatsappStatus', 'success', '✅ Entrada confirmada! Preparando sua roleta...');
        await sleep(1200);
        startCountdown();
      }
    } catch (e) {
      console.warn('Polling error:', e.message);
    }
  }, App.POLL_INTERVAL_MS);
}

// ============================================================
// COUNTDOWN 5..1
// ============================================================
function startCountdown() {
  showStep('roulette');
  updateStepDots(2);

  const countdownEl = document.getElementById('countdownNumber');
  const countdownSection = document.getElementById('countdownSection');
  const rouletteSection = document.getElementById('rouletteSection');

  countdownSection.style.display = 'block';
  rouletteSection.style.display = 'none';

  let count = 5;
  countdownEl.textContent = count;

  const tick = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
      // Força re-trigger da animação
      countdownEl.style.animation = 'none';
      void countdownEl.offsetWidth;
      countdownEl.style.animation = '';
    } else {
      clearInterval(tick);
      countdownSection.style.display = 'none';
      rouletteSection.style.display = 'block';
      initRoulette();
    }
  }, 1000);
}

// ============================================================
// ROLETA - Inicializa e solicita resultado ao backend
// ============================================================
async function initRoulette() {
  // Carrega segmentos da campanha
  const segments = await getRouletteSegments();
  App.roulette = new Roulette('rouletteCanvas', {
    size: Math.min(window.innerWidth - 60, 320),
    onSpinEnd: handleSpinEnd,
  });
  App.roulette.setSegments(segments);
  App.segments = segments;

  document.getElementById('btnSpin').addEventListener('click', handleSpinClick);
}

async function getRouletteSegments() {
  try {
    const data = await api('GET', `/campaigns/${App.campaignId}/roulette-display`);
    return data.segments || getDefaultSegments();
  } catch {
    return getDefaultSegments();
  }
}

function getDefaultSegments() {
  return [
    { label: 'Tente Novamente', color: '#6C3FC5' },
    { label: '10% OFF', color: '#FF6B35' },
    { label: 'Volte Amanhã', color: '#1A1A2E' },
    { label: 'Brinde', color: '#2ECC71' },
    { label: 'Tente Novamente', color: '#6C3FC5' },
    { label: '5% OFF', color: '#3498DB' },
    { label: 'Volte Amanhã', color: '#1A1A2E' },
    { label: 'Surpresa!', color: '#FFD700' },
  ];
}

async function handleSpinClick() {
  const btn = document.getElementById('btnSpin');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> Sorteando...';

  try {
    // Backend decide o prêmio — NUNCA o frontend
    const result = await api('POST', '/spin', {
      phone: App.phone,
      session_token: App.sessionToken,
      campaign_id: App.campaignId,
    });

    if (!result || result.segment_index === undefined) {
      throw new Error('Resposta inválida do servidor.');
    }

    App.spinResult = result;
    // Anima até o índice retornado pelo backend
    App.roulette.spinToIndex(result.segment_index, handleSpinEnd);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '🎰 GIRAR ROLETA';
    showToast('Erro ao sortear: ' + e.message, 'error');
  }
}

function handleSpinEnd(index) {
  const result = App.spinResult;
  if (!result) return;

  setTimeout(() => {
    showResult(result);
    if (result.is_prize) launchConfetti(100);
  }, 600);
}

// ============================================================
// RESULTADO
// ============================================================
function showResult(result) {
  showStep('result');
  updateStepDots(3);

  document.getElementById('resultIcon').textContent = result.icon || (result.is_prize ? '🎉' : '😊');
  document.getElementById('resultPrize').textContent = result.prize_name || 'Tente Novamente';
  document.getElementById('resultDesc').textContent = result.description || '';

  const codeSection = document.getElementById('resultCodeSection');
  if (result.redemption_code) {
    codeSection.style.display = 'block';
    document.getElementById('resultCode').textContent = result.redemption_code;
  } else {
    codeSection.style.display = 'none';
  }

  // Instrução personalizada do resultado
  const instrEl = document.getElementById('resultInstruction');
  if (result.instruction) {
    instrEl.textContent = result.instruction;
    instrEl.style.display = 'block';
  } else {
    instrEl.style.display = 'none';
  }

  // Próxima jogada
  if (result.next_allowed_at) {
    const next = new Date(result.next_allowed_at);
    document.getElementById('resultNextPlay').textContent =
      'Próxima jogada disponível: ' + next.toLocaleString('pt-BR');
  }
}

// ============================================================
// HELPERS UI
// ============================================================
function showStep(name) {
  ['phone', 'whatsapp', 'roulette', 'result', 'cooldown'].forEach(s => {
    const el = document.getElementById(s + 'Step');
    if (el) el.classList.toggle('active', s === name);
  });
}

function updateStepDots(active) {
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('done', i < active);
    dot.classList.toggle('active', i === active);
  });
}

function setStatus(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-bar ${type}`;
  el.innerHTML = `<span class="status-dot"></span><span>${text}</span>`;
}

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 4000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCampaignId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('c') || params.get('campaign') || 'default';
}

// ============================================================
// API - Comunicação com backend (Supabase Edge Functions)
// ============================================================
async function api(method, path, body) {
  // CONFIG: edite config.js com suas credenciais
  const BASE_URL = window.SUPABASE_FUNCTIONS_URL || 'https://SEU-PROJETO.supabase.co/functions/v1/sorteio-api';
  const ANON_KEY = window.SUPABASE_ANON_KEY || 'SUA-CHAVE-ANON';

  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ANON_KEY,
      'apikey': ANON_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}
