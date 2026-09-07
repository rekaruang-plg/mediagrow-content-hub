import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const COOKIE_NAME = "mediagrow-meta-oauth";
export const FLOW_SECONDS = 600;
export const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function config() {
  const site = new URL(process.env.APP_URL || "https://mediagrow-content-hub.vercel.app");
  const local = ["localhost", "127.0.0.1"].includes(site.hostname);
  if (site.username || site.password || site.pathname !== "/" || site.search || site.hash ||
      (site.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production"))) {
    throw new OAuthError("configuration", "Alamat aplikasi belum dikonfigurasi dengan benar.", 503);
  }
  const appId = process.env.META_APP_ID || "1350438086849056";
  const version = process.env.META_GRAPH_VERSION || "v26.0";
  const configId = process.env.META_LOGIN_CONFIG_ID || "";
  if (!/^\d+$/.test(appId) || !/^v\d+\.0$/.test(version) || (configId && !/^\d+$/.test(configId))) {
    throw new OAuthError("configuration", "Konfigurasi aplikasi Meta belum valid.", 503);
  }
  return { appId, version, configId, secret: process.env.META_APP_SECRET || "", origin: site.origin,
    redirectUri: `${site.origin}/api/meta/callback`, secure: site.protocol === "https:" };
}
export function requireConfig() {
  const c = config();
  if (c.secret.length < 32) throw new OAuthError("not_configured", "Login Meta belum diaktifkan. Minta admin melengkapi konfigurasi koneksi.", 503);
  return c;
}

const common = { userId: z.string().uuid(), brandId: z.string().uuid(), flowId: z.string().min(32).max(128), expires: z.number() };
const flowSchema = z.discriminatedUnion("stage", [
  z.object({ ...common, stage: z.literal("start"), accessToken: z.string().min(1).max(8000), state: z.string().min(32).max(128) }),
  z.object({ ...common, stage: z.literal("choose"), metaToken: z.string().min(1).max(8000), tokenExpiresAt: z.string().datetime().nullable() }),
]);
export type Flow = z.infer<typeof flowSchema>;
function key() { return createHash("sha256").update("mediagrow:meta-oauth:cookie:v1:").update(requireConfig().secret).digest(); }
export function seal(flow: Flow): string {
  flowSchema.parse(flow);
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(config().origin));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(flow), "utf8"), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (value.length > 3700) throw new OAuthError("session_size", "Sesi koneksi terlalu besar. Hubungi admin untuk memeriksa konfigurasi akun.");
  return value;
}
export function unseal(value: string | undefined): Flow {
  try {
    if (!value || value.length > 3700) throw new Error();
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    decipher.setAAD(Buffer.from(config().origin));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    const flow = flowSchema.parse(data);
    if (flow.expires <= Date.now() || flow.expires > Date.now() + FLOW_SECONDS * 1000 + 5000) throw new Error();
    return flow;
  } catch { throw new OAuthError("session_expired", "Sesi koneksi berakhir atau tidak valid. Klik Hubungkan lewat Facebook lagi.", 401); }
}
export function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function nonce() { return randomBytes(32).toString("hex"); }
export function authorizationUrl(state: string) {
  const c = requireConfig(), url = new URL(`https://www.facebook.com/${c.version}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: c.appId, redirect_uri: c.redirectUri, response_type: "code", state,
    ...(c.configId ? { config_id: c.configId, override_default_response_type: "true" } : { scope: SCOPES.join(","), auth_type: "rerequest" }) }).toString();
  return url.toString();
}

async function requestMeta(path: string, params: Record<string, string>, token?: string) {
  const c = requireConfig(), url = new URL(`https://graph.facebook.com/${c.version}/${path}`);
  url.search = new URLSearchParams({ ...params, ...(token ? { appsecret_proof: createHmac("sha256", c.secret).update(token).digest("hex") } : {}) }).toString();
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000), headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
  catch { throw new OAuthError("meta_unavailable", "Meta belum dapat dihubungi. Silakan coba lagi.", 502); }
  let data;
  try { data = await response.json(); } catch { throw new OAuthError("meta_response", "Respons Meta tidak dapat dibaca. Silakan coba lagi.", 502); }
  if (!response.ok || data.error) {
    // Never propagate provider messages, URLs, or bodies: these can contain credentials.
    if (data.error?.code === 190) throw new OAuthError("meta_expired", "Akses Meta sudah tidak valid. Hubungkan akun kembali.", 401);
    if ([10, 200].includes(data.error?.code)) throw new OAuthError("meta_permissions", "Izin Meta belum lengkap. Periksa akses Page dan izin publikasi aplikasi.", 403);
    throw new OAuthError("meta_error", "Meta menolak permintaan. Periksa pengaturan login, izin aplikasi, dan akun penguji.", 502);
  }
  return data;
}
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().nonnegative().optional() });
export async function exchangeCode(code: string) {
  const c = requireConfig();
  const short = tokenSchema.parse(await requestMeta("oauth/access_token", { client_id: c.appId, client_secret: c.secret, redirect_uri: c.redirectUri, code }));
  const long = tokenSchema.parse(await requestMeta("oauth/access_token", { grant_type: "fb_exchange_token", client_id: c.appId, client_secret: c.secret, fb_exchange_token: short.access_token }));
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null };
}

