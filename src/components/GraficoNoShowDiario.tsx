"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PontoNoShow } from "@/lib/metricas";

const COR_FALTOU = "#d03b3b"; // status: crítico — mesma cor do "Faltou" em todo o app

type Linha = { rotulo: string; taxaPct: number | null; realizado: number; faltou: number };

function TooltipCustom({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: Linha }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-grade bg-superficie px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-tinta-2">
        Taxa de falta: {d.taxaPct === null ? "—" : `${Math.round(d.taxaPct)}%`}
      </p>
      <p className="text-tinta-2">
        {d.faltou} faltou de {d.realizado + d.faltou} com desfecho
      </p>
    </div>
  );
}

export default function GraficoNoShowDiario({ serie }: { serie: PontoNoShow[] }) {
  const dados: Linha[] = serie.map((p) => ({
    rotulo: `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`,
    taxaPct: p.taxa === null ? null : p.taxa * 100,
    realizado: p.realizado,
    faltou: p.faltou,
  }));
  const muitosDias = dados.length > 35;

  return (
    <div className="rounded-2xl border border-grade bg-superficie p-4">
      <h2 className="text-sm font-medium">Taxa de falta por dia</h2>
      <div className="mt-3 h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
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
              tickFormatter={(v) => `${v}%`}
              domain={[0, 100]}
              tick={{ fill: "#898781", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<TooltipCustom />} cursor={{ fill: "rgba(11,11,11,0.04)" }} />
            <Bar dataKey="taxaPct" fill={COR_FALTOU} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
