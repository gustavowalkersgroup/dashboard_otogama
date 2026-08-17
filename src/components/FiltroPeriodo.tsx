"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const OPCOES = [7, 30, 90];

export default function FiltroPeriodo({ dias }: { dias: number }) {
  const pathname = usePathname();
  return (
    <div className="inline-flex rounded-lg border border-grade bg-superficie p-0.5">
      {OPCOES.map((op) => (
        <Link
          key={op}
          href={`${pathname}?p=${op}`}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            op === dias ? "bg-tinta text-white" : "text-tinta-2 hover:text-tinta"
          }`}
        >
          {op} dias
        </Link>
      ))}
    </div>
  );
}
