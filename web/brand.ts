/** Original competition identity, preserved byte-for-byte. Decoration never gates service. */
let intro:HTMLDialogElement|null=null;
let introTimer:ReturnType<typeof setTimeout>|null=null;
export function showBrandIntro(force=false){
  if(intro?.open)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='reduce';
  let already=false;try{already=sessionStorage.getItem('lidian-brand-seen')==='1';}catch{/* Restricted storage must not block entry. */}
  if(!force&&(already||reduced))return;
  try{sessionStorage.setItem('lidian-brand-seen','1');}catch{/* Presentation preference only; no business data stored. */}
  intro=document.createElement('dialog');intro.className='brand-intro';intro.setAttribute('aria-label','锂电智诊开场动画');
  intro.innerHTML=`<div class="brand-intro-content"><video src="/assets/brand/loading-video.mp4" muted playsinline preload="auto" aria-label="原始品牌开场动画"></video><img src="/assets/brand/logo.png" alt="锂电智诊原始标识" hidden><p>锂电智诊</p><span class="intro-caption">企业研究 · 有据可循</span><button type="button" class="secondary" data-intro-skip>进入工作区</button></div>`;
  document.body.append(intro);const current=intro;
  const done=()=>{if(introTimer)clearTimeout(introTimer);if(current.open)current.close();current.remove();if(intro===current)intro=null;};
  const video=current.querySelector('video')!;const image=current.querySelector('img')!;
  const fallback=()=>{video.pause();video.hidden=true;image.hidden=false;current.querySelector('.intro-caption')!.textContent='动画暂不可播，可直接进入';};
  current.querySelector('[data-intro-skip]')!.addEventListener('click',done);
  current.addEventListener('cancel',e=>{e.preventDefault();done();});
  video.addEventListener('error',fallback,{once:true});video.addEventListener('ended',done,{once:true});
  current.showModal();introTimer=setTimeout(done,6500);
  if(reduced){video.hidden=true;image.hidden=false;}else void video.play().catch(fallback);
}
export function motionSetting(value:string){
  document.documentElement.dataset.motion=value;
  try{sessionStorage.setItem('lidian-motion',value);}catch{/* Nonessential preference. */}
}
export function restoreMotion(){try{motionSetting(sessionStorage.getItem('lidian-motion')??'system');}catch{motionSetting('system');}}
