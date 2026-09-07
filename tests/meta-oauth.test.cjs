const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Use the project's pinned TypeScript compiler, with no additional test dependencies.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  });
  module._compile(outputText, filename);
};
const { NextRequest } = require('next/server');
const oauth = require('../src/lib/meta/oauth.ts');
const handlers = require('../src/lib/meta/handlers.ts');
const ORIGIN = 'https://mediagrow-content-hub.vercel.app';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECRET = 'test-only-secret-not-a-real-app-key-123456789';
const SUPABASE_TOKEN = 'test-only-supabase-access-token';
const META_TOKEN = 'test-only-meta-user-token';
const PAGE_TOKEN = 'test-only-meta-page-token';
const nativeFetch = global.fetch;
let userId, role, pages, granted, calls, saves, graphError, databaseError, paginate;
function response(data, status = 200) { return Response.json(data, { status }); }
beforeEach(() => {
  process.env.APP_URL = ORIGIN; process.env.META_APP_SECRET = SECRET;
  delete process.env.META_LOGIN_CONFIG_ID;
  userId = USER; role = 'owner'; calls = []; saves = []; graphError = null; databaseError = false; paginate = false;
  granted = [...oauth.SCOPES];
  pages = [{ id: '101', name: 'Page Reka Ruang', access_token: PAGE_TOKEN, tasks: ['CREATE_CONTENT'],
    instagram_business_account: { id: '202', name: 'Reka Ruang', username: 'rekaruang_test' } }];
  global.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname.endsWith('.supabase.co')) {
      if (url.pathname === '/auth/v1/user') {
        if (new Headers(init.headers).get('authorization') !== `Bearer ${SUPABASE_TOKEN}`) return response({ message: 'bad token' }, 401);
        return response({ id: userId, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
      }
      if (url.pathname === '/rest/v1/brands') return response({ id: BRAND, name: 'Reka Ruang', organization_id: ORG });
      if (url.pathname === '/rest/v1/memberships') return response({ role });
      if (url.pathname === '/rest/v1/rpc/connect_meta_accounts') {
        if (databaseError) return response({ message: 'internal db error containing a secret' }, 500);
        saves.push(JSON.parse(init.body)); return response(['saved-facebook-id', 'saved-instagram-id']);
      }
    }
    if (url.hostname === 'graph.facebook.com') {
      assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      if (graphError) return response({ error: graphError }, 400);
      if (url.pathname.endsWith('/oauth/access_token')) return response({ access_token: META_TOKEN, expires_in: 3600 });
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${META_TOKEN}`);
      if (url.pathname.endsWith('/me/permissions')) return response({ data: granted.map(permission => ({ permission, status: 'granted' })) });
      if (url.pathname.endsWith('/me/accounts')) {
        if (paginate && !url.searchParams.has('after')) return response({ data: [], paging: { next: 'https://evil.invalid/steal', cursors: { after: 'safe-cursor' } } });
        return response({ data: pages });
      }
    }
    throw new Error(`Unexpected network request in isolated test: ${url.origin}${url.pathname}`);
  };
});
afterEach(() => { global.fetch = nativeFetch; delete process.env.META_APP_SECRET; delete process.env.META_LOGIN_CONFIG_ID; });
function request(path, { body, cookie, token = SUPABASE_TOKEN, origin = ORIGIN } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = `${oauth.COOKIE_NAME}=${cookie}`;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers.Origin = origin; }
  return new NextRequest(`${ORIGIN}/api/meta/${path}`, { method: body === undefined ? 'GET' : 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function choiceFlow(overrides = {}) {
  return { stage: 'choose', userId: USER, brandId: BRAND, flowId: 'f'.repeat(64), expires: Date.now() + 600000, metaToken: META_TOKEN, tokenExpiresAt: null, ...overrides };
}
function body(flow = choiceFlow()) { return { flowId: flow.flowId, pageId: '101', platforms: ['facebook', 'instagram'] }; }

test('missing configuration stays disabled, and unauthenticated start never reaches Meta', async () => {
  delete process.env.META_APP_SECRET;
  let result = await handlers.status(request('status'));
  assert.equal((await result.json()).ready, false);
  result = await handlers.start(request('start', { body: { brandId: BRAND } }));
  assert.equal(result.status, 503);
  process.env.META_APP_SECRET = SECRET;
  result = await handlers.start(request('start', { body: { brandId: BRAND }, token: null }));
  assert.equal(result.status, 401); assert.equal(saves.length, 0);
  assert.ok(calls.every(x => x.hostname !== 'graph.facebook.com'));
});
test('cross-origin POST and non-admin start are rejected', async () => {
  let result = await handlers.start(request('start', { body: { brandId: BRAND }, origin: 'https://evil.invalid' }));
  assert.equal(result.status, 403); assert.equal(calls.length, 0);
  role = 'editor'; result = await handlers.start(request('start', { body: { brandId: BRAND } }));
  assert.equal(result.status, 403);
});
test('cookie encryption detects tampering, expiry and wrong application origin', () => {
  const flow = choiceFlow(), encrypted = oauth.seal(flow);
  assert.ok(!encrypted.includes(META_TOKEN)); assert.deepEqual(oauth.unseal(encrypted), flow);
  assert.throws(() => oauth.unseal((encrypted[0] === 'A' ? 'B' : 'A') + encrypted.slice(1)));
  assert.throws(() => oauth.unseal(oauth.seal(choiceFlow({ expires: Date.now() - 1 }))));
  process.env.APP_URL = 'https://other.invalid'; assert.throws(() => oauth.unseal(encrypted));
});
test('start binds random state to a Secure HttpOnly cookie and exact redirect URI', async () => {
  const result = await handlers.start(request('start', { body: { brandId: BRAND } }));
  assert.equal(result.status, 200);
  const data = await result.json(), url = new URL(data.url), setCookie = result.headers.get('set-cookie');
  assert.equal(url.hostname, 'www.facebook.com');
  assert.equal(url.searchParams.get('client_id'), '1350438086849056');
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/meta/callback`);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, /Max-Age=600/); assert.ok(!JSON.stringify(data).includes(SUPABASE_TOKEN));
  const flow = oauth.unseal(result.cookies.get(oauth.COOKIE_NAME).value);
  assert.equal(flow.state, url.searchParams.get('state')); assert.equal(flow.brandId, BRAND);
});
test('optional business configuration uses config_id without falling back to another app', () => {
  process.env.META_LOGIN_CONFIG_ID = '999999'; const url = new URL(oauth.authorizationUrl('x'.repeat(64)));
  assert.equal(url.searchParams.get('config_id'), '999999'); assert.equal(url.searchParams.get('scope'), null);
});
test('invalid state, cancellation and replay at the wrong stage never exchange a code', async () => {
  const start = await handlers.start(request('start', { body: { brandId: BRAND } }));
  const sealed = start.cookies.get(oauth.COOKIE_NAME).value, flow = oauth.unseal(sealed);
  for (const path of ['callback?state=wrong&code=attack', `callback?state=${flow.state}&error=access_denied`]) {
    const result = await handlers.callback(request(path, { cookie: sealed }));
    assert.equal(result.status, 303); assert.ok(new URL(result.headers.get('location')).searchParams.has('meta_error'));
  }
  const replay = await handlers.callback(request(`callback?state=${flow.state}&code=attack`, { cookie: oauth.seal(choiceFlow()) }));
  assert.ok(replay.headers.get('location').includes('state_mismatch'));
  assert.ok(calls.every(x => x.hostname !== 'graph.facebook.com')); assert.equal(saves.length, 0);
});
test('happy path exchanges on server, shows safe choices and atomically saves the selected brand accounts', async () => {
  const started = await handlers.start(request('start', { body: { brandId: BRAND } }));
  const firstCookie = started.cookies.get(oauth.COOKIE_NAME).value, startFlow = oauth.unseal(firstCookie);
  const callback = await handlers.callback(request(`callback?state=${startFlow.state}&code=test-one-time-code`, { cookie: firstCookie }));
  assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), `${ORIGIN}/?tab=meta&meta=choose`);
  const cookie = callback.cookies.get(oauth.COOKIE_NAME).value, flow = oauth.unseal(cookie);
  assert.equal(flow.stage, 'choose'); assert.equal(flow.accessToken, undefined);
  assert.equal(saves.length, 0); // Authorizing Meta does not save or publish anything yet.
  const listed = await handlers.choices(request('choices', { cookie }));
  const data = await listed.json();
  assert.equal(data.brand.id, BRAND); assert.equal(data.pages[0].instagram.id, '202');
  for (const secret of [META_TOKEN, PAGE_TOKEN, SECRET, SUPABASE_TOKEN]) assert.ok(!JSON.stringify(data).includes(secret));
  const saved = await handlers.connect(request('connect', { cookie, body: { ...body(flow), brandId: OTHER, access_token: 'forged-token' } }));
  assert.equal(saved.status, 200); assert.equal(saves.length, 1);
  assert.equal(saves[0].p_brand_id, BRAND);
  assert.deepEqual(saves[0].p_accounts.map(a => a.external_account_id), ['101', '202']);
  assert.ok(saves[0].p_accounts.every(a => a.access_token === PAGE_TOKEN));
  assert.match(saved.headers.get('set-cookie'), /Max-Age=0/);
  const publicResult = await saved.text(); assert.ok(!publicResult.includes(PAGE_TOKEN));
  assert.ok(calls.every(x => !x.pathname.includes('schedule_content') && !x.pathname.includes('media_publish')));
});
test('a different MediaGrow user and a downgraded administrator cannot view or save choices', async () => {
  const cookie = oauth.seal(choiceFlow()); userId = OTHER;
  let result = await handlers.choices(request('choices', { cookie })); assert.equal(result.status, 403);
  userId = USER; role = 'uploader'; result = await handlers.connect(request('connect', { cookie, body: body() }));
  assert.equal(result.status, 403); assert.equal(saves.length, 0);
});
test('forged Page, stale flow and unavailable Instagram are rejected before persistence', async () => {
  const flow = choiceFlow(), cookie = oauth.seal(flow);
  let result = await handlers.connect(request('connect', { cookie, body: { ...body(flow), pageId: '999' } })); assert.equal(result.status, 403);
  result = await handlers.connect(request('connect', { cookie, body: { ...body(flow), flowId: 'g'.repeat(64) } })); assert.equal(result.status, 400);
  delete pages[0].instagram_business_account;
  result = await handlers.connect(request('connect', { cookie, body: body(flow) })); assert.equal(result.status, 403);
  assert.equal(saves.length, 0);
});
test('missing publishing permission or Page task disables that platform', async () => {
  granted = granted.filter(p => p !== 'pages_manage_posts'); const cookie = oauth.seal(choiceFlow());
  let result = await handlers.choices(request('choices', { cookie })); let data = await result.json();
  assert.equal(data.pages[0].facebookAllowed, false); assert.equal(data.pages[0].instagramAllowed, true);
  result = await handlers.connect(request('connect', { cookie, body: body() })); assert.equal(result.status, 403);
  pages[0].tasks = []; result = await handlers.choices(request('choices', { cookie })); data = await result.json();
  assert.equal(data.pages[0].instagramAllowed, false); assert.equal(saves.length, 0);
});
test('Facebook-only consent does not request an Instagram-protected field', async () => {
  granted = granted.filter(p => !p.startsWith('instagram_')); delete pages[0].instagram_business_account;
  const cookie = oauth.seal(choiceFlow());
  const result = await handlers.connect(request('connect', { cookie, body: { ...body(), platforms: ['facebook'] } }));
  assert.equal(result.status, 200); assert.equal(saves[0].p_accounts.length, 1);
  assert.ok(calls.filter(x => x.pathname.endsWith('/me/accounts')).every(x => !x.searchParams.get('fields').includes('instagram')));
});
test('pagination never follows arbitrary next URLs or leaks provider tokens to the browser', async () => {
  paginate = true; const result = await handlers.choices(request('choices', { cookie: oauth.seal(choiceFlow()) }));
  assert.equal(result.status, 200); assert.equal((await result.json()).pages.length, 1);
  assert.ok(calls.some(x => x.searchParams.get('after') === 'safe-cursor'));
  assert.ok(calls.every(x => x.hostname !== 'evil.invalid'));
});
test('Meta error messages and database errors never expose secrets', async () => {
  const cookie = oauth.seal(choiceFlow()); graphError = { code: 100, message: `${SECRET} ${META_TOKEN} ${PAGE_TOKEN}` };
  let result = await handlers.choices(request('choices', { cookie }));
  assert.equal(result.status, 502); assert.ok(!(await result.text()).includes(SECRET));
  graphError = null; databaseError = true; result = await handlers.connect(request('connect', { cookie, body: body() }));
  assert.equal(result.status, 500); assert.ok(!(await result.text()).includes('internal db error')); assert.equal(saves.length, 0);
});
test('cancel clears temporary credentials and performs no account writes', async () => {
  const result = await handlers.cancel(request('cancel', { cookie: oauth.seal(choiceFlow()), body: {} }));
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Max-Age=0/); assert.equal(saves.length, 0);
});
