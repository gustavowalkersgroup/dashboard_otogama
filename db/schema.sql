-- Event store do dashboard Otogama (append-only).
-- Rodar uma vez no Neon (ou via `npm run db:init`).

CREATE TABLE IF NOT EXISTS eventos (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL DEFAULT 'otogama',
  tipo        TEXT NOT NULL,        -- envio_lembrete | confirmacao | precisa_ajuda
                                    -- | agendamento_ia | desfecho_agendamento | api_status
                                    -- | status_consulta
  chave       TEXT,                 -- chave do agendamento na Konsist (1 linha POR chave)
  telefone    TEXT,                 -- E.164 sem '+', ex: 5561999998888
  paciente    TEXT,                 -- nome, quando disponível
  payload     JSONB NOT NULL DEFAULT '{}',
  ts          TIMESTAMPTZ NOT NULL, -- momento do evento (fonte), não do insert
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eventos_tenant_tipo_ts ON eventos (tenant_id, tipo, ts);
CREATE INDEX IF NOT EXISTS eventos_tenant_chave ON eventos (tenant_id, chave);

-- Idempotência: fontes podem reenviar (retry) — dedup por hash natural.
CREATE UNIQUE INDEX IF NOT EXISTS eventos_dedup
  ON eventos (tenant_id, tipo, COALESCE(chave, ''), ts);
