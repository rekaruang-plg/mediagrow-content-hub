"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Building2, CalendarDays, CheckCircle2, CircleAlert, Clock3, Eye, FileImage, FolderOpen, RotateCcw, Search, UploadCloud, Video, XCircle } from "lucide-react";

type Brand = { id: string; name: string; niche: string | null };
type Content = { id: string; brand_id: string; title: string; status: string; media_type: string; created_at: string };
export type WorkspaceJob = { id: string; content_item_id: string; platform: string; publish_kind: string; scheduled_for: string; status: string; error_message: string | null };
type JobAction = "reschedule" | "cancel" | "retry";
const names: Record<string, string> = { ready: "Siap", draft: "Draf", scheduled: "Terjadwal", retrying: "Dicoba ulang", publishing: "Dipublikasikan…", posted: "Terbit", failed: "Gagal", cancelled: "Dibatalkan", archived: "Diarsipkan" };
const date = (v: string) => new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const active = (j: WorkspaceJob) => ["scheduled", "retrying", "publishing"].includes(j.status);
function Badge({ status }: { status: string }) { return <span className={`status ${status}`}><i/>{names[status] || status}</span>; }

export function WorkspaceOverview({ brands, content, jobs, library = false, onUpload, onOpenContent, onJobAction }: { brands: Brand[]; content: Content[]; jobs: WorkspaceJob[]; library?: boolean; onUpload: () => void; onOpenContent?: (contentId: string) => void; onJobAction?: (jobId: string, action: JobAction, scheduledFor?: string) => Promise<void> }) {
  const [query, setQuery] = useState(""), [brand, setBrand] = useState(""), [status, setStatus] = useState("");
  const contentMap = new Map(content.map(c => [c.id, c]));
  const brandName = (id?: string) => brands.find(b => b.id === id)?.name || "—";
  const scope = jobs.filter(j => !brand || contentMap.get(j.content_item_id)?.brand_id === brand);
  const listed = scope.filter(j => (!status || (status === "active" ? active(j) : j.status === status)) && (contentMap.get(j.content_item_id)?.title || j.content_item_id).toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(active(b)) - Number(active(a)) || (active(a) ? Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for) : Date.parse(b.scheduled_for) - Date.parse(a.scheduled_for)));
  const materials = content.filter(c => (!brand || c.brand_id === brand) && c.title.toLowerCase().includes(query.toLowerCase()));
  const next = scope.filter(active).sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))[0];
  const stats = [{ label: "Brand dikelola", value: brands.length, icon: Building2, tone: "purple" }, { label: "Konten tersimpan", value: content.filter(c => !brand || c.brand_id === brand).length, icon: FolderOpen, tone: "blue" }, { label: "Antrean aktif", value: scope.filter(active).length, icon: Clock3, tone: "amber" }, { label: "Publikasi terbit", value: scope.filter(j => j.status === "posted").length, icon: CheckCircle2, tone: "green" }];
  return <>
    {!library && <><section className="metrics">{stats.map(s => <article key={s.label}><span className={`metric-icon ${s.tone}`}><s.icon size={21}/></span><span>{s.label}</span><b>{s.value}</b></article>)}</section><section className="overview-strip"><span className="strip-icon"><CalendarDays size={24}/></span><div><small>BERIKUTNYA DALAM ANTREAN</small><h3>{next ? contentMap.get(next.content_item_id)?.title || "Konten dalam antrean" : "Siapkan publikasi pertamamu"}</h3><p>{next ? `${date(next.scheduled_for)} WIB · ${next.platform === "instagram" ? "Instagram" : "Facebook"} ${next.publish_kind}` : "Unggah bahan konten, lalu pilih channel untuk membuat jadwal."}</p></div><button className="text-button" onClick={onUpload}>Upload konten <ArrowUpRight size={17}/></button></section></>}
    <section className="card"><div className="section-heading"><div><h3>{library ? "Konten terbaru" : "Jadwal publikasi"}</h3><p>{library ? "Bahan konten yang sudah diunggah tim." : "Satu baris untuk setiap channel. Semua jadwal ditampilkan dalam WIB."}</p></div><span className="count-pill">{library ? materials.length : listed.length} item</span></div><div className="filters"><label className="search-field"><Search size={17}/><input aria-label="Cari judul konten" placeholder="Cari judul konten…" value={query} onChange={e => setQuery(e.target.value)}/></label><select aria-label="Filter brand" value={brand} onChange={e => setBrand(e.target.value)}><option value="">Semua brand</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>{!library && <select aria-label="Filter status" value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option><option value="active">Antrean aktif</option><option value="posted">Terbit</option><option value="failed">Gagal</option><option value="cancelled">Dibatalkan</option></select>}</div>
    {library ? materials.length ? <div className="content-grid">{materials.map(c => <article className="content-tile" key={c.id}><div className="media-placeholder">{c.media_type === "video" ? <Video size={30}/> : <FileImage size={30}/>}<span>{c.media_type === "video" ? "VIDEO" : "GAMBAR"}</span></div><div className="tile-body"><small>{brandName(c.brand_id)}</small><h4>{c.title}</h4><div><Badge status={c.status}/><time>{date(c.created_at)}</time></div>{onOpenContent ? <button className="secondary tile-preview" onClick={() => onOpenContent(c.id)}><Eye size={15}/>Preview & edit</button> : null}</div></article>)}</div> : <Empty onUpload={onUpload}/> : listed.length ? <div className="table-wrap"><table><thead><tr><th>Konten & brand</th><th>Channel</th><th>Jadwal · WIB</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{listed.map(j => { const c = contentMap.get(j.content_item_id); return <tr key={j.id}><td><strong>{c?.title || `Konten ${j.content_item_id.slice(0, 8)}`}</strong><small>{brandName(c?.brand_id)}</small></td><td><span className={`platform-tag ${j.platform}`}>{j.platform === "instagram" ? "IG" : "FB"}</span> <span className="channel-kind">{j.publish_kind}</span></td><td>{date(j.scheduled_for)}</td><td><Badge status={j.status}/>{j.error_message && <details className="job-error"><summary>Detail kendala</summary><p>{j.error_message}</p></details>}</td><td>{j.status === "failed" && onJobAction ? <button className="secondary compact" onClick={() => void onJobAction(j.id,"retry")}><RotateCcw size={14}/>Coba lagi</button> : <span>—</span>}</td></tr>; })}</tbody></table></div> : <Empty onUpload={onUpload}/>}
    <p className="data-scope">Data yang dimuat: hingga 100 konten terbaru dan 200 jadwal terbaru. Filter brand mengikuti konten yang dimuat. Jumlah publikasi dihitung per channel.</p></section>
  </>;
}

