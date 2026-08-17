import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Otogama · Métricas",
  description: "Dashboard de métricas da automação WhatsApp + IA da clínica Otogama",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
