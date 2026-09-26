/** Presentation state only. No identity, business content or credentials in storage. */
export type LayoutState={collapsed:boolean;assistant:boolean;width:number};
const defaults:LayoutState={collapsed:false,assistant:false,width:390};
let saved={...defaults},owner='',restoreFocus:HTMLElement|null=null;
export function normalizeLayout(value:Partial<LayoutState>,viewport=window.innerWidth):LayoutState{
 return {collapsed:value.collapsed===true,assistant:value.assistant===true,width:Math.max(320,Math.min(560,Number.isFinite(value.width)?Number(value.width):390,Math.max(320,viewport-620)))};
}
export function loadLayout(userId:string){if(owner===userId)return;owner=userId;try{saved=normalizeLayout(JSON.parse(sessionStorage.getItem('lidian:layout:'+owner)??'{}'));}catch{saved={...defaults};}}
function remember(){try{sessionStorage.setItem('lidian:layout:'+owner,JSON.stringify(saved));}catch{/* storage is optional */}}
export function layoutState(){return {...saved};}
export function clearLayout(){owner='';saved={...defaults};restoreFocus=null;}
export function applyLayout(){const shell=document.querySelector<HTMLElement>('.workspace-shell');if(!shell)return;
 saved=normalizeLayout(saved);shell.dataset.nav=saved.collapsed?'compact':'expanded';shell.dataset.assistant=saved.assistant?'visible':'hidden';shell.style.setProperty('--assistant-width',saved.width+'px');
 const full=location.hash.startsWith('#copilot');shell.dataset.copilot=full?'full':'rail';
 const rail=document.querySelector<HTMLElement>('#assistant-rail');if(rail){rail.hidden=full||(!saved.assistant&&innerWidth>900);if(full||!saved.assistant)rail.classList.remove('open');}
 document.querySelectorAll<HTMLElement>('[data-action="menu"]').forEach(b=>{b.setAttribute('aria-expanded',String(innerWidth>900?!saved.collapsed:document.querySelector('#sidebar')?.classList.contains('open')));b.setAttribute('title',saved.collapsed?'展开导航':'收起导航');});
 document.querySelectorAll<HTMLElement>('[data-action="show-assistant"]').forEach(b=>{b.setAttribute('aria-expanded',String(saved.assistant&&!full));b.setAttribute('title',full?'助手已在主工作区':saved.assistant?'收起研究助手':'打开研究助手');});
 const handle=document.querySelector('#assistant-resize');if(handle){handle.setAttribute('aria-valuenow',String(saved.width));handle.setAttribute('aria-valuemin','320');handle.setAttribute('aria-valuemax','560');}
 syncBackdrop();
}
function syncBackdrop(){const back=document.querySelector<HTMLElement>('#drawer-backdrop');if(!back)return;const open=innerWidth<=900&&!!document.querySelector('#sidebar.open, #assistant-rail.open');back.hidden=!open;document.body.classList.toggle('drawer-active',open);}
function focusFirst(id:string){restoreFocus=document.activeElement as HTMLElement;document.querySelector<HTMLElement>(id+' button, '+id+' textarea')?.focus();}
export function toggleNav(force?:boolean){const el=document.querySelector<HTMLElement>('#sidebar');if(!el)return;if(innerWidth>900){saved.collapsed=force===undefined?!saved.collapsed:!force;remember();applyLayout();return;}
 const opened=force??!el.classList.contains('open');document.querySelector('#assistant-rail')?.classList.remove('open');el.classList.toggle('open',opened);if(opened)focusFirst('#sidebar');else restoreFocus?.focus();syncBackdrop();applyLayout();}
export function toggleAssistant(force?:boolean){if(location.hash.startsWith('#copilot'))return;const el=document.querySelector<HTMLElement>('#assistant-rail');if(!el)return;saved.assistant=force??!saved.assistant;remember();el.hidden=false;
 if(innerWidth<=900){document.querySelector('#sidebar')?.classList.remove('open');el.classList.toggle('open',saved.assistant);if(saved.assistant)focusFirst('#assistant-rail');else restoreFocus?.focus();}applyLayout();}
export function closeDrawers(){document.querySelectorAll('.sidebar.open,.assistant-rail.open').forEach(x=>x.classList.remove('open'));if(innerWidth<=900){saved.assistant=false;remember();}syncBackdrop();restoreFocus?.focus();}
let dragging=false;
document.addEventListener('pointerdown',e=>{if(!(e.target as Element).closest('#assistant-resize')||innerWidth<=1100)return;e.preventDefault();dragging=true;(e.target as HTMLElement).setPointerCapture(e.pointerId);document.body.classList.add('resizing-rail');});
document.addEventListener('pointermove',e=>{if(!dragging)return;saved.width=normalizeLayout({width:innerWidth-e.clientX,...{collapsed:saved.collapsed,assistant:saved.assistant}}).width;applyLayout();});
function endResize(){if(!dragging)return;dragging=false;document.body.classList.remove('resizing-rail');remember();}
document.addEventListener('pointerup',endResize);document.addEventListener('pointercancel',endResize);
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).id==='assistant-resize'&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();saved.width=e.key==='Home'?320:e.key==='End'?560:saved.width+(e.key==='ArrowLeft'?24:-24);saved=normalizeLayout(saved);remember();applyLayout();}
 if(e.key==='Escape'&&!document.querySelector('dialog[open]'))closeDrawers();
 if(e.key==='Tab'&&innerWidth<=900&&!document.querySelector('dialog[open]')){const drawer=document.querySelector<HTMLElement>('#sidebar.open,#assistant-rail.open');if(!drawer)return;const controls=[...drawer.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]')].filter(x=>!x.hidden&&x.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1)!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
window.addEventListener('resize',()=>{if(innerWidth>900){document.querySelectorAll('.sidebar.open,.assistant-rail.open').forEach(x=>x.classList.remove('open'));}applyLayout();});
document.addEventListener('click',e=>{if((e.target as HTMLElement).id==='drawer-backdrop')closeDrawers();});
