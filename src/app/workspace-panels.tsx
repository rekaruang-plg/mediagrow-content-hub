"use client";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Building2, CalendarDays, CheckCircle2, CircleAlert, Clock3, Eye, FileImage, FolderOpen, Images, RectangleVertical, RotateCcw, Search, UploadCloud, Video, XCircle } from "lucide-react";

type Brand = { id: string; name: string; niche: string | null };
type Content = { id: string; brand_id: string; title: string; status: string; media_type: string; created_at: string; primary_asset_path?: string; content_assets?: { position?: number }[] };
export type WorkspaceJob = { id: string; content_item_id: string; platform: string; publish_kind: string; scheduled_for: string; status: string; error_message: string | null };
type JobAction = "reschedule" | "cancel" | "retry";
const names: Record<string, string> = { ready: "Siap", draft: "Draf", scheduled: "Terjadwal", retrying: "Dicoba ulang", publishing: "Dipublikasikan…", posted: "Terbit", failed: "Gagal", cancelled: "Dibatalkan", archived: "Diarsipkan" };
const date = (v: string) => new Date(v).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const active = (j: WorkspaceJob) => ["scheduled", "retrying", "publishing"].includes(j.status);
function Badge({ status }: { status: string }) { return <span className={`status ${status}`}><i/>{names[status] || status}</span>; }

export function WorkspaceOverview({ brands, content, jobs, thumbnailUrls = {}, library = false, onUpload, onOpenContent, onDuplicate, onJobAction }: { brands: Brand[]; content: Content[]; jobs: WorkspaceJob[]; thumbnailUrls?: Record<string,string>; library?: boolean; onUpload: () => void; onOpenContent?: (contentId: string) => void; onDuplicate?: (contentId: string) => Promise<void>; onJobAction?: (jobId: string, action: JobAction, scheduledFor?: string) => Promise<void> }) {
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
    {library ? materials.length ? <div className="content-grid">{materials.map(c => <article className="content-tile" key={c.id}><div className="media-placeholder">{thumbnailUrls[c.id]?<Image src={thumbnailUrls[c.id]} alt={`Thumbnail ${c.title}`} fill sizes="(max-width: 600px) 100vw, 33vw" unoptimized/>:<>{c.media_type === "video" ? <Video size={30}/> : <FileImage size={30}/>}<span>{c.media_type === "video" ? "VIDEO" : "GAMBAR"}</span></>}</div><div className="tile-body"><small>{brandName(c.brand_id)}</small><h4>{c.title}</h4><div><Badge status={c.status}/><time>{date(c.created_at)}</time></div><div className="tile-actions">{onOpenContent ? <button className="secondary" onClick={() => onOpenContent(c.id)}><Eye size={15}/>Preview & edit</button> : null}{onDuplicate?<button className="secondary" onClick={() => void onDuplicate(c.id)}><Images size={15}/>Duplikat</button>:null}</div></div></article>)}</div> : <Empty onUpload={onUpload}/> : listed.length ? <div className="table-wrap"><table><thead><tr><th>Konten & brand</th><th>Channel</th><th>Jadwal · WIB</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{listed.map(j => { const c = contentMap.get(j.content_item_id); return <tr key={j.id}><td><strong>{c?.title || `Konten ${j.content_item_id.slice(0, 8)}`}</strong><small>{brandName(c?.brand_id)}</small></td><td><span className={`platform-tag ${j.platform}`}>{j.platform === "instagram" ? "IG" : "FB"}</span> <span className="channel-kind">{j.publish_kind}</span></td><td>{date(j.scheduled_for)}</td><td><Badge status={j.status}/>{j.error_message && <details className="job-error"><summary>Detail kendala</summary><p>{j.error_message}</p></details>}</td><td>{j.status === "failed" && onJobAction ? <button className="secondary compact" onClick={() => void onJobAction(j.id,"retry")}><RotateCcw size={14}/>Coba lagi</button> : <span>—</span>}</td></tr>; })}</tbody></table></div> : <Empty onUpload={onUpload}/>}
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
const jakartaToday = () => {
  const [year, month, day] = jakartaDateKey(new Date()).split("-").map(Number);
  return { year, month, day };
};
const monthStart = (offset: number) => {
  const { year, month } = jakartaToday();
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return new Date(first.getTime() - mondayOffset * 86400000);
};
const monthAnchor = (offset: number) => {
  const { year, month } = jakartaToday();
  return new Date(Date.UTC(year, month - 1 + offset, 1));
};
const calendarDate = (value: Date) => value.toLocaleDateString("id-ID", { timeZone: "UTC", day: "numeric", month: "short" });
const calendarDay = (value: Date) => value.toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "short" });
const calendarTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
const calendarBrandThemes = [
  { accent: "#7553d4", soft: "#f2edff", ink: "#5638a5" },
  { accent: "#d65f83", soft: "#fff0f5", ink: "#a33e61" },
  { accent: "#268b7a", soft: "#eaf8f5", ink: "#176b5e" },
  { accent: "#d17a28", soft: "#fff4e8", ink: "#995717" },
  { accent: "#3478c5", soft: "#edf5ff", ink: "#245c9b" },
  { accent: "#aa6548", soft: "#fff1eb", ink: "#81452e" },
  { accent: "#6d7f24", soft: "#f3f7e6", ink: "#53631a" },
  { accent: "#8b5ca8", soft: "#f7effc", ink: "#6b3e87" },
] as const;
const calendarFormatMeta = {
  feed: { label: "Feed", icon: FileImage },
  carousel: { label: "Carousel", icon: Images },
  story: { label: "Story", icon: RectangleVertical },
  reel: { label: "Reel", icon: Video },
} as const;
type CalendarFormat = keyof typeof calendarFormatMeta;
const calendarFormat = (job: WorkspaceJob, item?: Content): CalendarFormat => {
  if (job.publish_kind === "story") return "story";
  if (job.publish_kind === "reel") return "reel";
  return (item?.content_assets?.length || 0) > 1 ? "carousel" : "feed";
};
const calendarBrandStyle = (brandId: string, brandOrder: Map<string, number>) => {
  const theme = calendarBrandThemes[(brandOrder.get(brandId) || 0) % calendarBrandThemes.length];
  return { "--calendar-brand": theme.accent, "--calendar-brand-soft": theme.soft, "--calendar-brand-ink": theme.ink } as CSSProperties;
};

