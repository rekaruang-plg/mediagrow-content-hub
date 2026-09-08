"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type Brand = { id: string; name: string; niche: string | null };
type PostingWindow = { day: number; times: string[] };
type BrandRule = { brand_id: string; autopilot_enabled: boolean; timezone: string; min_gap_minutes: number; posting_windows: PostingWindow[] };

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
