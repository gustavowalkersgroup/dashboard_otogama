import CardMetrica from "@/components/CardMetrica";
import ErroDados from "@/components/ErroDados";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import TabelaConfirmacoes from "@/components/TabelaConfirmacoes";
import { numeroBR } from "@/lib/formato";
import {
  contagemConfirmacoes,
  listaConfirmados,
  listaPedidosAjuda,
  listaPendentes,
  listaPresasApi,
  PENDENTE_APOS_HORAS,
  periodoValido,
  rotuloPeriodo,
} from "@/lib/metricas";

export const dynamic = "force-dynamic";

export default async function Confirmacoes({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const dias = periodoValido((await searchParams).p);

  let dados;
  try {
    const [contagem, confirmados, pendentes, ajuda, presasApi] = await Promise.all([
      contagemConfirmacoes(dias),
      listaConfirmados(dias),
      listaPendentes(dias),
      listaPedidosAjuda(dias),
      listaPresasApi(dias),
    ]);
    dados = { contagem, confirmados, pendentes, ajuda, presasApi };
  } catch (e) {
    console.error("confirmações:", e);
    return (
      <>
        <FiltroPeriodo dias={dias} />
        <div className="mt-4">
          <ErroDados />
        </div>
      </>
    );
  }

  const { contagem, confirmados, pendentes, ajuda, presasApi } = dados;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Confirmações · {rotuloPeriodo(dias)}</h2>
        <FiltroPeriodo dias={dias} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <CardMetrica
          rotulo="Confirmadas na Konsist"
          valor={numeroBR(contagem.ok)}
          detalhe="gravadas com sucesso"
        />
        <CardMetrica
          rotulo="Já estavam confirmadas"
          valor={numeroBR(contagem.jaConfirmado)}
          detalhe="paciente confirmou de novo"
        />
        <CardMetrica
          rotulo="Presas por queda da API"
          valor={numeroBR(contagem.erroApi)}
          detalhe="na fila do n8n, retentando"
          className={contagem.erroApi > 0 ? "border-alerta/50 bg-alerta/5" : ""}
        />
        <CardMetrica
          rotulo="Paciente não localizado"
          valor={numeroBR(contagem.semPaciente)}
          detalhe="chave sem paciente na Konsist"
        />
      </div>

      <p className="mt-4 text-xs text-tinta-3">
        “Sem resposta” considera agendamentos avisados há mais de {PENDENTE_APOS_HORAS}h e sem
        confirmação até agora.
      </p>

      <div className="mt-2">
        <TabelaConfirmacoes
          confirmados={confirmados}
          pendentes={pendentes}
          ajuda={ajuda}
          presasApi={presasApi}
        />
      </div>
    </>
  );
}
