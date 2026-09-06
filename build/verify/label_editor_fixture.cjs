"use strict";
const {FixtureServer,fact,statsFor}=require('./test_responsive_views.cjs');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');
class EditorFixture extends FixtureServer {
  constructor(){super();this.plans=[];this.previewPlans=[];this.getPlans=[];this.requests=[];this.sequence=100;this.provider=null;}
  reset(){
    this.fixture={name:'label-editor',facts:Array.from({length:25},(_,i)=>fact(i+1,
      `Synthetic Garden memory ${i+1} café e\u0301 👩‍🔬`,{x:(i%5-2)*150,y:(Math.floor(i/5)-2)*150,
      category:i===0?'Custom Garden':'project',entities:[`Garden ${i+1}`],tags:'old, tags',trust_score:0.5})),entities:[],events:[]};
    this.fixture.stats={...statsFor(this.fixture.facts,[]),snr:1.6,hrr_dim:1024,facts:400,null_vectors:12,min_trust:0.3};
    this.plans=[];this.previewPlans=[];this.getPlans=[];
  }
  image(id){const f=this.fixture.facts.find(f=>f.fact_id===id);return f?{...f,links:f.entities.map((name,i)=>({name,entity_id:i+1})),vector_bytes:512,journal_retrievals:2,register:{fact_id:id,method:'synthetic-read-only',register_affinity:0.4}}:null;}
  async handle(req,res){this.requests.push({url:req.url,method:req.method});return super.handle(req,res);}
  async rpc(method,params){
    if(this.provider){
      if(['agent.sessions','agent.ask','backup.create','backfill_vectors'].includes(method))throw Error('Unexpected method outside editor scope: '+method);
      if(['fact.update','fact.trust_set','undo'].includes(method))this.mutationCalls.push({method,params});
      return this.provider.call(method,params);
    }
    if(method==='fact.get'){const plan=this.getPlans.shift();return plan?.reply||{fact:this.image(params.fact_id)};}
    if(method==='fact.preview_update'){
      const before=this.image(params.fact_id),result={before,after:{...before,...params},predicted_entities:[],entities_removed:[],bank_impact:[]};
      const plan=this.previewPlans.shift();if(plan?.wait)await plan.wait;if(plan?.reply)return plan.reply;return result;
    }
    if(['fact.update','fact.trust_set'].includes(method)){
      this.mutationCalls.push({method,params});const plan=this.plans.shift();if(plan?.wait)await plan.wait;
      if(plan?.reply&&!plan.commit)return plan.reply;
      const f=this.fixture.facts.find(f=>f.fact_id===params.fact_id);
      if(method==='fact.update')for(const k of ['content','category','tags'])if(k in params)f[k]=k==='content'?params[k].trim():params[k];
      if(method==='fact.trust_set')f.trust_score=params.trust;
      const event_id=++this.sequence;
      this.fixture.events.push({event_id,ts:'2026-01-02T03:04:05Z',session_id:'synthetic-only',source:'eye',kind:method,request:JSON.stringify(params),response:JSON.stringify({fact_id:params.fact_id}),before:null,after:null,duration_ms:1,undone_by:null});
      return plan?.reply||{ok:true,event_id,fact:this.image(params.fact_id)};
    }
    return super.rpc(method,params);
  }
}
class ProviderBridge {
  constructor(python,log){
    this.sequence=0;this.pending=new Map();this.process=spawn(python,[path.join(__dirname,'label_editor_provider_fixture.py')],{stdio:['pipe','pipe',log]});
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.timer=setTimeout(()=>this.readyReject(Error('Synthetic provider initialization exceeded 15 seconds')),15000);
    this.lines=readline.createInterface({input:this.process.stdout});
    this.lines.on('line',line=>{let v;try{v=JSON.parse(line);}catch{return this.readyReject(Error('Non-JSON provider output: '+line));}
      if(v.ready){clearTimeout(this.timer);this.readyResolve(v);return;}
      const p=this.pending.get(v.id);if(!p)return;this.pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error)):p.resolve(v.result);
    });
    this.process.on('error',error=>this.readyReject(error));
    this.process.on('exit',code=>{this.readyReject(Error('Provider exited '+code));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Provider exited '+code));}this.pending.clear();});
  }
  call(method,params){const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Provider RPC timeout: '+method));},10000);this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  async close(){clearTimeout(this.timer);if(this.process.exitCode!==null)return;this.process.stdin.end();await new Promise(resolve=>{const t=setTimeout(()=>{this.process.kill('SIGTERM');resolve();},3000);this.process.once('exit',()=>{clearTimeout(t);resolve();});});}
}
module.exports={EditorFixture,ProviderBridge};
