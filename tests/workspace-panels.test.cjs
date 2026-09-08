const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require.extensions['.tsx'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  });
  module._compile(outputText, filename);
};
const { WorkspaceOverview, WorkspaceCalendar, evaluateMedia, evaluateMediaSelection } = require('../src/app/workspace-panels.tsx');
const { buildWorkspaceNotifications, NotificationPanel } = require('../src/app/notification-panel.tsx');
test('one content item with mixed channel outcomes displays both jobs and the failure detail', () => {
  const common = { content_item_id: 'content-1', publish_kind: 'feed', scheduled_for: '2026-09-09T02:00:00Z' };
  const html = renderToStaticMarkup(React.createElement(WorkspaceOverview, {
    brands: [{ id: 'brand-1', name: 'Test Brand', niche: null }],
    content: [{ id: 'content-1', brand_id: 'brand-1', title: 'Test Content', media_type: 'image', status: 'ready', created_at: '2026-09-08T02:00:00Z' }],
    jobs: [{ ...common, id: 'job-1', platform: 'instagram', status: 'posted', error_message: null }, { ...common, id: 'job-2', platform: 'facebook', status: 'failed', error_message: 'Test permission failure' }],
    onUpload() {},
  }));
  const tbody = html.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
  assert.ok(tbody);
  assert.equal((tbody.match(/<tr>/g) || []).length, 2);
  assert.ok(tbody.includes('instagram'));
  assert.ok(tbody.includes('facebook'));
  assert.ok(tbody.includes('Terbit'));
  assert.ok(tbody.includes('Gagal'));
  assert.ok(tbody.includes('Test permission failure'));
});

test('weekly calendar renders a scheduled job with brand and channel context', () => {
  const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const html = renderToStaticMarkup(React.createElement(WorkspaceCalendar, {
    brands: [{ id: 'brand-1', name: 'Calendar Brand', niche: null }],
    content: [{ id: 'content-1', brand_id: 'brand-1', title: 'Calendar Content', media_type: 'image', status: 'scheduled', created_at: scheduledFor }],
    jobs: [{ id: 'job-1', content_item_id: 'content-1', platform: 'instagram', publish_kind: 'feed', scheduled_for: scheduledFor, status: 'scheduled', error_message: null }],
    onUpload() {},
  }));
  assert.ok(html.includes('Kalender publikasi'));
  assert.ok(html.includes('Calendar Content'));
  assert.ok(html.includes('Calendar Brand'));
  assert.ok(html.includes('IG feed'));
});

test('upload source exposes manual, auto, and smart scheduling through the atomic content RPC', () => {
  const source = fs.readFileSync(require.resolve('../src/app/page.tsx'), 'utf8');
  assert.ok(source.includes('value="smart"'));
  assert.ok(source.includes('value="auto"'));
  assert.ok(source.includes('value="manual"'));
  assert.ok(source.includes('create_content_with_assets'));
  assert.ok(source.includes('recommend_content_schedule'));
});

test('carousel and Story selections enforce format-specific asset rules', () => {
  const image = (name, width=1080, height=1080) => ({ name, mimeType: 'image/jpeg', mediaType: 'image', bytes: 500000, width, height, durationSeconds: null });
  const video = { name: 'story.mp4', mimeType: 'video/mp4', mediaType: 'video', bytes: 1000000, width: 1080, height: 1920, durationSeconds: 12 };
  assert.equal(evaluateMediaSelection([image('one.jpg')], ['ig_feed'], 'carousel').errors.some(message => message.includes('2–10')), true);
  assert.equal(evaluateMediaSelection([image('one.jpg'), image('two.jpg')], ['ig_feed'], 'carousel').errors.length, 0);
  assert.equal(evaluateMediaSelection([image('one.jpg'), video], ['ig_feed'], 'carousel').errors.some(message => message.includes('gambar saja')), true);
  assert.equal(evaluateMediaSelection([image('story.jpg', 1080, 1920), video], ['ig_story'], 'story').errors.length, 0);
});

test('worker contains resumable multi-frame Story and carousel publishing flows', () => {
  const worker = fs.readFileSync(require.resolve('../supabase/functions/publish-worker/index.ts'), 'utf8');
  assert.ok(worker.includes('media_type:"CAROUSEL"'));
  assert.ok(worker.includes('attached_media['));
  assert.ok(worker.includes('published_asset_positions'));
  assert.ok(worker.includes('content_assets'));
});

