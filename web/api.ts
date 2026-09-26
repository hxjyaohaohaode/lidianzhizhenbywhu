export type Json = any;
let csrf = '';
let authGeneration=0;
export function setCsrf(value:string){if(value!==csrf)authGeneration++;csrf=value;}
export class ApiError extends Error {
  constructor(message:string,public status:number,public code:string,public requestId:string){super(message);}
}
export async function api(path:string,method='GET',body?:Json,extra:Record<string,string>={}):Promise<Json> {
  const generation=authGeneration;const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),30000);
  const headers:Record<string,string>={'Accept':'application/json',...extra};
  if(csrf && method!=='GET') headers['X-CSRF-Token']=csrf;
  if(body!==undefined && !(body instanceof FormData))headers['Content-Type']='application/json';
  try {
    const res=await fetch('/api'+path,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const type=res.headers.get('content-type')??'';
    if(!type.includes('application/json'))throw new ApiError('服务返回格式异常，请检查后端地址。',res.status,'NON_JSON','');
    const data=await res.json();
    if(generation!==authGeneration)throw new ApiError('登录上下文已变化，已丢弃旧账户的迟到响应。',409,'STALE_SESSION','');
    if(!res.ok){const e=data.error??{};throw new ApiError((e.message??'请求失败')+(e.details?.length?'\n'+e.details.map((x:Json)=>x.path+': '+x.message).join('\n'):''),res.status,e.code??'ERROR',data.request_id??'');}
    return data;
  } catch(e){
    if(e instanceof ApiError)throw e;
    if(e instanceof Error && e.name==='AbortError')throw new Error('请求超时。写入可能已被服务端接收，请刷新状态后确认；不会自动重复提交。');
    throw new Error('无法连接服务。当前输入仍在页面，请检查网络后重试。');
  } finally {clearTimeout(timeout);}
}
export const workspace=(path:string,method='GET',body?:Json)=>api('/workspace'+path,method,body);
