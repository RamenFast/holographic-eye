#!/usr/bin/env node
"use strict";
// Synthetic browser checks. No provider, database, tokens, or live UI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");
const frontend = path.resolve(__dirname, "../eye_frontend");
const esbuild = require(path.join(frontend, "node_modules/esbuild"));
(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "eye-labels-"));
  let browser;
  try {
    const bundle = path.join(scratch, "test.js");
    await esbuild.build({ stdin: { contents: `import {FieldLabels,wrapLabel,graphemes,overlaps} from "./field-labels";
      import {Field} from "./field"; import {store,initTheme} from "./state"; initTheme();
      Object.assign(window,{FieldLabels,wrapLabel,graphemes,overlaps,Field,store});`,
      resolveDir: path.join(frontend, "src") }, bundle: true, outfile: bundle, format: "iife" });
    browser = await chromium.launch({ executablePath: process.env.EYE_BROWSER || "/usr/bin/thorium-browser", headless: true,
      args: ["--no-sandbox", "--disable-gpu"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors=[]; page.on("pageerror", error=>errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.setContent(`<style>html{font-size:13px}#field{position:relative;width:1200px;height:750px}canvas{width:100%;height:100%}.tooltip{position:absolute;width:260px}.mathlog{display:none}</style>
      <div id="field"><canvas class="fieldc"></canvas><div class="tooltip" style="display:none"></div><pre class="mathlog"></pre></div>`);
    await page.addScriptTag({ path: bundle });
    const result = await page.evaluate(async (skipPerf) => {
      const check = (ok, msg) => { if (!ok) throw Error(msg); };
      const ctx = document.querySelector("canvas").getContext("2d");
      const fact = (id,x,y) => ({fact_id:id,x,y,has_vector:x!==null,content:`Actual content ${id} 👩🏽‍💻 café 漢字`,
        category:"test",trust_score:0.8,retrieval_count:0,helpful_count:0,entities:[],tags:"",created_at:"",updated_at:""});
      const sparse = Array.from({length:60},(_,i)=>fact(i+1, (i%10)*300, Math.floor(i/10)*150));
      const labels = new FieldLabels(); labels.sync(sparse);
      const view = {w:3200,h:1200,cx:1350,cy:375,scale:1,ui:1,zoom:4,focused:30,selected:new Set([30]),hover:31,highlighted:new Set([32]),exclusions:[]};
      labels.layout(ctx,view,"auto"); const first = labels.status();
      check(first.accepted>0 && first.accepted<=48 && first.measured<=256,"default labels and caps");
      check(first.labels[0].id===31 && first.labels[1].id===30 && first.labels[2].id===32,"priority");
      check(first.labels.every(l=>l.lines.join(" ").includes("Actual")),"actual content");
      for (const l of first.labels) {
        check(l.x>=0 && l.y>=0 && l.x+l.w<=view.w && l.y+l.h<=view.h,"bounds");
        for (const other of first.labels) if(l!==other) check(!overlaps(l,other),"label overlap");
        for (const f of sparse) {
          const x=(f.x-view.cx)*view.scale+view.w/2,y=(f.y-view.cy)*view.scale+view.h/2;
          check(!overlaps(l,{x:x-9,y:y-9,w:18,h:18}),"dot overlap");
        }
      }
      labels.layout(ctx,view,"auto"); check(labels.status().rebuilds===first.rebuilds,"layout cache");
      labels.invalidate(); labels.layout(ctx,view,"auto"); check(JSON.stringify(labels.status().labels)===JSON.stringify(first.labels),"determinism");
      labels.layout(ctx,{...view,exclusions:[{x:0,y:0,w:view.w,h:view.h}]},"auto"); check(labels.status().accepted===0,"overlay exclusion");
      labels.layout(ctx,view,"off"); check(labels.status().accepted===0,"off");
      for(const ui of [1,1.15,1.3,1.5]) {labels.layout(ctx,{...view,ui},"auto");check(labels.status().accepted>0,"scaled labels");}
      const emoji="👩🏽‍💻", wrapped=wrapLabel(emoji.repeat(100),50,2,s=>graphemes(s).length*10);
      check(wrapped.every(s=>graphemes(s).every(g=>g===emoji||g==="…")),"grapheme-safe");
      const huge=Array.from({length:20000},(_,i)=>fact(i+1,Math.cos(i*2.399963)*Math.sqrt(i)*5,Math.sin(i*2.399963)*Math.sqrt(i)*5));
      labels.sync(huge);
      const perfView={...view,w:1200,h:750,cx:0,cy:0,scale:0.5,highlighted:new Set(),selected:new Set(),focused:null,hover:null};
      const times=[];
      for(let i=0;i<(skipPerf ? 0 : 41);i++) { labels.invalidate(); labels.layout(ctx,{...perfView,cx:i*0.3},"auto");times.push(labels.status().layoutMs); }
      const cold=times.shift();times.sort((a,b)=>a-b);
      // Field integration: camera, hidden state, strip bounds, and focus guards.
      store.setFacts(sparse,{}); const field=new Field(document.querySelector("#field")); field.fit();
      const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      await frame(); check(field.getLabelMode()==="auto","Field default auto");
      check(field.labelStatus().accepted===0,"Field fitted overview omits ordinary text");
      field.zoomBy(3);await frame();
      check(field.labelStatus().accepted>0,"Field zoom reveals content");
      const coordinates=JSON.stringify([...store.facts.values()].map(f=>[f.fact_id,f.x,f.y]));
      const probe=sparse[0], screen=field.toScreen(probe.x,probe.y);
      check(field.hitTest(...screen)===probe.fact_id,"dot picking before labels");
      field.zoomBy(1.2); await frame();
      check(JSON.stringify([...store.facts.values()].map(f=>[f.fact_id,f.x,f.y]))===coordinates,"coordinates unchanged");
      check(field.hitTest(...field.toScreen(probe.x,probe.y))===probe.fact_id,"dot picking after labels");
      const canvas=document.querySelector("canvas"), bounds=canvas.getBoundingClientRect();
      field.bounds={minX:0,maxX:1,minY:0,maxY:10000};field.fit();
      const fitted=field.scale;canvas.dispatchEvent(new WheelEvent("wheel",{deltaY:-100000,bubbles:true,cancelable:true}));
      check(Math.abs(field.scale-fitted*8)<1e-9,"two-axis wheel clamp");field.fit();field.zoomBy(10000);
      check(Math.abs(field.scale-fitted*8)<1e-9,"two-axis button clamp");
      field.tooltip.textContent="long tooltip ".repeat(200);field.tooltip.style.display="block";
      field.placeTooltip(9999,9999,bounds.width,bounds.height);
      const tr=field.tooltip.getBoundingClientRect();check(tr.left>=bounds.left && tr.right<=bounds.right && tr.top>=bounds.top && tr.bottom<=bounds.bottom,"measured tooltip clamp");
      field.tooltip.style.display="none";
      document.querySelector("#field").style.height="0px";
      const zero=field.labelStatus().rebuilds;field.requestDraw();await frame();check(field.labelStatus().rebuilds===zero,"zero-size draw guard");
      document.querySelector("#field").style.height="750px";
      field.setLabelMode("off"); await frame(); check(field.labelStatus().accepted===0,"Field off");
      field.setLabelMode("auto"); field.setActive(false); const hidden=field.labelStatus().rebuilds;
      field.invalidateLabels();await frame();check(field.labelStatus().rebuilds===hidden,"inactive draw suppression");
      field.setActive(true);await frame();
      const camera=field.scale;const input=document.createElement("input");document.body.append(input);input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown",{key:"f",bubbles:true}));check(field.scale===camera,"editor shortcut guard");input.remove();
      const dialog=document.createElement("dialog");document.body.append(dialog);dialog.showModal();field.scale=123;
      window.dispatchEvent(new KeyboardEvent("keydown",{key:"0"}));check(field.scale===123,"dialog shortcut guard");dialog.close();dialog.remove();
      store.setFacts(Array.from({length:20000},(_,i)=>fact(i+1,null,null)),{});await frame();
      const strip=field.labelStatus();check(strip.vectorlessTotal===20000 && strip.vectorlessVisible<=120,`bounded null strip ${JSON.stringify(strip)}`);
      field.setActive(false);
      store.setFacts([],{});
      const host=document.createElement("div");host.style.cssText="position:relative;width:800px;height:480px";
      host.innerHTML='<canvas class="fieldc"></canvas><div class="tooltip" style="display:none"></div><pre class="mathlog"></pre>';
      host.hidden=true;document.body.append(host);
      const deferred=new Field(host);deferred.setActive(false);
      store.setFacts([fact(1,10000,20000),fact(2,12000,24000)],{});await frame();
      check(deferred.scale===1 && deferred.cx===0 && deferred.cy===0,"inactive boot retains unfitted camera");
      host.hidden=false;host.style.height="0px";deferred.setActive(true);await frame();
      check(deferred.scale===1 && deferred.initialFitPending,"initial fit waits for valid viewport");
      host.style.height="480px";deferred.requestDraw();await frame();
      check(deferred.cx===11000 && deferred.cy===22000 && Math.abs(deferred.scale-480*.82/4000)<1e-9,"first visible vector frame fits once");
      deferred.zoomBy(2);deferred.cx+=17;deferred.cy-=23;
      const preserved=[deferred.scale,deferred.cx,deferred.cy];
      deferred.setActive(false);host.hidden=true;store.setFacts([fact(1,20000,30000),fact(2,24000,38000)],{});await frame();
      host.hidden=false;deferred.setActive(true);await frame();
      check(JSON.stringify([deferred.scale,deferred.cx,deferred.cy])===JSON.stringify(preserved),"later view roundtrip and data preserve camera");
      deferred.setActive(false);host.remove();
      return {checks:"pass",sparseAccepted:first.accepted,measured:first.measured,coldMs:cold,p95Ms:times[Math.floor(times.length*.95)],
        targetMs:8,vectorlessTotal:strip.vectorlessTotal,vectorlessVisible:strip.vectorlessVisible};
    }, process.env.EYE_LABELS_SKIP_PERF === "1");
    assert.deepEqual(errors,[]);
    assert.equal(result.checks,"pass"); console.log(JSON.stringify(result,null,2));
  } finally { if(browser) await browser.close(); fs.rmSync(scratch,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