export function WorkspaceCalendar({ brands, content, jobs, thumbnailUrls = {}, onUpload, onJobAction }: { brands: Brand[]; content: Content[]; jobs: WorkspaceJob[]; thumbnailUrls?: Record<string,string>; onUpload: () => void; onJobAction?: (jobId: string, action: JobAction, scheduledFor?: string) => Promise<void> }) {
  const [view, setView] = useState<"week"|"month">("week"), [offset, setOffset] = useState(0), [brand, setBrand] = useState("");
  const [selected, setSelected] = useState<WorkspaceJob | null>(null), [newTime, setNewTime] = useState("");
  const [draggingJobId, setDraggingJobId] = useState("");
  const start = view === "week" ? weekStart(offset) : monthStart(offset);
  const dates = Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => new Date(start.getTime() + index * 86400000));
  const activeMonth = monthAnchor(offset).getUTCMonth();
  const contentMap = new Map(content.map(item => [item.id, item]));
  const brandMap = new Map(brands.map(item => [item.id, item.name]));
  const brandOrder = new Map(brands.map((item, index) => [item.id, index]));
  const visibleJobs = jobs.filter(job => !brand || contentMap.get(job.content_item_id)?.brand_id === brand);
  const visibleBrands = brand ? brands.filter(item => item.id === brand) : brands;
  const canMove = (job: WorkspaceJob) => Boolean(onJobAction) && !["posted","publishing","cancelled"].includes(job.status);
  const openEditor = (job: WorkspaceJob) => {
    setSelected(job);
    setNewTime(new Date(new Date(job.scheduled_for).getTime() + 7*60*60*1000).toISOString().slice(0,16));
  };
  const moveToDay = async (jobId: string, dayKey: string) => {
    const job = jobs.find(item => item.id === jobId);
    if (!job || !canMove(job) || !onJobAction) return;
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(job.scheduled_for));
    const target = new Date(`${dayKey}T${time}:00+07:00`);
    if (target.getTime() <= Date.now()) return;
    await onJobAction(job.id, "reschedule", target.toISOString());
  };
  const rangeLabel = view === "week"
    ? `${calendarDate(dates[0])} – ${calendarDate(dates[6])}`
    : monthAnchor(offset).toLocaleDateString("id-ID", { timeZone: "UTC", month: "long", year: "numeric" });
  return <section className="card calendar-card">
    <div className="calendar-toolbar"><div><h3>Kalender publikasi</h3><p>Jadwal mingguan atau bulanan untuk seluruh brand dan channel dalam WIB.</p></div><div className="calendar-actions"><div className="calendar-view-switch" aria-label="Tampilan kalender"><button className={view === "week" ? "active" : ""} onClick={() => { setView("week"); setOffset(0); }}>Minggu</button><button className={view === "month" ? "active" : ""} onClick={() => { setView("month"); setOffset(0); }}>Bulan</button></div><select aria-label="Filter brand kalender" value={brand} onChange={event => setBrand(event.target.value)}><option value="">Semua brand</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="icon-button" aria-label={`${view === "week" ? "Minggu" : "Bulan"} sebelumnya`} onClick={() => setOffset(value => value - 1)}><ArrowLeft size={16}/></button><button className="today-button" onClick={() => setOffset(0)}>{view === "week" ? "Minggu ini" : "Bulan ini"}</button><button className="icon-button" aria-label={`${view === "week" ? "Minggu" : "Bulan"} berikutnya`} onClick={() => setOffset(value => value + 1)}><ArrowRight size={16}/></button></div></div>
    <div className="calendar-legends" aria-label="Legenda kalender"><div className="brand-legend"><b>WARNA BRAND</b>{visibleBrands.map(item => <span key={item.id}><i style={{ backgroundColor: calendarBrandThemes[(brandOrder.get(item.id) || 0) % calendarBrandThemes.length].accent }}/>{item.name}</span>)}</div><div className="format-legend"><b>FORMAT</b>{(Object.entries(calendarFormatMeta) as [CalendarFormat, typeof calendarFormatMeta[CalendarFormat]][]).map(([key, meta]) => { const Icon = meta.icon; return <span className={`calendar-format ${key}`} key={key}><Icon size={12}/>{meta.label}</span>; })}</div></div>
    <div className="week-range">{rangeLabel}</div>
    {onJobAction ? <p className="calendar-drag-hint">Seret kartu ke tanggal lain untuk memindahkan jadwal dengan jam yang sama. Klik kartu untuk mengubah jam atau membatalkan.</p> : null}
    <div className="calendar-scroll"><div className={`week-grid ${view === "month" ? "month-view" : ""}`}>{dates.map(day => {
      const key = day.toISOString().slice(0, 10);
      const dayJobs = visibleJobs.filter(job => jakartaDateKey(job.scheduled_for) === key).sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
      const today = jakartaDateKey(new Date()) === key;
      const outsideMonth = view === "month" && day.getUTCMonth() !== activeMonth;
      return <article className={`calendar-day${today ? " is-today" : ""}${outsideMonth ? " outside-month" : ""}${draggingJobId ? " drop-ready" : ""}`} key={key} onDragOver={event => { if (draggingJobId) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const jobId = event.dataTransfer.getData("text/plain") || draggingJobId; setDraggingJobId(""); void moveToDay(jobId,key); }}><header><span>{calendarDay(day)}</span><b>{day.getUTCDate()}</b></header><div>{dayJobs.length ? dayJobs.map(job => {const item = contentMap.get(job.content_item_id),brandId=item?.brand_id||"",format=calendarFormat(job,item),FormatIcon=calendarFormatMeta[format].icon,thumbnail=thumbnailUrls[job.content_item_id];return <button className={`calendar-job ${job.status}`} style={calendarBrandStyle(brandId,brandOrder)} key={job.id} draggable={canMove(job)} onDragStart={event => { event.dataTransfer.effectAllowed="move"; event.dataTransfer.setData("text/plain",job.id); setDraggingJobId(job.id); }} onDragEnd={() => setDraggingJobId("")} onClick={() => openEditor(job)} aria-label={`${item?.title || "Konten"}, ${brandMap.get(brandId) || "Brand"}, ${calendarFormatMeta[format].label}, ${calendarTime(job.scheduled_for)} WIB`}>{thumbnail ? <span className="calendar-job-thumbnail"><Image src={thumbnail} alt="" fill sizes="110px" unoptimized/></span> : null}<span className="calendar-job-head"><time>{calendarTime(job.scheduled_for)}</time><span className={`calendar-platform ${job.platform}`}>{job.platform === "instagram" ? "IG" : "FB"}</span></span><span className={`calendar-format ${format}`}><FormatIcon size={12}/>{calendarFormatMeta[format].label}</span><strong>{item?.title || "Konten"}</strong><span className="calendar-job-brand"><i/>{brandMap.get(brandId) || "Brand"}</span></button>}) : <span className="day-empty">Belum ada jadwal</span>}</div></article>;
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
