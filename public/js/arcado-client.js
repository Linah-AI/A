// أركيدو — عميل مشترك للوقت الفعلي (Socket.IO)
// يوفّر اتصالاً + مساعدات صغيرة للشاشات الثلاث.

export const socket = io();

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

// أصوات بسيطة عبر WebAudio (بدون ملفات)
const AC = window.AudioContext || window.webkitAudioContext;
let actx = null;
function tone(freq, dur = 0.15, type = 'square', gain = 0.06) {
  try {
    actx = actx || new AC();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(actx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.stop(actx.currentTime + dur);
  } catch (_) {}
}
export const sfx = {
  buzz: () => { tone(220, 0.18, 'sawtooth', 0.08); },
  correct: () => { tone(523, 0.12); setTimeout(() => tone(784, 0.18), 120); },
  wrong: () => { tone(160, 0.3, 'sawtooth', 0.07); },
  tick: () => { tone(880, 0.05, 'sine', 0.03); }
};

// confetti بسيط على canvas
export function confetti(canvas, n = 160) {
  const ctx = canvas.getContext('2d');
  const r = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  r();
  const COLORS = ['#E2583F', '#1E8770', '#E3A92E', '#DC859E', '#3C6CA0', '#FBF4E2'];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = Math.random() * 9 + 4;
    ps.push({ x: innerWidth / 2, y: innerHeight * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5,
      g: 0.22, s: Math.random() * 7 + 3, rot: Math.random() * 6.28, vr: (Math.random() - .5) * .5,
      c: COLORS[i % COLORS.length], life: 1 });
  }
  let raf;
  (function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ps.forEach(p => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= .008;
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.c;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); ctx.restore(); });
    ctx.globalAlpha = 1;
    if (ps.some(p => p.life > 0 && p.y < canvas.height + 40)) raf = requestAnimationFrame(loop);
  })();
}

export function el(id) { return document.getElementById(id); }
