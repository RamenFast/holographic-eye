/* Synthetic editor model checks. No database, provider, HTTP, or GUI. */
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('../eye_frontend/node_modules/esbuild');
const built = buildSync({ entryPoints: [path.join(__dirname, '../eye_frontend/src/memory-editor-model.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const moduleObject = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module: moduleObject, exports: moduleObject.exports });
const { MemoryDraft, checkedFact } = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const fact = () => ({ fact_id: 17, content: 'Original memory', category: 'custom/category', tags: 'one,two', trust_score: 0.5,
  created_at: '2026-09-05 10:00:00', updated_at: '2026-09-05 10:00:00', helpful_count: 2,
  register: { register_affinity: 'synthetic' }, links: [], vector_bytes: 0 });
function fixture() {
  const f = { saved: fact(), calls: [], event: 50, fault: null };
  f.call = async (method, params) => {
    f.calls.push({ method, params: plain(params) });
    if (f.fault) { const result = await f.fault(method, params); if (result !== undefined) return result; }
    if (method === 'fact.get') return { ok: true, fact: { ...f.saved } };
    if (method === 'fact.preview_update') return { ok: true,
      before: { content: f.saved.content, category: f.saved.category, tags: f.saved.tags },
      after: { content: f.saved.content, category: f.saved.category, tags: f.saved.tags, ...params },
      predicted_entities: [], entities_removed: [], bank_impact: [] };
    if (method === 'fact.update') {
      for (const key of ['content', 'category', 'tags']) if (key in params) f.saved[key] = key === 'content' ? params[key].trim() : params[key];
    } else if (method === 'fact.trust_set') f.saved.trust_score = params.trust;
    else throw new Error('Unexpected method: ' + method);
    return { ok: true, event_id: ++f.event, fact: { ...f.saved } };
  };
  f.draft = new MemoryDraft(f.saved);
  return f;
}
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await check('incomplete edit images rejected', () => {
    for (const value of [null, { ...fact(), tags: null }, { ...fact(), trust_score: NaN }, { ...fact(), fact_id: 18 }])
      assert.throws(() => checkedFact(value, 17));
  });
  await check('staging and slider-equivalent changes emit no calls', () => {
    const f = fixture(); f.draft.change('content', 'New'); f.draft.trustText = '0.8';
    assert.equal(f.calls.length, 0); assert.equal(f.draft.dirty, true);
  });
  await check('combined details omit trust and preserve exact metadata', async () => {
    const f = fixture(); f.draft.change('content', '  Unicode 🌸\nnext line  ');
    f.draft.change('category', 'unlisted-category'); f.draft.change('tags', ''); f.draft.trustText = '0.8';
    await f.draft.loadPreview(f.call); assert.equal(f.draft.previewReady, true);
    await f.draft.saveDetails(f.call);
    const writes = f.calls.filter(c => c.method === 'fact.update');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].params, { fact_id: 17, content: '  Unicode 🌸\nnext line  ', category: 'unlisted-category', tags: '' });
    assert.equal(f.draft.values.content, 'Unicode 🌸\nnext line');
    assert.equal(f.draft.detailsDirty, false); assert.equal(f.draft.trustDirty, true);
    assert.equal(f.saved.trust_score, 0.5); assert.equal(f.draft.receipts.length, 1);
  });
  await check('separate trust save does not save detail draft or helpful count', async () => {
    const f = fixture(); f.draft.change('content', 'Unsubmitted'); f.draft.trustText = '0.73';
    await f.draft.setTrust(f.call);
    assert.deepEqual(f.calls.map(c => c.method), ['fact.get', 'fact.trust_set', 'fact.get']);
    assert.deepEqual(f.calls[1].params, { fact_id: 17, trust: 0.73 });
    assert.equal(f.draft.values.content, 'Unsubmitted'); assert.equal(f.draft.detailsDirty, true);
    assert.equal(f.saved.content, 'Original memory'); assert.equal(f.saved.helpful_count, 2);
  });
  await check('unchanged details omitted and unrelated trust drift allowed', async () => {
    const f = fixture(); f.draft.change('tags', '  raw, raw  '); await f.draft.loadPreview(f.call);
    f.saved.trust_score = 0.9; await f.draft.saveDetails(f.call);
    assert.deepEqual(f.calls.find(c => c.method === 'fact.update').params, { fact_id: 17, tags: '  raw, raw  ' });
    assert.equal(f.saved.trust_score, 0.9); assert.equal(f.draft.base.trust_score, 0.9);
  });
  await check('save requires matching preview and changing draft invalidates preview', async () => {
    const f = fixture(); f.draft.change('tags', 'first'); await f.draft.saveDetails(f.call);
    assert.equal(f.calls.length, 0);
    await f.draft.loadPreview(f.call); f.draft.change('tags', 'second');
    assert.equal(f.draft.previewReady, false); await f.draft.saveDetails(f.call);
    assert.equal(f.calls.filter(c => c.method === 'fact.update').length, 0);
  });
  await check('invalid details and trust rejected before network', async () => {
    for (const [key, value] of [['content', '   '], ['category', '']]) {
      const f = fixture(); f.draft.change(key, value); await f.draft.loadPreview(f.call); assert.equal(f.calls.length, 0);
    }
    for (const value of ['', ' ', '-0.1', '1.1', 'NaN', 'Infinity']) {
      const f = fixture(); f.draft.trustText = value; await f.draft.setTrust(f.call); assert.equal(f.calls.length, 0);
    }
  });
  await check('detail preflight conflict preserves draft without mutation', async () => {
    const f = fixture(); f.draft.change('content', 'My draft'); await f.draft.loadPreview(f.call);
    f.saved.tags = 'new external tags'; await f.draft.saveDetails(f.call);
    assert.equal(f.calls.some(c => c.method === 'fact.update'), false);
    assert.equal(f.draft.values.content, 'My draft'); assert.deepEqual(plain(f.draft.conflicts), ['tags']);
    assert.equal(f.draft.unknown, false);
  });
  await check('trust preflight conflict cannot overwrite latest trust', async () => {
    const f = fixture(); f.draft.trustText = '0.7'; f.saved.trust_score = 0.8;
    await f.draft.setTrust(f.call);
    assert.equal(f.calls.some(c => c.method === 'fact.trust_set'), false);
    assert.equal(f.draft.trustText, '0.7'); assert.equal(f.saved.trust_score, 0.8);
  });
  await check('provider preview drift and malformed preview block save', async () => {
    for (const before of [{ ...fact(), content: 'Concurrent edit' }, {}]) {
      const f = fixture(); f.draft.change('tags', 'draft');
      f.fault = method => method === 'fact.preview_update' ? { before, after: fact(), predicted_entities: [], entities_removed: [], bank_impact: [] } : undefined;
      await f.draft.loadPreview(f.call); assert.equal(f.draft.previewReady, false);
      await f.draft.saveDetails(f.call); assert.equal(f.calls.some(c => c.method === 'fact.update'), false);
    }
  });
  await check('unknown mutation blocks both write actions and keeps draft after inspect', async () => {
    const f = fixture(); f.draft.change('tags', 'draft'); f.draft.trustText = '0.7'; await f.draft.loadPreview(f.call);
    f.fault = method => { if (method === 'fact.update') throw Object.assign(new Error('Outcome unknown'), { outcome: 'unknown' }); };
    await f.draft.saveDetails(f.call); assert.equal(f.draft.unknown, true);
    await assert.rejects(f.draft.setTrust(f.call)); await assert.rejects(f.draft.saveDetails(f.call));
    await f.draft.inspectCurrent(f.call); assert.equal(f.draft.unknown, true);
    f.draft.useCurrentDetails(); f.draft.useCurrentTrust();
    assert.equal(f.draft.values.tags, 'draft'); assert.equal(f.draft.trustText, '0.7');
    assert.equal(f.calls.filter(c => c.method === 'fact.update').length, 1);
  });
  await check('malformed acknowledgment blocks rather than reporting success', async () => {
    const f = fixture(); f.draft.trustText = '0.7';
    f.fault = method => method === 'fact.trust_set' ? { ok: true, fact: fact() } : undefined;
    await f.draft.setTrust(f.call); assert.equal(f.draft.unknown, true); assert.equal(f.draft.receipts.length, 0);
  });
  await check('known receipt retained when saved image malformed', async () => {
    const f = fixture(); f.draft.trustText = '0.7';
    f.fault = method => method === 'fact.trust_set' ? { ok: true, event_id: 77 } : undefined;
    await f.draft.setTrust(f.call); assert.equal(f.draft.unknown, true); assert.equal(f.draft.receipts[0].event_id, 77);
  });
  await check('inspect is read-only and replacing draft requires explicit separate action', async () => {
    const f = fixture(); f.draft.change('tags', 'draft'); f.draft.trustText = '0.7';
    f.saved.tags = 'external'; f.saved.trust_score = 0.8; await f.draft.inspectCurrent(f.call);
    assert.equal(f.draft.values.tags, 'draft'); assert.equal(f.draft.trustText, '0.7');
    f.draft.useCurrentDetails(); assert.equal(f.draft.values.tags, 'external'); assert.equal(f.draft.trustText, '0.7');
    f.draft.useCurrentTrust(); assert.equal(f.draft.trustText, '0.8'); assert.equal(f.calls.length, 1);
  });
  await check('mutation images refresh complete vector and journal evidence', async () => {
    const f = fixture(); f.saved.vector_bytes = 8193; f.saved.journal_retrievals = 23;
    f.draft.trustText = '0.7';
    f.fault = method => {
      if (method !== 'fact.trust_set') return undefined;
      f.saved.trust_score = 0.7;
      const image = { ...f.saved }; delete image.vector_bytes; delete image.journal_retrievals;
      return { ok: true, event_id: 72, fact: image };
    };
    await f.draft.setTrust(f.call);
    assert.equal(f.draft.current.vector_bytes, 8193); assert.equal(f.draft.current.journal_retrievals, 23);
    assert.equal(f.draft.evidenceStale, false); assert.equal(f.draft.unknown, false);
  });
  await check('post-save evidence read failure preserves receipt and marks prior evidence stale', async () => {
    const f = fixture(); f.saved.vector_bytes = 8193; f.saved.journal_retrievals = 23;
    f.draft.trustText = '0.7'; let mutated = false;
    f.fault = method => {
      if (method === 'fact.get' && mutated) throw new Error('read offline');
      if (method !== 'fact.trust_set') return undefined;
      mutated = true; f.saved.trust_score = 0.7;
      const image = { ...f.saved }; delete image.vector_bytes; delete image.journal_retrievals;
      return { ok: true, event_id: 73, fact: image };
    };
    await f.draft.setTrust(f.call);
    assert.equal(f.draft.current.vector_bytes, 8193); assert.equal(f.draft.current.journal_retrievals, 23);
    assert.equal(f.draft.evidenceStale, true); assert.equal(f.draft.unknown, false);
    assert.equal(f.draft.receipts[0].event_id, 73); assert.match(f.draft.status, /refresh failed/);
    assert.equal(f.draft.trustDirty, false);
  });
  await check('page exit risk includes kept drafts, writes and unknown outcomes but not clean reads', () => {
    const f = fixture(); assert.equal(f.draft.exitRisk, false);
    f.draft.busy = true; assert.equal(f.draft.exitRisk, false);
    f.draft.writing = true; assert.equal(f.draft.exitRisk, true);
    f.draft.busy = false; f.draft.writing = false;
    f.draft.unknown = true; assert.equal(f.draft.exitRisk, true);
    f.draft.unknown = false; f.draft.change('tags', 'kept draft'); assert.equal(f.draft.exitRisk, true);
    f.draft.useCurrentDetails(); assert.equal(f.draft.exitRisk, false);
  });
  await check('busy state prevents concurrent mutation while preflight waits', async () => {
    const f = fixture(); f.draft.trustText = '0.7';
    let release; f.fault = method => method === 'fact.get' ? new Promise(resolve => { release = () => resolve({ fact: f.saved }); }) : undefined;
    const pending = f.draft.setTrust(f.call); assert.equal(f.draft.busy, true);
    assert.equal(f.draft.writing, true); assert.equal(f.draft.exitRisk, true);
    await assert.rejects(f.draft.setTrust(f.call)); f.fault = null; release(); await pending;
    assert.equal(f.calls.filter(c => c.method === 'fact.trust_set').length, 1); assert.equal(f.draft.busy, false);
    assert.equal(f.draft.writing, false); assert.equal(f.draft.exitRisk, false);
  });
  console.log(`${checks} editor model checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
