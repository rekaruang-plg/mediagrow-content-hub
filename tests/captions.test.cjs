const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  });
  module._compile(outputText, filename);
};

const { buildCaptionPrompt, buildFallbackCaptions, containsProhibitedTerm } = require('../src/lib/ai/captions.ts');

const context = {
  brandName: 'Gudang WPC', niche: 'Interior', title: 'Cara memilih panel dinding', brief: 'Pertimbangkan kebutuhan dan tampilan ruang.',
  goal: 'soft_sell', format: 'carousel', channels: ['ig_feed'], tone: 'Hangat dan profesional', defaultCta: 'Konsultasikan kebutuhanmu dengan tim kami.',
  targetAudience: 'Pemilik rumah', hashtagGuidance: '#GudangWPC, #InteriorRumah', prohibitedTerms: 'termurah, dijamin', contentPillars: ['Edukasi'],
};

test('caption prompt includes facts, format, and safety guardrails from Brand Kit', () => {
  const prompt = buildCaptionPrompt(context);
  assert.ok(prompt.includes('Gudang WPC'));
  assert.ok(prompt.includes('Cara memilih panel dinding'));
  assert.ok(prompt.includes('Caption Carousel'));
  assert.ok(prompt.includes('termurah, dijamin'));
  assert.ok(prompt.includes('Jangan mengarang harga'));
});

test('fallback always provides three editable captions and removes prohibited terms', () => {
  const variants = buildFallbackCaptions({ ...context, brief: 'Pilihan termurah dijamin cocok.' });
  assert.equal(variants.length, 3);
  for (const variant of variants) {
    assert.ok(variant.caption.length > 20);
    assert.equal(containsProhibitedTerm(variant.caption, context.prohibitedTerms), false);
  }
});

test('prohibited term checks ignore capitalization', () => {
  assert.equal(containsProhibitedTerm('Pilihan TERMURAH untukmu', 'termurah'), true);
  assert.equal(containsProhibitedTerm('Pilihan sesuai kebutuhanmu', 'termurah'), false);
});
