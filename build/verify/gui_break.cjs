/* Break-test the Holographic Eye GUI against the live control plane.
   READ-ONLY: no mutation RPC is ever triggered (Ben's memory DB stays
   untouched). Collects console errors, layout invariants, per-theme
   screenshots, and the dirty-flag idle-draw count. */
const { chromium } = require("playwright-core");
const fs = require("fs");

const TOKEN = fs.readFileSync(process.env.HOME + "/.hermes/eye_token", "utf8").trim();
const URL = `http://127.0.0.1:8770/?token=${TOKEN}`;
const SHOTS = __dirname + "/shots";
fs.mkdirSync(SHOTS, { recursive: true });

const THEMES = ["blossom_dark", "blossom", "amoled", "light", "dark",
                "funky", "paper", "basalt", "amber", "chromacore"];

let failures = [];
function check(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(label + (detail ? ` (${detail})` : ""));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/thorium-browser",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""),
    { timeout: 20000 });
  check("boot: metrics render", true);

  // favicon served
  const fav = await page.evaluate(async () => (await fetch("/favicon.png")).status);
  check("favicon.png served", fav === 200, `status ${fav}`);

  // ── layout invariants: garden lane below stream, vines under field ──
  const geo = await page.evaluate(() => {
    const g = document.querySelector(".garden").getBoundingClientRect();
    const s = document.querySelector(".stream").getBoundingClientRect();
    const f = document.querySelector(".fieldc").getBoundingClientRect();
    const vine = document.querySelector(".vine-l").getBoundingClientRect();
    const el = document.elementFromPoint(vine.x + 4, vine.y + vine.height / 2);
    return { gardenTop: g.top, streamBottom: s.bottom, gardenH: g.height,
             overVine: el ? el.className : "none", fieldLeft: f.left };
  });
  check("garden lane sits BELOW the stream (never covers it)",
        geo.gardenTop >= geo.streamBottom - 1,
        `garden.top=${geo.gardenTop} stream.bottom=${geo.streamBottom}`);
  check("clicks over the vine reach the field canvas",
        String(geo.overVine).includes("fieldc"), geo.overVine);

  // flowerbed painted (non-blank)
  const bedLit = await page.evaluate(() => {
    const c = document.querySelector(".garden canvas");
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return lit;
  });
  check("flowerbed actually painted", bedLit > 50, `${bedLit} lit px`);

  // ── dirty-flag: zero field draws while idle ──
  await page.evaluate(() => {
    const ctx = document.querySelector(".fieldc").getContext("2d");
    const orig = ctx.clearRect.bind(ctx);
    window.__draws = 0;
    ctx.clearRect = (...a) => { window.__draws++; return orig(...a); };
  });
  await page.waitForTimeout(3000);
  const idleDraws = await page.evaluate(() => window.__draws);
  check("dirty-flag: 0 field draws in 3s idle", idleDraws === 0, `${idleDraws}`);

  // ── theme sweep ──
  for (const t of THEMES) {
    await page.evaluate((id) => {
      localStorage.setItem("eyeTheme", id);
      // call through the settings path indirectly: reuse the bridge
      document.documentElement.dataset.theme = id;
    }, t);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""),
      { timeout: 20000 });
    await page.waitForTimeout(700);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.screenshot({ path: `${SHOTS}/theme-${t}.png` });
    check(`theme ${t} renders`, !!bg, bg);
  }
  // back to default for the interaction storm
  await page.evaluate(() => localStorage.setItem("eyeTheme", "blossom_dark"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => /\d/.test(document.querySelector("#sb-metrics")?.textContent || ""));

  // ── theme picker through the real UI (settings modal) ──
  await page.click("#sb-settings");
  await page.waitForSelector(".theme-grid");
  await page.click('.theme-chip[data-th="amoled"]');
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  check("theme chip applies via settings", applied === "amoled", applied);
  await page.click('.theme-chip[data-th="blossom_dark"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("settings closes on esc",
        await page.evaluate(() => !document.querySelector(".modal-back")));

  // ── garden toggle off/on ──
  await page.click("#sb-settings");
  await page.waitForSelector("#st-garden");
  await page.click("#st-garden");
  await page.waitForTimeout(200);
  const hidden = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".garden")).display === "none");
  check("garden toggle hides the lane", hidden);
  await page.click("#st-garden");
  await page.waitForTimeout(400);
  const relit = await page.evaluate(() => {
    const c = document.querySelector(".garden canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return lit;
  });
  check("garden regrows after re-enable", relit > 50, `${relit} lit px`);

  // ── text scale extremes ──
  for (const scale of ["0.85", "1.25", "1"]) {
    await page.selectOption("#st-scale", scale);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const sb = document.querySelector(".statusbar");
      return sb.scrollWidth - sb.clientWidth;
    });
    check(`text scale ${scale}: status bar fits`, overflow <= 2, `overflow ${overflow}px`);
  }
  await page.keyboard.press("Escape");

  // ── interaction storm (read-only) ──
  // rapid entity highlight toggles — the pane re-renders per click, so
  // re-query every time (nth-of-type against the live DOM)
  for (let i = 1; i <= 5; i++) {
    const row = await page.$(`.ent-list .ent-row:nth-of-type(${i})`);
    if (row) await row.click().catch(() => {});
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1200);
  const ringed = await page.$$eval(".ent-row.active", (r) => r.length);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const cleared = await page.$$eval(".ent-row.active", (r) => r.length);
  check("entity storm: highlights stack then esc clears",
        ringed > 0 && cleared === 0, `${ringed} active → ${cleared}`);

  // trust lens spam
  await page.click("#spark");
  await page.waitForSelector(".lens-pop");
  for (let i = 0; i < 6; i++) await page.click("#lens-plus");
  await page.click('[data-m="above"]');
  await page.click("#spark"); // toggle closed
  const lensGone = await page.evaluate(() => !document.querySelector(".lens-pop"));
  check("trust lens toggles closed", lensGone);
  await page.click("#spark"); await page.waitForSelector(".lens-pop");
  await page.click('[data-m="off"]');
  await page.click("#spark");

  // find overlay → select a fact (read-only select)
  await page.keyboard.press("F");
  await page.waitForSelector(".find-overlay input");
  await page.type(".find-overlay input", "the");
  await page.waitForTimeout(400);
  const hadResults = await page.$$eval(".find-results div", (d) => d.length);
  if (hadResults) {
    await page.click(".find-results div");
    await page.waitForTimeout(600);
    const inspected = await page.evaluate(() =>
      document.querySelector(".factid")?.textContent || "");
    check("find → select → inspect", /f#\d+/.test(inspected), inspected);
    // FFT modal if the fact has a vector
    const alg = await page.$("#ins-algebra");
    if (alg) {
      await alg.click();
      await page.waitForSelector("#fft-canvas", { timeout: 10000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/fft.png` });
      await page.keyboard.press("Escape");
      check("FFT inspector opens + closes", true);
    }
    // delete modal typed-ID guard — CANCEL, never confirm
    await page.click("#ins-del");
    await page.waitForSelector("#del-confirm");
    await page.type("#del-confirm", "999999");
    const stillDisabled = await page.$eval("#del-go", (b) => b.disabled);
    check("delete stays disabled on wrong id", stillDisabled);
    await page.click("#del-cancel");
  } else {
    await page.keyboard.press("Escape");
  }

  // workbench (read-only reason.explain) — fast now with the accel
  await page.click("#sb-workbench");
  await page.waitForSelector("#wb-entities");
  await page.fill("#wb-entities", "hermes");
  const t0 = Date.now();
  await page.click("#wb-run");
  // wait for the math trace to land (run finished), then pull the
  // threshold slider down like a user would — live scores can all sit
  // under the 0.5 default and the honest empty-state is correct
  await page.waitForFunction(
    () => (document.querySelector("#wb-math")?.textContent || "")
            .includes("probe_key"),
    { timeout: 30000 });
  const wbMs = Date.now() - t0;
  await page.$eval("#wb-slider", (s) => {
    s.value = "0";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const wbRows = await page.$$eval(".wb-row", (r) => r.length);
  check("workbench returns results", wbRows > 0, `${wbRows} rows in ${wbMs}ms`);
  check("workbench is fast (accel live)", wbMs < 3000, `${wbMs}ms`);
  await page.screenshot({ path: `${SHOTS}/workbench.png` });
  await page.keyboard.press("Escape");

  // help modal
  await page.keyboard.press("?");
  await page.waitForSelector(".m-title");
  await page.keyboard.press("Escape");
  check("help opens/closes", await page.evaluate(() => !document.querySelector(".modal-back")));

  // ── resize extremes ──
  for (const [w, h] of [[1100, 680], [2200, 1200]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => {
      const g = document.querySelector(".garden").getBoundingClientRect();
      const s = document.querySelector(".stream").getBoundingClientRect();
      const sb = document.querySelector(".sb-right").getBoundingClientRect();
      return g.top >= s.bottom - 1 && sb.right <= innerWidth + 1 && g.height > 10;
    });
    check(`resize ${w}x${h}: lane + statusbar intact`, ok);
    await page.screenshot({ path: `${SHOTS}/resize-${w}x${h}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/hero-blossom-dark.png` });

  // console errors gate (whole run)
  const realErrors = consoleErrors.filter((e) => !e.includes("favicon"));
  check("zero console errors across the whole run", realErrors.length === 0,
        realErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILURES` : "\nALL CHECKS PASSED");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
