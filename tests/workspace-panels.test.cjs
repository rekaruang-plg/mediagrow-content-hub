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
const { CaptionAssistant } = require('../src/app/caption-assistant.tsx');
const { ChannelCustomizer, serializeChannelOverrides } = require('../src/app/channel-customizer.tsx');
const { ContentPlanner } = require('../src/app/planner-panel.tsx');
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
  assert.ok(html.includes('>IG<'));
  assert.ok(html.includes('>Feed<'));
  assert.ok(html.includes('--calendar-brand'));
});

test('calendar distinguishes brand colors and Feed, Carousel, Story, and Reel icons', () => {
  const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const jobs = [
    { id: 'feed-job', content_item_id: 'feed', platform: 'instagram', publish_kind: 'feed' },
    { id: 'carousel-job', content_item_id: 'carousel', platform: 'facebook', publish_kind: 'feed' },
    { id: 'story-job', content_item_id: 'story', platform: 'instagram', publish_kind: 'story' },
    { id: 'reel-job', content_item_id: 'reel', platform: 'instagram', publish_kind: 'reel' },
  ].map(job => ({ ...job, scheduled_for: scheduledFor, status: 'scheduled', error_message: null }));
  const content = [
    { id: 'feed', brand_id: 'brand-1', title: 'Feed tunggal', content_assets: [{ position: 0 }] },
    { id: 'carousel', brand_id: 'brand-2', title: 'Carousel promo', content_assets: [{ position: 0 }, { position: 1 }] },
    { id: 'story', brand_id: 'brand-1', title: 'Story harian', content_assets: [{ position: 0 }] },
    { id: 'reel', brand_id: 'brand-2', title: 'Reel proyek', content_assets: [{ position: 0 }] },
  ].map(item => ({ ...item, media_type: 'image', status: 'scheduled', created_at: scheduledFor }));
  const html = renderToStaticMarkup(React.createElement(WorkspaceCalendar, {
    brands: [{ id: 'brand-1', name: 'Reka Ruang', niche: null }, { id: 'brand-2', name: 'Gudang WPC', niche: null }],
    content, jobs, onUpload() {},
  }));
  assert.ok(html.includes('WARNA BRAND'));
  assert.ok(html.includes('FORMAT'));
  for (const format of ['Feed', 'Carousel', 'Story', 'Reel']) assert.ok(html.includes(`>${format}<`));
  assert.equal((html.match(/--calendar-brand:/g) || []).length, 4);
  assert.ok(html.includes('--calendar-brand:#7553d4'));
  assert.ok(html.includes('--calendar-brand:#d65f83'));
});

test('upload source exposes manual, auto, and smart scheduling through the atomic content RPC', () => {
  const source = fs.readFileSync(require.resolve('../src/app/page.tsx'), 'utf8');
  assert.ok(source.includes('value="smart"'));
  assert.ok(source.includes('value="auto"'));
  assert.ok(source.includes('value="manual"'));
  assert.ok(source.includes('create_content_with_channel_settings'));
  assert.ok(source.includes('recommend_content_schedule'));
});

