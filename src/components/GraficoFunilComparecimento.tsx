"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EstagioFunil } from "@/lib/metricas";

const COR_COM_LEMBRETE = "#2a78d6"; // categórico slot 1
const COR_SEM_LEMBRETE = "#eb6834"; // categórico slot 2

type Linha = {
  estagio: string;
  comLembretePct: number;
  semLembretePct: number;
  comLembreteN: number;
  comLembreteBase: number;
  semLembreteN: number;
  semLembreteBase: number;
};

function TooltipCustom({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; payload: Linha }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-grade bg-superficie px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-tinta-2">
        Com lembrete: {Math.round(d.comLembretePct)}% ({d.comLembreteN} de {d.comLembreteBase})
      </p>
      <p className="text-tinta-2">
        Sem lembrete: {Math.round(d.semLembretePct)}% ({d.semLembreteN} de {d.semLembreteBase})
      </p>
    </div>
  );
}

/** Funil (barras) comparando quem recebeu lembrete via WhatsApp vs quem não recebeu. */
export default function GraficoFunilComparecimento({ estagios }: { estagios: EstagioFunil[] }) {
  const com = estagios.find((e) => e.grupo === "com_lembrete");
  const sem = estagios.find((e) => e.grupo === "sem_lembrete");
  const comBase = com?.agendado ?? 0;
  const semBase = sem?.agendado ?? 0;
  const pct = (v: number, base: number) => (base > 0 ? (v / base) * 100 : 0);

  const dados: Linha[] = [
    {
      estagio: "Agendado",
      comLembretePct: 100,
      semLembretePct: 100,
      comLembreteN: comBase,
      comLembreteBase: comBase,
      semLembreteN: semBase,
      semLembreteBase: semBase,
    },
    {
      estagio: "Confirmado",
      comLembretePct: pct(com?.confirmado ?? 0, comBase),
      semLembretePct: pct(sem?.confirmado ?? 0, semBase),
      comLembreteN: com?.confirmado ?? 0,
      comLembreteBase: comBase,
      semLembreteN: sem?.confirmado ?? 0,
      semLembreteBase: semBase,
    },
    {
      estagio: "Compareceu",
      comLembretePct: pct(com?.compareceu ?? 0, comBase),
      semLembretePct: pct(sem?.compareceu ?? 0, semBase),
      comLembreteN: com?.compareceu ?? 0,
      comLembreteBase: comBase,
      semLembreteN: sem?.compareceu ?? 0,
      semLembreteBase: semBase,
    },
  ];

  if (comBase === 0 && semBase === 0) {
    return (
      <div className="rounded-2xl border border-grade bg-superficie p-4">
        <h2 className="text-sm font-medium">Comparecimento: com lembrete × sem lembrete</h2>
        <p className="mt-3 text-sm text-tinta-2">
          Sem consultas com desfecho (Realizado/Faltou) no período ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-grade bg-superficie p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Comparecimento: com lembrete × sem lembrete</h2>
        <div className="flex gap-4 text-xs text-tinta-2">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COR_COM_LEMBRETE }}
            />
            Com lembrete ({numeroBase(comBase)})
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: COR_SEM_LEMBRETE }}
            />
            Sem lembrete ({numeroBase(semBase)})
          </span>
        </div>
      </div>
      <div className="mt-3 h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            barGap={2}
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
              dataKey="estagio"
              width={84}
              tick={{ fill: "#52514e", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "#c3c2b7" }}
            />
            <Tooltip content={<TooltipCustom />} cursor={{ fill: "rgba(11,11,11,0.04)" }} />
            <Bar dataKey="comLembretePct" fill={COR_COM_LEMBRETE} radius={[0, 4, 4, 0]} maxBarSize={20} />
            <Bar dataKey="semLembretePct" fill={COR_SEM_LEMBRETE} radius={[0, 4, 4, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function numeroBase(n: number): string {
  return `${n} agendado${n === 1 ? "" : "s"}`;
}
