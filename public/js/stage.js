/* أركيدو — محرّك المسرح: لمبات الماركي + نجوم متطايرة + confetti */

/* ===== نجوم متطايرة في الخلفية ===== */
(function stars(){
  const field = document.getElementById('stars');
  if(!field) return;
  const N = 26;
  for(let i=0;i<N;i++){
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24');
    const size = 10 + Math.random()*26;
    s.setAttribute('width',size); s.setAttribute('height',size);
    s.classList.add('fstar');
    s.style.left = Math.random()*100 + '%';
    s.style.top = Math.random()*100 + '%';
    s.style.setProperty('--r', (Math.random()*40-20)+'deg');
    s.style.animationDelay = (Math.random()*3)+'s';
    s.style.color = Math.random()>.5 ? '#FFC21E' : '#E23B32';
    s.innerHTML = '<use href="#i-star"/>';
    field.appendChild(s);
  }
})();

/* ===== لمبات حول إطار الماركي ===== */
function ringBulbs(frame, gap=26){
  if(!frame) return;
  const wrap = document.createElement('div'); wrap.className='bulbs';
  frame.appendChild(wrap);
  const place = ()=>{
    wrap.innerHTML='';
    const w = frame.clientWidth, h = frame.clientHeight, pad = 13;
    const nx = Math.max(6, Math.floor((w-2*pad)/gap));
    const ny = Math.max(4, Math.floor((h-2*pad)/gap));
    const add = (x,y,i)=>{ const b=document.createElement('span'); b.className='bulb';
      b.style.left=x+'px'; b.style.top=y+'px'; b.style.animationDelay=(i%4)*0.18+'s';
      b.style.transform='translate(-50%,-50%)'; wrap.appendChild(b); };
    let i=0;
    for(let k=0;k<=nx;k++){ const x=pad+(w-2*pad)*k/nx; add(x,pad,i++); add(x,h-pad,i++); }
    for(let k=1;k<ny;k++){ const y=pad+(h-2*pad)*k/ny; add(pad,y,i++); add(w-pad,y,i++); }
  };
  place();
  new ResizeObserver(place).observe(frame);
  addEventListener('resize',place);
}
ringBulbs(document.getElementById('heroFrame'));

/* ===== confetti احتفالي ===== */
let _cv, _ctx, _pieces=[], _raf;
function ensureCanvas(){
  if(_cv) return;
  _cv=document.createElement('canvas');
  _cv.style.cssText='position:fixed;inset:0;z-index:90;pointer-events:none';
  document.body.appendChild(_cv);
  _ctx=_cv.getContext('2d');
  const r=()=>{_cv.width=innerWidth;_cv.height=innerHeight}; r(); addEventListener('resize',r);
}
function arcadoCelebrate(){
  ensureCanvas();
  const COLORS=['#FFC21E','#E23B32','#19A88C','#2440B0','#FFF4D6'];
  for(let i=0;i<160;i++){
    const a=Math.random()*Math.PI*2, sp=Math.random()*9+4;
    _pieces.push({x:innerWidth/2,y:innerHeight*0.4,
      vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-5, g:0.22,
      r:Math.random()*7+3, rot:Math.random()*6.28, vr:(Math.random()-.5)*.5,
      c:COLORS[i%COLORS.length], life:1});
  }
  if(!_raf) loop();
}
function loop(){
  _ctx.clearRect(0,0,_cv.width,_cv.height);
  _pieces.forEach(p=>{ p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.life-=.008;
    _ctx.globalAlpha=Math.max(p.life,0); _ctx.fillStyle=p.c;
    _ctx.save(); _ctx.translate(p.x,p.y); _ctx.rotate(p.rot);
    _ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r*.6); _ctx.restore(); });
  _pieces=_pieces.filter(p=>p.life>0 && p.y<_cv.height+40);
  _ctx.globalAlpha=1;
  _raf = _pieces.length ? requestAnimationFrame(loop) : (cancelAnimationFrame(_raf),_raf=null);
}
window.arcadoCelebrate = arcadoCelebrate;

/* احتفال ترحيبي خفيف عند التحميل */
addEventListener('load', ()=> setTimeout(arcadoCelebrate, 700));
