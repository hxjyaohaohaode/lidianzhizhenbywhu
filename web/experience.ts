import {interactionGuard,invalidateInteractions} from './interactions.js';
import {api,invalidateContext,type Json} from './api.js';
import {state,scopedDatasets} from './state.js';
import {esc,field,input,textarea,formFooter,notice,jsonView} from './components.js';
import {identityForm,connectionForm,watchForm,serviceForm} from './views-services.js';
import {configureCopilot,chatAction,copilotSubmit,resetCopilot,handoffCopilot,type ExperienceHooks} from './copilot-ui.js';
let hooks:ExperienceHooks;
export async function selectIdentity(id:string){if(id===state.identity)return true;if(id&&!state.identities.some(x=>x.id===id))throw new Error('服务身份已失效，请刷新。');if(state.dirty&&!confirm('切换身份将放弃当前未保存表单，是否继续？'))return false;invalidateInteractions();invalidateContext();state.identity=id;state.dirty=false;state.cache={};if(state.active&&!scopedDatasets().some(x=>x.id===state.active))state.active='';try{sessionStorage.setItem('lidian:identity:'+state.user.id,id);}catch{/* optional */}document.querySelector<HTMLDialogElement>('#modal')?.close();document.querySelector<HTMLDialogElement>('#inspector')?.close();await hooks.render();return true;}
export function restoreIdentity(){try{const id=sessionStorage.getItem('lidian:identity:'+state.user.id)??'';state.identity=state.identities.some(x=>x.id===id)?id:'';}catch{state.identity='';}}
function sensitive(title:string,action:string,id='',version=0){hooks.dialog(title,serviceForm(action,notice('需要当前账户密码确认；不会读取或显示其他设备的会话令牌。')+field('当前登录密码',input('password','','type="password" required maxlength="128" autocomplete="current-password"'))+formFooter('验证并执行'),`data-id="${esc(id)}" data-version="${version}"`));}
export function setupExperience(value:ExperienceHooks){hooks=value;configureCopilot(value);
 document.addEventListener('click',async e=>{const el=(e.target as Element).closest<HTMLElement>('[data-x-action]');if(!el)return;e.preventDefault();e.stopImmediatePropagation();if(el.dataset.pending)return;el.dataset.pending='true';el.setAttribute('aria-busy','true');const act=el.dataset.xAction!,id=el.dataset.id??'';
 try{if(act.startsWith('chat-')){await chatAction(act,el);return;}
 switch(act){
 case 'identity-new':hooks.dialog('新建服务身份',identityForm(),true);break;
 case 'identity-edit':{const r=state.identities.find(x=>x.id===id);if(!r)throw new Error('身份已变化，请刷新');hooks.dialog('编辑服务身份',identityForm(r),true);break;}
 case 'identity-use':await selectIdentity(id);break;
 case 'identity-delete':if(!confirm('删除此服务身份？尚未外发的关联调用将停止；历史报告与会话快照仍然保留。'))return;await api('/services/identities/'+id+'?version='+encodeURIComponent(el.dataset.version??''),'DELETE');await hooks.refresh();if(state.identity===id)state.identity='';await hooks.render();break;
 case 'connection-new':hooks.dialog('配置私有模型连接',connectionForm());break;
 case 'connection-edit':{const r=state.cache.connections?.find((x:Json)=>x.id===id);if(!r)throw new Error('连接不存在，请刷新');hooks.dialog('更新模型连接',connectionForm(r));break;}
 case 'connection-delete':sensitive('删除模型连接','remove-connection',id,Number(el.dataset.version));break;
 case 'sessions-others':sensitive('退出其他登录会话','revoke-others');break;
 case 'session-revoke':sensitive('撤销登录会话','revoke-session',id);break;
 case 'watch-new':hooks.dialog('跟踪一项已保存指标',watchForm());break;
 case 'watch-edit':{const row=state.cache.tracking.rules.find((x:Json)=>x.id===id);hooks.dialog('调整跟踪规则',watchForm(row));break;}
 case 'watch-toggle':{const w=state.cache.tracking.rules.find((x:Json)=>x.id===id);await api('/services/watches/'+id,'PUT',{...w.payload,active:!w.payload.active,version:w.version});await hooks.render();break;}
 case 'watch-delete':if(!confirm('删除此跟踪规则？过去的提醒保留供你核查。'))return;await api('/services/watches/'+id+'?version='+encodeURIComponent(el.dataset.version??''),'DELETE');await hooks.render();break;
 case 'alert-ack':{const row=state.cache.tracking.alerts.find((x:Json)=>x.id===id);hooks.dialog('记录核对结果',serviceForm('alert-ack',field('已核对的内容与后续处理',textarea('note','','required minlength="2" maxlength="1000" rows="3"'))+formFooter('保存核对记录'),`data-id="${esc(id)}" data-version="${row.version}"`));break;}
 case 'alert-archive':await api('/services/alerts/'+id+'?version='+encodeURIComponent(el.dataset.version??''),'DELETE');await hooks.render();break;
 case 'alert-investigate':{const row=state.cache.tracking.alerts.find((x:Json)=>x.id===id);state.active=row.payload.dataset_id;invalidateContext();hooks.navigate('copilot',true);await hooks.render();await handoffCopilot('核查当前企业的'+row.payload.title+'，说明指标来源、数据质量与需要的证据');break;}
 default:throw new Error('此操作未识别，没有执行写入。');}
 }catch(error){hooks.toast(error instanceof Error?error.message:'操作失败',true);}finally{delete el.dataset.pending;el.removeAttribute('aria-busy');}},true);
 document.addEventListener('submit',async e=>{const form=e.target as HTMLFormElement;if(!form.dataset.serviceForm)return;e.preventDefault();e.stopImmediatePropagation();if(form.dataset.pending)return;if(!form.reportValidity())return;const valid=interactionGuard();form.dataset.pending='true';form.setAttribute('aria-busy','true');const fd=new FormData(form),str=(n:string)=>String(fd.get(n)??'');const out=form.querySelector('.form-error');if(out)out.textContent='';const buttons=[...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];buttons.forEach(b=>b.disabled=true);const type=form.dataset.serviceForm;
 try{if(['proposal','confirm-proposal'].includes(type)){await copilotSubmit(form,fd);return;}const id=form.dataset.id??'',version=Number(form.dataset.version??0);
 switch(type){
 case 'identity':{const body={name:str('name'),perspective:str('perspective'),objective:str('objective'),depth:str('depth'),output_style:str('output_style'),dataset_ids:fd.getAll('dataset_ids').map(String),include_shared_memory:fd.has('include_shared_memory'),allow_external:fd.has('allow_external'),max_calls:Number(str('max_calls')),version};await api('/services/identities'+(id?'/'+id:''),id?'PUT':'POST',body);break;}
 case 'connection':await api('/services/connections'+(id?'/'+id:''),id?'PUT':'POST',{name:str('name'),base_url:str('base_url'),model:str('model'),api_key:str('api_key'),password:str('password'),version});break;
 case 'remove-connection':await api('/services/connections/'+id+'/remove','POST',{password:str('password'),version});break;
 case 'revoke-others':case 'revoke-session':{const r=await api('/services/sessions/revoke','POST',{password:str('password'),others:type==='revoke-others',id});if(r.relogin_required){resetCopilot();hooks.reset();return;}break;}
 case 'watch':await api('/services/watches'+(id?'/'+id:''),id?'PUT':'POST',{title:str('title'),identity_id:state.identity,dataset_id:str('dataset_id'),metric:str('metric'),operator:str('operator'),threshold:Number(str('threshold')),active:fd.has('active'),stale_after_days:Number(str('stale_after_days')),expires_at:str('expires_at')||null,version});break;
 case 'alert-ack':await api('/services/alerts/'+id+'/acknowledge','POST',{note:str('note'),version});break;
 default:throw new Error('表单尚未识别，没有执行写入。');}
 if(!valid())return;state.dirty=false;document.querySelector<HTMLDialogElement>('#modal')?.close();await hooks.refresh();if(!valid())return;await hooks.render();hooks.toast('已保存。');
 }catch(error){if(out)out.textContent=error instanceof Error?error.message:'提交失败，请核对状态后重试。';}finally{delete form.dataset.pending;form.removeAttribute('aria-busy');buttons.forEach(b=>b.disabled=false);}},true);
 document.addEventListener('change',async e=>{const el=e.target as HTMLSelectElement;if(el.id!=='active-identity')return;try{await selectIdentity(el.value);el.value=state.identity;}catch(error){hooks.toast(String(error),true);el.value=state.identity;}});
}
