/**
 * CONFIG.JS — Configuração do sistema Gire & Ganhe
 *
 * Edite este arquivo com as credenciais do seu projeto Supabase.
 * Após configurar, o sistema estará pronto para uso.
 *
 * PASSO A PASSO:
 * 1. Crie uma conta gratuita em https://supabase.com
 * 2. Crie um novo projeto
 * 3. Vá em Settings > API e copie:
 *    - Project URL → cole em SUPABASE_FUNCTIONS_URL abaixo
 *    - anon/public key → cole em SUPABASE_ANON_KEY abaixo
 * 4. Execute o SQL do arquivo supabase/schema.sql no SQL Editor do Supabase
 * 5. Faça deploy da Edge Function (supabase/functions/sorteio-api)
 * 6. Configure o motor WhatsApp para enviar webhooks para:
 *    https://SEU-PROJETO.supabase.co/functions/v1/sorteio-api/webhook/whatsapp
 */

// ============================================================
// SUPABASE - Edite aqui com seus dados reais
// ============================================================
window.SUPABASE_FUNCTIONS_URL = 'https://thsiktvrpisbhgvihsio.supabase.co/functions/v1/sorteio-api';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoc2lrdHZycGlzYmhndmloc2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODg2ODksImV4cCI6MjA5MDY2NDY4OX0.jd5_J0gjXIAWR_PjtVbr8diFoXWtVxaSwRZPkgBzH1o';

// ============================================================
// CONFIGURAÇÕES GERAIS
// ============================================================
window.APP_CONFIG = {
  // Nome exibido no header quando campanha não carrega
  defaultName: 'Gire & Ganhe',
  // Versão
  version: '1.0.0',
  // Debug mode (false em produção)
  debug: false,
};

if (window.APP_CONFIG.debug) {
  console.log('[Config] Sistema carregado. URL:', window.SUPABASE_FUNCTIONS_URL);
}
