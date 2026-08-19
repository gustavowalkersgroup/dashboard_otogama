import CardMetrica from "@/components/CardMetrica";
import ErroDados from "@/components/ErroDados";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import GraficoComparecimentoIa from "@/components/GraficoComparecimentoIa";
import TabelaAgendamentos from "@/components/TabelaAgendamentos";
import { numeroBR } from "@/lib/formato";
import {
  comparecimentoIaVsHumano,
  listaAgendamentosIa,
  periodoValido,
  resumoAgendamentosIa,
} from "@/lib/metricas";

export const dynamic = "force-dynamic";

export default async function Agendamentos({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const dias = periodoValido((await searchParams).p);

  let agendamentos, comparecimento;
  try {
    [agendamentos, comparecimento] = await Promise.all([
      listaAgendamentosIa(dias),
      comparecimentoIaVsHumano(dias),
    ]);
  } catch (e) {
    console.error("agendamentos:", e);
    return (
      <>
        <FiltroPeriodo dias={dias} />
        <div className="mt-4">
          <ErroDados />
        </div>
      </>
    );
  }

  const resumo = resumoAgendamentosIa(agendamentos);
  const q = (s: string) => resumo.porStatus.get(s) ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Agendamentos da IA · últimos {dias} dias</h2>
        <FiltroPeriodo dias={dias} />
      </div>

      <p className="mt-1 text-xs text-tinta-3">
        Pré-agendamentos que a IA criou na agenda da clínica; a recepção aprova ou recusa.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardMetrica rotulo="Criados pela IA" valor={numeroBR(resumo.total)} />
        <CardMetrica rotulo="Agendados" valor={numeroBR(q("Agendado"))} detalhe="aprovados pela recepção" />
        <CardMetrica rotulo="Em análise" valor={numeroBR(q("Em Análise"))} detalhe="aguardando a recepção" />
        <CardMetrica rotulo="Recusados" valor={numeroBR(q("Recusado"))} />
      </div>

      <div className="mt-4">
        <GraficoComparecimentoIa grupos={comparecimento} />
      </div>

      <div className="mt-4">
        <TabelaAgendamentos agendamentos={agendamentos} />
      </div>
    </>
  );
}
