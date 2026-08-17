"use client";

import { useRouter } from "next/navigation";

export default function BotaoSair() {
  const router = useRouter();
  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      onClick={sair}
      className="rounded-lg px-3 py-1.5 text-sm text-tinta-2 hover:bg-grade/50 hover:text-tinta"
    >
      Sair
    </button>
  );
}
