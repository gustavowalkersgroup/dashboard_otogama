import { NextResponse } from "next/server";
import { motivoDoErro, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sem auth: usado pelo n8n para monitorar o próprio dashboard.
//
// Checa o event store, não só se o processo respira. Um health check que devolve
// 200 enquanto a tabela `eventos` não existe é pior do que não ter health check:
// foi esse silêncio que deixou a ingestão quebrada de 25/08 a 30/08 sem ninguém
// perceber. Quebrado responde 503, para o nó HTTP do n8n falhar e o alerta sair
// sozinho.
//
// Não revela host, banco nem credencial — isso é do /api/login/diagnostico, que
// pede sessão. Aqui vai só o suficiente para saber QUAL conserto fazer:
// `sem_database_url` é configuração da Vercel, `tabela_ausente` é rodar o
// /api/eventos/init, `sem_conexao` é o Neon.

type Estado = "ok" | "sem_database_url" | "tabela_ausente" | "sem_conexao";

// Endpoint público que toca o banco: sem uma memória curta, qualquer um
// multiplica requisição nossa no Neon só apertando F5. 15s não atrasa nada —
// quem observa isso roda de 15 em 15 minutos.
const VALIDADE_MS = 15_000;
let cache: { em: number; estado: Estado; motivo: string | null } | null = null;

async function medir(): Promise<{ estado: Estado; motivo: string | null }> {
  const env: Record<string, string | undefined> = process.env;
  if (!(env.DATABASE_URL ?? "").trim()) {
    return { estado: "sem_database_url", motivo: "DATABASE_URL ausente ou vazia neste deployment" };
  }
  try {
    const linhas = await sql()`SELECT to_regclass('public.eventos') IS NOT NULL AS existe`;
    if (linhas[0]?.existe === true) return { estado: "ok", motivo: null };
    return {
      estado: "tabela_ausente",
      motivo: "a tabela `eventos` não existe neste banco — rode POST /api/eventos/init",
    };
  } catch (e) {
    return { estado: "sem_conexao", motivo: motivoDoErro(e) };
  }
}

export async function GET() {
  const agora = Date.now();
  if (!cache || agora - cache.em > VALIDADE_MS) {
    const medido = await medir();
    cache = { em: agora, ...medido };
    if (medido.estado !== "ok") {
      console.error(`health: event store ${medido.estado} — ${medido.motivo}`);
    }
  }

  const ok = cache.estado === "ok";
  return NextResponse.json(
    { ok, ts: new Date().toISOString(), store: cache.estado, motivo: cache.motivo },
    { status: ok ? 200 : 503 },
  );
}
