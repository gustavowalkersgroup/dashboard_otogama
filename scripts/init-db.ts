/**
 * Aplica db/schema.sql no banco apontado por DATABASE_URL.
 * Uso: npm run db:init   (lê .env.local se existir)
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { SCHEMA_SQL, comandosSchema } from "../src/lib/schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local — usa o ambiente do shell
}

if (process.env.NEON_HTTP_PROXY) {
  neonConfig.fetchEndpoint = process.env.NEON_HTTP_PROXY;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não configurada (defina em .env.local ou no ambiente).");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  // O DDL que roda é o de src/lib/schema.ts, porque é ele que vai no bundle e
  // alimenta o POST /api/eventos/init. db/schema.sql é a mesma coisa em arquivo,
  // para colar no SQL Editor do Neon — se os dois divergirem, alguém editou um e
  // esqueceu o outro, e aí não há resposta certa sobre qual é o schema.
  const arquivo = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  if (arquivo !== SCHEMA_SQL) {
    console.error(
      "db/schema.sql e src/lib/schema.ts divergiram — iguale os dois antes de rodar.",
    );
    process.exit(1);
  }

  const comandos = comandosSchema();
  for (const comando of comandos) {
    await sql.query(comando);
  }
  console.log(`Schema aplicado (${comandos.length} comandos).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
