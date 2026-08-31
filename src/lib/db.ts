import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";

export const TENANT = process.env.TENANT_ID ?? "otogama";

let cliente: NeonQueryFunction<false, false> | null = null;

export function sql(): NeonQueryFunction<false, false> {
  if (!cliente) {
    // alias evita o inline de `process.env.X` do bundler, que eliminaria o branch
    const env: Record<string, string | undefined> = process.env;
    // dev local sem Neon: proxy HTTP compatível (ex.: Neon Local)
    if (env.NEON_HTTP_PROXY) {
      neonConfig.fetchEndpoint = env.NEON_HTTP_PROXY;
    }
    const url = env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL não configurada — veja o README (setup Neon).");
    }
    cliente = neon(url);
  }
  return cliente;
}

/**
 * Motivo do erro do banco, curto e sem credencial. A mensagem do driver às vezes
 * traz a URL de conexão, que carrega a senha — daí a raspagem antes de devolver.
 */
export function motivoDoErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  return bruto
    .replace(/[a-z]+:\/\/[^\s@]*@/gi, "://***@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
