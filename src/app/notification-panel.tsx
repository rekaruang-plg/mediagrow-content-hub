"use client";

import { Bell, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, Link2, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

export type NotificationBrand = { id: string; name: string };
export type NotificationContent = { id: string; brand_id: string; title: string; approval_status: string; review_note: string | null; created_at: string };
export type NotificationJob = { id: string; content_item_id: string; platform: string; publish_kind: string; status: string; error_message: string | null; scheduled_for: string };
export type NotificationAccount = { id: string; brand_id: string; platform: string; username: string | null; display_name: string | null; status: string; token_expires_at: string | null; last_verified_at: string | null; updated_at: string };
export type NotificationPlan = { id: string; brand_id: string; title: string; status: string; due_at: string | null; updated_at: string };
export type NotificationTarget = "approval" | "content" | "calendar" | "meta" | "planner";

export type WorkspaceNotification = {
  id: string;
  brandId: string;
  level: "critical" | "warning" | "info";
  kind: "publishing" | "review" | "connection" | "planning";
  title: string;
  message: string;
  target: NotificationTarget;
  contentId?: string;
  occurredAt: string;
};

const priority = { critical: 0, warning: 1, info: 2 } as const;
const formatDate = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function buildWorkspaceNotifications(
  brands: NotificationBrand[],
  content: NotificationContent[],
  jobs: NotificationJob[],
  accounts: NotificationAccount[],
  now = Date.now(),
  plans: NotificationPlan[] = [],
) {
  const brandMap = new Map(brands.map(brand => [brand.id, brand.name]));
  const contentMap = new Map(content.map(item => [item.id, item]));
  const alerts: WorkspaceNotification[] = [];

  for (const item of content) {
    if (item.approval_status === "pending_review") alerts.push({
      id: `review-${item.id}`,
      brandId: item.brand_id,
      level: "warning",
      kind: "review",
      title: `${item.title} menunggu persetujuan`,
      message: `${brandMap.get(item.brand_id) || "Brand"} belum memiliki jadwal sampai konten ditinjau.`,
      target: "approval",
      contentId: item.id,
      occurredAt: item.created_at,
    });
    if (item.approval_status === "changes_requested") alerts.push({
      id: `revision-${item.id}`,
      brandId: item.brand_id,
      level: "warning",
      kind: "review",
      title: `${item.title} perlu direvisi`,
      message: item.review_note || "Reviewer meminta perubahan sebelum konten dijadwalkan.",
      target: "content",
      contentId: item.id,
      occurredAt: item.created_at,
    });
  }

  for (const job of jobs) {
    if (job.status !== "failed") continue;
    const item = contentMap.get(job.content_item_id);
    alerts.push({
      id: `failed-${job.id}`,
      brandId: item?.brand_id || "",
      level: "critical",
      kind: "publishing",
      title: `${item?.title || "Konten"} gagal terbit`,
      message: `${job.platform === "instagram" ? "Instagram" : "Facebook"} ${job.publish_kind}: ${job.error_message || "Periksa koneksi akun lalu coba lagi."}`,
      target: "calendar",
      contentId: item?.id,
      occurredAt: job.scheduled_for,
    });
  }

  const deadlineWarningMs = 48 * 60 * 60 * 1000;
  for (const plan of plans) {
    if (!plan.due_at || ["published","archived"].includes(plan.status)) continue;
    const dueAt = Date.parse(plan.due_at);
    if (Number.isNaN(dueAt) || dueAt - now > deadlineWarningMs) continue;
    const overdue = dueAt < now;
    alerts.push({ id:`planning-${plan.id}`,brandId:plan.brand_id,level:overdue?"critical":"warning",kind:"planning",title:overdue?`${plan.title} melewati deadline`:`${plan.title} mendekati deadline`,message:overdue?`Deadline lewat pada ${formatDate(plan.due_at)} WIB. Perbarui tahap atau PIC pekerjaan.`:`Deadline ${formatDate(plan.due_at)} WIB. Pastikan materi bergerak ke tahap berikutnya.`,target:"planner",occurredAt:plan.due_at });
  }

  const expiryWarningMs = 14 * 24 * 60 * 60 * 1000;
  for (const account of accounts) {
    const label = account.display_name || account.username || (account.platform === "instagram" ? "Instagram" : "Facebook Page");
    const brandName = brandMap.get(account.brand_id) || "Brand";
    const expiry = account.token_expires_at ? Date.parse(account.token_expires_at) : null;
    if (account.status !== "connected" || (expiry !== null && expiry <= now)) alerts.push({
      id: `connection-${account.id}`,
      brandId: account.brand_id,
      level: "critical",
      kind: "connection",
      title: `${label} perlu dihubungkan ulang`,
      message: `Koneksi ${brandName} tidak siap dipakai untuk jadwal baru.`,
      target: "meta",
      occurredAt: account.updated_at,
    });
    else if (expiry !== null && expiry - now <= expiryWarningMs) alerts.push({
      id: `expiry-${account.id}`,
      brandId: account.brand_id,
      level: "warning",
      kind: "connection",
      title: `Akses ${label} segera berakhir`,
      message: `Hubungkan ulang ${brandName} sebelum ${formatDate(account.token_expires_at!)} WIB.`,
      target: "meta",
      occurredAt: account.token_expires_at!,
    });
  }

  return alerts.sort((a, b) => priority[a.level] - priority[b.level] || Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

const icons = { publishing: RotateCcw, review: ShieldCheck, connection: Link2, planning: ClipboardList } as const;

export function NotificationPanel({ brands, notifications, onNavigate }: {
  brands: NotificationBrand[];
  notifications: WorkspaceNotification[];
  onNavigate: (target: NotificationTarget, contentId?: string) => void;
}) {
  const [brandId, setBrandId] = useState("");
  const [kind, setKind] = useState("");
  const brandMap = useMemo(() => new Map(brands.map(brand => [brand.id, brand.name])), [brands]);
  const shown = notifications.filter(item => (!brandId || item.brandId === brandId) && (!kind || item.kind === kind));
  const critical = notifications.filter(item => item.level === "critical").length;

  return <section className="card notification-center">
    <div className="section-heading"><div><h3>Pusat notifikasi</h3><p>Masalah yang membutuhkan tindakan akan hilang otomatis setelah diselesaikan.</p></div><span className={`notification-total ${critical ? "has-critical" : ""}`}><Bell size={17}/>{notifications.length}</span></div>
    <div className="notification-summary">
      <article><CircleAlert size={18}/><span><b>{critical}</b> perlu segera ditangani</span></article>
      <article><CalendarClock size={18}/><span><b>{notifications.length - critical}</b> perlu diperhatikan</span></article>
    </div>
    <div className="filters"><select aria-label="Filter brand notifikasi" value={brandId} onChange={event => setBrandId(event.target.value)}><option value="">Semua brand</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select><select aria-label="Filter jenis notifikasi" value={kind} onChange={event => setKind(event.target.value)}><option value="">Semua jenis</option><option value="planning">Deadline planner</option><option value="publishing">Publikasi</option><option value="review">Review</option><option value="connection">Koneksi akun</option></select></div>
    {shown.length ? <div className="notification-list">{shown.map(item => {
      const Icon = icons[item.kind];
      return <article className={`notification-item ${item.level}`} key={item.id}>
        <span className="notification-icon"><Icon size={18}/></span>
        <div><small>{brandMap.get(item.brandId) || "Workspace"} · {formatDate(item.occurredAt)} WIB</small><strong>{item.title}</strong><p>{item.message}</p></div>
        <button className="secondary compact" onClick={() => onNavigate(item.target, item.contentId)}>Tangani</button>
      </article>;
    })}</div> : <div className="empty-state"><CheckCircle2 size={34}/><h4>Tidak ada masalah aktif</h4><p>Semua review, publikasi, dan koneksi akun dalam kondisi siap.</p></div>}
  </section>;
}
