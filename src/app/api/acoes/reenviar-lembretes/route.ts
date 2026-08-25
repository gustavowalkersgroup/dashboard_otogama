import { NextRequest, NextResponse } from "next/server";
import { diaLembreteValido, painelLembretes } from "@/lib/metricas";
import { pedirReenvio } from "@/lib/reenvio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Teto por pedido. Não é medo do n8n — é que um clique não deve poder disparar
// WhatsApp para a agenda inteira de uma semana por acidente.
const MAX_POR_PEDIDO = 300;

export async function POST(req: NextRequest) {
  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "body não é JSON válido" }, { status: 400 });
  }

  const dia = diaLembreteValido(typeof corpo.dia === "string" ? corpo.dia : undefined);
  const forcar = corpo.forcar === true;
  const pedidas = Array.isArray(corpo.chaves) ? corpo.chaves.map((c) => String(c)) : [];

  if (pedidas.length === 0) {
    return NextResponse.json({ erro: "nenhuma consulta selecionada" }, { status: 400 });
  }
  if (pedidas.length > MAX_POR_PEDIDO) {
    return NextResponse.json(
      { erro: `no máximo ${MAX_POR_PEDIDO} consultas por pedido` },
      { status: 400 },
    );
  }

  // Isto envia WhatsApp para paciente. Não basta a sessão ser válida: as chaves
  // são reconferidas contra a lista que o servidor mesmo calcula, senão um pedido
  // forjado escolheria para quem mandar.
  const painel = await painelLembretes(dia);
  const permitidas = new Set(painel.faltando.map((c) => c.chave));
  const chaves = pedidas.filter((c) => permitidas.has(c));
  const recusadas = pedidas.length - chaves.length;

  if (chaves.length === 0) {
    return NextResponse.json(
      {
        erro:
          "Nenhuma das consultas escolhidas ainda está sem lembrete — a lista mudou. Atualize a página.",
      },
      { status: 409 },
    );
  }

  const r = await pedirReenvio({ data: painel.dataBR, chaves, forcar });
  if (!r.ok) {
    return NextResponse.json({ erro: r.erro }, { status: r.status });
  }

  return NextResponse.json({
    ok: true,
    enfileiradas: chaves.length,
    recusadas,
    data: painel.dataBR,
    n8n: r.corpo,
  });
}
