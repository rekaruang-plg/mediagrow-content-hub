"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Activity, Check, Clipboard, Clock3, Eye, History, Link2, LoaderCircle, RotateCcw, Send, ShieldCheck, Trash2, UserPlus, Users, X, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export type OperationsBrand = { id: string; name: string; niche: string | null };
export type OperationsContent = {
  id: string;
  brand_id: string;
  title: string;
  brief: string | null;
  caption: string | null;
  status: string;
  approval_status: string;
  review_note: string | null;
  media_type: string;
  primary_asset_path: string;
  created_at: string;
};
export type ActivityItem = {
  id: number;
  brand_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  actor_name: string;
  created_at: string;
};

type ReviewDecision = "approved" | "changes_requested";
type BrandAccess = { brand_id: string; can_upload: boolean; can_edit: boolean; can_publish: boolean };
type TeamMember = { user_id: string; display_name: string; email: string; role: string; created_at: string; brand_access: BrandAccess[] };
type TeamInvite = { id: string; email: string; role: string; brand_ids: string[]; expires_at: string; created_at: string };
type TeamData = { current_role: string; members: TeamMember[]; invitations: TeamInvite[] };

const approvalLabels: Record<string, string> = {
  draft: "Draf",
  pending_review: "Menunggu review",
  changes_requested: "Perlu revisi",
  approved: "Disetujui",
};
const actionLabels: Record<string, string> = {
  "brand.kit_updated": "memperbarui Brand Kit",
  "content.created": "membuat konten",
  "content.updated": "memperbarui konten",
  "content.submitted": "mengirim konten untuk review",
  "content.reviewed": "meninjau konten",
  "content.scheduled": "menjadwalkan konten",
  "publish_job.reschedule": "mengubah jadwal publikasi",
  "publish_job.cancel": "membatalkan publikasi",
  "publish_job.retry": "mencoba ulang publikasi",
  "publish_job.status_changed": "memperbarui status publikasi",
  "team.invited": "mengundang anggota",
  "team.joined": "bergabung ke workspace",
  "team.removed": "menghapus anggota",
  "team.role_updated": "mengubah peran anggota",
  "team.brand_access_updated": "mengubah akses brand",
  "team.invite_revoked": "membatalkan undangan",
  "brand.rules_updated": "memperbarui aturan brand",
};
const formatDate = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ApprovalQueue({ brands, content, busy, onOpen, onReview }: {
  brands: OperationsBrand[];
  content: OperationsContent[];
  busy: boolean;
  onOpen: (content: OperationsContent) => void;
  onReview: (contentId: string, decision: ReviewDecision, note: string) => Promise<void>;
}) {
  const [brandId, setBrandId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const brandMap = useMemo(() => new Map(brands.map(brand => [brand.id, brand.name])), [brands]);
  const queue = content.filter(item => ["pending_review", "changes_requested"].includes(item.approval_status) && (!brandId || item.brand_id === brandId));
  const waiting = queue.filter(item => item.approval_status === "pending_review");
  const revisions = queue.filter(item => item.approval_status === "changes_requested");

  return <section className="card approval-card">
    <div className="section-heading"><div><h3>Persetujuan konten</h3><p>Periksa materi dan caption sebelum konten masuk ke antrean publikasi.</p></div><span className="count-pill">{waiting.length} menunggu</span></div>
    <div className="filters"><select aria-label="Filter brand persetujuan" value={brandId} onChange={event => setBrandId(event.target.value)}><option value="">Semua brand</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></div>
    {!queue.length ? <div className="empty-state"><ShieldCheck size={34}/><h4>Semua konten sudah ditangani</h4><p>Konten yang dikirim tim untuk review akan muncul di halaman ini.</p></div> : <div className="approval-columns">
      <div><h4><Clock3 size={16}/>Menunggu review <span>{waiting.length}</span></h4>{waiting.length ? waiting.map(item => <article className="review-item" key={item.id}>
        <div><small>{brandMap.get(item.brand_id) || "Brand"}</small><strong>{item.title}</strong><span>{formatDate(item.created_at)} WIB</span></div>
        <button className="secondary compact" onClick={() => onOpen(item)}><Eye size={15}/>Preview</button>
        <label>Catatan review<textarea rows={2} value={notes[item.id] || ""} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Opsional untuk persetujuan, wajib jika perlu revisi"/></label>
        <div className="review-actions"><button disabled={busy} onClick={() => void onReview(item.id, "approved", notes[item.id] || "")}><Check size={15}/>Setujui</button><button className="danger-button" disabled={busy || !(notes[item.id] || "").trim()} onClick={() => void onReview(item.id, "changes_requested", notes[item.id] || "")}><RotateCcw size={15}/>Minta revisi</button></div>
      </article>) : <p className="column-empty">Tidak ada konten menunggu review.</p>}</div>
      <div><h4><RotateCcw size={16}/>Perlu revisi <span>{revisions.length}</span></h4>{revisions.length ? revisions.map(item => <article className="review-item revision" key={item.id}>
        <div><small>{brandMap.get(item.brand_id) || "Brand"}</small><strong>{item.title}</strong><span>{item.review_note || "Belum ada catatan revisi."}</span></div>
        <button className="secondary compact" onClick={() => onOpen(item)}><Eye size={15}/>Buka & perbaiki</button>
      </article>) : <p className="column-empty">Tidak ada konten yang perlu direvisi.</p>}</div>
    </div>}
  </section>;
}

export function ActivityPanel({ brands, activities }: { brands: OperationsBrand[]; activities: ActivityItem[] }) {
  const [brandId, setBrandId] = useState("");
  const brandMap = useMemo(() => new Map(brands.map(brand => [brand.id, brand.name])), [brands]);
  const shown = activities.filter(item => !brandId || item.brand_id === brandId);
  return <section className="card activity-card">
    <div className="section-heading"><div><h3>Riwayat aktivitas</h3><p>Jejak perubahan konten, jadwal, publikasi, dan anggota tim.</p></div><History size={23}/></div>
    <div className="filters"><select aria-label="Filter brand aktivitas" value={brandId} onChange={event => setBrandId(event.target.value)}><option value="">Semua brand</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></div>
    {shown.length ? <div className="activity-list">{shown.map(item => <article key={item.id}><span className="activity-icon"><Activity size={15}/></span><div><strong>{item.actor_name}</strong> {actionLabels[item.action] || item.action}<small>{item.brand_id ? brandMap.get(item.brand_id) || "Brand" : "Workspace"} · {formatDate(item.created_at)} WIB</small></div></article>)}</div> : <div className="empty-state"><History size={32}/><h4>Belum ada aktivitas</h4><p>Aktivitas baru akan dicatat otomatis di sini.</p></div>}
  </section>;
}

function accessLevel(access?: BrandAccess) {
  if (!access) return "none";
  if (access.can_publish) return "publish";
  if (access.can_edit) return "edit";
  if (access.can_upload) return "upload";
  return "view";
}
const permissionsFor = (level: string) => ({
  p_enabled: level !== "none",
  p_can_upload: ["upload","edit","publish"].includes(level),
  p_can_edit: ["edit","publish"].includes(level),
  p_can_publish: level === "publish",
});

function MemberCard({ member, brands, organizationId, currentUserId, canManage, canPromoteAdmin, onReload, onMessage }: {
  member: TeamMember;
  brands: OperationsBrand[];
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
  canPromoteAdmin?: boolean;
  onReload: () => Promise<void>;
  onMessage: (value: string) => void;
}) {
  const protectedMember = member.role === "owner" || member.user_id === currentUserId;
  const [busy, setBusy] = useState(false);
  async function changeRole(role: string) {
    setBusy(true); const { error } = await supabase.rpc("update_workspace_member", { p_organization_id: organizationId, p_user_id: member.user_id, p_role: role, p_remove: false });
    setBusy(false); if (error) onMessage(error.message); else await onReload();
  }
  async function removeMember() {
    if (!window.confirm(`Hapus ${member.display_name} dari workspace?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("update_workspace_member", { p_organization_id: organizationId, p_user_id: member.user_id, p_role: member.role, p_remove: true });
    setBusy(false);
    if (error) onMessage(error.message); else { onMessage(`${member.display_name} dihapus dari workspace.`); await onReload(); }
  }
  return <article className="member-card">
    <div className="member-avatar">{member.display_name.slice(0,2).toUpperCase()}</div><div className="member-main"><strong>{member.display_name}</strong><span>{member.email}</span></div><span className={`role-pill ${member.role}`}>{member.role}</span>
    {canManage && !protectedMember ? <div className="member-controls"><label>Peran<select disabled={busy} value={member.role} onChange={event => void changeRole(event.target.value)}>{canPromoteAdmin || member.role === "admin" ? <option value="admin">Admin</option> : null}<option value="editor">Editor</option><option value="uploader">Uploader</option><option value="viewer">Viewer</option></select></label><button type="button" className="danger-button compact" disabled={busy} onClick={() => void removeMember()}><Trash2 size={14}/>Hapus anggota</button></div> : null}
    {!['owner','admin'].includes(member.role) ? <div className="brand-access-list"><b>Akses brand</b>{brands.map(brand => {
      const access = member.brand_access.find(item => item.brand_id === brand.id);
      return <label key={brand.id}><span>{brand.name}</span><select disabled={!canManage || busy} value={accessLevel(access)} onChange={async event => {
        setBusy(true); const { error } = await supabase.rpc("update_brand_member_access", { p_brand_id: brand.id, p_user_id: member.user_id, ...permissionsFor(event.target.value) }); setBusy(false);
        if (error) onMessage(error.message); else await onReload();
      }}><option value="none">Tidak ada akses</option><option value="view">Lihat saja</option><option value="upload">Upload</option><option value="edit">Upload & edit</option><option value="publish">Sampai terbitkan</option></select></label>;
    })}</div> : <p className="all-brand-access"><ShieldCheck size={15}/>Akses ke seluruh brand dalam workspace.</p>}
  </article>;
}

export function TeamPanel({ organizationId, brands, currentUserId }: { organizationId: string; brands: OperationsBrand[]; currentUserId: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [role, setRole] = useState("uploader");
  const [brandIds, setBrandIds] = useState<string[]>(brands.map(brand => brand.id));
  async function loadTeam() {
    const { data: result, error } = await supabase.rpc("list_workspace_team", { p_organization_id: organizationId });
    if (error) setMessage(error.message); else setData(result as TeamData);
  }
  useEffect(() => { void loadTeam(); }, [organizationId]);
  useEffect(() => { setBrandIds(current => current.length ? current.filter(id => brands.some(brand => brand.id === id)) : brands.map(brand => brand.id)); }, [brands]);
  const canManage = data?.current_role === "owner" || data?.current_role === "admin";

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const formData = new FormData(form);
    setBusy(true); setMessage(""); setInviteLink("");
    const { data: invitation, error } = await supabase.rpc("create_workspace_invite", { p_organization_id: organizationId, p_email: String(formData.get("email")), p_role: role, p_brand_ids: role === "admin" ? [] : brandIds });
    setBusy(false);
    if (error) setMessage(error.message); else {
      const result = invitation as { token: string; email: string };
      const url = `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`;
      setInviteLink(url); setMessage(`Undangan untuk ${result.email} siap dibagikan.`); form.reset(); setRole("uploader"); await loadTeam();
    }
  }
  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink); setMessage("Tautan undangan sudah disalin.");
  }

  return <section className="card team-card">
    <div className="section-heading"><div><h3>Anggota tim</h3><p>Atur siapa yang dapat melihat, upload, mengedit, atau menerbitkan konten setiap brand.</p></div><Users size={23}/></div>
    {message ? <div className="settings-message" role="status">{message}</div> : null}
    {canManage ? <form className="invite-form" onSubmit={invite}><label>Email anggota<input type="email" name="email" placeholder="nama@mediagrow.id" required/></label><label>Peran<select value={role} onChange={event => setRole(event.target.value)}><option value="admin">Admin</option><option value="editor">Editor</option><option value="uploader">Uploader</option><option value="viewer">Viewer</option></select></label>{role !== "admin" ? <fieldset><legend>Brand yang dapat diakses</legend>{brands.map(brand => <label className="check" key={brand.id}><input type="checkbox" checked={brandIds.includes(brand.id)} onChange={event => setBrandIds(current => event.target.checked ? [...current, brand.id] : current.filter(id => id !== brand.id))}/>{brand.name}</label>)}</fieldset> : <p className="inline-help">Admin otomatis dapat mengelola seluruh brand.</p>}<button disabled={busy || (role !== "admin" && !brandIds.length)}><UserPlus size={17}/>{busy ? "Membuat undangan…" : "Buat tautan undangan"}</button></form> : null}
    {inviteLink ? <div className="invite-link"><Link2 size={18}/><div><small>TAUTAN UNDANGAN · BERLAKU 7 HARI</small><code>{inviteLink}</code></div><button onClick={() => void copyInvite()}><Clipboard size={16}/>Salin</button></div> : null}
    {!data ? <div className="panel-loading"><LoaderCircle className="spinning" size={20}/>Memuat anggota…</div> : <div className="member-list">{data.members.map(member => <MemberCard key={member.user_id} member={member} brands={brands} organizationId={organizationId} currentUserId={currentUserId} canManage={Boolean(canManage)} canPromoteAdmin={data.current_role === "owner"} onReload={loadTeam} onMessage={setMessage}/>)}</div>}
    {canManage && data?.invitations.length ? <div className="pending-invites"><h4>Undangan aktif</h4>{data.invitations.map(invitation => <article key={invitation.id}><div><strong>{invitation.email}</strong><span>{invitation.role} · berakhir {formatDate(invitation.expires_at)} WIB</span></div><button className="secondary compact" onClick={async () => { const { error } = await supabase.rpc("revoke_workspace_invite", { p_invitation_id: invitation.id }); if (error) setMessage(error.message); else await loadTeam(); }}><XCircle size={15}/>Batalkan</button></article>)}</div> : null}
  </section>;
}

export function ContentDetailModal({ content, brandName, busy, onClose, onSave, onSubmit }: {
  content: OperationsContent;
  brandName: string;
  busy: boolean;
  onClose: () => void;
  onSave: (contentId: string, title: string, brief: string, caption: string) => Promise<void>;
  onSubmit: (contentId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(content.title);
  const [brief, setBrief] = useState(content.brief || "");
  const [caption, setCaption] = useState(content.caption || "");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState("");
  useEffect(() => {
    let active = true;
    supabase.storage.from("content-media").createSignedUrl(content.primary_asset_path, 900).then(({ data, error }) => {
      if (!active) return;
      if (error) setMediaError("Preview media tidak dapat dimuat."); else setMediaUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [content.primary_asset_path]);
  const editable = !["publishing","posted"].includes(content.status);
  const canResubmit = ["draft","changes_requested"].includes(content.approval_status);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="content-modal" role="dialog" aria-modal="true" aria-labelledby="content-modal-title">
    <header><div><small>{brandName} · {approvalLabels[content.approval_status] || content.approval_status}</small><h3 id="content-modal-title">Preview & detail konten</h3></div><button className="icon-button" aria-label="Tutup detail konten" onClick={onClose}><X size={18}/></button></header>
    <div className="content-modal-grid"><div className="stored-media-preview">{mediaUrl ? content.media_type === "video" ? <video controls preload="metadata" src={mediaUrl}/> : <Image src={mediaUrl} alt={`Preview ${content.title}`} fill sizes="(max-width: 760px) 100vw, 45vw" unoptimized/> : <div>{mediaError || "Memuat preview…"}</div>}</div><form onSubmit={event => { event.preventDefault(); void onSave(content.id,title,brief,caption); }}><label>Judul<input value={title} onChange={event => setTitle(event.target.value)} disabled={!editable} required/></label><label>Brief<textarea rows={3} value={brief} onChange={event => setBrief(event.target.value)} disabled={!editable}/></label><label>Caption<textarea rows={8} value={caption} onChange={event => setCaption(event.target.value)} disabled={!editable}/></label>{content.review_note ? <div className="review-note"><RotateCcw size={16}/><div><b>Catatan revisi</b><p>{content.review_note}</p></div></div> : null}<div className="modal-actions">{editable ? <button disabled={busy}>Simpan perubahan</button> : null}{canResubmit ? <button type="button" className="secondary" disabled={busy} onClick={() => void onSubmit(content.id)}><Send size={15}/>Kirim untuk review</button> : null}</div></form></div>
  </section></div>;
}
