/**
 * Aplica db/schema.sql no banco apontado por DATABASE_URL.
 * Uso: npm run db:init   (lê .env.local se existir)
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

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
  const ddl = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const comandos = ddl
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const comando of comandos) {
    await sql.query(comando);
  }
  console.log(`Schema aplicado (${comandos.length} comandos).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
