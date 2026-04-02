-- ============================================================
-- SCHEMA - Gire & Ganhe - Sistema de Sorteio com Roleta
-- Execute este arquivo no SQL Editor do Supabase
-- ============================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABELA: campaigns (Campanhas)
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  whatsapp_group_link TEXT NOT NULL,
  whatsapp_group_id   TEXT,           -- ID interno do grupo no motor WA
  start_date      DATE,
  end_date        DATE,
  store_open_time TIME DEFAULT '09:00',
  store_close_time TIME DEFAULT '18:00',
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: prizes (Prêmios / Espaços da Roleta)
-- ============================================================
CREATE TABLE IF NOT EXISTS prizes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id           UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  label                 TEXT NOT NULL,               -- Texto exibido na roleta
  description           TEXT,                        -- Descrição ao ganhar
  instruction           TEXT,                        -- Instrução pós-ganho
  icon                  TEXT DEFAULT '🎁',
  color                 TEXT DEFAULT '#6C3FC5',       -- Cor do segmento
  is_prize              BOOLEAN DEFAULT true,         -- É prêmio real?
  is_filler             BOOLEAN DEFAULT false,        -- Preenchimento?
  generate_code         BOOLEAN DEFAULT false,        -- Gera código único?
  redemption_type       TEXT DEFAULT 'show',          -- show | code | none
  weight                INT DEFAULT 10,               -- Peso visual na roleta

  -- Controle de estoque
  stock_total           INT DEFAULT 0,               -- 0 = ilimitado
  stock_remaining       INT DEFAULT 0,               -- Saldo atual
  daily_limit           INT DEFAULT 0,               -- 0 = ilimitado
  
  -- Controle de distribuição inteligente
  min_interval_minutes  INT DEFAULT 0,               -- Intervalo mín entre saídas
  allowed_from          TIME,                        -- Horário de início permitido
  allowed_until         TIME,                        -- Horário fim permitido
  last_awarded_at       TIMESTAMPTZ,                 -- Última vez que saiu
  
  -- Contadores
  total_awarded         INT DEFAULT 0,
  today_awarded         INT DEFAULT 0,
  today_date            DATE,

  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: participants (Participantes / Controle 24h)
-- ============================================================
CREATE TABLE IF NOT EXISTS participants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT NOT NULL,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  last_played_at  TIMESTAMPTZ,
  next_allowed_at TIMESTAMPTZ,                       -- next_allowed_at = last_played_at + 24h
  total_plays     INT DEFAULT 0,
  joined_group    BOOLEAN DEFAULT false,
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone, campaign_id)
);

-- ============================================================
-- TABELA: sessions (Sessões temporárias de participação)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone           TEXT NOT NULL,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  session_token   TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          TEXT DEFAULT 'pending',    -- pending | joined | played | expired
  whatsapp_click  BOOLEAN DEFAULT false,
  whatsapp_clicked_at TIMESTAMPTZ,
  spin_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: spins (Registros de giros)
-- ============================================================
CREATE TABLE IF NOT EXISTS spins (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID REFERENCES sessions(id),
  phone           TEXT NOT NULL,
  campaign_id     UUID REFERENCES campaigns(id),
  prize_id        UUID REFERENCES prizes(id),
  segment_index   INT NOT NULL,
  segment_label   TEXT NOT NULL,
  is_prize        BOOLEAN DEFAULT false,
  redemption_code TEXT UNIQUE,
  redeemed        BOOLEAN DEFAULT false,
  redeemed_at     TIMESTAMPTZ,
  redeemed_by     TEXT,                              -- ID do admin que resgatou
  -- Metadados de distribuição (para auditoria interna)
  distribution_score  FLOAT,
  eligible_prizes     JSONB,                         -- Prêmios elegíveis no momento
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: whatsapp_events (Eventos do motor WhatsApp)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type      TEXT NOT NULL,                     -- group_join | group_leave | message
  phone           TEXT NOT NULL,
  group_id        TEXT,
  raw_payload     JSONB,
  processed       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: admin_settings (Configurações do sistema)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_settings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key             TEXT UNIQUE NOT NULL,
  value           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insere configuração padrão de senha admin (hash: "admin123" - ALTERE IMEDIATAMENTE!)
INSERT INTO admin_settings (key, value) VALUES
  ('admin_password_hash', crypt('admin123', gen_salt('bf')))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_participants_phone_campaign ON participants(phone, campaign_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone, campaign_id);
CREATE INDEX IF NOT EXISTS idx_spins_phone ON spins(phone, campaign_id);
CREATE INDEX IF NOT EXISTS idx_spins_code ON spins(redemption_code) WHERE redemption_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_events_phone ON whatsapp_events(phone, processed);
CREATE INDEX IF NOT EXISTS idx_prizes_campaign ON prizes(campaign_id, active);

-- ============================================================
-- FUNÇÃO: Reseta contadores diários dos prêmios (chamar via cron)
-- ============================================================
CREATE OR REPLACE FUNCTION reset_daily_prize_counters()
RETURNS void AS $$
BEGIN
  UPDATE prizes
  SET today_awarded = 0, today_date = CURRENT_DATE
  WHERE today_date IS DISTINCT FROM CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNÇÃO: Gera código de resgate único
-- ============================================================
CREATE OR REPLACE FUNCTION generate_redemption_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  -- Garante unicidade
  WHILE EXISTS (SELECT 1 FROM spins WHERE redemption_code = code) LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) - Segurança por linha
-- ============================================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE spins ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Políticas: apenas service_role (Edge Functions) acessa tudo
-- O frontend não acessa o banco diretamente - apenas via Edge Function
CREATE POLICY "service_role_only" ON campaigns TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON prizes TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON participants TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON sessions TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON spins TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON whatsapp_events TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only" ON admin_settings TO service_role USING (true) WITH CHECK (true);
