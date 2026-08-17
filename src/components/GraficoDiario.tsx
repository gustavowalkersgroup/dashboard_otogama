"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PontoDiario } from "@/lib/metricas";

const COR_ENVIOS = "#2a78d6"; // série 1
const COR_CONFIRMACOES = "#eb6834"; // série 2

type Linha = { rotulo: string; envios: number; confirmacoes: number };

function TooltipCustom({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const por = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div className="rounded-lg border border-grade bg-superficie px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-tinta-2">Lembretes enviados: {por.envios ?? 0}</p>
      <p className="text-tinta-2">Confirmações: {por.confirmacoes ?? 0}</p>
    </div>
  );
}

export default function GraficoDiario({ serie }: { serie: PontoDiario[] }) {
  const dados: Linha[] = serie.map((p) => ({
    rotulo: `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`,
    envios: p.envios,
    confirmacoes: p.confirmacoes,
  }));
  const muitosDias = dados.length > 35;

  return (
    <div className="rounded-2xl border border-grade bg-superficie p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Envios × confirmações por dia</h2>
        <div className="flex gap-4 text-xs text-tinta-2">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COR_ENVIOS }}
            />
            Lembretes (mensagens)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COR_CONFIRMACOES }}
            />
            Confirmações
          </span>
        </div>
      </div>
      <div className="mt-3 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} barGap={2} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#e1e0d9" strokeWidth={1} />
            <XAxis
              dataKey="rotulo"
              tick={{ fill: "#898781", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#c3c2b7" }}
              interval={muitosDias ? Math.floor(dados.length / 10) : "preserveStartEnd"}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "#898781", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<TooltipCustom />} cursor={{ fill: "rgba(11,11,11,0.04)" }} />
            <Bar dataKey="envios" fill={COR_ENVIOS} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar
              dataKey="confirmacoes"
              fill={COR_CONFIRMACOES}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
