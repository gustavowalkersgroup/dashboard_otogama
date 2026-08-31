import BannerApi from "@/components/BannerApi";
import CardMetrica from "@/components/CardMetrica";
import ErroDados from "@/components/ErroDados";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import GraficoDiario from "@/components/GraficoDiario";
import GraficoFunilComparecimento from "@/components/GraficoFunilComparecimento";
import { duracaoHumana, numeroBR } from "@/lib/formato";
import {
  contagemConfirmacoes,
  contagemLembretes,
  funilComparecimento,
  listaAgendamentosIa,
  periodoValido,
  resumoAgendamentosIa,
  saudeApi,
  serieDiaria,
  taxaConfirmacao,
  tempoAteConfirmar,
  trabalhoPoupado,
  rotuloPeriodo,
} from "@/lib/metricas";

/**
 * Diz sobre quantos agendamentos a taxa fala, e de onde veio a confirmação.
 *
 * Mostra "1 de 4 com status" e não "1 de 310 avisados" porque o denominador é
 * só o que dá para julgar: o poll varre 21 dias, e o card de 30 ou 90 conta
 * lembretes mais antigos que isso. O total de avisados vem junto, para não
 * sumir da tela.
 *
 * E separa "só pela Konsist": uma confirmação vista apenas na situação do
 * agendamento não prova que o paciente respondeu à nossa mensagem — pode ter
 * ligado para a clínica. Somar sem separar infla a métrica da automação.
 */
function detalheConfirmacao(t: {
  confirmados: number;
  avisados: number;
  julgaveis: number;
  soSituacao: number;
}) {
  if (t.julgaveis === 0) {
    return `sem status conhecido dos ${numeroBR(t.avisados)} avisados`;
  }
  const base = `${numeroBR(t.confirmados)} de ${numeroBR(t.julgaveis)} com status · ${numeroBR(t.avisados)} avisados`;
  return t.soSituacao > 0 ? `${base} · ${numeroBR(t.soSituacao)} só pela Konsist` : base;
}

export const dynamic = "force-dynamic";

export default async function VisaoGeral({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const dias = periodoValido((await searchParams).p);

  let dados;
  try {
    const [lembretes, confirmacoes, taxa, tempo, agendamentos, serie, saude, funil] = await Promise.all([
      contagemLembretes(dias),
      contagemConfirmacoes(dias),
      taxaConfirmacao(dias),
      tempoAteConfirmar(dias),
      listaAgendamentosIa(dias),
      serieDiaria(dias),
      saudeApi(dias),
      funilComparecimento(dias),
    ]);
    dados = { lembretes, confirmacoes, taxa, tempo, agendamentos, serie, saude, funil };
  } catch (e) {
    console.error("visão geral:", e);
    return (
      <>
        <FiltroPeriodo dias={dias} />
        <div className="mt-4">
          <ErroDados />
        </div>
      </>
    );
  }

  const { lembretes, confirmacoes, taxa, tempo, agendamentos, serie, saude, funil } = dados;
  const ia = resumoAgendamentosIa(agendamentos);
  const poupado = trabalhoPoupado({
    mensagensLembrete: lembretes.mensagens,
    mensagensConfirmacao: confirmacoes.mensagens,
    agendamentosIa: ia.total,
  });

  const breakdownIa = ["Agendado", "Em Análise", "Recusado"]
    .map((s) => ({ s, q: ia.porStatus.get(s) ?? 0 }))
    .filter(({ q }) => q > 0)
    .map(({ s, q }) => `${q} ${s.toLowerCase()}`)
    .join(" · ");

  const horas =
    poupado.horas >= 10 ? `${numeroBR(Math.round(poupado.horas))}h` : `${poupado.horas.toFixed(1).replace(".", ",")}h`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Visão geral · {rotuloPeriodo(dias)}</h2>
        <FiltroPeriodo dias={dias} />
      </div>

      <div className="mt-4">
        <BannerApi saude={saude} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <CardMetrica
          rotulo="Consultas marcadas pela IA"
          valor={numeroBR(ia.total)}
          detalhe={breakdownIa || "pré-agendamentos criados na Konsist"}
        />
        <CardMetrica
          rotulo="Lembretes enviados"
          valor={numeroBR(lembretes.mensagens)}
          detalhe={`${numeroBR(lembretes.agendamentos)} agendamentos avisados`}
        />
        <CardMetrica
          rotulo="Taxa de confirmação"
          valor={taxa.taxa === null ? "—" : `${Math.round(taxa.taxa * 100)}%`}
          detalhe={detalheConfirmacao(taxa)}
        />
        <CardMetrica
          rotulo="Tempo até confirmar"
          valor={tempo.medianaS === null ? "—" : duracaoHumana(tempo.medianaS)}
          detalhe={
            tempo.mediaS === null
              ? "sem confirmações no período"
              : `média ${duracaoHumana(tempo.mediaS)} · mediana de ${numeroBR(tempo.total)} confirmações`
          }
        />
        <CardMetrica
          rotulo="Trabalho poupado"
          valor={horas}
          detalhe={`≈ ${poupado.diasUteis.toFixed(1).replace(".", ",")} dias úteis de um funcionário`}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mt-4">
        <GraficoFunilComparecimento estagios={funil} />
      </div>

      {serie.length > 0 && (
        <div className="mt-4">
          <GraficoDiario serie={serie} />
        </div>
      )}
    </>
  );
}
