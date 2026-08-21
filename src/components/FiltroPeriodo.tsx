"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROTULO_DIA } from "@/lib/formato";
import { DIAS_RELATIVOS, PERIODOS, type Periodo } from "@/lib/metricas";

// Dois grupos, não um só: os recortes por dia respondem "como está a agenda
// desse dia" (recorte pela data da consulta) e os de período respondem "o que a
// automação fez nesse intervalo" (recorte pela data do evento). Misturar tudo
// numa fileira sugeriria que são a mesma escala.
export default function FiltroPeriodo({ dias }: { dias: Periodo }) {
  const pathname = usePathname();

  const item = (valor: string | number, rotulo: string) => (
    <Link
      key={valor}
      href={`${pathname}?p=${valor}`}
      aria-current={valor === dias ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        valor === dias ? "bg-tinta text-white" : "text-tinta-2 hover:text-tinta"
      }`}
    >
      {rotulo}
    </Link>
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-grade bg-superficie p-0.5">
        {DIAS_RELATIVOS.map((d) => item(d, ROTULO_DIA[d]))}
      </div>
      <div className="inline-flex rounded-lg border border-grade bg-superficie p-0.5">
        {PERIODOS.map((p) => item(p, `${p} dias`))}
      </div>
    </div>
  );
}
