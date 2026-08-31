/**
 * DDL do event store — fonte única.
 *
 * Mora em TypeScript, e não só em `db/schema.sql`, porque a recriação da tabela
 * precisa ser possível de dentro do próprio deployment: em 30/08 a tabela
 * `eventos` foi derrubada por uma migração de OUTRO app que dividia o mesmo
 * banco, e consertar exigia alguém com a connection string na mão e um cliente
 * Postgres. Com o DDL no bundle, `POST /api/eventos/init` resolve.
 *
 * `db/schema.sql` é a mesma coisa em arquivo, para colar no SQL Editor do Neon —
 * `npm run db:init` recusa rodar se os dois divergirem.
 */
export const SCHEMA_SQL = `-- Event store do dashboard Otogama (append-only).
-- Rodar uma vez no Neon (ou via \`npm run db:init\`).

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
`;

/** Comandos individuais — o driver HTTP do Neon manda um por requisição. */
export function comandosSchema(): string[] {
  return SCHEMA_SQL.split(";")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
