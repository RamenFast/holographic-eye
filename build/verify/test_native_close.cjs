#!/usr/bin/env node
"use strict";
// Native WM-close acceptance. All GUI processes and port 8770 stay in a private namespace.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const binary=path.resolve(process.env.EYE_NATIVE_BINARY||path.join(ROOT,'eye_shell/src-tauri/target/release/holographic-eye'));
const out=path.resolve(process.env.EYE_NATIVE_ARTIFACTS||path.join(__dirname,'shots/native-close/run-'+process.pid));
async function scriptChecks(){
  const source=fs.readFileSync(path.join(ROOT,'eye_shell/src-tauri/src/main.rs'),'utf8');
  const body=source.match(/const CLOSE_DECISION_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1];
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('window',body);
  assert.equal(await run({}),true);
  for(const value of [null,42,'true',false,{},[],undefined]){
    assert.equal(await run({eyeRequestClose:()=>Promise.resolve(value)}),false);
  }
  assert.equal(await run({eyeRequestClose:()=>Promise.resolve(true)}),true);
  assert.equal(await run({eyeRequestClose:'invalid'}),false);
  await assert.rejects(run({eyeRequestClose:()=>{throw Error('sync')}}));
  await assert.rejects(run({eyeRequestClose:()=>Promise.reject(Error('async'))}));
  let resolve;const decision=run({eyeRequestClose:()=>new Promise(r=>resolve=r)});
  let settled=false;decision.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
  resolve(true);assert.equal(await decision,true);
  console.log('PASS native async decision script: exact booleans, missing function, pending promise, errors');
}
if(process.argv.includes('--script-only')){scriptChecks().catch(e=>{console.error(e);process.exitCode=1;});}
else if(!process.argv.includes('--isolated')){
  fs.mkdirSync(out,{recursive:true});
  const home=path.join(out,'home'),runtime=path.join(out,'runtime');
  for(const p of [home,runtime,path.join(out,'config'),path.join(out,'cache'),path.join(out,'data')])fs.mkdirSync(p,{recursive:true,mode:0o700});
  const env={PATH:process.env.PATH,HOME:home,XDG_RUNTIME_DIR:runtime,XDG_CONFIG_HOME:path.join(out,'config'),XDG_CACHE_HOME:path.join(out,'cache'),XDG_DATA_HOME:path.join(out,'data'),
    GDK_BACKEND:'x11',LIBGL_ALWAYS_SOFTWARE:'1',WEBKIT_DISABLE_COMPOSITING_MODE:'1',NO_AT_BRIDGE:'1',
    EYE_NATIVE_ARTIFACTS:out,EYE_NATIVE_BINARY:binary,EYE_HOST_NET:fs.readlinkSync('/proc/self/ns/net'),EYE_HOST_USER:fs.readlinkSync('/proc/self/ns/user')};
  const child=spawn('unshare',['--user','--map-root-user','--net','--','dbus-run-session','--','xvfb-run','-a','-s','-screen 0 1600x1000x24 -nolisten tcp',process.execPath,__filename,'--isolated'],{env,stdio:'inherit',detached:true});
  const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  child.on('exit',code=>{stop();process.exitCode=code??1;});
}else{
  const {EditorFixture}=require('./label_editor_fixture.cjs');
  const report={binary,checks:[],net:fs.readlinkSync('/proc/self/ns/net'),user:fs.readlinkSync('/proc/self/ns/user'),display:process.env.DISPLAY};
  const jobs=[],log=fs.openSync(path.join(out,'process.log'),'a');
  function start(exe,args=[]){const p=spawn(exe,args,{stdio:['ignore',log,log]});jobs.push(p);return p;}
  function cmd(exe,args=[]){return new Promise((resolve,reject)=>{const p=spawn(exe,args);let s='',e='';p.stdout.on('data',d=>s+=d);p.stderr.on('data',d=>e+=d);p.on('error',reject);p.on('exit',c=>c===0?resolve(s.trim()):reject(Error(exe+': '+c+' '+e)));});}
  function check(name,ok,detail){report.checks.push({name,ok:!!ok,detail});console.log(JSON.stringify(report.checks.at(-1)));assert.ok(ok,name);}
  let pending=null,answer=null,sequence=0;
  const browserScript=`(()=>{localStorage.setItem('eyeToken','synthetic-fixture-token');const tick=async()=>{try{const c=await(await fetch('/native-command')).json();if(c){let value;try{value=await eval(c.js)}catch(e){value={error:String(e)}}await fetch('/native-result',{method:'POST',body:JSON.stringify({id:c.id,value})})}}catch(e){}setTimeout(tick,30)};tick()})();`;
  function js(code){assert.equal(answer,null,'one browser command at a time');return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{answer=null;pending=null;reject(Error('native JS timeout: '+code));},10000);answer={id,done:v=>{clearTimeout(timer);answer=null;resolve(v)}};pending={id,js:code};});}
  const server=new EditorFixture();server.reset();const base=server.handle.bind(server);
  server.handle=async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1:8770');
    if(u.pathname==='/health')return server.json(res,200,{ok:true,app:'holographic-eye',attached:true});
    if(u.pathname==='/native-command'){const c=pending;pending=null;return server.json(res,200,c);}
    if(u.pathname==='/native-result'){const r=await server.body(req);if(answer?.id===r.id)answer.done(r.value);return server.json(res,200,{ok:true});}
    if(u.pathname==='/'){let html=fs.readFileSync(path.join(ROOT,'eye_frontend/dist/index.html'),'utf8');html=html.replace('</head>','<script>'+browserScript+'</script></head>');res.writeHead(200,{'Content-Type':'text/html'});return res.end(html);}
    return base(req,res);
  };
  let app,win;
  const waitJS=condition=>js(`new Promise(r=>{let n=0;const f=()=>{if(${condition})r(true);else if(n++>150)r(false);else setTimeout(f,30)};f()})`);
  async function boot(){app=start(binary);check('synthetic UI boot',await waitJS(`window.eyeRequestClose&&document.querySelector('#sb-metrics')?.textContent.includes('400 facts')`));win=(await cmd('xdotool',['search','--onlyvisible','--name','^The Holographic Eye$'])).split('\n').at(-1);await cmd('xdotool',['windowactivate','--sync',win]);}
  // XTEST sends real WM key input. xdotool --window would instead use XSendEvent.
  const wmClose=()=>cmd('xdotool',['key','--clearmodifiers','alt+F4']);
  const alive=()=>app.exitCode===null;
  async function exited(){return new Promise(resolve=>{if(!alive())return resolve(true);const timer=setTimeout(()=>resolve(false),6000);app.once('exit',()=>{clearTimeout(timer);resolve(true);});});}
  (async()=>{try{
    check('private network and user namespaces',report.net!==process.env.EYE_HOST_NET&&report.user!==process.env.EYE_HOST_USER,{net:report.net,user:report.user});
    check('private desktop and HOME',!process.env.WAYLAND_DISPLAY&&process.env.HOME===path.join(out,'home')&&!!process.env.DBUS_SESSION_BUS_ADDRESS,process.env.HOME);
    await scriptChecks();await cmd('ip',['link','set','lo','up']);await new Promise(r=>server.server.listen(8770,'127.0.0.1',r));start('openbox',['--sm-disable']);await boot();
    const hints=await cmd('xprop',['-id',win,'WM_NORMAL_HINTS','_MOTIF_WM_HINTS']);check('640x480 minimum unchanged',/minimum size: 640 by 480/.test(hints),hints);
    check('native decoration flag disabled',/_MOTIF_WM_HINTS.*= 0x2, 0x0, 0x0,/.test(hints),hints);
    const extents=await cmd('xprop',['-id',win,'_NET_FRAME_EXTENTS']);check('WM has no frame extents',/= 0, 0, 0, 0/.test(extents),extents);
    await cmd('xdotool',['windowsize',win,'100','100']);
    check('WM enforces minimum client geometry',await waitJS('innerWidth===640&&innerHeight===480'));
    check('minimum layout has no horizontal overflow',await js('document.documentElement.scrollWidth===innerWidth'));
    await cmd('import',['-window','root',path.join(out,'native-undecorated-minimum.png')]);
    await cmd('xdotool',['windowsize',win,'1440','900']);check('WM resize restores usable client',await waitJS('innerWidth===1440&&innerHeight===900'));
    await js(`window.originalClose=window.eyeRequestClose;window.calls=0;window.eyeRequestClose=()=>{calls++;return new Promise(r=>window.resolveClose=r)};true`);
    await wmClose();check('async callback entered',await waitJS('window.calls===1'));await wmClose();await wmClose();
    check('pending decision deduplicated',await js('calls===1')&&alive());
    await js('resolveClose(false);true');await js('new Promise(r=>setTimeout(()=>r(true),150))');check('false keeps window',alive());
    for(const body of [`return Promise.resolve('true')`,`throw Error('sync failure')`,`return Promise.reject(Error('async failure'))`,`return Promise.resolve(null)`]){
      await js(`window.eyeRequestClose=()=>{calls++;${body}};window.beforeCalls=calls;true`);await wmClose();check('decision retry ran '+body,await waitJS('calls===beforeCalls+1'));await js('new Promise(r=>setTimeout(()=>r(true),150))');check('invalid/error keeps window '+body,alive());
    }
    await js(`window.eyeRequestClose=originalClose;document.querySelector('#explorer-tabs [data-view="categories"]').click();true`);
    check('synthetic row ready',await waitJS(`document.querySelector('#browser-facts [data-fact-id="1"]')`));
    await js(`document.querySelector('#browser-facts [data-fact-id="1"]').click();true`);
    check('editor button ready',await waitJS(`document.querySelector('#edit-content')`));await js(`document.querySelector('#edit-content').click();true`);
    check('editor loaded',await waitJS(`document.querySelector('#me-content')&&!document.querySelector('#me-content').disabled`));
    await js(`const el=document.querySelector('#me-content');el.value='Synthetic native draft retained';el.dispatchEvent(new Event('input',{bubbles:true}));true`);
    await wmClose();check('real dirty draft shows decision',await waitJS(`document.querySelector('#me-exit-keep')`));
    await cmd('import',['-window','root',path.join(out,'native-dirty-close.png')]);await wmClose();
    check('one real exit decision',await js(`document.querySelectorAll('#me-exit-decision').length===1`));
    await js(`document.querySelector('#me-exit-keep').click();true`);check('keep preserves real draft',await js(`document.querySelector('#me-content').value==='Synthetic native draft retained'`)&&alive());
    await wmClose();check('second dirty decision',await waitJS(`document.querySelector('#me-exit-keep')`));await cmd('xdotool',['key','Escape']);
    check('Escape keeps draft',await waitJS(`!document.querySelector('#me-exit-decision')&&document.querySelector('#me-content')?.value==='Synthetic native draft retained'`));
    await js(`document.querySelector('#me-close').click();true`);
    check('editor close offers keep draft',await waitJS(`document.querySelector('#me-keep')&&!document.querySelector('#me-keep').disabled`));
    await js(`document.querySelector('#me-keep').click();true`);
    check('kept draft editor closed',await js(`!document.querySelector('#me-content')`));
    await wmClose();check('kept draft still guards WM close',await waitJS(`document.querySelector('#me-exit-confirm')&&document.querySelector('#me-exit-list').textContent.includes('unsaved draft')`));
    await js(`document.querySelector('#me-exit-keep').click();document.querySelector('#edit-content').click();true`);
    check('kept draft reopens unchanged',await waitJS(`document.querySelector('#me-content')?.value==='Synthetic native draft retained'`));
    const guards=await js(`(async()=>{const p=window.eyeRequestClose();document.querySelector('#me-exit-confirm').click();const approved=await p;const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);const reload=new KeyboardEvent('keydown',{key:'F5',cancelable:true});window.dispatchEvent(reload);return {approved,unloadPrevented:event.defaultPrevented,reloadPrevented:reload.defaultPrevented,draft:document.querySelector('#me-content').value}})()`);
    check('approval cannot leave stale reload bypass',guards.approved&&guards.unloadPrevented&&guards.reloadPrevented&&guards.draft==='Synthetic native draft retained',guards);
    await wmClose();check('final dirty decision',await waitJS(`document.querySelector('#me-exit-confirm')`));
    // Fetch the command result before destruction can remove the page.
    await js(`setTimeout(()=>document.querySelector('#me-exit-confirm').click(),150);true`);check('explicit real approval destroys window',await exited());
    check('draft close paths caused no mutations',server.mutationCalls.length===0,server.mutationCalls);
    await boot();await js(`document.querySelector('#explorer-tabs [data-view="categories"]').click();true`);
    check('busy row ready',await waitJS(`document.querySelector('#browser-facts [data-fact-id="1"]')`));
    await js(`document.querySelector('#browser-facts [data-fact-id="1"]').click();true`);
    check('busy editor ready',await waitJS(`document.querySelector('#edit-content')`));await js(`document.querySelector('#edit-content').click();true`);
    check('busy editor loaded',await waitJS(`document.querySelector('#me-trust')&&!document.querySelector('#me-trust').disabled`));
    let release;server.plans.push({wait:new Promise(r=>release=r),reply:{ok:true}});
    await js(`const el=document.querySelector('#me-trust');el.value='0.71';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#me-set-trust').click();true`);
    check('explicit synthetic trust request is busy',await waitJS(`document.querySelector('#me-trust').disabled`));
    await wmClose();check('busy save guards WM close',await waitJS(`document.querySelector('#me-exit-list')?.textContent.includes('save still running')`));
    await js(`document.querySelector('#me-exit-keep').click();true`);check('busy keep does not submit another write',alive()&&server.mutationCalls.length===1,server.mutationCalls);
    release();check('malformed acknowledgment locks unknown outcome',await waitJS(`/Writes blocked/.test(document.querySelector('#me-status')?.textContent)`));
    await wmClose();check('unknown outcome guards WM close',await waitJS(`document.querySelector('#me-exit-list')?.textContent.includes('save outcome unknown')`));
    await cmd('import',['-window','root',path.join(out,'native-unknown-close.png')]);
    await js(`document.querySelector('#me-exit-keep').click();true`);
    check('unknown keep retains blocked trust draft',await js(`document.querySelector('#me-trust').value==='0.71'&&document.querySelector('#me-set-trust').disabled`)&&alive());
    await wmClose();check('unknown decision can be retried',await waitJS(`document.querySelector('#me-exit-confirm')`));
    await js(`setTimeout(()=>document.querySelector('#me-exit-confirm').click(),150);true`);check('explicit unknown approval destroys',await exited());
    check('only explicit trust action reached synthetic mutation path',server.mutationCalls.length===1&&server.mutationCalls[0].method==='fact.trust_set'&&server.mutationCalls[0].params.trust===0.71,server.mutationCalls);
    await boot();await js('delete window.eyeRequestClose;true');await wmClose();check('old UI missing hook closes normally',await exited());
    await boot();await wmClose();check('clean current UI closes normally',await exited());
    check('close actions add no implicit mutation',server.mutationCalls.length===1&&server.fixture.facts[0].trust_score===0.5,server.mutationCalls);report.status='passed';
  }catch(error){report.status='failed';report.error=String(error.stack||error);console.error(error);}
  finally{report.mutationCalls=server.mutationCalls;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));for(const p of jobs)p.kill('SIGTERM');await server.stop();setTimeout(()=>{for(const p of jobs)if(p.exitCode===null)p.kill('SIGKILL');process.exit(report.status==='passed'?0:1);},500);}})();
}
