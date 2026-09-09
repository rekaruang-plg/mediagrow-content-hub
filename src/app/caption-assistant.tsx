"use client";

import { Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaptionFormat, CaptionGoal, CaptionVariant } from "@/lib/ai/captions";

type Props = {
  accessToken: string;
  brandId: string;
  title: string;
  brief: string;
  format: CaptionFormat;
  channels: string[];
  onUse: (caption: string) => void;
};

const goals: { value: CaptionGoal; label: string; help: string }[] = [
  { value: "education", label: "Edukasi", help: "Memberi insight dan membangun kepercayaan." },
  { value: "soft_sell", label: "Soft selling", help: "Menawarkan secara natural dan tidak memaksa." },
  { value: "promotion", label: "Promo", help: "Fokus pada penawaran dan tindakan berikutnya." },
];

export function CaptionAssistant({ accessToken, brandId, title, brief, format, channels, onUse }: Props) {
  const [goal, setGoal] = useState<CaptionGoal>("soft_sell");
  const [variants, setVariants] = useState<CaptionVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const channelKey = channels.join(",");

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setVariants([]);
    setMessage("");
    setLoading(false);
  }, [brandId, title, brief, format, channelKey]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function generate() {
    if (!brandId) { setMessage("Pilih brand terlebih dahulu."); return; }
    if (title.trim().length < 3) { setMessage("Isi judul minimal 3 karakter agar caption lebih relevan."); return; }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true); setMessage(""); setVariants([]);
    try {
      const result = await fetch("/api/ai/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ brandId, title, brief: brief.trim() || null, goal, format, channels }),
        signal: controller.signal,
      });
      const data = await result.json() as { variants?: CaptionVariant[]; error?: string; notice?: string };
      if (!result.ok || !data.variants) throw new Error(data.error || "Caption belum dapat dibuat.");
      setVariants(data.variants);
      setMessage(data.notice || "Tiga pilihan siap. Pilih salah satu, lalu edit bila diperlukan.");
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Caption belum dapat dibuat.");
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setLoading(false); }
    }
  }

  return <section className="caption-assistant" aria-labelledby="caption-assistant-title">
    <div className="caption-assistant-heading"><span><Sparkles size={18}/></span><div><b id="caption-assistant-title">Caption Otomatis</b><small>Mengikuti Brand Kit, format, judul, dan brief.</small></div></div>
    <div className="caption-goals" role="radiogroup" aria-label="Tujuan caption">{goals.map(item => <label className={goal === item.value ? "selected" : ""} key={item.value}><input type="radio" name="caption_goal" value={item.value} checked={goal === item.value} onChange={() => { setGoal(item.value); setVariants([]); setMessage(""); }}/><span><b>{item.label}</b><small>{item.help}</small></span></label>)}</div>
    <button type="button" className="caption-generate" onClick={() => void generate()} disabled={loading || !brandId || title.trim().length < 3}><WandSparkles size={17}/>{loading ? "Sedang menulis…" : "Buat 3 pilihan caption"}</button>
    {message ? <p className="caption-message" role="status">{message}</p> : null}
    {variants.length ? <div className="caption-variants">{variants.map((variant, index) => <article key={`${variant.angle}-${index}`}><div><small>PILIHAN {index + 1}</small><b>{variant.angle}</b></div><p>{variant.caption}</p><button type="button" className="secondary" onClick={() => { onUse(variant.caption); setMessage(`Pilihan ${index + 1} sudah dimasukkan ke kolom caption.`); }}>Gunakan caption ini</button></article>)}</div> : null}
    <p className="caption-disclaimer">AI dapat membuat kesalahan. Periksa fakta, harga, promo, dan detail brand sebelum dijadwalkan.{format === "story" ? " Caption Story disimpan sebagai catatan copy dan tidak ditempel otomatis ke gambar/video." : ""}</p>
  </section>;
}
