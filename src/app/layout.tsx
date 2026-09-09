import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./workspace.css";
import "./workspace-readability.css";
import "./schedule.css";
import "./operations.css";
import "./feature-tools.css";
import "./planner.css";

export const metadata: Metadata = {
  title: "MediaGrow Content Hub",
  description: "Multi-brand social media content scheduling and auto-publishing hub.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="id"><body>{children}<footer style={{ padding: "18px 24px", textAlign: "center", fontSize: 13, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px 24px" }}><a href="/privacy">Kebijakan Privasi</a><a href="/data-deletion">Penghapusan Data</a><a href="/terms">Ketentuan Layanan</a></footer></body></html>;
}
