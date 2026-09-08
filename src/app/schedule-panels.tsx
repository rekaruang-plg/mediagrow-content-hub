"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, Palette, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type Brand = { id: string; name: string; niche: string | null };
type PostingWindow = { day: number; times: string[] };
type BrandRule = {
  brand_id: string;
  autopilot_enabled: boolean;
  approval_required: boolean;
  timezone: string;
  min_gap_minutes: number;
  posting_windows: PostingWindow[];
  tone: string | null;
  default_cta: string | null;
  target_audience: string | null;
  hashtag_guidance: string | null;
  prohibited_terms: string | null;
  content_pillars: string[];
};

const days = [
  { value: 1, label: "Senin" },
  { value: 2, label: "Selasa" },
  { value: 3, label: "Rabu" },
  { value: 4, label: "Kamis" },
  { value: 5, label: "Jumat" },
  { value: 6, label: "Sabtu" },
  { value: 0, label: "Minggu" },
];

const normalize = (windows?: PostingWindow[]) => days.map(day => ({
  day: day.value,
  times: windows?.find(window => window.day === day.value)?.times?.length
    ? [...windows.find(window => window.day === day.value)!.times]
    : ["09:00", "18:30"],
}));

export function BrandScheduleEditor({ brands, rules, onSaved }: { brands: Brand[]; rules: BrandRule[]; onSaved: () => Promise<void> | void }) {
  const [brandId, setBrandId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [gap, setGap] = useState(180);
  const [windows, setWindows] = useState<PostingWindow[]>(normalize());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brandId, brands]);

  useEffect(() => {
    const rule = rules.find(item => item.brand_id === brandId);
    if (!rule) return;
    setEnabled(rule.autopilot_enabled);
    setApprovalRequired(rule.approval_required);
    setGap(rule.min_gap_minutes);
    setWindows(normalize(rule.posting_windows));
    setMessage("");
  }, [brandId, rules]);

  const updateTime = (day: number, index: number, value: string) => setWindows(current => current.map(window => window.day === day ? { ...window, times: window.times.map((time, i) => i === index ? value : time) } : window));
  const addTime = (day: number) => setWindows(current => current.map(window => window.day === day && window.times.length < 4 ? { ...window, times: [...window.times, "18:30"] } : window));
  const removeTime = (day: number, index: number) => setWindows(current => current.map(window => window.day === day && window.times.length > 1 ? { ...window, times: window.times.filter((_, i) => i !== index) } : window));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brandId || saving) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.rpc("update_brand_schedule_rules", {
      p_brand_id: brandId,
      p_autopilot_enabled: enabled,
      p_min_gap_minutes: gap,
      p_posting_windows: windows,
      p_approval_required: approvalRequired,
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Aturan jadwal brand berhasil disimpan.");
      await onSaved();
    }
    setSaving(false);
  }

  if (!brands.length) return null;

  return <section className="card narrow schedule-settings">
    <div className="section-heading"><div><h3>Aturan jadwal per brand</h3><p>Dipakai oleh mode Auto dan Saran Cerdas. Semua waktu menggunakan WIB.</p></div><CalendarClock size={24}/></div>
    <form onSubmit={save}>
      <div className="settings-grid">
        <label>Brand<select value={brandId} onChange={event => setBrandId(event.target.value)}>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <label>Jeda minimum<select value={gap} onChange={event => setGap(Number(event.target.value))}><option value={60}>1 jam</option><option value={120}>2 jam</option><option value={180}>3 jam</option><option value={240}>4 jam</option><option value={360}>6 jam</option></select></label>
      </div>
      <label className="autopilot-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/><span><b>Aktifkan autopilot untuk brand ini</b><small>Jika dimatikan, konten hanya dapat dijadwalkan secara Manual.</small></span></label>
      <label className="autopilot-toggle approval-toggle"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.target.checked)}/><span><b>Wajibkan persetujuan sebelum terbit</b><small>Upload dari tim masuk ke halaman Persetujuan dan belum akan dibuatkan jadwal sampai disetujui.</small></span></label>
      <div className="weekly-windows">
        {days.map(day => {
          const window = windows.find(item => item.day === day.value) || { day: day.value, times: ["09:00"] };
          return <div className="day-window" key={day.value}>
            <strong>{day.label}</strong>
            <div>{window.times.map((time, index) => <span className="time-entry" key={`${day.value}-${index}`}><input aria-label={`${day.label} waktu ${index + 1}`} type="time" value={time} onChange={event => updateTime(day.value, index, event.target.value)} required/><button type="button" className="icon-button" aria-label={`Hapus waktu ${day.label}`} disabled={window.times.length === 1} onClick={() => removeTime(day.value, index)}><Trash2 size={14}/></button></span>)}{window.times.length < 4 && <button type="button" className="add-time" onClick={() => addTime(day.value)}><Plus size={14}/>Tambah jam</button>}</div>
          </div>;
        })}
      </div>
      {message && <div className="settings-message" role="status">{message}</div>}
      <button disabled={saving}><Save size={17}/>{saving ? "Menyimpan…" : "Simpan aturan jadwal"}</button>
    </form>
  </section>;
}

