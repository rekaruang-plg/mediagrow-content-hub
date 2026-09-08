import type { ReactNode } from "react";
import "./policies.css";

export default function PolicyLayout({ children }: { children: ReactNode }) {
  return <main className="policy-page"><a href="/" className="policy-brand">MediaGrow Content Hub</a><article>{children}</article><nav aria-label="Informasi layanan"><a href="/privacy">Kebijakan Privasi</a><a href="/data-deletion">Penghapusan Data</a><a href="/terms">Ketentuan Layanan</a><a href="/">Kembali ke aplikasi</a></nav></main>;
}
