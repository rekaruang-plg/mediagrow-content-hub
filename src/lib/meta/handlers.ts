import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizationUrl, config, COOKIE_NAME, exchangeCode, FLOW_SECONDS, listPages, nonce, OAuthError, pageChoice, requireConfig, same, seal, unseal, type Flow } from "./oauth";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function failure(error: unknown) {
  if (error instanceof OAuthError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Data koneksi tidak valid. Silakan ulangi proses koneksi.", code: "invalid_data" }, 400);
  return json({ error: "Koneksi belum dapat diselesaikan. Silakan coba lagi.", code: "connection_failed" }, 500);
}
function checkOrigin(req: NextRequest, mutation = false) {
  const origin = config().origin;
  if (new URL(req.url).origin !== origin || (mutation && req.headers.get("origin") !== origin)) {
    throw new OAuthError("origin", "Buka koneksi dari alamat utama MediaGrow Content Hub.", 403);
  }
}
async function authenticated(token: string | null) {
  if (!token) throw new OAuthError("unauthorized", "Masuk ke MediaGrow terlebih dahulu.", 401);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ntdqqzqgkylxixivkmrp.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_QeWv7cMl3JCrHWBN0m5cQA_IN0Tbk_w", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new OAuthError("unauthorized", "Sesi MediaGrow berakhir. Masuk kembali lalu ulangi koneksi.", 401);
  return { db, user: data.user, token };
}
function bearer(req: NextRequest) { return req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] || null; }
async function brandAdmin(auth: Awaited<ReturnType<typeof authenticated>>, brandId: string) {
  const { data: brand, error } = await auth.db.from("brands").select("id,name,organization_id").eq("id", brandId).single();
  if (error || !brand) throw new OAuthError("forbidden", "Brand tidak ditemukan atau tidak dapat diakses.", 403);
  const { data: membership } = await auth.db.from("memberships").select("role").eq("organization_id", brand.organization_id).eq("user_id", auth.user.id).single();
  if (!membership || !["owner", "admin"].includes(membership.role)) throw new OAuthError("forbidden", "Hanya owner atau admin workspace yang dapat menghubungkan akun brand.", 403);
  return brand;
}
function cookie(response: NextResponse, flow?: Flow) {
  response.cookies.set(COOKIE_NAME, flow ? seal(flow) : "", { httpOnly: true, secure: config().secure, sameSite: "lax", path: "/api/meta", maxAge: flow ? FLOW_SECONDS : 0 });
  return response;
}
async function choiceContext(req: NextRequest, mutation = false) {
  checkOrigin(req, mutation);
  requireConfig();
  const auth = await authenticated(bearer(req)), flow = unseal(req.cookies.get(COOKIE_NAME)?.value);
  if (flow.stage !== "choose") throw new OAuthError("wrong_stage", "Selesaikan login Meta terlebih dahulu.", 409);
  if (flow.userId !== auth.user.id) throw new OAuthError("wrong_user", "Sesi koneksi dibuat oleh pengguna MediaGrow yang berbeda. Ulangi koneksi.", 403);
  const brand = await brandAdmin(auth, flow.brandId);
  return { auth, flow, brand };
}
export async function status(req: NextRequest) {
  try {
    checkOrigin(req); await authenticated(bearer(req));
    const c = config();
    return json({ ready: c.secret.length >= 32, appId: c.appId, redirectUri: c.redirectUri });
  } catch (e) { return failure(e); }
}
export async function start(req: NextRequest) {
  try {
    checkOrigin(req, true); requireConfig();
    const auth = await authenticated(bearer(req));
    const { brandId } = z.object({ brandId: z.string().uuid() }).parse(await req.json());
    await brandAdmin(auth, brandId);
    const state = nonce();
    return cookie(json({ url: authorizationUrl(state) }), { stage: "start", userId: auth.user.id, brandId, accessToken: auth.token, state, flowId: nonce(), expires: Date.now() + FLOW_SECONDS * 1000 });
  } catch (e) { return failure(e); }
}
export async function callback(req: NextRequest) {
  const destination = new URL("/?tab=meta", config().origin);
  try {
    checkOrigin(req); requireConfig();
    const flow = unseal(req.cookies.get(COOKIE_NAME)?.value), state = req.nextUrl.searchParams.get("state") || "";
    if (flow.stage !== "start" || !same(flow.state, state)) throw new OAuthError("state_mismatch", "Sesi login tidak cocok. Ulangi koneksi.");
    if (req.nextUrl.searchParams.has("error")) throw new OAuthError("cancelled", "Login Meta dibatalkan.");
    const code = req.nextUrl.searchParams.get("code");
    if (!code || code.length > 8192) throw new OAuthError("missing_code", "Meta tidak mengirim kode login.");
    const auth = await authenticated(flow.accessToken);
    if (auth.user.id !== flow.userId) throw new OAuthError("wrong_user", "Pengguna tidak cocok.", 403);
    await brandAdmin(auth, flow.brandId);
    const token = await exchangeCode(code);
    destination.searchParams.set("meta", "choose");
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return cookie(response, { stage: "choose", userId: flow.userId, brandId: flow.brandId, flowId: nonce(), metaToken: token.token, tokenExpiresAt: token.expiresAt, expires: Date.now() + FLOW_SECONDS * 1000 });
  } catch (e) {
    destination.searchParams.set("meta_error", e instanceof OAuthError ? e.code : "connection_failed");
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return cookie(response);
  }
}
export async function choices(req: NextRequest) {
  try {
    const { flow, brand } = await choiceContext(req);
    const { pages, granted } = await listPages(flow.metaToken);
    return json({ brand: { id: brand.id, name: brand.name }, flowId: flow.flowId, pages: pages.map(p => pageChoice(p, granted)) });
  } catch (e) { return failure(e); }
}
export async function connect(req: NextRequest) {
  try {
    const { auth, flow } = await choiceContext(req, true);
    const input = z.object({ flowId: z.string(), pageId: z.string().regex(/^\d+$/), platforms: z.array(z.enum(["facebook", "instagram"])).min(1).max(2) }).parse(await req.json());
    if (!same(input.flowId, flow.flowId) || new Set(input.platforms).size !== input.platforms.length) throw new OAuthError("state_mismatch", "Pilihan berasal dari sesi lain. Muat ulang daftar akun.");
    // Re-fetch provider-owned IDs and tokens; never trust IDs, tokens or brand IDs from a form.
    const { pages, granted } = await listPages(flow.metaToken), page = pages.find(p => p.id === input.pageId);
    if (!page?.access_token) throw new OAuthError("page_access", "Page yang dipilih tidak tersedia dalam izin login ini.", 403);
    const available = pageChoice(page, granted);
    if (input.platforms.some(p => p === "facebook" ? !available.facebookAllowed : !available.instagramAllowed)) throw new OAuthError("meta_permissions", "Izin publikasi atau akses akun belum lengkap. Hubungkan ulang dan setujui izin yang diperlukan.", 403);
    const accounts = input.platforms.map(platform => ({ platform, external_account_id: platform === "facebook" ? page.id : page.instagram_business_account!.id,
      access_token: page.access_token, username: platform === "instagram" ? page.instagram_business_account?.username || null : null,
      display_name: platform === "facebook" ? page.name : page.instagram_business_account?.name || page.instagram_business_account?.username || "Instagram",
      token_expires_at: flow.tokenExpiresAt, capabilities: { connection_method: "facebook_login", page_id: page.id, permissions: [...granted], tasks: page.tasks } }));
    const result = await auth.db.rpc("connect_meta_accounts", { p_brand_id: flow.brandId, p_accounts: accounts });
    if (result.error) throw new OAuthError("save_failed", "Akun belum tersimpan. Minta admin memeriksa konfigurasi database, lalu coba lagi.", 500);
    return cookie(json({ connected: input.platforms, brandId: flow.brandId }));
  } catch (e) { return failure(e); }
}
export async function cancel(req: NextRequest) {
  try { checkOrigin(req, true); await authenticated(bearer(req)); return cookie(json({ ok: true })); }
  catch (e) { return failure(e); }
}
