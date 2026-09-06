"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { buildSync } = require("../eye_frontend/node_modules/esbuild");
const { chromium } = require("playwright-core");
const entry = path.join(__dirname, "../eye_frontend/src/capacity-warning.ts");
const bundle = (format) => buildSync({ entryPoints: [entry], bundle: true, format, globalName: "Capacity", write: false }).outputFiles[0].text;
const m = { exports: {} };
vm.runInNewContext(bundle("cjs"), { module: m, exports: m.exports });
const { capacitySnapshot: snapshot, capacityPrompt: prompt } = m.exports;
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
for (const value of [null, undefined, {}, {snr: "1.6"}, {snr: NaN}, {snr: Infinity}, {snr: -1}]) {
  ok(snapshot(value).snr === null, "invalid SNR is unavailable");
}
const metrics = {snr: 1.6, hrr_dim: 1024, facts: 400, null_vectors: 12, min_trust: .3};
const s = snapshot(metrics);
ok(Object.isFrozen(s), "immutable snapshot"); metrics.facts = 900;
ok(s.facts === 400, "snapshot isolated");
ok(snapshot({facts: 1, null_vectors: 2}).null_vectors === null, "inconsistent null count unavailable");
ok(snapshot({hrr_dim: 0, facts: 1.1, min_trust: 2}).min_trust === null, "invalid bounded values");
ok(prompt(s).includes("Total stored facts: 400") && prompt(s).includes("SNR estimate: 1.6"), "observed numbers copied");
ok(!prompt(snapshot({snr: '<img>', session_id: 'SECRET'})).includes('SECRET'), "allowlist only");
ok(prompt(snapshot({})).includes("HRR dimensions: Unavailable"), "no invented dimension");
ok(prompt(s).includes('Use read-only tools') && !prompt(s).includes('Blocked:'), 'prompt permits read-only diagnosis without extra gates');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.EYE_BROWSER || "/usr/bin/thorium-browser", headless: true,
    args: ["--no-sandbox", "--disable-gpu"]});
  try {
    const page = await browser.newPage({viewport: {width: 680, height: 600}});
    let requests = 0;
    await page.route('**/*', route => { requests++; return route.abort(); });
    await page.setContent('<button id="outside">Outside</button><span id="metrics"><button id="anchor">Crowding estimate</button></span><button id="sb-settings">Settings</button>');
    await page.addStyleTag({content: fs.readFileSync(path.join(__dirname, '../eye_frontend/styles.css'), 'utf8') + fs.readFileSync(path.join(__dirname, '../eye_frontend/capacity-warning.css'), 'utf8')});
    await page.addScriptTag({content: bundle('iife')});
    await page.evaluate(() => {
      window.layouts = 0; window.c = new Capacity.CapacityWarning(() => window.layouts++); window.foreground = 0;
      window.addEventListener('keydown', () => window.foreground++);
      window.clip = [];
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async t => {window.clip.push(t);}}});
      c.update({snr: 1.6, facts: 400, hrr_dim: 1024, null_vectors: 12, min_trust: .3});
      c.bind(document.querySelector('#anchor'));
    });
    ok(await page.evaluate(() => [1.999, 2, 2.001, 0].map(snr => c.update({snr})).join(',') === 'true,false,false,true'), 'threshold uses reported number');
    await page.evaluate(() => c.update({snr:1.6, facts:400, hrr_dim:1024}));
    await page.locator('#outside').focus();
    await page.locator('#anchor').hover();
    ok(await page.locator('.capacity-pop').count() === 1, 'hover opens');
    ok(await page.evaluate(() => layouts > 0), 'open notifies layout');
    ok(await page.evaluate(() => document.activeElement.id === 'outside'), 'hover keeps focus');
    await page.locator('.capacity-prompt').hover(); await page.mouse.move(670,590);
    ok(await page.locator('.capacity-pop').count() === 1, 'pointer exit persists');
    await page.locator('.capacity-copy').click();
    await page.waitForFunction(() => document.querySelector('.capacity-status').textContent.startsWith('Copied.'));
    ok(await page.evaluate(() => clip[0] === document.querySelector('textarea').value), 'copy matches visible prompt');
    const prior = await page.locator('textarea').inputValue();
    await page.evaluate(() => { c.beforeRender(); c.update({snr:2.2, facts:900}); document.querySelector('#metrics').innerHTML = '<button id="anchor">SNR details</button>'; c.bind(document.querySelector('#anchor')); });
    ok(await page.locator('textarea').inputValue() === prior, 'stats redraw freezes snapshot');
    ok(await page.locator('.capacity-newer').isVisible(), 'newer snapshot noted');
    await page.locator('textarea').focus();
    const oldKeys = await page.evaluate(() => foreground);
    await page.keyboard.press('f'); await page.keyboard.press('Control+r');
    ok(await page.evaluate(() => foreground) === oldKeys, 'foreground keys guarded');
    const oldLayouts = await page.evaluate(() => layouts);
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => layouts) > oldLayouts, 'close notifies layout');
    ok(await page.locator('.capacity-pop').count() === 0, 'Escape closes');
    ok(await page.evaluate(() => document.activeElement.id === 'anchor' && foreground === 0), 'Escape restores trigger without foreground side effects');
    await page.evaluate(() => { c.beforeRender(); document.querySelector('#metrics').innerHTML = '<button id="anchor">SNR details</button>'; c.bind(document.querySelector('#anchor')); });
    ok(await page.evaluate(() => document.activeElement.id === 'anchor'), 'focus survives header replacement');
    await page.keyboard.press('Enter');
    ok(await page.locator('.capacity-close').evaluate(el => el === document.activeElement), 'keyboard open focuses control');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value: undefined}));
    await page.locator('.capacity-copy').click();
    await page.waitForFunction(() => document.querySelector('.capacity-status').textContent.startsWith('Copy failed.'));
    ok(await page.locator('textarea').evaluate(el => el === document.activeElement && el.selectionEnd === el.value.length), 'manual fallback selected');
    ok(await page.locator('.capacity-copy').isEnabled(), 'copy retry enabled');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value: {writeText: () => new Promise(resolve => {window.resolveCopy = resolve;})}}));
    await page.locator('.capacity-copy').click();
    await page.locator('.capacity-close').click();
    await page.evaluate(() => resolveCopy());
    ok(await page.locator('.capacity-pop').count() === 0, 'late clipboard completion stays closed');
    await page.locator('#anchor').click();
    await page.locator('#outside').click();
    ok(await page.locator('.capacity-pop').count() === 0 && await page.locator('#outside').evaluate(el => el === document.activeElement), 'click away keeps destination focus');
    await page.setViewportSize({width:320,height:480});
    await page.locator('#anchor').click();
    const box = await page.locator('.capacity-pop').boundingBox();
    ok(box.x >= 0 && box.x + box.width <= 320 && box.y + box.height <= 480, 'narrow viewport bounds');
    await page.evaluate(() => { for(let i=0;i<100;i++){ c.close(); document.querySelector('#anchor').click(); } });
    ok(await page.locator('.capacity-pop').count() === 1, 'one panel after 100 cycles');
    for (const selector of ['modal-back', 'find-overlay', 'ctxmenu', 'lens-pop']) {
      await page.evaluate(cls => {
        const layer = document.createElement('div'); layer.className = cls;
        layer.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:100px';
        const input = document.createElement('input'); layer.append(input); document.body.append(layer); input.focus();
        window.ownerEscape = event => { if (event.key === 'Escape') { event.preventDefault(); layer.remove(); window.removeEventListener('keydown', window.ownerEscape); } };
        window.addEventListener('keydown', window.ownerEscape);
      }, selector);
      await page.keyboard.press('Escape');
      ok(await page.locator('.' + selector).count() === 0 && await page.locator('.capacity-pop').count() === 1,
        selector + ' owns Escape above capacity');
    }
    await page.evaluate(() => {
      const hidden = document.createElement('div'); hidden.className = 'find-overlay'; hidden.hidden = true; document.body.append(hidden);
    });
    await page.keyboard.press('Escape');
    ok(await page.locator('.capacity-pop').count() === 0, 'hidden overlay does not block capacity Escape');
    await page.evaluate(() => document.querySelector('.find-overlay').remove());
    for (const selector of ['modal-back', 'find-overlay', 'ctxmenu', 'lens-pop']) {
      await page.evaluate(cls => {
        const layer = document.createElement('div'); layer.className = cls;
        layer.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:100px'; document.body.append(layer);
        const anchor = document.querySelector('#anchor');
        anchor.dispatchEvent(new PointerEvent('pointerleave'));
        anchor.dispatchEvent(new PointerEvent('pointerenter'));
        anchor.click();
      }, selector);
      ok(await page.locator('.capacity-pop').count() === 0, selector + ' blocks new capacity hover/click');
      await page.evaluate(cls => document.querySelector('.' + cls).remove(), selector);
    }


    ok(requests === 0, 'no transport requests');
    console.log(`PASS ${checks} capacity warning checks (synthetic, isolated browser, no provider)`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
