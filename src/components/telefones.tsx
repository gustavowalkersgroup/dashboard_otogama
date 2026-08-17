"use client";

import { useSyncExternalStore } from "react";
import { telefoneCompleto, telefoneMascarado } from "@/lib/formato";

// Telefone mascarado por padrão (LGPD); "mostrar" vale pela sessão do navegador.
// Store minimalista fora do React para sincronizar todos os componentes da página.
const CHAVE = "mostrar_telefones";
const ouvintes = new Set<() => void>();

function assinar(cb: () => void) {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}
const lerCliente = () => sessionStorage.getItem(CHAVE) === "1";
const lerServidor = () => false;

function alternarMostrar() {
  sessionStorage.setItem(CHAVE, lerCliente() ? "0" : "1");
  ouvintes.forEach((cb) => cb());
}

function useMostrarTelefones(): boolean {
  return useSyncExternalStore(assinar, lerCliente, lerServidor);
}

export function ToggleTelefones() {
  const mostrar = useMostrarTelefones();
  return (
    <button
      onClick={alternarMostrar}
      className="rounded-lg border border-grade bg-superficie px-3 py-1.5 text-xs font-medium text-tinta-2 hover:text-tinta"
    >
      {mostrar ? "Ocultar telefones" : "Mostrar telefones"}
    </button>
  );
}

export function Telefone({ numero }: { numero: string | null }) {
  const mostrar = useMostrarTelefones();
  return (
    <span className="tabular-nums">
      {mostrar ? telefoneCompleto(numero) : telefoneMascarado(numero)}
    </span>
  );
}
