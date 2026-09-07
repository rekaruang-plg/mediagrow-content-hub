"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import "./meta-connect.css";

type Brand = { id: string; name: string };
type Platform = "facebook" | "instagram";
type Choice = { id: string; name: string; instagram: { id: string; username: string; name: string } | null; facebookAllowed: boolean; instagramAllowed: boolean };
type Pending = { brand: Brand; flowId: string; pages: Choice[] };
type Account = { id: string; brand_id: string; platform: Platform; username: string | null; display_name: string | null; status: string; token_expires_at: string | null };

const callbackErrors: Record<string, string> = {
  cancelled: "Login Meta dibatalkan. Kamu bisa mencoba lagi kapan saja.",
  state_mismatch: "Sesi login tidak cocok. Ulangi koneksi dari tab ini.",
  session_expired: "Sesi koneksi berakhir. Klik Hubungkan lewat Facebook lagi.",
  unauthorized: "Sesi MediaGrow berakhir. Masuk kembali lalu ulangi koneksi.",
  meta_expired: "Akses Meta sudah tidak valid. Silakan hubungkan kembali.",
  meta_permissions: "Izin Meta belum lengkap. Periksa izin aplikasi dan akses Page.",
  meta_error: "Meta menolak login. Admin perlu memeriksa alamat callback, izin aplikasi, dan akun penguji.",
  not_configured: "Login Meta belum diaktifkan oleh admin.",
};

