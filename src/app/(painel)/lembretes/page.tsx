import Link from "next/link";
import ErroDados from "@/components/ErroDados";
import PainelReenvioLembretes from "@/components/PainelReenvioLembretes";
import { DIAS_LEMBRETE, diaLembreteValido, painelLembretes } from "@/lib/metricas";

export const dynamic = "force-dynamic";

const ROTULO: Record<string, string> = { hoje: "Hoje", amanha: "Amanhã" };

export default async function Lembretes({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const dia = diaLembreteValido((await searchParams).d);

  let painel;
  try {
    painel = await painelLembretes(dia);
  } catch (e) {
    console.error("lembretes:", e);
    return <ErroDados />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          Lembretes · consultas de {ROTULO[dia].toLowerCase()} ({painel.dataBR})
        </h2>
        <div className="inline-flex rounded-lg border border-grade bg-superficie p-0.5">
          {DIAS_LEMBRETE.map((d) => (
            <Link
              key={d}
              href={`/lembretes?d=${d}`}
              aria-current={d === dia ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                d === dia ? "bg-tinta text-white" : "text-tinta-2 hover:text-tinta"
              }`}
            >
              {ROTULO[d]}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-1 text-sm text-tinta-2">
        Para quando a Konsist cai na hora do disparo e o lembrete não sai. Aqui dá para ver quem
        ficou sem aviso e mandar de novo.
      </p>

      <PainelReenvioLembretes painel={painel} />
    </>
  );
}