const jakartaDateKey = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const weekStart = (offset: number) => {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  const [year, month, day] = formatter.format(new Date()).split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - mondayOffset * 86400000 + offset * 7 * 86400000);
};
const calendarDate = (value: Date) => value.toLocaleDateString("id-ID", { timeZone: "UTC", day: "numeric", month: "short" });
const calendarDay = (value: Date) => value.toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "short" });
const calendarTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

export function WorkspaceCalendar({ brands, content, jobs, onUpload, onJobAction }: { brands: Brand[]; content: Content[]; jobs: WorkspaceJob[]; onUpload: () => void; onJobAction?: (jobId: string, action: JobAction, scheduledFor?: string) => Promise<void> }) {
  const [offset, setOffset] = useState(0), [brand, setBrand] = useState("");
  const [selected, setSelected] = useState<WorkspaceJob | null>(null), [newTime, setNewTime] = useState("");
  const start = weekStart(offset);
  const dates = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86400000));
  const contentMap = new Map(content.map(item => [item.id, item]));
  const brandMap = new Map(brands.map(item => [item.id, item.name]));
  const visibleJobs = jobs.filter(job => !brand || contentMap.get(job.content_item_id)?.brand_id === brand);
  return <section className="card calendar-card">
    <div className="calendar-toolbar"><div><h3>Kalender publikasi</h3><p>Jadwal mingguan untuk seluruh brand dan channel dalam WIB.</p></div><div className="calendar-actions"><select aria-label="Filter brand kalender" value={brand} onChange={event => setBrand(event.target.value)}><option value="">Semua brand</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" aria-label="Minggu sebelumnya" onClick={() => setOffset(value => value - 1)}><ArrowLeft size={16}/></button><button className="today-button" onClick={() => setOffset(0)}>Minggu ini</button><button className="icon-button" aria-label="Minggu berikutnya" onClick={() => setOffset(value => value + 1)}><ArrowRight size={16}/></button></div></div>
    <div className="week-range">{calendarDate(dates[0])} – {calendarDate(dates[6])}</div>
    <div className="calendar-scroll"><div className="week-grid">{dates.map(day => {
      const key = day.toISOString().slice(0, 10);
      const dayJobs = visibleJobs.filter(job => jakartaDateKey(job.scheduled_for) === key).sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
      const today = jakartaDateKey(new Date()) === key;
      return <article className={today ? "calendar-day is-today" : "calendar-day"} key={key}><header><span>{calendarDay(day)}</span><b>{day.getUTCDate()}</b></header><div>{dayJobs.length ? dayJobs.map(job => {const item = contentMap.get(job.content_item_id);return <button className={`calendar-job ${job.status}`} key={job.id} onClick={() => { setSelected(job); const local = new Date(new Date(job.scheduled_for).getTime() + 7*60*60*1000).toISOString().slice(0,16); setNewTime(local); }}><small>{calendarTime(job.scheduled_for)} · {job.platform === "instagram" ? "IG" : "FB"} {job.publish_kind}</small><strong>{item?.title || "Konten"}</strong><span>{brandMap.get(item?.brand_id || "") || "Brand"}</span></button>}) : <span className="day-empty">Belum ada jadwal</span>}</div></article>;
    })}</div></div>
    {selected ? <div className="calendar-editor"><div><small>ATUR PUBLIKASI</small><strong>{contentMap.get(selected.content_item_id)?.title || "Konten"}</strong><span>{selected.platform === "instagram" ? "Instagram" : "Facebook"} {selected.publish_kind} · <Badge status={selected.status}/></span></div>{!["posted","publishing","cancelled"].includes(selected.status) ? <label>Jadwal baru · WIB<input type="datetime-local" value={newTime} onChange={event => setNewTime(event.target.value)}/></label> : null}<div>{!["posted","publishing","cancelled"].includes(selected.status) && onJobAction ? <button onClick={async () => { const target = new Date(`${newTime}:00+07:00`).toISOString(); await onJobAction(selected.id,"reschedule",target); setSelected(null); }}><CalendarDays size={15}/>Simpan jadwal</button> : null}{selected.status === "failed" && onJobAction ? <button className="secondary" onClick={async () => { await onJobAction(selected.id,"retry"); setSelected(null); }}><RotateCcw size={15}/>Coba lagi</button> : null}{!["posted","publishing","cancelled"].includes(selected.status) && onJobAction ? <button className="danger-button" onClick={async () => { await onJobAction(selected.id,"cancel"); setSelected(null); }}><XCircle size={15}/>Batalkan</button> : null}<button className="secondary" onClick={() => setSelected(null)}>Tutup</button></div></div> : null}
    {!visibleJobs.length && <div className="calendar-empty"><p>Belum ada jadwal untuk pilihan ini.</p><button onClick={onUpload}><UploadCloud size={17}/>Upload konten</button></div>}
  </section>;
}
function Empty({ onUpload }: { onUpload: () => void }) { return <div className="empty-state"><FolderOpen size={32}/><h4>Belum ada item yang ditampilkan</h4><p>Ubah filter pencarian atau mulai dengan mengunggah konten.</p><button onClick={onUpload}><UploadCloud size={17}/>Upload konten</button></div>; }

