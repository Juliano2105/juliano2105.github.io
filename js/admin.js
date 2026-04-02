/**
 * ADMIN.JS - Painel Administrativo
 * Gerencia campanhas, prêmios, roleta, relatórios e configurações.
 */

// ============================================================
// ESTADO
// ============================================================
const Admin = {
  currentPage: 'dashboard',
  currentCampaignId: null,
  prizes: [],
  adminRoulette: null,
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  setupNavigation();
  loadDashboard();
  setupModals();
  setupPrizeForm();
  setupCampaignForm();
});

// ============================================================
// AUTH - Verificação básica de admin
// ============================================================
function checkAdminAuth() {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    // Mostra modal de login
    document.getElementById('loginModal').classList.add('open');
    document.getElementById('btnAdminLogin').addEventListener('click', handleAdminLogin);
    document.getElementById('adminPassword').addEventListener('keypress', e => {
      if (e.key === 'Enter') handleAdminLogin();
    });
  }
}

async function handleAdminLogin() {
  const pwd = document.getElementById('adminPassword').value;
  const err = document.getElementById('loginError');
  if (!pwd) { err.textContent = 'Digite a senha.'; return; }
  try {
    const result = await adminApi('POST', '/admin/auth', { password: pwd });
    if (result.token) {
      localStorage.setItem('admin_token', result.token);
      document.getElementById('loginModal').classList.remove('open');
      showToast('Login realizado com sucesso!', 'success');
      loadDashboard();
    } else {
      err.textContent = 'Senha incorreta.';
    }
  } catch (e) {
    err.textContent = 'Erro: ' + e.message;
  }
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function setupNavigation() {
  document.querySelectorAll('.admin-nav a[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      navigateTo(page);
      // Mobile: fecha sidebar
      document.getElementById('adminSidebar').classList.remove('open');
    });
  });
  // Mobile toggle
  const toggle = document.getElementById('adminMobileToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.getElementById('adminSidebar').classList.toggle('open');
    });
  }
  document.getElementById('btnLogout').addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    location.reload();
  });
}

function navigateTo(page) {
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.admin-nav a').forEach(a => a.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector(`.admin-nav a[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');
  Admin.currentPage = page;

  // Carrega dados da página
  const loaders = {
    dashboard: loadDashboard,
    campaigns: loadCampaigns,
    prizes: loadPrizes,
    reports: loadReports,
    settings: loadSettings,
  };
  if (loaders[page]) loaders[page]();
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  try {
    const stats = await adminApi('GET', '/admin/stats');
    document.getElementById('statTotalSpins').textContent = stats.total_spins || 0;
    document.getElementById('statTodaySpins').textContent = stats.today_spins || 0;
    document.getElementById('statPrizesGiven').textContent = stats.prizes_given || 0;
    document.getElementById('statActiveCampaigns').textContent = stats.active_campaigns || 0;
    renderRecentActivity(stats.recent || []);
  } catch (e) {
    console.warn('Dashboard load error:', e.message);
  }
}

