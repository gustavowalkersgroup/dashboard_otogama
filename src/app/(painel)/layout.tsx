import { Suspense } from "react";
import NavPrincipal from "@/components/NavPrincipal";
import BotaoSair from "@/components/BotaoSair";

export default function LayoutPainel({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-grade bg-superficie">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between pt-4">
            <div>
              <h1 className="text-lg font-semibold leading-tight">Otogama</h1>
              <p className="text-xs text-tinta-3">Métricas da automação de WhatsApp + IA</p>
            </div>
            <BotaoSair />
          </div>
          <Suspense fallback={<div className="h-11" />}>
            <NavPrincipal />
          </Suspense>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-xs text-tinta-3">
        por <span className="font-medium text-tinta-2">NexTags</span> · dados em horário de
        Brasília
        {process.env.VERCEL_GIT_COMMIT_SHA && (
          <span title={process.env.VERCEL_GIT_COMMIT_SHA}>
            {" "}
            · build {process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}
          </span>
        )}
      </footer>
    </div>
  );
}
