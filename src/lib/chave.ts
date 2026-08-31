import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Chave de ingestão que ESTE deployment espera.
 *
 * Espaço/quebra de linha no fim do valor é acidente de copiar-e-colar no painel
 * da Vercel, não chave — sem o trim vira um 401 impossível de diagnosticar.
 */
export function chaveIngestEsperada(): string {
  const env: Record<string, string | undefined> = process.env;
  return (env.INGEST_API_KEY ?? "").trim();
}

/**
 * Compara em tempo constante. O hash existe para igualar o tamanho dos buffers:
 * `timingSafeEqual` recusa comprimentos diferentes, e recusar já vazaria o
 * tamanho da chave certa.
 */
export function chaveConfere(recebida: string | null | undefined, esperada: string): boolean {
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida.trim()).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}
