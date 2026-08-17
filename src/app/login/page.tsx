"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PaginaLogin() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      if (resp.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setErro(resp.status === 401 ? "Senha incorreta." : "Erro ao entrar — tente de novo.");
    } catch {
      setErro("Erro de rede — tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm rounded-2xl border border-grade bg-superficie p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold">Otogama</h1>
        <p className="mt-1 text-sm text-tinta-2">Métricas da automação · por NexTags</p>

        <label className="mt-6 block text-sm font-medium" htmlFor="senha">
          Senha de acesso
        </label>
        <input
          id="senha"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="mt-2 w-full rounded-lg border border-grade bg-white px-3 py-2.5 text-base outline-none focus:border-serie-1"
        />

        {erro && <p className="mt-3 text-sm text-critico">{erro}</p>}

        <button
          type="submit"
          disabled={enviando || senha.length === 0}
          className="mt-5 w-full rounded-lg bg-tinta px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
