import { dataHoraBRT } from "@/lib/formato";
import type { SaudeApi } from "@/lib/metricas";

// Cores de status são reservadas (bom/crítico) e sempre acompanham ícone + texto.
export default function BannerApi({ saude }: { saude: SaudeApi }) {
  if (saude.estadoAtual === "desconhecido") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-grade bg-superficie px-4 py-3 text-sm text-tinta-2">
        <span aria-hidden>◌</span>
        Sem dados de monitoramento da API da clínica ainda.
      </div>
    );
  }

  const ok = saude.estadoAtual === "ok";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-3 text-sm ${
        ok ? "border-bom/30 bg-bom/5" : "border-critico/40 bg-critico/5"
      }`}
    >
      <span className={ok ? "text-bom" : "text-critico"} aria-hidden>
        {ok ? "●" : "▲"}
      </span>
      <span className="font-medium">
        {ok ? "API da clínica no ar" : "API da clínica fora do ar"}
      </span>
      <span className="text-tinta-2">
        {ok ? "desde" : "detectado em"} {saude.desde ? dataHoraBRT(saude.desde) : "—"}
        {!ok && saude.detalheAtual ? ` · ${saude.detalheAtual}` : ""}
      </span>
    </div>
  );
}
