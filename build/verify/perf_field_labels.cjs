#!/usr/bin/env node
"use strict";
// Synthetic component timing, not native frame latency or provider performance.
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright-core");
const frontend = path.resolve(__dirname,"../eye_frontend");
const esbuild = require(path.join(frontend,"node_modules/esbuild"));
const counts = (process.env.EYE_LABEL_COUNTS || "100,1500,20000").split(",").map(Number);
if (!counts.length || counts.some(n=>!Number.isSafeInteger(n)||n<4||n>20000)) throw Error("EYE_LABEL_COUNTS requires integers from 4 to 20000");
(async () => {
  const bundle = await esbuild.build({stdin:{contents:'import {FieldLabels} from "./field-labels"; window.FieldLabels=FieldLabels;',
    resolveDir:path.join(frontend,"src")},bundle:true,write:false,format:"iife",target:"es2022"});
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.EYE_BROWSER||"/usr/bin/thorium-browser",headless:true,
      args:["--no-sandbox","--disable-gpu"]});
    const page = await browser.newPage({viewport:{width:1920,height:1200},deviceScaleFactor:1});
    await page.route("**/*",route=>route.abort());
    await page.setContent('<canvas width="1920" height="1200"></canvas>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result = await page.evaluate((counts) => {
      const ctx=document.querySelector("canvas").getContext("2d");
      const cases=[];
      for(const count of counts) {
        const cols=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/cols);
        const facts=Array.from({length:count},(_,i)=>({fact_id:i+1,x:(i%cols)*30,y:Math.floor(i/cols)*30,has_vector:true,
          content:`Synthetic content ${i+1}: garden index 👩🏽‍💻 café 漢字`,category:"general",tags:"synthetic",entities:["garden"],
          trust_score:.8,retrieval_count:0,helpful_count:0,created_at:"",updated_at:""}));
        const fit=Math.min(1920*.86/((cols-1)*30),1200*.82/((rows-1)*30));
        for(const zoom of [1,2.5,8]) {
          const labels=new window.FieldLabels();const start=performance.now();labels.sync(facts);const syncMs=performance.now()-start;
          const view={w:1920,h:1200,cx:(cols-1)*15,cy:(rows-1)*15,scale:fit*zoom,zoom,ui:1,
            hover:null,focused:null,selected:new Set(),highlighted:new Set(),exclusions:[]};
          const sample = () => {const s=labels.status();return {layoutMs:s.layoutMs,visible:s.visible,accepted:s.accepted,measured:s.measured};};
          labels.layout(ctx,view,"auto");const cold=sample();
          const warm=[];
          for(let i=0;i<40;i++) {labels.layout(ctx,{...view,cx:view.cx+(i+1)*.3},"auto");warm.push(sample());}
          const times=warm.map(s=>s.layoutMs).sort((a,b)=>a-b);
          cases.push({count,fixture:"regular grid; all projected; unique loaded Unicode text",zoomRatio:zoom,
            tier:zoom<1.25?"overview":zoom<2.5?"one-line":zoom<4?"two-line-24":"two-line-48",
            fitScale:fit,scale:view.scale,syncMs,cold,warm,
            warmMedianMs:times[Math.floor(times.length/2)],warmP95Ms:times[Math.floor(times.length*.95)]});
        }
      }
      return {cases,userAgent:navigator.userAgent};
    }, counts);
    const shaped=result.cases.filter(c=>c.zoomRatio===8);
    if(shaped.some(c=>c.cold.measured===0||c.cold.accepted===0)) throw Error("Close zoom fixture did not shape and accept real labels");
    console.log(JSON.stringify({status:"ok",tool:"perf_field_labels",version:"1",ts:new Date().toISOString(),
      scope:"FieldLabels layout only; synthetic Chromium Canvas2D; no live data or native WebKitGTK claim",
      measurement:{viewport:"1920x1200",ui:1,dpr:1,cold:"first layout after sync, empty text cache",
        warm:"40 small camera pans; retained text cache; no discarded warmup",sync:"reported separately; excludes fixture construction",
        targetMs:8,targetMeaning:"warmed p95 goal, not a universal cold bound; overview includes dot scan but no text shaping"},...result},null,2));
  } finally {await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
