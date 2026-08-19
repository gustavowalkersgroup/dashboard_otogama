"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DesfechoMedico } from "@/lib/metricas";

const COR_PENDENTE = "#c3c2b7"; // status: neutro
const COR_REALIZADO = "#0ca30c"; // status: bom
const COR_FALTOU = "#d03b3b"; // status: crítico
const COR_CANCELADO = "#ec835a"; // status: sério

type Linha = {
  medico: string;
  total: number;
  pendentePct: number;
  realizadoPct: number;
  faltouPct: number;
  canceladoPct: number;
  pendente: number;
  realizado: number;
  faltou: number;
  cancelado: number;
};

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
      <p className="mt-1 text-tinta-2">{d.total} consultas com desfecho no período</p>
      <p className="text-tinta-2">Realizado: {d.realizado}</p>
      <p className="text-tinta-2">Faltou: {d.faltou}</p>
      <p className="text-tinta-2">Cancelado: {d.cancelado}</p>
      <p className="text-tinta-2">Pendente: {d.pendente}</p>
    </div>
  );
}

const LEGENDA = [
  { rotulo: "Pendente", cor: COR_PENDENTE },
  { rotulo: "Realizado", cor: COR_REALIZADO },
  { rotulo: "Faltou", cor: COR_FALTOU },
  { rotulo: "Cancelado", cor: COR_CANCELADO },
];

export default function GraficoDesfechoMedico({ dados }: { dados: DesfechoMedico[] }) {
  if (dados.length === 0) {
    return (
      <div className="rounded-2xl border border-grade bg-superficie p-4">
        <h2 className="text-sm font-medium">Desfecho por médico</h2>
        <p className="mt-3 text-sm text-tinta-2">Sem dados de agenda no período ainda.</p>
      </div>
    );
  }

  const linhas: Linha[] = dados.map((d) => ({
    medico: d.medico,
    total: d.total,
    pendentePct: d.total > 0 ? (d.pendente / d.total) * 100 : 0,
    realizadoPct: d.total > 0 ? (d.realizado / d.total) * 100 : 0,
    faltouPct: d.total > 0 ? (d.faltou / d.total) * 100 : 0,
    canceladoPct: d.total > 0 ? (d.cancelado / d.total) * 100 : 0,
    pendente: d.pendente,
    realizado: d.realizado,
    faltou: d.faltou,
    cancelado: d.cancelado,
  }));
  const altura = Math.max(140, linhas.length * 40 + 24);

  return (
    <div className="rounded-2xl border border-grade bg-superficie p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Desfecho por médico</h2>
        <div className="flex flex-wrap gap-3 text-xs text-tinta-2">
          {LEGENDA.map((l) => (
            <span key={l.rotulo} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: l.cor }}
              />
              {l.rotulo}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 w-full" style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={linhas}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="#e1e0d9" strokeWidth={1} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "#898781", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="medico"
              width={128}
              tick={{ fill: "#52514e", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "#c3c2b7" }}
            />
            <Tooltip content={<TooltipCustom />} cursor={{ fill: "rgba(11,11,11,0.04)" }} />
            {/* stroke na cor da superfície funciona como o "gap" de 2px entre segmentos */}
            <Bar dataKey="pendentePct" stackId="d" fill={COR_PENDENTE} stroke="#fcfcfb" strokeWidth={2} />
            <Bar dataKey="realizadoPct" stackId="d" fill={COR_REALIZADO} stroke="#fcfcfb" strokeWidth={2} />
            <Bar dataKey="faltouPct" stackId="d" fill={COR_FALTOU} stroke="#fcfcfb" strokeWidth={2} />
            <Bar
              dataKey="canceladoPct"
              stackId="d"
              fill={COR_CANCELADO}
              stroke="#fcfcfb"
              strokeWidth={2}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
