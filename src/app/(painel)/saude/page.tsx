import BannerApi from "@/components/BannerApi";
import CardMetrica from "@/components/CardMetrica";
import ErroDados from "@/components/ErroDados";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import { dataHoraAnoBRT, duracaoHumana, numeroBR } from "@/lib/formato";
import { periodoValido, saudeApi, rotuloPeriodo } from "@/lib/metricas";

export const dynamic = "force-dynamic";

export default async function Saude({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const dias = periodoValido((await searchParams).p);

  let saude;
  try {
    saude = await saudeApi(dias);
  } catch (e) {
    console.error("saúde da API:", e);
    return (
      <>
        <FiltroPeriodo dias={dias} />
        <div className="mt-4">
          <ErroDados />
        </div>
      </>
    );
  }

  const ultimaQueda = saude.quedas[0];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Saúde da API da clínica · {rotuloPeriodo(dias)}</h2>
        <FiltroPeriodo dias={dias} />
      </div>

      <p className="mt-1 text-xs text-tinta-3">
        A API da Konsist roda dentro da clínica — quedas aqui são do sistema deles, não da
        automação.
      </p>

      <div className="mt-4">
        <BannerApi saude={saude} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardMetrica
          rotulo="Disponibilidade"
          valor={saude.uptimePct === null ? "—" : `${saude.uptimePct.toFixed(1).replace(".", ",")}%`}
          detalhe="no período"
        />
        <CardMetrica rotulo="Quedas" valor={numeroBR(saude.quedas.length)} />
        <CardMetrica
          rotulo="Tempo total fora"
          valor={saude.tempoForaS > 0 ? duracaoHumana(saude.tempoForaS) : "0"}
        />
        <CardMetrica
          rotulo="Última queda"
          valor={ultimaQueda ? dataHoraAnoBRT(ultimaQueda.inicio) : "—"}
          detalhe={ultimaQueda?.detalhe ?? undefined}
        />
      </div>

      <section className="mt-4 rounded-2xl border border-grade bg-superficie p-4">
        <h3 className="text-sm font-semibold">Linha do tempo de quedas</h3>
        {saude.quedas.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-2">Nenhuma queda registrada no período. ✓</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Início</th>
                  <th className="py-1.5 pr-3 font-medium">Fim</th>
                  <th className="py-1.5 pr-3 font-medium">Duração</th>
                  <th className="py-1.5 font-medium">Causa registrada</th>
                </tr>
              </thead>
              <tbody>
                {saude.quedas.map((q, i) => (
                  <tr key={i} className="border-t border-grade">
                    <td className="py-2 pr-3 tabular-nums">{dataHoraAnoBRT(q.inicio)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {q.fim ? (
                        dataHoraAnoBRT(q.fim)
                      ) : (
                        <span className="font-medium text-critico">▲ em curso</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{duracaoHumana(q.duracaoS)}</td>
                    <td className="py-2 text-tinta-2">{q.detalhe ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