export type RawMediaInspection = { name: string; mimeType: string; mediaType: "image" | "video"; bytes: number; width: number; height: number; durationSeconds: number | null };
export type MediaInspection = RawMediaInspection & { aspectRatio: number; errors: string[]; warnings: string[] };
export type ContentFormat = "feed" | "carousel" | "story" | "reel";
export type MediaSelection = { items: MediaInspection[]; errors: string[] };

export function evaluateMedia(raw: RawMediaInspection, channels: string[]): MediaInspection {
  const errors: string[] = [], warnings: string[] = [];
  const ratio = raw.width / raw.height;
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
  const targetsInstagram = channels.some(channel => channel.startsWith("ig_"));
  const targetsVertical = channels.some(channel => channel.endsWith("story") || channel.endsWith("reel"));

  if (!allowedTypes.includes(raw.mimeType)) errors.push("Format berkas tidak didukung. Gunakan JPG, PNG, WebP, MP4, atau MOV.");
  if (raw.mediaType === "image" && channels.some(channel => channel.endsWith("reel"))) errors.push("Reel membutuhkan video, bukan gambar.");
  if (raw.mediaType === "video" && channels.includes("ig_feed")) errors.push("Video Instagram Feed harus dipublikasikan sebagai Reel pada versi ini.");
  if (raw.mediaType === "image" && targetsInstagram && raw.mimeType !== "image/jpeg") errors.push("Publikasi gambar Instagram melalui API membutuhkan file JPG/JPEG.");
  if (raw.mediaType === "image" && targetsInstagram && raw.bytes > 8 * 1024 * 1024) errors.push("Gambar Instagram maksimal 8 MB.");
  if (raw.mediaType === "video" && raw.bytes > 1024 * 1024 * 1024) errors.push("Video maksimal 1 GB sesuai batas penyimpanan sistem.");
  if (raw.mediaType === "image" && channels.includes("ig_feed") && (ratio < 0.8 || ratio > 1.91)) errors.push("Rasio Instagram Feed harus berada antara 4:5 dan 1,91:1.");
  if (raw.mediaType === "image" && channels.includes("ig_feed") && raw.width < 320) errors.push("Lebar gambar Instagram Feed minimal 320 piksel.");
  if (targetsVertical && Math.abs(ratio - 9 / 16) > 0.035) warnings.push("Story/Reel paling aman memakai rasio vertikal 9:16 agar tidak terpotong.");
  if (raw.mediaType === "image" && raw.width > 1440) warnings.push("Gambar lebih lebar dari 1.440 piksel dapat diperkecil oleh platform.");
  if (raw.mediaType === "video" && raw.durationSeconds !== null && raw.durationSeconds < 3) warnings.push("Video sangat pendek; periksa kembali hasilnya sebelum dijadwalkan sebagai Reel.");
  if (raw.mediaType === "video" && raw.durationSeconds !== null && raw.durationSeconds > 900) warnings.push("Video lebih dari 15 menit dapat ditolak pada jenis publikasi tertentu.");
  return { ...raw, aspectRatio: ratio, errors, warnings };
}

