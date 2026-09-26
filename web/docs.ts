/** Read-only API reference from the running server; no third-party CDN. */
export {};
const list=document.querySelector<HTMLDivElement>('#docs-list')!,schemas=document.querySelector<HTMLDivElement>('#docs-schemas')!,search=document.querySelector<HTMLInputElement>('#docs-search')!;
function text(tag:string,value:string){const el=document.createElement(tag);el.textContent=value;return el;}
async function load(){
 const response=await fetch('/api/openapi.json',{credentials:'same-origin'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const spec=await response.json();
 const entries:{method:string;path:string;operation:Record<string,unknown>}[]=[];
 for(const [path,methods] of Object.entries(spec.paths))for(const [method,operation] of Object.entries(methods as Record<string,Record<string,unknown>>))if(['get','post','put','patch','delete'].includes(method))entries.push({method,path,operation});
 function render(){list.replaceChildren();const selected=entries.filter(e=>`${e.method} ${e.path} ${e.operation.summary??''}`.toLowerCase().includes(search.value.toLowerCase()));list.append(text('p',`${selected.length}个接口；契约版本${spec.info.version}`));for(const e of selected){const d=document.createElement('details');d.className='panel';d.append(text('summary',`${e.method.toUpperCase()} ${e.path} · ${e.operation.summary??''}`),text('pre',JSON.stringify({parameters:e.operation.parameters??[],requestBody:e.operation.requestBody??null,responses:e.operation.responses},null,2)));list.append(d);}}
 for(const [name,model] of Object.entries(spec.components?.schemas??{})){const d=document.createElement('details');d.className='panel';d.id=`schema-${name}`;d.append(text('summary',name),text('pre',JSON.stringify(model,null,2)));schemas.append(d);}
 search.addEventListener('input',render);render();
}
load().catch((e:Error)=>list.replaceChildren(text('p',`无法读取接口契约：${e.message}`)));
