/** Presentation state only. No identity, business content or credentials in storage. */
export type LayoutState={collapsed:boolean;assistant:boolean;width:number};
const defaults:LayoutState={collapsed:false,assistant:false,width:390};
let saved={...defaults},owner='',restoreFocus:HTMLElement|null=null;
let mobile=window.innerWidth<=900;
export function normalizeLayout(value:Partial<LayoutState>,viewport=window.innerWidth):LayoutState{
 return {collapsed:value.collapsed===true,assistant:value.assistant===true,width:Math.max(320,Math.min(560,Number.isFinite(value.width)?Number(value.width):390,Math.max(320,viewport-620)))};
}
export function loadLayout(userId:string){if(owner===userId)return;owner=userId;try{saved=normalizeLayout(JSON.parse(sessionStorage.getItem('lidian:layout:'+owner)??'{}'));}catch{saved={...defaults};}}
function remember(){try{sessionStorage.setItem('lidian:layout:'+owner,JSON.stringify(saved));}catch{/* storage is optional */}}
export function layoutState(){return {...saved};}
export function clearLayout(){owner='';saved={...defaults};restoreFocus=null;document.body.classList.remove('drawer-active','resizing-rail');}
function setUnavailable(el:HTMLElement|null,unavailable:boolean){if(!el)return;el.inert=unavailable;el.setAttribute('aria-hidden',String(unavailable));}
function restoreTrigger(){if(restoreFocus?.isConnected)restoreFocus.focus();restoreFocus=null;}
function focusFirst(id:string){document.querySelector<HTMLElement>(id+' button, '+id+' textarea, '+id+' a[href]')?.focus();}
export function applyLayout(){
 const shell=document.querySelector<HTMLElement>('.workspace-shell');if(!shell)return;
 const small=innerWidth<=900,full=location.hash.split(':')[0]==='#copilot';
 const sidebar=document.querySelector<HTMLElement>('#sidebar'),rail=document.querySelector<HTMLElement>('#assistant-rail');
 // Drawer state never survives replacement of its DOM or a breakpoint change.
 if(small!==mobile){sidebar?.classList.remove('open');rail?.classList.remove('open');restoreFocus=null;}mobile=small;
 if(full||!saved.assistant)rail?.classList.remove('open');
 const navOpen=small&&!!sidebar?.classList.contains('open'),railOpen=small&&!!rail?.classList.contains('open');
 const compact=!small&&(saved.collapsed||(saved.assistant&&!full&&innerWidth<=1100));
 const width=normalizeLayout(saved).width;
 shell.dataset.nav=compact?'compact':'expanded';shell.dataset.assistant=saved.assistant?'visible':'hidden';shell.dataset.copilot=full?'full':'rail';shell.style.setProperty('--assistant-width',width+'px');
 if(rail)rail.hidden=full||(!small&&!saved.assistant);
 setUnavailable(sidebar,small&&!navOpen);setUnavailable(rail,full||(small?!railOpen:!saved.assistant));
 setUnavailable(document.querySelector<HTMLElement>('.main-shell'),small&&(navOpen||railOpen));
 const back=document.querySelector<HTMLElement>('#drawer-backdrop');if(back)back.hidden=!(navOpen||railOpen);
 document.body.classList.toggle('drawer-active',navOpen||railOpen);
 document.querySelectorAll<HTMLElement>('[data-action="menu"]').forEach(b=>{const expanded=small?navOpen:!compact;const label=expanded?'收起导航':'展开导航';b.setAttribute('aria-expanded',String(expanded));b.setAttribute('aria-controls','sidebar');b.setAttribute('title',label);b.setAttribute('aria-label',label);});
 document.querySelectorAll<HTMLElement>('[data-action="show-assistant"]').forEach(b=>{const expanded=!full&&(small?railOpen:saved.assistant);const label=full?'助手已在主工作区':expanded?'收起研究助手':'打开研究助手';b.setAttribute('aria-expanded',String(expanded));b.setAttribute('aria-controls',full?'copilot-full':'assistant-rail');b.setAttribute('title',label);b.setAttribute('aria-label',label);});
 const handle=document.querySelector('#assistant-resize');if(handle){handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuemin','320');handle.setAttribute('aria-valuemax',String(normalizeLayout({width:560}).width));}
}
export function toggleNav(force?:boolean){
 const el=document.querySelector<HTMLElement>('#sidebar');if(!el)return;
 if(innerWidth>900){const compact=document.querySelector<HTMLElement>('.workspace-shell')?.dataset.nav==='compact';saved.collapsed=force===undefined?!compact:!force;if(!saved.collapsed&&saved.assistant&&innerWidth<=1100)saved.assistant=false;remember();applyLayout();return;}
 const opened=force??!el.classList.contains('open');
 if(opened&&!document.body.classList.contains('drawer-active'))restoreFocus=document.activeElement as HTMLElement;
 document.querySelector('#assistant-rail')?.classList.remove('open');el.classList.toggle('open',opened);applyLayout();
 if(opened)focusFirst('#sidebar');else restoreTrigger();
}
export function toggleAssistant(force?:boolean){
 if(location.hash.split(':')[0]==='#copilot')return;const el=document.querySelector<HTMLElement>('#assistant-rail');if(!el)return;
 const opened=force??(innerWidth<=900?!el.classList.contains('open'):!saved.assistant);saved.assistant=opened;remember();el.hidden=false;
 if(innerWidth<=900){if(opened&&!document.body.classList.contains('drawer-active'))restoreFocus=document.activeElement as HTMLElement;document.querySelector('#sidebar')?.classList.remove('open');el.classList.toggle('open',opened);}
 applyLayout();if(innerWidth<=900){if(opened)focusFirst('#assistant-rail');else restoreTrigger();}
}
export function closeDrawers(){if(innerWidth<=900&&document.querySelector('#assistant-rail.open')){saved.assistant=false;remember();}const opened=!!document.querySelector('.sidebar.open,.assistant-rail.open');document.querySelectorAll('.sidebar.open,.assistant-rail.open').forEach(x=>x.classList.remove('open'));applyLayout();if(opened)restoreTrigger();}
let dragging=false;
document.addEventListener('pointerdown',e=>{const handle=(e.target as Element).closest<HTMLElement>('#assistant-resize');if(!handle||innerWidth<=1100)return;e.preventDefault();dragging=true;handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-rail');});
document.addEventListener('pointermove',e=>{if(!dragging)return;saved.width=normalizeLayout({...saved,width:innerWidth-e.clientX}).width;applyLayout();});
function endResize(){if(!dragging)return;dragging=false;document.body.classList.remove('resizing-rail');remember();}
document.addEventListener('pointerup',endResize);document.addEventListener('pointercancel',endResize);document.addEventListener('lostpointercapture',endResize);
document.addEventListener('keydown',e=>{
 if((e.target as HTMLElement).id==='assistant-resize'&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();saved.width=e.key==='Home'?320:e.key==='End'?560:saved.width+(e.key==='ArrowLeft'?24:-24);saved=normalizeLayout(saved);remember();applyLayout();}
 if(e.key==='Escape'&&!document.querySelector('dialog[open]'))closeDrawers();
 if(e.key==='Tab'&&innerWidth<=900&&!document.querySelector('dialog[open]')){const drawer=document.querySelector<HTMLElement>('#sidebar.open,#assistant-rail.open');if(!drawer)return;const controls=[...drawer.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(x=>!x.hidden&&!x.inert&&x.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1)!;if(!drawer.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
window.addEventListener('resize',()=>{endResize();applyLayout();});
document.addEventListener('click',e=>{if((e.target as HTMLElement).id==='drawer-backdrop')closeDrawers();});