function renderRecentActivity(items) {
  const tbody = document.getElementById('recentActivityBody');
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Nenhuma atividade ainda</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(item => {
    const badge = item.is_prize
      ? '<span class="badge badge-green">🎁 Prêmio</span>'
      : '<span class="badge badge-blue">🎰 Participação</span>';
    return `<tr>
      <td>${formatDateTime(item.created_at)}</td>
      <td>${formatPhone(item.phone)}</td>
      <td>${item.campaign_name || '-'}</td>
      <td>${item.prize_name || item.segment_label}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

// ============================================================
// CAMPANHAS
// ============================================================
async function loadCampaigns() {
  try {
    const campaigns = await adminApi('GET', '/admin/campaigns');
    renderCampaignList(campaigns);
  } catch (e) {
    showToast('Erro ao carregar campanhas: ' + e.message, 'error');
  }
}

function renderCampaignList(campaigns) {
  const container = document.getElementById('campaignList');
  if (!campaigns.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">Nenhuma campanha criada ainda.</p>';
    return;
  }
  container.innerHTML = campaigns.map(c => `
    <div class="prize-item">
      <div class="prize-color-dot" style="background:${c.active ? '#2ECC71' : '#E74C3C'}"></div>
      <div class="prize-info">
        <div class="prize-name">${c.name}</div>
        <div class="prize-meta">
          Início: ${formatDate(c.start_date)} | Fim: ${formatDate(c.end_date)} |
          Grupo WA: ${c.whatsapp_group_link ? '✅ Configurado' : '⚠️ Pendente'}
        </div>
      </div>
      <div class="prize-actions">
        <button class="btn btn-sm btn-secondary" onclick="editCampaign('${c.id}')">✏️ Editar</button>
        <button class="btn btn-sm btn-primary" onclick="managePrizes('${c.id}')">🎁 Prêmios</button>
        <button class="btn btn-sm" style="background:rgba(255,215,0,.15);color:#FFD700"
          onclick="showQrCode('${c.id}')">📱 QR Code</button>
      </div>
    </div>
  `).join('');
}

function setupCampaignForm() {
  document.getElementById('btnNewCampaign').addEventListener('click', () => {
    document.getElementById('campaignModalTitle').textContent = 'Nova Campanha';
    document.getElementById('campaignForm').reset();
    document.getElementById('campaignIdHidden').value = '';
    document.getElementById('campaignModal').classList.add('open');
  });

  document.getElementById('btnSaveCampaign').addEventListener('click', saveCampaign);
}

async function saveCampaign() {
  const form = document.getElementById('campaignForm');
  const id = document.getElementById('campaignIdHidden').value;
  const data = {
    name: document.getElementById('campName').value,
    title: document.getElementById('campTitle').value,
    description: document.getElementById('campDesc').value,
    whatsapp_group_link: document.getElementById('campWaLink').value,
    start_date: document.getElementById('campStartDate').value,
    end_date: document.getElementById('campEndDate').value,
    store_open_time: document.getElementById('campOpenTime').value || '09:00',
    store_close_time: document.getElementById('campCloseTime').value || '18:00',
    active: document.getElementById('campActive').checked,
  };
  if (!data.name || !data.whatsapp_group_link) {
    showToast('Preencha nome e link do grupo.', 'error');
    return;
  }
  try {
    if (id) {
      await adminApi('PUT', `/admin/campaigns/${id}`, data);
    } else {
      await adminApi('POST', '/admin/campaigns', data);
    }
    closeModal('campaignModal');
    loadCampaigns();
    showToast('Campanha salva!', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function editCampaign(id) {
  try {
    const c = await adminApi('GET', `/admin/campaigns/${id}`);
    document.getElementById('campaignModalTitle').textContent = 'Editar Campanha';
    document.getElementById('campaignIdHidden').value = c.id;
    document.getElementById('campName').value = c.name;
    document.getElementById('campTitle').value = c.title || '';
    document.getElementById('campDesc').value = c.description || '';
    document.getElementById('campWaLink').value = c.whatsapp_group_link || '';
    document.getElementById('campStartDate').value = c.start_date?.substring(0,10) || '';
    document.getElementById('campEndDate').value = c.end_date?.substring(0,10) || '';
    document.getElementById('campOpenTime').value = c.store_open_time || '09:00';
    document.getElementById('campCloseTime').value = c.store_close_time || '18:00';
    document.getElementById('campActive').checked = c.active;
    document.getElementById('campaignModal').classList.add('open');
  } catch (e) {
    showToast('Erro ao carregar campanha: ' + e.message, 'error');
  }
}

function managePrizes(campaignId) {
  Admin.currentCampaignId = campaignId;
  navigateTo('prizes');
}

function showQrCode(campaignId) {
  const url = `https://juliano2105.github.io/?c=${campaignId}`;
  document.getElementById('qrUrl').textContent = url;
  // Gera QR code via API pública
  const img = document.getElementById('qrImage');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
  img.style.display = 'block';
  document.getElementById('qrCopyBtn').onclick = () => {
    navigator.clipboard.writeText(url);
    showToast('URL copiada!', 'success');
  };
  document.getElementById('qrModal').classList.add('open');
}

// ============================================================
// PRÊMIOS
// ============================================================
async function loadPrizes() {
  if (!Admin.currentCampaignId) {
    document.getElementById('prizesPlaceholder').style.display = 'block';
    document.getElementById('prizesContent').style.display = 'none';
    return;
  }
  document.getElementById('prizesPlaceholder').style.display = 'none';
  document.getElementById('prizesContent').style.display = 'block';
  try {
    const prizes = await adminApi('GET', `/admin/campaigns/${Admin.currentCampaignId}/prizes`);
    Admin.prizes = prizes;
    renderPrizeList(prizes);
    renderRoulettePreview(prizes);
  } catch (e) {
    showToast('Erro ao carregar prêmios: ' + e.message, 'error');
  }
}

function renderPrizeList(prizes) {
  const container = document.getElementById('prizeList');
  if (!prizes.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:30px">Nenhum prêmio cadastrado.</p>';
    return;
  }
  container.innerHTML = prizes.map(p => {
    const stockBar = p.stock_total > 0
      ? `<div class="progress-bar-wrap"><div class="progress-bar" style="width:${Math.max(5,(p.stock_remaining/p.stock_total)*100)}%"></div></div>`
      : '';
    const isFillerBadge = p.is_filler ? '<span class="badge badge-blue">Preenchimento</span>' : '<span class="badge badge-yellow">Prêmio real</span>';
    return `<div class="prize-item">
      <div class="prize-color-dot" style="background:${p.color || '#6C3FC5'}"></div>
      <div class="prize-info">
        <div class="prize-name">${p.label} ${isFillerBadge}</div>
        <div class="prize-meta">
          Estoque: ${p.stock_remaining || '∞'}/${p.stock_total || '∞'} |
          Diário: ${p.daily_limit || '∞'} |
          Intervalo mín: ${p.min_interval_minutes || 0}min |
          Horário: ${p.allowed_from || '--'}–${p.allowed_until || '--'}
        </div>
        ${stockBar}
      </div>
      <div class="prize-actions">
        <button class="btn btn-sm btn-secondary" onclick="editPrize('${p.id}')">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deletePrize('${p.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function renderRoulettePreview(prizes) {
  const canvas = document.getElementById('adminRouletteCanvas');
  if (!canvas) return;
  if (!Admin.adminRoulette) {
    Admin.adminRoulette = new Roulette('adminRouletteCanvas', { size: 280 });
  }
  Admin.adminRoulette.setSegments(prizes.map(p => ({ label: p.label, color: p.color })));
}

function setupPrizeForm() {
  document.getElementById('btnNewPrize').addEventListener('click', () => {
    document.getElementById('prizeModalTitle').textContent = 'Novo Prêmio / Espaço da Roleta';
    document.getElementById('prizeForm').reset();
    document.getElementById('prizeIdHidden').value = '';
    document.getElementById('prizeModal').classList.add('open');
  });
  document.getElementById('btnSavePrize').addEventListener('click', savePrize);

  // Preview de cor
  document.getElementById('prizeColor').addEventListener('input', e => {
    document.getElementById('prizeColorPreview').style.background = e.target.value;
  });
}

async function savePrize() {
  const id = document.getElementById('prizeIdHidden').value;
  const data = {
    campaign_id: Admin.currentCampaignId,
    label: document.getElementById('prizeLabel').value,
    description: document.getElementById('prizeDescription').value,
    icon: document.getElementById('prizeIcon').value || '🎁',
    color: document.getElementById('prizeColor').value || '#6C3FC5',
    is_prize: document.getElementById('prizeIsPrize').checked,
    is_filler: document.getElementById('prizeIsFiller').checked,
    stock_total: parseInt(document.getElementById('prizeStockTotal').value) || 0,
    daily_limit: parseInt(document.getElementById('prizeDailyLimit').value) || 0,
    min_interval_minutes: parseInt(document.getElementById('prizeMinInterval').value) || 0,
    allowed_from: document.getElementById('prizeAllowedFrom').value || null,
    allowed_until: document.getElementById('prizeAllowedUntil').value || null,
    weight: parseInt(document.getElementById('prizeWeight').value) || 10,
    instruction: document.getElementById('prizeInstruction').value,
    redemption_type: document.getElementById('prizeRedemptionType').value,
    generate_code: document.getElementById('prizeGenerateCode').checked,
  };
  if (!data.label) { showToast('Informe o nome do prêmio.', 'error'); return; }
  try {
    if (id) {
      await adminApi('PUT', `/admin/prizes/${id}`, data);
    } else {
      await adminApi('POST', '/admin/prizes', data);
    }
    closeModal('prizeModal');
    loadPrizes();
    showToast('Prêmio salvo!', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function editPrize(id) {
  try {
    const p = await adminApi('GET', `/admin/prizes/${id}`);
    document.getElementById('prizeModalTitle').textContent = 'Editar Prêmio';
    document.getElementById('prizeIdHidden').value = p.id;
    document.getElementById('prizeLabel').value = p.label;
    document.getElementById('prizeDescription').value = p.description || '';
    document.getElementById('prizeIcon').value = p.icon || '';
    document.getElementById('prizeColor').value = p.color || '#6C3FC5';
    document.getElementById('prizeColorPreview').style.background = p.color || '#6C3FC5';
    document.getElementById('prizeIsPrize').checked = p.is_prize;
    document.getElementById('prizeIsFiller').checked = p.is_filler;
    document.getElementById('prizeStockTotal').value = p.stock_total || '';
    document.getElementById('prizeDailyLimit').value = p.daily_limit || '';
    document.getElementById('prizeMinInterval').value = p.min_interval_minutes || '';
    document.getElementById('prizeAllowedFrom').value = p.allowed_from || '';
    document.getElementById('prizeAllowedUntil').value = p.allowed_until || '';
    document.getElementById('prizeWeight').value = p.weight || 10;
    document.getElementById('prizeInstruction').value = p.instruction || '';
    document.getElementById('prizeRedemptionType').value = p.redemption_type || 'show';
    document.getElementById('prizeGenerateCode').checked = p.generate_code;
    document.getElementById('prizeModal').classList.add('open');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

async function deletePrize(id) {
  if (!confirm('Excluir este prêmio?')) return;
  try {
    await adminApi('DELETE', `/admin/prizes/${id}`);
    loadPrizes();
    showToast('Prêmio removido.', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ============================================================
// RELATÓRIOS
// ============================================================
async function loadReports() {
  const campaignId = document.getElementById('reportCampaignFilter')?.value || '';
  const dateFrom = document.getElementById('reportDateFrom')?.value || '';
  const dateTo = document.getElementById('reportDateTo')?.value || '';
  try {
    const data = await adminApi('GET',
      `/admin/reports?campaign_id=${campaignId}&date_from=${dateFrom}&date_to=${dateTo}`);
    renderReports(data);
  } catch (e) {
    showToast('Erro ao carregar relatórios: ' + e.message, 'error');
  }
}

function renderReports(data) {
  const tbody = document.getElementById('reportTableBody');
  if (!data.participations?.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">Sem dados no período.</td></tr>';
    return;
  }
  tbody.innerHTML = data.participations.map(r => {
    const statusBadge = r.redeemed
      ? '<span class="badge badge-green">✅ Resgatado</span>'
      : r.is_prize
        ? '<span class="badge badge-yellow">⏳ Pendente</span>'
        : '<span class="badge badge-blue">Sem prêmio</span>';
    return `<tr>
      <td>${formatDateTime(r.created_at)}</td>
      <td>${formatPhone(r.phone)}</td>
      <td>${r.campaign_name || '-'}</td>
      <td>${r.segment_label}</td>
      <td>${r.redemption_code || '-'}</td>
      <td>${statusBadge}</td>
      <td>${r.redeemed_at ? formatDateTime(r.redeemed_at) : '-'}</td>
    </tr>`;
  }).join('');
  // Stats
  if (data.summary) {
    document.getElementById('reportTotal').textContent = data.summary.total || 0;
    document.getElementById('reportPrizes').textContent = data.summary.prizes || 0;
    document.getElementById('reportRedeemed').textContent = data.summary.redeemed || 0;
    document.getElementById('reportUniquePhones').textContent = data.summary.unique_phones || 0;
  }
}

async function redeemCode() {
  const code = document.getElementById('redeemInput').value.trim().toUpperCase();
  if (!code) { showToast('Digite um código.', 'error'); return; }
  try {
    const result = await adminApi('POST', '/admin/redeem', { code });
    if (result.success) {
      showToast(`✅ Código ${code} validado! Prêmio: ${result.prize_name}`, 'success');
      document.getElementById('redeemInput').value = '';
      loadReports();
    } else {
      showToast('Código inválido ou já utilizado.', 'error');
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================
async function loadSettings() {
  try {
    const s = await adminApi('GET', '/admin/settings');
    document.getElementById('settingApiUrl').value = s.supabase_url || '';
    document.getElementById('settingAnonKey').value = s.anon_key || '';
    document.getElementById('settingWaApiUrl').value = s.whatsapp_api_url || '';
    document.getElementById('settingWaApiKey').value = s.whatsapp_api_key || '';
    document.getElementById('settingAdminPwd').value = '';
  } catch (e) {
    console.warn('Settings load:', e.message);
  }
}

async function saveSettings() {
  const data = {
    supabase_url: document.getElementById('settingApiUrl').value,
    anon_key: document.getElementById('settingAnonKey').value,
    whatsapp_api_url: document.getElementById('settingWaApiUrl').value,
    whatsapp_api_key: document.getElementById('settingWaApiKey').value,
  };
  const newPwd = document.getElementById('settingAdminPwd').value;
  if (newPwd) data.new_password = newPwd;
  try {
    await adminApi('POST', '/admin/settings', data);
    showToast('Configurações salvas!', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ============================================================
// MODAIS
// ============================================================
function setupModals() {
  document.querySelectorAll('.modal-close, [data-dismiss-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay').classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// ============================================================
// API ADMIN
// ============================================================
async function adminApi(method, path, body) {
  const BASE = window.SUPABASE_FUNCTIONS_URL || 'https://SEU-PROJETO.supabase.co/functions/v1/sorteio-api';
  const token = localStorage.getItem('admin_token') || '';
  const ANON = window.SUPABASE_ANON_KEY || '';
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ANON,
      'apikey': ANON,
      'x-admin-token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'HTTP ' + res.status);
  }
  return res.json();
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}
function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('pt-BR');
}
function formatPhone(p) {
  if (!p) return '-';
  const d = p.replace(/\D/g,'');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return p;
}
function showToast(msg, type='info') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className='toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(100%)'; setTimeout(()=>t.remove(),300); }, 4000);
}

window.redeemCode = redeemCode;
window.editCampaign = editCampaign;
window.managePrizes = managePrizes;
window.showQrCode = showQrCode;
window.editPrize = editPrize;
window.deletePrize = deletePrize;
window.saveSettings = saveSettings;
window.loadReports = loadReports;
window.navigateTo = navigateTo;
