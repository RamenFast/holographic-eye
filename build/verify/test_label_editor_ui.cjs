#!/usr/bin/env node
"use strict";
// Independent acceptance against frozen built assets. Synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {EditorFixture,ProviderBridge}=require('./label_editor_fixture.cjs');
const {THEMES,SCALES}=require('./test_responsive_views.cjs');
const ROOT=path.resolve(process.env.EYE_UI_ASSETS||path.join(__dirname,'../eye_frontend/dist'));
const OUT=path.resolve(process.env.EYE_UI_ARTIFACTS||path.join(__dirname,'shots/label-editor/run-'+process.pid));
const SELECTORS={editor:'#edit-content',content:'#me-content',category:'#me-category',tags:'#me-tags',preview:'#me-preview',save:'#me-save',trust:'#me-trust',setTrust:'#me-set-trust',status:'#me-status',key:'#field-color-key',capacity:'#sb-capacity'};
const checks=[];
let colorOracle;
async function checkColors(page,label){
  if(!colorOracle)colorOracle=require('../eye_frontend/node_modules/esbuild').buildSync({stdin:{contents:'export {catColor,initTheme} from "./state"',resolveDir:path.resolve(__dirname,'../eye_frontend/src')},bundle:true,write:false,format:'iife',globalName:'__eyeColorOracle'}).outputFiles[0].text;
  await page.addScriptTag({content:colorOracle});
  const mismatches=await page.evaluate(()=>{__eyeColorOracle.initTheme();const probe=document.createElement('span');return [...document.querySelectorAll('.field-key [data-category][data-trust]')].flatMap(el=>{const t=Number(el.dataset.trust);probe.style.background=__eyeColorOracle.catColor(el.dataset.category,t,.55+t*.45);return probe.style.background===el.style.background?[]:[{category:el.dataset.category,t,expected:probe.style.background,actual:el.style.background}];});});
  check(label+' samples equal renderer catColor',mismatches.length===0,mismatches);
}
function check(name,ok,detail){checks.push({name,ok:!!ok,detail});assert.ok(ok,name+(detail?' '+JSON.stringify(detail):''));}
const frames=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const camera=page=>page.evaluate(()=>({cx:eyeField.cx,cy:eyeField.cy,scale:eyeField.scale}));
async function settled(page){await page.waitForFunction(()=>!document.querySelector('#me-content')?.disabled);await frames(page);}
async function openEditor(page,id=1){
  await page.locator('#explorer-tabs [data-view="categories"]').click();
  const row=page.locator(`#browser-facts [data-fact-id="${id}"]`);await row.click();
  if(await page.locator('#pane-switcher').isVisible())await page.locator('#pane-switcher [data-pane="inspect"]').click();
  await page.locator(SELECTORS.editor).click();await page.waitForSelector(SELECTORS.content);await settled(page);
}
async function details(page,text='  Synthetic staged\n雪 café e\u0301 👩‍🔬  '){
  await page.fill(SELECTORS.content,text);await page.fill(SELECTORS.category,'Custom Exact Category');await page.fill(SELECTORS.tags,'');
}
async function preview(page){await page.click(SELECTORS.preview);await page.waitForFunction(()=>!document.querySelector('#me-save').disabled);}
async function save(page){await page.click(SELECTORS.save);await page.waitForFunction(()=>/Details saved/.test(document.querySelector('#me-status').textContent));}
async function boot(browser,server,options={}){
  server.reset();const context=await browser.newContext({viewport:options.viewport||{width:1440,height:900},reducedMotion:'reduce',deviceScaleFactor:options.dpr||Number(process.env.EYE_UI_DPR||1),forcedColors:process.env.EYE_UI_FORCED_COLORS==='1'?'active':'none'});
  context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
  const blocked=[];await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(server.url).origin)return route.continue();blocked.push(route.request().url());return route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.setItem('eyeToken','synthetic-fixture-token');localStorage.setItem('eyeTheme','blossom_dark');localStorage.setItem('eyeUiScale','1');});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.eyeField&&document.querySelector('#sb-metrics')?.textContent.includes('400 facts'));await frames(page);
  return {page,context,errors,blocked};
}
async function labels(page,server){
  await page.locator('#field-fit').click();const fit=await camera(page);const coordinateBefore=JSON.stringify(server.fixture.facts.map(f=>[f.fact_id,f.x,f.y]));
  const sweep=[];
  for(const z of [.5,1,1.24999,1.25,2.49999,2.5,3.99999,4,8]){
    await page.evaluate(({z,fit})=>{eyeField.scale=fit.scale*z;eyeField.requestDraw();},{z,fit});await frames(page);
    const status=await page.evaluate(()=>eyeField.labelStatus());const cap=z<1.25?0:z<2.5?12:z<4?24:48;
    check(`labels z=${z} tier cap`,status.accepted<=cap&&status.measured<=256,status);
    const owners=await page.evaluate(rows=>rows.map(f=>({id:f.fact_id,screen:eyeField.toScreen(f.x,f.y)})),server.fixture.facts);
    for(const l of status.labels){const p=owners.find(p=>p.id===l.id).screen;
      check(`label ${l.id} z=${z} below owner with stem`,Math.abs(l.x+l.w/2-p[0])<=.5&&l.y>p[1]&&Math.abs(l.stem.x+.5-p[0])<=.5&&Math.abs(l.stem.y+l.stem.h-l.y)<=.5,{l,p});
      check(`label ${l.id} z=${z} truthful ID and line budget`,l.lines.join(' ').includes(String(l.id).padStart(4,'0'))&&l.lines.length<=(z<2.5?1:2),l.lines);
    }
    check(`labels z=${z} no caption overlap`,!status.labels.some((a,i)=>status.labels.slice(i+1).some(b=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)));
    if(z===2.5&&status.accepted>0)await page.screenshot({path:path.join(OUT,'feature-field-anchored-labels.png')});
    sweep.push({z,...status});
  }
  check('zoom reveals some labels',sweep.some(s=>s.z>=1.25&&s.accepted>0));
  await page.locator('#field-fit').click();await frames(page);check('Fit restores silent overview',(await page.evaluate(()=>eyeField.labelStatus())).accepted===0);
  await page.evaluate(()=>eyeField.zoomBy(2.5));await frames(page);const before=await camera(page);
  const probes=await page.evaluate(rows=>rows.map(f=>({id:f.fact_id,pick:eyeField.hitTest(...eyeField.toScreen(f.x,f.y))})),server.fixture.facts);
  await page.locator('#field-text-mode').click();await frames(page);
  check('Text off clears captions',(await page.evaluate(()=>eyeField.labelStatus())).accepted===0);
  check('Text toggle does not move camera',JSON.stringify(before)===JSON.stringify(await camera(page)));
  const after=await page.evaluate(rows=>rows.map(f=>({id:f.fact_id,pick:eyeField.hitTest(...eyeField.toScreen(f.x,f.y))})),server.fixture.facts);
  check('Text toggle preserves picks and coordinates',JSON.stringify(probes)===JSON.stringify(after)&&coordinateBefore===JSON.stringify(server.fixture.facts.map(f=>[f.fact_id,f.x,f.y])));
  await page.locator('#field-text-mode').click();
  await page.click('#spark');await page.click('.lens-pop [data-m="below"]');await frames(page);
  check('Below trust filter suppresses equal-valued ordinary labels',(await page.evaluate(()=>eyeField.labelStatus())).accepted===0);
  await page.click('.lens-pop [data-m="above"]');await frames(page);
  check('Above trust filter includes equal-valued facts',(await page.evaluate(()=>eyeField.labelStatus())).accepted>0);
  await page.click('.lens-pop [data-m="off"]');await page.click('#field-fit');await page.evaluate(()=>eyeField.zoomBy(2.5));await frames(page);
  await page.locator('#explorer-tabs [data-view="categories"]').click();const count=await page.evaluate(()=>eyeField.labelStatus().rebuilds);await page.evaluate(()=>{eyeField.invalidateLabels();eyeField.requestDraw();});await frames(page);
  check('Hidden Field performs no layout',count===await page.evaluate(()=>eyeField.labelStatus().rebuilds));
  fs.writeFileSync(path.join(OUT,'label-sweep.json'),JSON.stringify(sweep,null,2));
}
async function happyEditor(page,server){
  const start=server.mutationCalls.length;await openEditor(page);await page.screenshot({path:path.join(OUT,'feature-editor-wide.png')});const original=await page.inputValue(SELECTORS.content);
  check('Custom category retained',await page.inputValue(SELECTORS.category)==='Custom Garden');
  check('Read-only register evidence visible',(await page.locator('#me-evidence').textContent()).includes('synthetic-read-only'));
  await details(page);await page.fill(SELECTORS.trust,'0.8');await page.locator(SELECTORS.trust).blur();
  check('Typing and staged trust do not write',server.mutationCalls.length===start);
  await page.evaluate(()=>window.eyeRefresh());check('Refresh retains typed multiline draft',(await page.inputValue(SELECTORS.content)).includes('Synthetic staged\n雪'));
  await page.keyboard.press('Escape');await page.waitForSelector('#me-leave:not([hidden])');await page.click('#me-stay');
  check('Escape retains unsaved draft and does not save',await page.inputValue(SELECTORS.content)!==original&&server.mutationCalls.length===start);
  await page.fill(SELECTORS.content,'   ');check('Blank memory cannot save',await page.locator(SELECTORS.preview).isDisabled()&&await page.locator(SELECTORS.save).isDisabled());
  await details(page);await preview(page);check('Preview stays inside the editor',await page.locator('.modal-back').count()===1&&await page.locator('#me-preview-body').isVisible());
  await page.screenshot({path:path.join(OUT,'feature-editor-preview-wide.png')});
  await save(page);const saved=server.mutationCalls.slice(start);check('Details use one combined update',saved.length===1&&saved[0].method==='fact.update'&&JSON.stringify(Object.keys(saved[0].params).sort())===JSON.stringify(['category','content','fact_id','tags']),saved);
  check('Details do not also save trust',server.fixture.facts[0].trust_score===.5&&await page.inputValue(SELECTORS.trust)==='0.8');
  check('Exact category and empty tags persist',server.fixture.facts[0].category==='Custom Exact Category'&&server.fixture.facts[0].tags==='');
  await page.click(SELECTORS.setTrust);await page.waitForFunction(()=>/Fact trust saved/.test(document.querySelector('#me-status').textContent));
  check('Trust is one separate absolute action',server.mutationCalls.length===start+2&&server.mutationCalls.at(-1).method==='fact.trust_set'&&server.mutationCalls.at(-1).params.trust===.8);
  check('Two actions expose two separate receipts',await page.locator('.me-receipt').count()===2);
  await page.fill(SELECTORS.tags,'retained draft');await page.click('#me-close');await page.click('#me-keep');await page.waitForSelector('.modal-back',{state:'detached'});
  await page.locator(SELECTORS.editor).click();await page.waitForSelector(SELECTORS.content);
  check('Close and keep preserves per-fact draft',await page.inputValue(SELECTORS.tags)==='retained draft');
  await page.click('#me-close');await page.click('#me-discard');check('Explicit discard makes no write',server.mutationCalls.length===start+2);
}
async function conflict(page,server){
  await openEditor(page);await details(page);await preview(page);const start=server.mutationCalls.length;
  server.fixture.facts[0].content='Concurrent saved memory';await page.click(SELECTORS.save);
  await page.waitForFunction(()=>/changed since|changed during/.test(document.querySelector('#me-status').textContent));
  check('Preflight conflict makes no write',server.mutationCalls.length===start);
  check('Conflict keeps draft and shows saved state',(await page.inputValue(SELECTORS.content)).includes('Synthetic staged')&&(await page.locator('#me-current-details').innerText()).includes('Concurrent saved memory'));
  check('Conflict discloses frontend-only limit',/not a server lock|does not lock|not a lock/i.test(await page.locator('.modal').innerText()));
}
async function unknown(page,server,reply,commit=false){
  await openEditor(page);await details(page);await preview(page);await page.fill(SELECTORS.trust,'0.7');const start=server.mutationCalls.length;
  server.plans.push({reply,commit});await page.click(SELECTORS.save);
  await page.waitForFunction(()=>/unknown|acknowledg|journal/i.test(document.querySelector('#me-status').textContent)&&document.querySelector('#me-save').disabled);
  check('Unknown outcome retains detail draft',(await page.inputValue(SELECTORS.content)).includes('Synthetic staged'));
  check('Unknown blocks both independent writes',await page.locator(SELECTORS.save).isDisabled()&&await page.locator(SELECTORS.setTrust).isDisabled());
  await page.click('#me-current');await settled(page);await page.fill(SELECTORS.tags,'changed after unknown');await frames(page);
  check('Read current and payload changes do not release unknown',await page.locator(SELECTORS.save).isDisabled()&&await page.locator(SELECTORS.setTrust).isDisabled()&&server.mutationCalls.length===start+1);
  await page.click('#me-close');await page.click('#me-keep');await page.locator(SELECTORS.editor).click();await page.waitForSelector(SELECTORS.content);
  check('Reopen keeps unknown draft blocked',await page.inputValue(SELECTORS.tags)==='changed after unknown'&&await page.locator(SELECTORS.setTrust).isDisabled()&&server.mutationCalls.length===start+1);
}
async function evidenceReadFailure(page,server){
  await openEditor(page);await details(page);await preview(page);const start=server.mutationCalls.length;
  server.getPlans.push(null,{reply:{error:'Synthetic evidence read failure'}});await save(page);await settled(page);
  check('Post-save evidence failure keeps confirmed receipt',await page.locator('.me-receipt').count()===1&&server.mutationCalls.length===start+1);
  check('Post-save evidence failure is stale, not unknown',/marked stale/.test(await page.locator('#me-status').innerText())&&!/Writes blocked/.test(await page.locator('#me-status').innerText()));
  await page.fill(SELECTORS.trust,'0.8');check('Confirmed save with stale evidence does not falsely block separate staged trust',await page.locator(SELECTORS.setTrust).isEnabled());
  await page.click('#me-current');await settled(page);
  check('Current-state read recovers evidence without another mutation',server.mutationCalls.length===start+1&&(await page.locator('#me-evidence').textContent()).includes('synthetic-read-only'));
}
async function lateTimeout(page,server){
  await openEditor(page);await details(page);await preview(page);const start=server.mutationCalls.length;let release;const wait=new Promise(r=>release=r);server.plans.push({wait});
  // Accelerate only the production mutation deadline, not app readiness timers.
  await page.evaluate(()=>{const original=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>original(fn,ms===30000?80:ms,...args);});
  await page.click(SELECTORS.save);await page.waitForFunction(()=>/outcome is unknown/.test(document.querySelector('#me-status').textContent));
  check('Timeout retains draft and blocks writes',await page.locator(SELECTORS.save).isDisabled()&&(await page.inputValue(SELECTORS.content)).includes('Synthetic staged'));
  const lateResponse=page.waitForResponse(response=>response.url().endsWith('/rpc')&&response.request().postDataJSON()?.method==='fact.update');release();await lateResponse;
  await page.click('#me-current');await settled(page);
  check('Late commit does not auto-retry or erase draft',server.mutationCalls.length===start+1&&server.fixture.facts[0].content.includes('Synthetic staged')&&await page.locator(SELECTORS.save).isDisabled());
}
async function trustConflict(page,server){
  await openEditor(page);await page.fill(SELECTORS.trust,'0.8');server.fixture.facts[0].trust_score=.2;const start=server.mutationCalls.length;
  await page.click(SELECTORS.setTrust);await page.waitForFunction(()=>/trust_score changed/.test(document.querySelector('#me-status').textContent));
  check('Concurrent trust change refuses stale absolute target',server.mutationCalls.length===start&&await page.inputValue(SELECTORS.trust)==='0.8'&&server.fixture.facts[0].trust_score===.2);
}
async function duplicate(page,server){
  await openEditor(page);await details(page);await preview(page);let release;const wait=new Promise(r=>release=r),start=server.mutationCalls.length;server.plans.push({wait});
  await page.click(SELECTORS.save);await page.waitForFunction(()=>document.querySelector('#me-save').disabled);
  await page.evaluate(()=>{document.querySelector('#me-save').click();document.querySelector('#me-set-trust').click();});
  release();await page.waitForFunction(()=>/Details saved/.test(document.querySelector('#me-status').textContent));
  check('Pending save prevents duplicate dispatch',server.mutationCalls.length===start+1);
}
async function capacity(page,server){
  const trigger=page.locator(SELECTORS.capacity);const before=await camera(page),requests=server.rpcCalls.length;
  await trigger.hover();await page.waitForSelector('.capacity-pop');await page.mouse.move(10,450);await frames(page);
  check('Pointer exit keeps capacity explanation open',await page.locator('.capacity-pop').isVisible());
  await page.locator('#field-fit').focus();await page.keyboard.press('Control+f');await page.waitForSelector('.find-overlay');
  await page.keyboard.press('Escape');
  check('Find owns Escape above persistent capacity explanation',await page.locator('.find-overlay').count()===0&&await page.locator('.capacity-pop').isVisible());
  const prompt=await page.inputValue('.capacity-prompt');check('Prompt has snapshot facts, not memory content',prompt.includes('1.6')&&prompt.includes('400')&&prompt.includes('1024')&&!prompt.includes('Synthetic Garden')&&!prompt.includes('synthetic-only'));
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('synthetic denial'))}}));
  await page.click('.capacity-copy');await page.waitForFunction(()=>document.querySelector('.capacity-status').textContent.startsWith('Copy failed'));
  check('Clipboard failure gives selected manual-copy text',await page.locator('.capacity-prompt').evaluate(el=>el.readOnly&&el.selectionStart===0&&el.selectionEnd===el.value.length));
  check('Open and failed copy issue no RPC',server.rpcCalls.length===requests,server.rpcCalls.slice(requests));
  server.fixture.stats={...server.fixture.stats,snr:2.2,facts:500};await page.evaluate(()=>window.eyeRefresh());await page.waitForSelector('.capacity-newer:not([hidden])');
  check('Status refresh does not replace frozen prompt',await page.inputValue('.capacity-prompt')===prompt);
  await page.evaluate(()=>{window.__copyText=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>{window.__copyText=text;return new Promise(resolve=>window.__copyResolve=resolve)}}});});
  const calls=server.rpcCalls.length;await page.click('.capacity-copy');
  check('Copy success waits for clipboard resolution',!(await page.locator('.capacity-status').innerText()).startsWith('Copied.')&&await page.locator('.capacity-copy').isDisabled());
  await page.evaluate(()=>window.__copyResolve());await page.waitForFunction(()=>document.querySelector('.capacity-status').textContent.startsWith('Copied.'));
  check('Clipboard matches frozen textarea',await page.evaluate(()=>window.__copyText)===prompt&&server.rpcCalls.length===calls);
  await page.screenshot({path:path.join(OUT,'feature-capacity-copy.png')});
  await page.keyboard.press('Escape');check('Escape closes only capacity, preserves camera',await page.locator('.capacity-pop').count()===0&&JSON.stringify(before)===JSON.stringify(await camera(page)));
}
async function key(page,server){
  await page.locator('#explorer-tabs [data-view="field"]').click();const before=await camera(page),calls=server.rpcCalls.length;
  await page.locator(SELECTORS.key).click();await page.waitForSelector('.field-key');
  await checkColors(page,'Default key');
  const samples=await page.locator('.field-key [data-category][data-trust]').evaluateAll(els=>els.map(el=>({category:el.dataset.category,trust:Number(el.dataset.trust),background:el.style.background})));
  check('Key shows all three numeric trust columns',samples.length>0&&[0,.5,1].every(t=>samples.some(s=>s.trust===t)));
  check('Key names custom category and bounded rows',samples.some(s=>s.category==='Custom Garden')&&await page.locator('.fk-categories tbody tr').count()<=24);
  check('Key samples change across trust values',samples.filter(s=>s.category==='project').map(s=>s.background).filter((s,i,a)=>a.indexOf(s)===i).length===3);
  const text=await page.locator('.field-key').innerText();check('Key explains actual opacity, counts and noncausal position',text.includes('0.55')&&text.includes('journal-observed')&&text.includes('PCA')&&text.includes('not causal')&&text.includes('0.12')&&text.includes('0.35')&&text.includes('0.07'));
  await page.screenshot({path:path.join(OUT,'feature-color-key.png')});
  await page.keyboard.press('Escape');check('Key close preserves camera and has no RPC',JSON.stringify(before)===JSON.stringify(await camera(page))&&server.rpcCalls.length===calls);
}
async function matrix(page,server){
  const rows=[];
  for(const theme of process.env.EYE_UI_QUICK?[THEMES[0]]:THEMES)for(const scale of SCALES){
    await page.setViewportSize({width:1440,height:900});await page.click('#sb-settings');await page.click(`.theme-chip[data-th="${theme}"]`);await page.selectOption('#st-scale',scale);await page.keyboard.press('Escape');
    await openEditor(page);
    for(const width of [640,800,1100,1440]){await page.setViewportSize({width,height:480});await frames(page);
      for(const selector of ['#me-content','#me-preview','#me-save','#me-set-trust','#me-close']){
        await page.locator(selector).scrollIntoViewIfNeeded();const r=await page.locator(selector).boundingBox();
        check(`${theme} ${scale} ${width} editor control reachable ${selector}`,r&&r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=481,r);
      }
      if(theme===THEMES[0]&&scale==='1.25'&&width===640){await page.locator('#me-content').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(OUT,'feature-editor-narrow.png')});}
      if(theme===THEMES[0]&&scale==='1'&&width===1440){await page.locator('#me-content').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(OUT,'feature-editor-wide-matrix.png')});}
      const overflow=await page.locator('.modal').evaluate(el=>el.scrollWidth-el.clientWidth);check(`${theme} ${scale} ${width} no horizontal dialog overflow`,overflow<=1,overflow);rows.push({theme,scale,width,overflow});
    }
    await page.click('#me-close');await page.setViewportSize({width:1440,height:900});await page.locator('#explorer-tabs [data-view="field"]').click();
    for(const width of [640,800,1100,1440]){
      await page.setViewportSize({width:1440,height:900});await page.locator(SELECTORS.key).click();await page.setViewportSize({width,height:480});
      await checkColors(page,`${theme} ${scale} ${width}`);
      check(`${theme} ${scale} ${width} key fits`,await page.locator('.modal').evaluate(el=>{const r=el.getBoundingClientRect();return el.scrollWidth-el.clientWidth<=1&&r.x>=11&&r.right<=innerWidth-11}));await page.keyboard.press('Escape');
      await page.locator(SELECTORS.capacity).click();
      for(const selector of ['.capacity-close','.capacity-copy']){const r=await page.locator(selector).boundingBox();check(`${theme} ${scale} ${width} capacity action reachable ${selector}`,r&&r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=481,r);}
      await page.keyboard.press('Escape');
    }
  }
  fs.writeFileSync(path.join(OUT,'matrix.json'),JSON.stringify(rows,null,2));
}
async function navigationGuard(page,server,kind){
  await openEditor(page);await details(page);const draftText=await page.inputValue(SELECTORS.content),start=server.mutationCalls.length;let release=()=>{};
  try{
    if(kind==='busy'){await preview(page);const wait=new Promise(r=>release=r);server.plans.push({wait});await page.click(SELECTORS.save);await page.waitForFunction(()=>document.querySelector('#me-content').disabled);}
    if(kind==='unknown'){await preview(page);server.plans.push({reply:{ok:true}});await page.click(SELECTORS.save);await page.waitForFunction(()=>/Writes blocked/.test(document.querySelector('#me-status').textContent));}
    if(kind==='kept'){await page.click('#me-close');await page.click('#me-keep');await page.waitForSelector('.modal-back',{state:'detached'});}
    const navigations=[];const onDialog=async dialog=>{navigations.push(dialog.type());await dialog.dismiss();};page.on('dialog',onDialog);
    try{
      const count=navigations.length;try{await page.reload({waitUntil:'domcontentloaded',timeout:1500});}catch(e){if(!String(e).includes('ERR_ABORTED')&&!(String(e).includes('Timeout')&&navigations.length===count+1))throw e;}
      check(kind+' reload asks beforeunload and can be cancelled',navigations.length===count+1&&navigations.at(-1)==='beforeunload',navigations);
      const count2=navigations.length;try{await page.goto(server.url+'?synthetic-navigation=1',{waitUntil:'domcontentloaded',timeout:1500});}catch(e){if(!String(e).includes('ERR_ABORTED')&&!(String(e).includes('Timeout')&&navigations.length===count2+1))throw e;}
      check(kind+' location navigation asks beforeunload and can be cancelled',navigations.length===count2+1&&navigations.at(-1)==='beforeunload',navigations);
    }finally{page.off('dialog',onDialog);}
    if(kind==='kept'){await page.locator(SELECTORS.editor).click();await page.waitForSelector(SELECTORS.content);}
    check(kind+' cancelled navigation retains exact draft',await page.inputValue(SELECTORS.content)===draftText);
    for(const key of [{key:'r',ctrlKey:true},{key:'r',metaKey:true,shiftKey:true},{key:'F5'}]){
      const keyboard=await page.evaluate(key=>{const e=new KeyboardEvent('keydown',{...key,bubbles:true,cancelable:true});document.querySelector('#me-content').dispatchEvent(e);return e.defaultPrevented;},key);
      check(kind+' reload keyboard default is cancelled '+JSON.stringify(key),keyboard);
    }
    await page.evaluate(()=>{window.__exit1=window.eyeRequestClose();window.__exit2=window.eyeRequestClose();});
    await page.waitForSelector('#me-exit-decision');
    check(kind+' duplicate exit callback requests share one decision',await page.evaluate(()=>window.__exit1===window.__exit2)&&await page.locator('#me-exit-decision').count()===1);
    await page.click('#me-exit-keep');
    check(kind+' Keep open refuses exit and retains draft',await page.evaluate(()=>window.__exit1)===false&&await page.inputValue(SELECTORS.content)===draftText);
    check(kind+' navigation never submits another mutation',server.mutationCalls.length===start+(kind==='busy'||kind==='unknown'?1:0));
  }finally{release();}
}
async function providerRoundtrip(browser,server){
  const log=fs.openSync(path.join(OUT,'provider.log'),'a'),provider=new ProviderBridge(process.env.EYE_PROVIDER_PYTHON||'/home/ben/.hermes/hermes-agent/venv/bin/python',log);let context;
  try{
    const ready=await provider.ready;check('Real provider creates only temporary stores',ready.temporaryStore===true);
    const booted=await boot(browser,server);context=booted.context;server.provider=provider;const {page}=booted;
    await page.evaluate(()=>window.eyeRefresh());await openEditor(page,ready.fact_id);await details(page,'Synthetic real-provider staged\nUnicode 雪');await preview(page);await save(page);
    const saved=await provider.call('fact.get',{fact_id:ready.fact_id});check('Actual RPC persists combined editor details',saved.fact.content==='Synthetic real-provider staged\nUnicode 雪'&&saved.fact.category==='Custom Exact Category'&&saved.fact.tags==='');
    await page.fill(SELECTORS.trust,'0.75');await page.click(SELECTORS.setTrust);await page.waitForFunction(()=>/Fact trust saved/.test(document.querySelector('#me-status').textContent));
    const trust=await provider.call('fact.get',{fact_id:ready.fact_id});check('Actual RPC persists separately staged trust',trust.fact.trust_score===.75);
    const journal=await provider.call('journal.tail',{limit:20});check('Actual RPC has separate detail and trust events',journal.events.some(e=>e.kind==='fact.update')&&journal.events.some(e=>e.kind==='fact.trust_set'));
  }finally{server.provider=null;if(context)await context.close();await provider.close();fs.closeSync(log);}
}
async function run(){
  if(process.env.EYE_LABEL_EDITOR_FROZEN!=='1')throw Error('Frozen-candidate signal required. Set EYE_LABEL_EDITOR_FROZEN=1 after root authorizes this run.');
  fs.mkdirSync(OUT,{recursive:true});const server=new EditorFixture();let browser;
  try{
    await server.start();assert.notEqual(server.port,8770);
    browser=await chromium.launch({executablePath:process.env.EYE_BROWSER||'/usr/bin/thorium-browser',headless:true,timeout:15000,args:['--no-sandbox','--disable-gpu','--disable-background-networking'],env:{...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',WAYLAND_SOCKET:''}});
    for(const [name,test] of [['labels',labels],['editor',happyEditor],['conflict',conflict],['unknown malformed',(p,s)=>unknown(p,s,{ok:true})],['unknown committed unjournaled',(p,s)=>unknown(p,s,{ok:false,committed:true,journaled:false,error:'synthetic journal loss'},true)],['post-save evidence read failure',evidenceReadFailure],['timeout then late commit',lateTimeout],['trust conflict',trustConflict],['duplicate',duplicate],['capacity',capacity],['key',key],['matrix',matrix],...['dirty','kept','busy','unknown'].map(kind=>['navigation '+kind,(p,s)=>navigationGuard(p,s,kind)])]){
      if(process.env.EYE_UI_SCENARIOS&&!process.env.EYE_UI_SCENARIOS.split(',').includes(name))continue;
      let env;try{env=await boot(browser,server);await test(env.page,server);check(name+' no page errors',env.errors.length===0,env.errors);check(name+' no off-origin calls',env.blocked.length===0,env.blocked);await env.page.screenshot({path:path.join(OUT,name.replaceAll(' ','-')+'.png')});}
      catch(e){checks.push({name:name+' scenario completes',ok:false,detail:String(e.stack||e)});console.error(name,e.message);}
      finally{if(env)await env.context.close();}
    }
    if(process.env.EYE_EDITOR_REAL_PROVIDER==='1')try{await providerRoundtrip(browser,server);}catch(e){checks.push({name:'real provider editor roundtrip',ok:false,detail:String(e.stack||e)});}
  }finally{if(browser)await browser.close();await server.stop();}
  const failed=checks.filter(c=>!c.ok),report={status:failed.length?'fail':'pass',tool:'eye-label-editor-acceptance',version:'1',ts:new Date().toISOString(),fixtureOnly:true,livePort8770Used:false,nativeWindowCovered:false,realProviderRequested:process.env.EYE_EDITOR_REAL_PROVIDER==='1',assetRoot:ROOT,runScope:{scenarios:process.env.EYE_UI_SCENARIOS||'all',themes:process.env.EYE_UI_QUICK?[THEMES[0]]:THEMES,scales:SCALES,widths:[640,800,1100,1440],dpr:Number(process.env.EYE_UI_DPR||1),forcedColors:process.env.EYE_UI_FORCED_COLORS==='1',reducedMotion:true},selectors:SELECTORS,totals:{checks:checks.length,failed:failed.length},checks};
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,tool:report.tool,version:report.version,ts:report.ts,report:path.join(OUT,'report.json'),totals:report.totals}));process.exitCode=failed.length?2:0;return report;
}
module.exports={run,SELECTORS};
if(require.main===module)run().catch(e=>{console.error(JSON.stringify({status:'error',tool:'eye-label-editor-acceptance',version:'1',ts:new Date().toISOString(),error:String(e),fix:'Freeze and build the candidate, then run with EYE_LABEL_EDITOR_FROZEN=1.'}));process.exitCode=2;});