async function api(path: string, body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Masuk ke MediaGrow terlebih dahulu.");
  const response = await fetch(`/api/meta/${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Koneksi belum berhasil. Coba lagi.");
  return result;
}
function clearCallback() {
  const url = new URL(window.location.href);
  url.searchParams.delete("meta"); url.searchParams.delete("meta_error"); url.searchParams.set("tab", "meta");
  window.history.replaceState({}, "", url);
}

export default function MetaConnect({ brands, userId, onConnected }: { brands: Brand[]; userId: string; onConnected: () => void }) {
  const [brandId, setBrandId] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pageId, setPageId] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryChoices, setRetryChoices] = useState(false);

  async function loadAccounts() {
    const { data, error } = await supabase.from("social_accounts").select("id,brand_id,platform,username,display_name,status,token_expires_at").order("updated_at", { ascending: false });
    if (error) throw new Error("Daftar akun belum dapat dimuat. Coba muat ulang.");
    setAccounts((data || []) as Account[]);
  }
  async function loadChoices() {
    setBusy(true); setMessage("");
    try {
      const result = await api("choices") as Pending;
      setPending(result); setBrandId(result.brand.id); setPageId(""); setPlatforms([]); setRetryChoices(false);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Daftar Page belum dapat dimuat."); setRetryChoices(true); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    api("status").then(result => { if (active) setConfigured(result.ready); }).catch(e => { if (active) setMessage(e.message); });
    void loadAccounts().catch(e => { if (active) setMessage(e.message); });
    const params = new URLSearchParams(window.location.search);
    if (params.get("meta") === "choose") void loadChoices();
    else if (params.has("meta_error")) {
      setMessage(callbackErrors[params.get("meta_error") || ""] || "Login Meta belum berhasil. Silakan ulangi koneksi."); clearCallback();
    }
    return () => { active = false; };
  }, [userId]);

  async function start() {
    setBusy(true); setMessage("");
    try { const result = await api("start", { brandId }); window.location.assign(result.url); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Login belum dapat dimulai."); setBusy(false); }
  }
  async function connect() {
    if (!pending) return;
    setBusy(true); setMessage("");
    try {
      await api("connect", { flowId: pending.flowId, pageId, platforms });
      const label = platforms.map(p => p === "instagram" ? "Instagram" : "Facebook Page").join(" dan ");
      setMessage(`${label} terhubung ke ${pending.brand.name}. Menghubungkan akun tidak membuat jadwal posting baru.`);
      setPending(null); setRetryChoices(false); clearCallback();
      await loadAccounts(); onConnected();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Akun belum tersimpan."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try { await api("cancel", {}); setPending(null); setRetryChoices(false); setMessage(""); clearCallback(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Sesi belum dapat ditutup."); }
    finally { setBusy(false); }
  }
  const selected = pending?.pages.find(p => p.id === pageId);
  const shownAccounts = accounts.filter(a => !brandId || a.brand_id === brandId);

  return <section className="card narrow meta-connect">
    <h3>Hubungkan akun brand</h3>
    <p>Pilih brand, login melalui Facebook, lalu pilih Page dan Instagram yang boleh dikelola. Setiap brand memiliki koneksi sendiri.</p>
    {message && <div className="connection-message" role="status">{message}</div>}
    {configured === false && <div className="connection-message">Login Meta belum diaktifkan. Admin perlu melengkapi konfigurasi koneksi sebelum akun dapat dihubungkan.</div>}
    {!pending && <form onSubmit={e => { e.preventDefault(); void start(); }}>
      <label>Brand<select value={brandId} onChange={e => setBrandId(e.target.value)} required disabled={busy}>
        <option value="">Pilih brand</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      {!brands.length && <p>Tambahkan brand melalui menu Brands terlebih dahulu.</p>}
      <button disabled={busy || !configured || !brandId}>{busy ? "Memproses…" : "Hubungkan lewat Facebook"}</button>
      <p className="connection-help">Gunakan Facebook yang memiliki akses publikasi ke Page brand. Untuk Instagram, akun profesional perlu terhubung ke Page tersebut.</p>
    </form>}
    {retryChoices && <div className="connection-actions"><button type="button" disabled={busy} onClick={() => void loadChoices()}>Muat ulang daftar Page</button><button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>Batalkan sesi</button></div>}
    {pending && <form onSubmit={e => { e.preventDefault(); void connect(); }}>
      <p>Akun akan dihubungkan ke <strong>{pending.brand.name}</strong>.</p>
      {!pending.pages.length ? <div className="connection-message">Meta tidak mengirim Page yang dapat dipilih. Ulangi login, pilih Page brand saat diminta, dan pastikan Facebook yang digunakan memiliki akses ke Page itu.</div> : <>
        <label>Facebook Page<select required value={pageId} disabled={busy} onChange={e => {
          setPageId(e.target.value); const p = pending.pages.find(x => x.id === e.target.value);
          setPlatforms([...(p?.facebookAllowed ? ["facebook" as const] : []), ...(p?.instagramAllowed ? ["instagram" as const] : [])]);
        }}><option value="">Pilih Page milik brand ini</option>{pending.pages.map(p => <option key={p.id} value={p.id}>{p.name}{p.instagram?.username ? ` — @${p.instagram.username}` : ""}</option>)}</select></label>
        {selected && <>
          <fieldset><legend>Akun yang dihubungkan</legend>{(["facebook", "instagram"] as const).map(platform => {
            const allowed = platform === "facebook" ? selected.facebookAllowed : selected.instagramAllowed;
            return <label className="check" key={platform}><input type="checkbox" disabled={busy || !allowed} checked={platforms.includes(platform)} onChange={e => setPlatforms(current => e.target.checked ? [...current, platform] : current.filter(p => p !== platform))}/>{platform === "facebook" ? `Facebook: ${selected.name}` : selected.instagram ? `Instagram: ${selected.instagram.username ? `@${selected.instagram.username}` : selected.instagram.name}` : "Instagram belum terhubung ke Page"}</label>;
          })}</fieldset>
          {(!selected.facebookAllowed || !selected.instagramAllowed) && <p className="connection-help">Pilihan yang nonaktif belum memiliki izin publikasi lengkap atau belum terhubung ke Page. Periksa akses akun lalu hubungkan ulang.</p>}
        </>}
      </>}
      <div className="connection-actions"><button disabled={busy || !pageId || !platforms.length}>{busy ? "Menyimpan…" : "Hubungkan akun yang dipilih"}</button><button className="secondary" type="button" disabled={busy} onClick={() => void cancel()}>Batal</button></div>
    </form>}
    <div className="connected-accounts"><h4>Akun tersimpan</h4>
      {!shownAccounts.length ? <p>Belum ada akun tersimpan untuk pilihan brand ini.</p> : shownAccounts.map(a => <article key={a.id}>
        <strong>{a.display_name || a.username || a.platform}</strong>
        <span>{brands.find(b => b.id === a.brand_id)?.name || "Brand"} · {a.platform === "instagram" ? "Instagram" : "Facebook Page"}</span>
        <span>{a.token_expires_at && new Date(a.token_expires_at).getTime() <= Date.now() ? "Perlu dihubungkan ulang" : a.status === "connected" ? "Terhubung" : a.status}</span>
      </article>)}
      <p className="connection-help">Untuk memperbarui akses, pilih brand yang sama dan hubungkan kembali akun tersebut. Jika ada beberapa akun pada platform yang sama, jadwal baru memakai akun yang terakhir dihubungkan.</p>
    </div>
  </section>;
}