export function BrandKitEditor({ brands, rules, onSaved }: { brands: Brand[]; rules: BrandRule[]; onSaved: () => Promise<void> | void }) {
  const [brandId, setBrandId] = useState("");
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("");
  const [cta, setCta] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [pillars, setPillars] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brandId, brands]);

  useEffect(() => {
    const rule = rules.find(item => item.brand_id === brandId);
    setTone(rule?.tone || "");
    setAudience(rule?.target_audience || "");
    setCta(rule?.default_cta || "");
    setHashtags(rule?.hashtag_guidance || "");
    setProhibited(rule?.prohibited_terms || "");
    setPillars((rule?.content_pillars || []).join("\n"));
    setMessage("");
  }, [brandId, rules]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brandId || saving) return;
    const contentPillars = pillars.split("\n").map(value => value.trim()).filter(Boolean);
    if (contentPillars.length > 12) {
      setMessage("Maksimal 12 pilar konten untuk setiap brand.");
      return;
    }
    setSaving(true);
    setMessage("");
    const { error } = await supabase.rpc("update_brand_kit", {
      p_brand_id: brandId,
      p_tone: tone || null,
      p_default_cta: cta || null,
      p_target_audience: audience || null,
      p_hashtag_guidance: hashtags || null,
      p_prohibited_terms: prohibited || null,
      p_content_pillars: contentPillars,
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Brand Kit berhasil disimpan dan siap dipakai tim.");
      await onSaved();
    }
    setSaving(false);
  }

  if (!brands.length) return null;

  return <section className="card narrow brand-kit-settings">
    <div className="section-heading"><div><h3>Brand Kit</h3><p>Simpan arahan yang harus diikuti saat menulis dan meninjau konten.</p></div><Palette size={24}/></div>
    <form onSubmit={save}>
      <label>Brand<select value={brandId} onChange={event => setBrandId(event.target.value)}>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
      <div className="brand-kit-grid">
        <label>Target audiens<textarea rows={3} maxLength={1000} value={audience} onChange={event => setAudience(event.target.value)} placeholder="Contoh: pemilik rumah usia 25–45 tahun di Palembang yang sedang renovasi"/></label>
        <label>Gaya bahasa<textarea rows={3} maxLength={1000} value={tone} onChange={event => setTone(event.target.value)} placeholder="Contoh: ramah, sederhana, meyakinkan, tidak terlalu formal"/></label>
        <label>CTA utama<textarea rows={3} maxLength={1000} value={cta} onChange={event => setCta(event.target.value)} placeholder="Contoh: Kirim foto dan ukuran melalui WhatsApp untuk estimasi"/></label>
        <label>Panduan hashtag<textarea rows={3} maxLength={1500} value={hashtags} onChange={event => setHashtags(event.target.value)} placeholder="Hashtag wajib, lokal, dan hashtag yang perlu dihindari"/></label>
        <label>Pilar konten <small>Satu pilar per baris, maksimal 12</small><textarea rows={5} value={pillars} onChange={event => setPillars(event.target.value)} placeholder={"Edukasi\nPortofolio\nPromo\nTestimoni"}/></label>
        <label>Kata atau klaim yang dilarang<textarea rows={5} maxLength={1500} value={prohibited} onChange={event => setProhibited(event.target.value)} placeholder="Contoh: jangan menjanjikan harga termurah atau hasil instan"/></label>
      </div>
      {message && <div className="settings-message" role="status">{message}</div>}
      <p className="inline-help">Brand Kit tidak mengubah caption yang sudah ada. Panduan ini menjadi acuan tim untuk konten berikutnya.</p>
      <button disabled={saving}><Save size={17}/>{saving ? "Menyimpan…" : "Simpan Brand Kit"}</button>
    </form>
  </section>;
}
