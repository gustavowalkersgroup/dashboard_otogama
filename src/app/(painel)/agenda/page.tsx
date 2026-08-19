import CardMetrica from "@/components/CardMetrica";
import ErroDados from "@/components/ErroDados";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import GraficoDesfechoMedico from "@/components/GraficoDesfechoMedico";
import GraficoNoShowDiario from "@/components/GraficoNoShowDiario";
import { numeroBR } from "@/lib/formato";
import { desfechoPorMedico, periodoValido, serieNoShowDiaria, taxaNoShow } from "@/lib/metricas";

export const dynamic = "force-dynamic";

export default async function Agenda({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const dias = periodoValido((await searchParams).p);

  let dados;
  try {
    const [noShow, serie, porMedico] = await Promise.all([
      taxaNoShow(dias),
      serieNoShowDiaria(dias),
      desfechoPorMedico(dias),
    ]);
    dados = { noShow, serie, porMedico };
  } catch (e) {
    console.error("agenda:", e);
    return (
      <>
        <FiltroPeriodo dias={dias} />
        <div className="mt-4">
          <ErroDados />
        </div>
      </>
    );
  }

  const { noShow, serie, porMedico } = dados;
  const resolvidas = noShow.realizado + noShow.faltou;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Agenda · últimos {dias} dias</h2>
        <FiltroPeriodo dias={dias} />
      </div>

      <p className="mt-1 text-xs text-tinta-3">
        Alimentado pelo poll horário do n8n na Konsist — dados de agenda chegam com
        granularidade de ~1h, não em tempo real.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardMetrica
          rotulo="Taxa de falta"
          valor={noShow.taxa === null ? "—" : `${Math.round(noShow.taxa * 100)}%`}
          detalhe={resolvidas > 0 ? `${numeroBR(noShow.faltou)} de ${numeroBR(resolvidas)} resolvidas` : "sem desfecho no período"}
        />
        <CardMetrica rotulo="Realizadas" valor={numeroBR(noShow.realizado)} />
        <CardMetrica rotulo="Canceladas" valor={numeroBR(noShow.cancelado)} />
        <CardMetrica rotulo="Pendentes" valor={numeroBR(noShow.pendente)} detalhe="agendado/confirmado, ainda sem desfecho" />
      </div>

      <div className="mt-4">
        <GraficoNoShowDiario serie={serie} />
      </div>

      <div className="mt-4">
        <GraficoDesfechoMedico dados={porMedico} />
      </div>
    </>
  );
}
