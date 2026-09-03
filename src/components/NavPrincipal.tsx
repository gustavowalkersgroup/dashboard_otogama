"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// `periodo: false` para as telas que não se recortam por período: Lembretes e
// Consultas falam de um dia de agenda (?d=), então carregar o ?p= para lá só
// sujaria a URL.
const ITENS = [
  { href: "/", rotulo: "Visão geral", periodo: true },
  { href: "/confirmacoes", rotulo: "Confirmações", periodo: true },
  { href: "/agendamentos", rotulo: "Agendamentos IA", periodo: true },
  { href: "/agenda", rotulo: "Agenda", periodo: true },
  { href: "/consultas", rotulo: "Consultas", periodo: false },
  { href: "/lembretes", rotulo: "Lembretes", periodo: false },
  { href: "/saude", rotulo: "Saúde da API", periodo: true },
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
            href={`${item.href}${item.periodo ? sufixo : ""}`}
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
