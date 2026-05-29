/* أركيدو — محرّك التجربة التفاعلية (جزيئات + confetti + مَيَلان 3D + مؤشر) */

/* ===== كانفس: جزيئات محيطة + confetti ===== */
const cv = document.getElementById('fx');
const ctx = cv.getContext('2d');
let W, H, DPR = Math.min(devicePixelRatio || 1, 2);
function resize() { W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; }
resize(); addEventListener('resize', resize);

const COLORS = ['#FF3F33', '#FFC94D', '#9FC87E', '#FF5FCF', '#9929EA', '#59B292', '#ffffff'];

// جزيئات بطيئة في الخلفية
const dust = Array.from({ length: 70 }, () => ({
  x: Math.random() * W, y: Math.random() * H,
  r: (Math.random() * 1.6 + .4) * DPR,
  vx: (Math.random() - .5) * .15 * DPR, vy: (Math.random() - .5) * .15 * DPR,
  a: Math.random() * .5 + .1
}));

// confetti قطع
let confetti = [];
function burst(cx, cy, n = 90) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2, sp = (Math.random() * 6 + 3) * DPR;
    confetti.push({
      x: cx * DPR, y: cy * DPR, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4 * DPR,
      g: .18 * DPR, r: (Math.random() * 5 + 3) * DPR, rot: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
      c: COLORS[(Math.random() * COLORS.length) | 0], life: 1
    });
  }
}

function frame() {
  ctx.clearRect(0, 0, W, H);
  // غبار
  dust.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
    ctx.globalAlpha = p.a; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
  });
  // confetti
  confetti.forEach(c => {
    c.vy += c.g; c.x += c.vx; c.y += c.vy; c.rot += c.vr; c.life -= .008;
    ctx.globalAlpha = Math.max(c.life, 0); ctx.fillStyle = c.c;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    ctx.fillRect(-c.r / 2, -c.r / 2, c.r, c.r * .6); ctx.restore();
  });
  confetti = confetti.filter(c => c.life > 0 && c.y < H + 40);
  ctx.globalAlpha = 1;
  requestAnimationFrame(frame);
}
frame();

/* ===== مؤشر مخصص + توهّج ===== */
const glow = document.querySelector('.cursor-glow');
const dot = document.querySelector('.cursor-dot');
let mx = innerWidth / 2, my = innerHeight / 2, gx = mx, gy = my;
addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  dot.style.left = mx + 'px'; dot.style.top = my + 'px';
});
(function follow() { gx += (mx - gx) * .12; gy += (my - gy) * .12; if (glow) { glow.style.left = gx + 'px'; glow.style.top = gy + 'px'; } requestAnimationFrame(follow); })();
document.querySelectorAll('a,button,.card3d').forEach(el => {
  el.addEventListener('mouseenter', () => dot.classList.add('big'));
  el.addEventListener('mouseleave', () => dot.classList.remove('big'));
});

/* ===== ميلان 3D للبطاقات (parallax tilt) ===== */
document.querySelectorAll('.card3d').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `rotateY(${px * 22}deg) rotateX(${-py * 22}deg) translateZ(30px) scale(1.05)`;
    card.style.boxShadow = `${-px * 40}px ${py * 40 + 30}px 70px rgba(0,0,0,.6)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });
  card.addEventListener('click', e => { burst(e.clientX, e.clientY, 60); });
});

/* ===== ميلان طفيف للـ hero مع الماوس ===== */
const heroInner = document.querySelector('.hero-inner');
if (heroInner) addEventListener('mousemove', e => {
  const px = e.clientX / innerWidth - .5, py = e.clientY / innerHeight - .5;
  heroInner.style.transform = `rotateY(${px * 8}deg) rotateX(${-py * 8}deg)`;
});

/* ===== أنيميشن حروف العنوان (stagger) ===== */
document.querySelectorAll('.hero h1 .l').forEach((l, i) => {
  l.style.animation = `fadeUp .8s ${.25 + i * 0.05}s forwards`;
});

/* ===== reveal عند التمرير ===== */
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) en.target.classList.add('in'); }), { threshold: .15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* ===== انفجار ترحيبي عند التحميل ===== */
addEventListener('load', () => setTimeout(() => { burst(innerWidth / 2, innerHeight * .4, 140); }, 600));
window.celebrate = () => burst(innerWidth / 2, innerHeight / 2, 160);