const pageSchema = z.object({ id: z.string().regex(/^\d+$/), name: z.string(), access_token: z.string().optional(), tasks: z.array(z.string()).default([]),
  instagram_business_account: z.object({ id: z.string().regex(/^\d+$/), username: z.string().optional(), name: z.string().optional() }).nullable().optional() });
export type MetaPage = z.infer<typeof pageSchema>;
export async function listPages(token: string) {
  const permissionResult = await requestMeta("me/permissions", {}, token);
  const permissions = z.array(z.object({ permission: z.string(), status: z.string() })).parse(permissionResult.data);
  const granted = new Set(permissions.filter(p => p.status === "granted").map(p => p.permission));
  if (!granted.has("pages_show_list")) throw new OAuthError("meta_permissions", "Izinkan akses daftar Facebook Page saat menghubungkan akun.", 403);
  const pages: MetaPage[] = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const fields = "id,name,access_token,tasks" + (granted.has("instagram_basic") ? ",instagram_business_account{id,username,name}" : "");
    const result = await requestMeta("me/accounts", { fields, limit: "100", ...(after ? { after } : {}) }, token);
    pages.push(...z.array(pageSchema).parse(result.data));
    if (!result.paging?.next) return { pages, granted };
    // Follow only the opaque cursor on our fixed Meta endpoint, never an upstream URL.
    const cursor = result.paging?.cursors?.after;
    if (typeof cursor !== "string" || !cursor || cursor === after) break;
    after = cursor;
  }
  throw new OAuthError("too_many_pages", "Daftar Page terlalu panjang atau tidak lengkap. Ulangi login dan pilih Page brand yang diperlukan.");
}
export function pageChoice(page: MetaPage, granted: Set<string>) {
  const task = page.tasks.some(t => ["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_FULL_CONTROL", "PROFILE_PLUS_CREATE_CONTENT"].includes(t));
  const usable = Boolean(page.access_token) && task;
  return { id: page.id, name: page.name, instagram: page.instagram_business_account ? {
    id: page.instagram_business_account.id, username: page.instagram_business_account.username || "", name: page.instagram_business_account.name || "Instagram",
  } : null,
  facebookAllowed: usable && granted.has("pages_manage_posts") && granted.has("pages_read_engagement"),
  instagramAllowed: usable && !!page.instagram_business_account && granted.has("instagram_basic") && granted.has("instagram_content_publish") && granted.has("pages_read_engagement") };
}
