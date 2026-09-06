#!/usr/bin/env node
"use strict";
// Synthetic layout only. No browser, provider, tokens, or output bundle.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const frontend = path.resolve(__dirname, "../eye_frontend");
const esbuild = require(path.join(frontend, "node_modules/esbuild"));
const file = path.join(frontend, "src/field-labels.ts");
const compiled = esbuild.transformSync(fs.readFileSync(file, "utf8"), {loader:"ts", format:"cjs", target:"es2022"});
const mod = new Module(file, module); mod._compile(compiled.code, file);
const {FieldLabels, wrapLabel, boundedText, graphemes, overlaps} = mod.exports;
let checks = 0;
const check = (value, message) => {assert.ok(value, message); checks++;};
const fact = (id, x, y, extra={}) => ({fact_id:id,x,y,has_vector:x!==null,
  content:`Actual content ${id} for a synthetic fact`,entities:[],tags:"",category:"general",
  trust_score:.8,retrieval_count:0,helpful_count:0,created_at:"",updated_at:"",...extra});
const rows = Array.from({length:80}, (_,i)=>fact(i+1,(i%10)*280,Math.floor(i/10)*120));
const ctx = {measureText:s=>({width:graphemes(s).length*7}),font:""};
const base = {w:3200,h:1300,cx:1260,cy:420,scale:1,ui:1,zoom:1,
  selected:new Set(),hover:null,focused:null,highlighted:new Set(),exclusions:[]};
const labels = new FieldLabels();labels.sync(rows);
const run = (extra={}) => {labels.invalidate(); labels.layout(ctx,{...base,...extra},"auto");return labels.status();};
for(const zoom of [.5,1,1.249999]) check(run({zoom}).accepted===0,"quiet overview");
for(const [zoom,cap,lineCount] of [[1.25,12,1],[2.499999,12,1],[2.5,24,2],[3.999999,24,2],[4,48,2],[8,48,2]]) {
  const result=run({zoom});check(result.accepted===cap,`tier cap ${zoom}`);
  check(result.measured<=256 && result.labels.every(l=>l.lines.length<=lineCount),"work and line caps");
  for(const l of result.labels) {
    const f=rows.find(f=>f.fact_id===l.id),sx=(f.x-base.cx)*base.scale+base.w/2,sy=(f.y-base.cy)*base.scale+base.h/2;
    check(Math.abs(l.x+l.w/2-sx)<.001 && l.y===sy+9+8,"centered below owner");
    check(l.stem.x+.5===sx && l.stem.y+l.stem.h===l.y,"stem ownership");
    for(const other of result.labels) if(other!==l) check(!overlaps(l,other)&&!overlaps(l,other.stem),"caption and stem clearance");
  }
}
const intentional=run({hover:80,focused:79,selected:new Set(rows.map(f=>f.fact_id))});
check(intentional.accepted===2 && intentional.labels[0].id===80 && intentional.labels[1].id===79,"overview intent only");
check(run({hover:80,tooltipId:80}).accepted===0,"tooltip replaces canvas caption");
const cached=labels.status().rebuilds;labels.layout(ctx,{...base,hover:80,tooltipId:80},"auto");
check(labels.status().rebuilds===cached,"unchanged view uses layout cache");
const a=run({zoom:4});const b=run({zoom:4});check(JSON.stringify(a.labels)===JSON.stringify(b.labels),"determinism");
check(run({zoom:4,exclusions:[{x:0,y:0,w:3200,h:1300}]}).accepted===0,"overlay exclusion");
check(run({zoom:4,highlighted:new Set([1])}).labels.every(l=>l.id===1),"entity context omission");
check(run({zoom:4,reason:new Set([2])}).labels.every(l=>l.id===2),"Reason context omission");
check(run({zoom:4,trustLens:{mode:"below",value:.8}}).accepted===0,"below lens excludes equality");
check(run({zoom:4,trustLens:{mode:"above",value:.8}}).accepted===48,"above lens includes equality");
check(run({zoom:4,reason:new Set(),hover:80}).labels[0].id===80,"explicit hover overrides dimming");
for(const ui of [.85,1,1.1,1.25]) check(run({zoom:4,ui}).accepted>0,"actual UI scales");
labels.layout(ctx,base,"off");check(labels.status().accepted===0,"text off");
labels.sync([fact(42,0,0,{entities:["garden"],tags:"notes",content:"Use a local index"})]);
check(run({zoom:1.25,cx:0,cy:0}).labels[0].lines.join(" ").includes("garden"),"loaded entity preview");
check(run({zoom:2.5,cx:0,cy:0}).labels[0].lines.join(" ").includes("Use a local index"),"loaded content preview");
labels.sync([fact(42,0,0,{entities:[],tags:"notes",content:""})]);
check(run({zoom:1.25,cx:0,cy:0}).labels[0].lines.join(" ").includes("notes"),"tags fallback");
labels.sync([fact(1,0,0),fact(2,0,0)]);check(run({zoom:4,cx:0,cy:0}).accepted===0,"coincident ownership omitted");
labels.sync([fact(1,null,null)]);check(run({zoom:4}).accepted===0,"null coordinates omitted");
labels.sync([fact(1,-base.w/2+2,0),fact(2,base.w/2-2,0),fact(3,0,base.h/2-2)]);
check(run({zoom:4,cx:0,cy:0}).accepted===0,"edge labels omitted without side fallback");
const emoji="👩🏽‍💻",huge=emoji.repeat(400000);
const preview=boundedText(huge);check(preview.length<=2049 && preview.endsWith("…"),"huge source bounded before normalization");
check(graphemes(preview).every(g=>g===emoji||g==="…"),"sliced emoji remains whole");
check(boundedText("a"+"\u0301".repeat(100000))==="…","oversized grapheme omitted whole");
check(wrapLabel(huge,100,2,s=>graphemes(s).length*7).every(s=>graphemes(s).every(g=>g===emoji||g==="…")),"wrapped graphemes intact");
const many=Array.from({length:20000},(_,i)=>fact(i+1,10000+i,10000+i));
many.push(fact(20001,0,0),fact(20002,500,0));labels.sync(many);
const priority=run({zoom:4,cx:0,cy:0,hover:20002,focused:20001,selected:new Set(many.map(f=>f.fact_id))});
check(priority.labels[0].id===20002&&priority.labels[1].id===20001&&priority.measured<=256,"20k selection cannot starve intent");
console.log(JSON.stringify({status:"pass",checks,scope:"synthetic layout unit checks; no timing or GUI claim"}));
