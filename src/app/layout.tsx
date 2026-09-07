import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediaGrow Content Hub",
  description: "Multi-brand social media content scheduling and auto-publishing hub.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