test('internal operations expose approval, job management, activity, and team workflows', () => {
  const page = fs.readFileSync(require.resolve('../src/app/page.tsx'), 'utf8');
  const operations = fs.readFileSync(require.resolve('../src/app/operations-panels.tsx'), 'utf8');
  assert.ok(page.includes('review_content'));
  assert.ok(page.includes('manage_publish_job'));
  assert.ok(page.includes('list_workspace_activity'));
  assert.ok(page.includes('approval_required'));
  assert.ok(page.includes('<TeamPanel'));
  assert.ok(operations.includes('Persetujuan konten'));
  assert.ok(operations.includes('Preview & detail konten'));
  assert.ok(operations.includes('create_workspace_invite'));
  assert.ok(operations.includes('update_brand_member_access'));
});

test('calendar and job table include reschedule, cancel, and retry controls', () => {
  const source = fs.readFileSync(require.resolve('../src/app/workspace-panels.tsx'), 'utf8');
  assert.ok(source.includes('Simpan jadwal'));
  assert.ok(source.includes('Batalkan'));
  assert.ok(source.includes('Coba lagi'));
  assert.ok(source.includes('onJobAction'));
});

test('media validation blocks incompatible Instagram files and warns about vertical cropping', () => {
  const png = evaluateMedia({ name: 'square.png', mimeType: 'image/png', mediaType: 'image', bytes: 500000, width: 1080, height: 1080, durationSeconds: null }, ['ig_feed']);
  assert.ok(png.errors.some(message => message.includes('JPG/JPEG')));
  const story = evaluateMedia({ name: 'wide.jpg', mimeType: 'image/jpeg', mediaType: 'image', bytes: 500000, width: 1200, height: 800, durationSeconds: null }, ['ig_story']);
  assert.equal(story.errors.length, 0);
  assert.ok(story.warnings.some(message => message.includes('9:16')));
  const reelImage = evaluateMedia({ name: 'reel.jpg', mimeType: 'image/jpeg', mediaType: 'image', bytes: 500000, width: 1080, height: 1920, durationSeconds: null }, ['ig_reel']);
  assert.ok(reelImage.errors.some(message => message.includes('membutuhkan video')));
  const unsupported = evaluateMedia({ name: 'unsafe.svg', mimeType: 'image/svg+xml', mediaType: 'image', bytes: 5000, width: 1080, height: 1080, durationSeconds: null }, ['fb_feed']);
  assert.ok(unsupported.errors.some(message => message.includes('tidak didukung')));
});

test('notification center derives only currently actionable workspace issues', () => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  const notifications = buildWorkspaceNotifications(
    [{ id: 'brand-1', name: 'Gudang WPC' }],
    [{ id: 'content-1', brand_id: 'brand-1', title: 'Promo', approval_status: 'pending_review', review_note: null, created_at: '2026-09-07T00:00:00Z' }],
    [{ id: 'job-1', content_item_id: 'content-1', platform: 'instagram', publish_kind: 'feed', status: 'failed', error_message: 'Token invalid', scheduled_for: '2026-09-08T00:00:00Z' }],
    [{ id: 'account-1', brand_id: 'brand-1', platform: 'instagram', username: 'gudang.interior_', display_name: null, status: 'connected', token_expires_at: '2026-09-15T00:00:00Z', last_verified_at: null, updated_at: '2026-09-08T00:00:00Z' }],
    now,
  );
  assert.equal(notifications.length, 3);
  assert.equal(notifications[0].level, 'critical');
  assert.deepEqual(new Set(notifications.map(item => item.kind)), new Set(['review', 'publishing', 'connection']));
  const html = renderToStaticMarkup(React.createElement(NotificationPanel, { brands: [{ id: 'brand-1', name: 'Gudang WPC' }], notifications, onNavigate() {} }));
  assert.ok(html.includes('Pusat notifikasi'));
  assert.ok(html.includes('Promo gagal terbit'));
  assert.ok(html.includes('Gudang WPC'));
});

test('brand screen exposes editable brand kit through the protected RPC', () => {
  const page = fs.readFileSync(require.resolve('../src/app/page.tsx'), 'utf8');
  const schedule = fs.readFileSync(require.resolve('../src/app/schedule-panels.tsx'), 'utf8');
  const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260908110000_brand_kit.sql'), 'utf8');
  assert.ok(page.includes('<BrandKitEditor'));
  assert.ok(schedule.includes('update_brand_kit'));
  assert.ok(schedule.includes('Simpan Brand Kit'));
  assert.ok(migration.includes('security invoker'));
  assert.ok(migration.includes('private.can_edit_brand'));
  assert.ok(migration.includes('brand.kit_updated'));
});
