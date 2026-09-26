/** Native SSE first. Polling is explicitly labelled, bounded, and never retries writes. */
import {api,workspace,ApiError,type Json} from './api.js';
export class RunLive {
  private stream:EventSource|null=null;private timer:ReturnType<typeof setTimeout>|null=null;
  private disposed=false;private busy=false;private cursor=0;private failures=0;private pending=false;private pendingFinal=false;
  private visible=()=>{if(!document.hidden)void this.refresh();};
  constructor(private id:string,private receive:(runtime:Json,trace:Json[])=>void,private done:()=>void,private label:(s:string)=>void){}
  start(){
    if(this.disposed)return;
    document.addEventListener('visibilitychange',this.visible);
    try{
      this.stream=new EventSource('/api/runs/'+encodeURIComponent(this.id)+'/events?after='+this.cursor,{withCredentials:true});
      this.stream.onopen=()=>{this.label('实时事件连接已建立');};
      this.stream.addEventListener('trace',(event)=>{try{const value=JSON.parse((event as MessageEvent).data);if(value.seq>this.cursor){this.cursor=value.seq;void this.refresh();}}catch{this.poll('事件格式异常，改为状态轮询');}});
      this.stream.addEventListener('end',()=>{void this.refresh(true);});
      this.stream.addEventListener('auth_expired',()=>{this.dispose();this.label('登录已过期；不会继续读取记录');});
      this.stream.onerror=()=>this.poll('实时连接暂不可用，正在状态轮询');
      // Initial snapshot closes the gap between rendering and subscribing.
      void this.refresh();
    }catch{this.poll('当前环境不支持实时连接，正在状态轮询');}
  }
  private poll(message:string){if(this.disposed)return;this.stream?.close();this.stream=null;this.label(message);if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>void this.refresh(),Math.min(12000,1500*2**this.failures));}
  private async refresh(final=false){
    if(this.disposed)return;
    if(this.busy){this.pending=true;this.pendingFinal=this.pendingFinal||final;return;}
    if(document.hidden&&!final){if(!this.stream)this.poll('页面在后台，降低状态轮询频率');return;}
    this.busy=true;
    try{
      const [runtime,events]=await Promise.all([workspace('/runs/'+this.id+'/runtime'),api('/runs/'+this.id+'/trace')]);
      if(this.disposed)return;this.failures=0;this.cursor=Math.max(this.cursor,...events.items.map((e:Json)=>e.seq));
      this.receive(runtime,events.items);
      if(['succeeded','degraded','failed','cancelled','paused','interrupted'].includes(runtime.state)){this.dispose();this.done();return;}
    }catch(e){
      if(e instanceof ApiError&&(e.status===401||e.code==='STALE_SESSION')){this.dispose();this.label('登录上下文已失效，已停止读取；不会显示旧账户的迟到结果');return;}
      this.failures++;this.stream?.close();this.stream=null;this.label('读取暂未完成；保留已有状态，未当作成功');
    }finally{
      this.busy=false;
      if(!this.disposed&&this.pending){const last=this.pendingFinal;this.pending=false;this.pendingFinal=false;void this.refresh(last);}
      else if(!this.disposed&&!this.stream)this.poll(this.failures?'连接异常，已延长状态重试间隔':'状态轮询 · 不会重复提交任务');
    }
  }
  dispose(){this.disposed=true;document.removeEventListener('visibilitychange',this.visible);this.pending=false;this.pendingFinal=false;this.stream?.close();this.stream=null;if(this.timer)clearTimeout(this.timer);this.timer=null;}
}
