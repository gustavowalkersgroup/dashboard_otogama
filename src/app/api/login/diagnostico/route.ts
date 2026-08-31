import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE_SESSAO, validarTokenSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico de configuração: responde o que ESTE deployment enxerga nas suas
// variáveis, sem revelar valor nenhum. Existe porque a Vercel congela as env
// vars no build — quando o login para de aceitar a senha, não há como saber de
// fora se o valor está errado, vazio, ou se o deployment é anterior à mudança.
//
// Aceita sessão OU a INGEST_API_KEY. A chave existe porque quem está trancado
// fora do login precisa deste endpoint justamente por não ter sessão. A sessão
// existe porque quem CONSEGUE entrar não deveria precisar decorar segredo nenhum
// para conferir a configuração — basta abrir a URL no navegador já logado.

function chaveConfere(recebida: string | null): boolean {
  const env: Record<string, string | undefined> = process.env;
  const esperada = (env.INGEST_API_KEY ?? "").trim();
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida.trim()).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

async function autorizado(req: NextRequest): Promise<boolean> {
  if (chaveConfere(req.headers.get("x-api-key"))) return true;
  return validarTokenSessao(req.cookies.get(COOKIE_SESSAO)?.value);
}

/** Primeiros 8 hex do sha256 — permite conferir se o valor é o esperado sem expô-lo. */
function impressao(v: string): string {
  return createHash("sha256").update(v).digest("hex").slice(0, 8);
}

/**
 * Host e nome do banco da connection string — nunca usuário nem senha.
 *
 * Não é credencial: sem a senha ninguém se conecta, e o Neon exige auth. E é a
 * única forma de saber a qual projeto do Neon este deployment aponta sem alguém
 * abrir a connection string, que é justamente o que a Vercel não devolve depois
 * de a variável ser marcada como sensível.
 */
function alvoBanco(bruto: string | undefined): { host: string; banco: string } | null {
  const v = (bruto ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return { host: u.hostname, banco: u.pathname.replace(/^\//, "") || "(sem nome)" };
  } catch {
    return null;
  }
}

function descrever(bruto: string | undefined) {
  const valor = bruto ?? "";
  const aparado = valor.trim();
  return {
    configurada: aparado.length > 0,
    tamanho: aparado.length,
    // espaço/quebra de linha colados junto é a causa mais comum de "a senha
    // está certa e mesmo assim não entra"
    tinhaEspacoSobrando: valor !== aparado,
    impressao: aparado.length > 0 ? impressao(aparado) : null,
  };
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json(
      { erro: "entre no dashboard, ou mande a INGEST_API_KEY no header x-api-key" },
      { status: 401 },
    );
  }
  const env: Record<string, string | undefined> = process.env;

  // O reenvio manda o N8N_REENVIO_TOKEN no header `x-api-key` do webhook. A
  // impressão permite conferir contra o token que o workflow guarda sem revelar
  // nenhum dos dois.
  const tokenDedicado = (env.N8N_REENVIO_TOKEN ?? "").trim();

  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    DASHBOARD_PASSWORD: descrever(env.DASHBOARD_PASSWORD),
    SESSION_SECRET: descrever(env.SESSION_SECRET),
    INGEST_API_KEY: descrever(env.INGEST_API_KEY),
    DATABASE_URL: {
      configurada: (env.DATABASE_URL ?? "").trim().length > 0,
      ...(alvoBanco(env.DATABASE_URL) ?? { host: null, banco: null }),
    },
    // URL não é segredo — mostrar de cara pega erro de digitação e webhook-test
    N8N_REENVIO_URL: (env.N8N_REENVIO_URL ?? "").trim() || null,
    N8N_REENVIO_TOKEN: descrever(env.N8N_REENVIO_TOKEN),
    reenvioPronto: tokenDedicado.length > 0 && (env.N8N_REENVIO_URL ?? "").trim().length > 0,
  });
}