export function evaluateMediaSelection(raw: RawMediaInspection[], channels: string[], format: ContentFormat): MediaSelection {
  const items = raw.map(item => evaluateMedia(item, channels));
  const errors = items.flatMap(item => item.errors.map(message => `${item.name}: ${message}`));
  if ((format === "feed" || format === "reel") && items.length !== 1) errors.push("Format ini membutuhkan tepat satu berkas.");
  if (format === "carousel" && (items.length < 2 || items.length > 10)) errors.push("Carousel membutuhkan 2–10 gambar.");
  if (format === "story" && (items.length < 1 || items.length > 10)) errors.push("Story menerima 1–10 frame.");
  if (format === "carousel" && items.some(item => item.mediaType !== "image")) errors.push("Carousel saat ini mendukung gambar saja.");
  if (format === "reel" && items.some(item => item.mediaType !== "video")) errors.push("Reel membutuhkan satu video.");
  if (format === "carousel" && new Set(items.map(item => item.aspectRatio.toFixed(2))).size > 1) errors.push("Semua gambar carousel harus memakai rasio yang sama agar tidak terpotong.");
  return { items, errors };
}

function inspectFile(file: File): Promise<RawMediaInspection> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve({ name: file.name, mimeType: file.type, mediaType: "image", bytes: file.size, width: image.naturalWidth, height: image.naturalHeight, durationSeconds: null }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Ukuran gambar tidak dapat dibaca.")); };
    image.src = url;
  });
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ name: file.name, mimeType: file.type, mediaType: "video", bytes: file.size, width: video.videoWidth, height: video.videoHeight, durationSeconds: Number.isFinite(video.duration) ? video.duration : null }); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Ukuran atau durasi video tidak dapat dibaca.")); };
    video.src = url;
  });
}