test('channel customization keeps independent captions and future times', () => {
  const future = new Date(Date.now() + 86400000);
  const local = new Date(future.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const settings = serializeChannelOverrides(['ig_feed', 'fb_feed'], {
    ig_feed: { caption: 'Caption khusus Instagram', scheduledFor: local },
    fb_feed: { caption: '', scheduledFor: '' },
  });
  assert.equal(settings[0].caption, 'Caption khusus Instagram');
  assert.ok(Date.parse(settings[0].scheduled_for) > Date.now());
  assert.equal(settings[1].caption, null);
  const html = renderToStaticMarkup(React.createElement(ChannelCustomizer, {
    channels: ['ig_feed', 'fb_feed'], masterCaption: 'Caption utama', masterTime: '18.30 WIB', overrides: {}, onChange() {},
  }));
  assert.ok(html.includes('Penyesuaian per channel'));
  assert.ok(html.includes('Instagram Feed'));
  assert.ok(html.includes('Facebook Feed'));
  assert.equal((html.match(/Caption khusus/g) || []).length, 2);
});

test('calendar exposes monthly view, thumbnails, and drag rescheduling', () => {
  const scheduledFor = new Date(Date.now() + 86400000).toISOString();
  const html = renderToStaticMarkup(React.createElement(WorkspaceCalendar, {
    brands: [{ id: 'brand-1', name: 'Visual Brand', niche: null }],
    content: [{ id: 'content-1', brand_id: 'brand-1', title: 'Visual Post', media_type: 'image', status: 'scheduled', created_at: scheduledFor }],
    jobs: [{ id: 'job-1', content_item_id: 'content-1', platform: 'instagram', publish_kind: 'feed', scheduled_for: scheduledFor, status: 'scheduled', error_message: null }],
    thumbnailUrls: { 'content-1': 'https://example.com/thumb.jpg' }, onUpload() {}, async onJobAction() {},
  }));
  assert.ok(html.includes('>Bulan<'));
  assert.ok(html.includes('Seret kartu ke tanggal lain'));
  assert.ok(html.includes('draggable="true"'));
  assert.ok(html.includes('thumb.jpg'));
});

test('library exposes safe content duplication with a thumbnail', () => {
  const createdAt = new Date().toISOString();
  const html = renderToStaticMarkup(React.createElement(WorkspaceOverview, {
    brands: [{ id: 'brand-1', name: 'Library Brand', niche: null }],
    content: [{ id: 'content-1', brand_id: 'brand-1', title: 'Source Post', media_type: 'image', status: 'draft', created_at: createdAt }],
    jobs: [], library: true, thumbnailUrls: { 'content-1': 'https://example.com/library.jpg' }, onUpload() {}, onOpenContent() {}, async onDuplicate() {},
  }));
  assert.ok(html.includes('Thumbnail Source Post'));
  assert.ok(html.includes('Duplikat'));
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
  assert.ok(worker.includes('job.caption??c.caption'));
});

test('channel customization migration protects RPCs and duplicates into drafts', () => {
  const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260909111951_channel_customization_calendar_tools.sql'), 'utf8');
  assert.ok(migration.includes('create_content_with_channel_settings'));
  assert.ok(migration.includes('update_content_customization'));
  assert.ok(migration.includes('duplicate_content_item'));
  assert.ok(migration.includes("source.primary_asset_path, 'ready', 'draft'"));
  assert.ok(migration.includes('revoke execute on function private.apply_channel_settings'));
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

test('content planner renders objective, PIC, deadline, and workflow lanes', () => {
  const now = Date.now();
  const html = renderToStaticMarkup(React.createElement(ContentPlanner, {
    brands: [{ id: 'brand-1', name: 'Gudang WPC', niche: 'Interior' }],
    plans: [{ id: 'plan-1', brand_id: 'brand-1', created_by: 'user-1', assignee_id: 'user-1', title: 'Promo September', brief: 'Highlight produk', objective: 'sales', content_pillar: 'Promo bulanan', content_format: 'carousel', status: 'design', due_at: new Date(now + 86400000).toISOString(), planned_for: new Date(now + 172800000).toISOString(), content_item_id: null, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }],
    comments: [],
    members: [{ user_id: 'user-1', display_name: 'Doni', email: 'doni@example.com', role: 'owner', brand_access: [] }],
    currentUserId: 'user-1', currentRole: 'owner', busy: false,
    async onCreate() { return true; }, async onUpdate() {}, async onComment() {}, onStartUpload() {},
  }));
  assert.ok(html.includes('Content Planner'));
  assert.ok(html.includes('Promo September'));
  assert.ok(html.includes('Sales'));
  assert.ok(html.includes('Doni'));
  assert.ok(html.includes('Produksi'));
});

test('deadline notifications route overdue planner work to the planner', () => {
  const now = Date.parse('2026-09-09T05:00:00Z');
  const notifications = buildWorkspaceNotifications(
    [{ id: 'brand-1', name: 'Gudang WPC' }], [], [], [], now,
    [{ id: 'plan-1', brand_id: 'brand-1', title: 'Carousel promo', status: 'design', due_at: '2026-09-09T04:00:00Z', updated_at: '2026-09-08T00:00:00Z' }],
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'planning');
  assert.equal(notifications[0].target, 'planner');
  assert.equal(notifications[0].level, 'critical');
});

test('planner database migration restricts writes to protected RPCs', () => {
  const migration = fs.readFileSync(require.resolve('../supabase/migrations/20260909050625_content_planner_team_workflow.sql'), 'utf8');
  assert.ok(migration.includes('alter table public.content_plans enable row level security'));
  assert.ok(migration.includes('create_content_plan'));
  assert.ok(migration.includes('add_content_plan_comment'));
  assert.ok(migration.includes('link_content_plan'));
  assert.ok(migration.includes('revoke all on public.content_plans from public,anon,authenticated'));
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

test('upload screen exposes editable AI caption choices without bypassing approval', () => {
  const page = fs.readFileSync(require.resolve('../src/app/page.tsx'), 'utf8');
  const assistant = fs.readFileSync(require.resolve('../src/app/caption-assistant.tsx'), 'utf8');
  const route = fs.readFileSync(require.resolve('../src/app/api/ai/caption/route.ts'), 'utf8');
  assert.ok(page.includes('<CaptionAssistant'));
  assert.ok(page.includes('value={uploadCaption}'));
  assert.ok(assistant.includes('Buat 3 pilihan caption'));
  assert.ok(assistant.includes('Gunakan caption ini'));
  assert.ok(route.includes('db.auth.getUser(token)'));
  assert.ok(route.includes('disallowPromptTraining: true'));
  assert.ok(route.includes('buildFallbackCaptions'));
});

test('caption assistant renders three goals and blocks generation until context is ready', () => {
  const html = renderToStaticMarkup(React.createElement(CaptionAssistant, {
    accessToken: 'token', brandId: '', title: '', brief: '', format: 'feed', channels: ['ig_feed'], onUse() {},
  }));
  assert.ok(html.includes('Caption Otomatis'));
  assert.equal((html.match(/name="caption_goal"/g) || []).length, 3);
  assert.ok(html.includes('Buat 3 pilihan caption'));
  assert.ok(html.includes('disabled'));
});
