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
const { WorkspaceOverview } = require('../src/app/workspace-panels.tsx');
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
