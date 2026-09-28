-- PostgreSQL / Neon
-- Schema inicial do sistema de conferência de passageiros.

CREATE TABLE IF NOT EXISTS viagens (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  origem TEXT,
  destino TEXT,
  data_viagem TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS passageiros (
  id BIGSERIAL PRIMARY KEY,
  viagem_id BIGINT NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  assento TEXT,
  documento TEXT,
  descriptor TEXT NOT NULL,
  foto_thumb TEXT,
  embarcado INTEGER NOT NULL DEFAULT 0,
  presente_parada INTEGER NOT NULL DEFAULT 0,
  embarcado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eventos (
  id BIGSERIAL PRIMARY KEY,
  viagem_id BIGINT NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_passageiros_viagem ON passageiros(viagem_id);
CREATE INDEX IF NOT EXISTS idx_eventos_viagem ON eventos(viagem_id);