export function MediaPicker({ channels, format, onInspectionChange }: { channels: string[]; format: ContentFormat; onInspectionChange: (selection: MediaSelection | null) => void }) {
  const [files, setFiles] = useState<File[]>([]), [previews, setPreviews] = useState<string[]>([]), [raw, setRaw] = useState<RawMediaInspection[]>([]), [inspectionError, setInspectionError] = useState("");
  const multiple = format === "carousel" || format === "story";
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  useEffect(() => {
    let active = true;
    if (!files.length) { setRaw([]); setInspectionError(""); return () => { active = false; }; }
    setRaw([]); setInspectionError("");
    void Promise.all(files.map(inspectFile)).then(value => { if (active) setRaw(value); }).catch(error => { if (active) setInspectionError(error instanceof Error ? error.message : "Berkas tidak dapat diperiksa."); });
    return () => { active = false; };
  }, [files]);
  const selection = useMemo<MediaSelection | null>(() => {
    if (!files.length || raw.length !== files.length) return null;
    return evaluateMediaSelection(raw, channels, format);
  }, [files.length, raw, channels, format]);
  useEffect(() => { onInspectionChange(selection); }, [selection, onInspectionChange]);
  const formatHint = format === "carousel" ? "Pilih 2–10 gambar JPG" : format === "story" ? "Pilih 1–10 gambar atau video" : format === "reel" ? "Pilih satu video MP4/MOV" : "Pilih satu gambar";
  const accept = format === "carousel" || format === "feed" ? "image/jpeg,image/png,image/webp" : format === "reel" ? "video/mp4,video/quicktime" : "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";

  return <div className="media-picker"><label className="file-drop"><UploadCloud size={30}/><strong>{files.length ? `${files.length} berkas dipilih` : formatHint}</strong><span>{format === "carousel" ? "Urutan pilihan menjadi urutan slide." : "JPG, PNG, WebP, MP4, atau MOV"}</span><input name="files" type="file" accept={accept} multiple={multiple} required onChange={event => setFiles(Array.from(event.target.files || []))}/></label>{previews.length ? <div className={`media-preview-grid ${previews.length === 1 ? "single" : ""}`}>{previews.map((preview, index) => { const file=files[index]; const inspection=selection?.items[index]; return <div className="media-preview" key={`${file.name}-${file.lastModified}`}><span className="media-order">{index+1}</span>{file.type.startsWith("video/") ? <video controls preload="metadata" src={preview}/> : <span className="local-image-preview"><Image src={preview} alt={`Pratinjau media ${index+1}`} fill sizes="(max-width: 760px) 50vw, 260px" unoptimized/></span>}<small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{inspection ? ` · ${inspection.width}×${inspection.height}` : ""}</small></div>;})}</div> : null}{files.length && !selection && !inspectionError ? <div className="media-inspection loading">Memeriksa ukuran, rasio, dan durasi semua media…</div> : null}{inspectionError ? <div className="media-inspection error">{inspectionError}</div> : null}{selection ? <div className={`media-inspection ${selection.errors.length ? "error" : selection.items.some(item=>item.warnings.length) ? "warning" : "ready"}`}>{selection.errors.map(message => <p key={message}><XCircle size={14}/>{message}</p>)}{selection.items.flatMap(item=>item.warnings.map(message=><p key={`${item.name}-${message}`}><CircleAlert size={14}/>{item.name}: {message}</p>))}{!selection.errors.length && !selection.items.some(item=>item.warnings.length) ? <p><CheckCircle2 size={14}/>{selection.items.length} media sesuai dengan format dan channel.</p> : null}</div> : null}</div>;
}
