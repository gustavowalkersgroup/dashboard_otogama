import { NextRequest, NextResponse } from "next/server";
import { chaveConfere, chaveIngestEsperada } from "@/lib/chave";
import { motivoDoErro, sql } from "@/lib/db";
import { comandosSchema } from "@/lib/schema";
import { COOKIE_SESSAO, validarTokenSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cria o event store no banco que ESTE deployment enxerga.
//
// Existe por causa de 30/08: a tabela `eventos` foi derrubada pela migração de
// outro app que dividia o mesmo banco do Neon, e o conserto ficou parado
// esperando alguém com a connection string e um cliente Postgres à mão. Depois
// de trocar a DATABASE_URL, um POST aqui resolve.
//
// Só cria o que falta: o DDL é todo `IF NOT EXISTS`, não apaga e não altera
// nada. Chamar duas vezes é o mesmo que chamar uma.
//
// Aceita sessão OU a INGEST_API_KEY — quem está recuperando o banco costuma não
// ter navegador logado, e o dashboard inteiro está fora do ar nesse momento.

async function autorizado(req: NextRequest): Promise<boolean> {
  if (chaveConfere(req.headers.get("x-api-key"), chaveIngestEsperada())) return true;
  return validarTokenSessao(req.cookies.get(COOKIE_SESSAO)?.value);
}

async function tabelaExiste(): Promise<boolean> {
  const linhas = await sql()`SELECT to_regclass('public.eventos') IS NOT NULL AS existe`;
  return linhas[0]?.existe === true;
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json(
      { erro: "entre no dashboard, ou mande a INGEST_API_KEY no header x-api-key" },
      { status: 401 },
    );
  }

  try {
    // Dentro do try pelo mesmo motivo da rota de ingestão: sem DATABASE_URL,
    // `sql()` lança antes de qualquer coisa e o 500 sai sem dizer o que falta.
    const db = sql();
    const existiaAntes = await tabelaExiste();
    const comandos = comandosSchema();
    for (const comando of comandos) {
      await db.query(comando);
    }
    // Conferir depois, e não confiar no silêncio do driver: `IF NOT EXISTS` não
    // reclama de nada, então sem esta checagem um DDL que rodou no banco errado
    // responderia "ok".
    if (!(await tabelaExiste())) {
      throw new Error("o DDL rodou sem erro, mas a tabela `eventos` continua ausente");
    }
    return NextResponse.json({
      ok: true,
      comandos: comandos.length,
      tabela: existiaAntes ? "ja_existia" : "criada",
    });
  } catch (e) {
    console.error("init do banco falhou:", e);
    return NextResponse.json(
      { erro: `falha ao criar o event store: ${motivoDoErro(e)}` },
      { status: 500 },
    );
  }
}
