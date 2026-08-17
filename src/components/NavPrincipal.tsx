"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ITENS = [
  { href: "/", rotulo: "Visão geral" },
  { href: "/confirmacoes", rotulo: "Confirmações" },
  { href: "/agendamentos", rotulo: "Agendamentos IA" },
  { href: "/saude", rotulo: "Saúde da API" },
];

export default function NavPrincipal() {
  const pathname = usePathname();
  const params = useSearchParams();
  const p = params.get("p");
  const sufixo = p ? `?p=${p}` : "";

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {ITENS.map((item) => {
        const ativo = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={`${item.href}${sufixo}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              ativo
                ? "border-tinta text-tinta"
                : "border-transparent text-tinta-2 hover:text-tinta"
            }`}
          >
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
