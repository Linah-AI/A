/* أركيدو — تفاعلات بسيطة للواجهات التجريبية (بدون سيرفر) */

/* مولّد نمط شبيه بالـ QR (زخرفي فقط — لأغراض المعاينة) */
function makeQR(el, seed = 1) {
  const N = 11;
  let rng = seed * 9301 + 49297;
  const rand = () => ((rng = (rng * 9301 + 49297) % 233280) / 233280);
  let cells = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const corner = (x < 3 && y < 3) || (x > N - 4 && y < 3) || (x < 3 && y > N - 4);
      const on = corner ? ((x === 0 || x === N - 1 || y === 0 || y === N - 1 || (x > 0 && x < 2 && y > 0 && y < 2)) ? 1 : (rand() > .7 ? 0 : 0)) : (rand() > .5 ? 1 : 0);
      // ارسم مربعات الزوايا بشكل ثابت
      if (corner) {
        const lx = x % (N - 3), ly = y % (N - 3);
        const px = x < 3 ? x : x - (N - 3);
        const py = y < 3 ? y : y - (N - 3);
        const fill = (px === 0 || px === 2 || py === 0 || py === 2 || (px === 1 && py === 1)) ? 1 : 0;
        if (fill) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        continue;
      }
      if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" fill="#0e1418">${cells}</svg>`;
}

document.querySelectorAll('[data-qr]').forEach((el, i) => makeQR(el, Number(el.dataset.qr) || i + 1));

/* عدّاد دائري تجريبي */
document.querySelectorAll('[data-timer]').forEach(ring => {
  let v = Number(ring.dataset.timer) || 12;
  const total = v;
  const span = ring.querySelector('span');
  const tick = () => {
    const pct = (v / total) * 100;
    ring.style.setProperty('--val', pct);
    if (span) span.textContent = v;
    ring.classList.toggle('danger', v <= 5);
    if (v > 0) v--; else v = total;
  };
  tick();
  setInterval(tick, 1000);
});

/* وميض Buzz عند الضغط على أزرار التجربة */
window.flashBuzz = function (color) {
  let f = document.querySelector('.buzz-flash.' + color);
  if (!f) {
    f = document.createElement('div');
    f.className = 'buzz-flash ' + color;
    document.body.appendChild(f);
  }
  f.animate(
    [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }],
    { duration: 700, easing: 'ease-out' }
  );
};

/* محرّك مؤشر طيف التجريبي */
document.querySelectorAll('[data-spectrum]').forEach(slider => {
  const needle = document.querySelector(slider.dataset.spectrum);
  if (!needle) return;
  const update = () => {
    const deg = (slider.value / 100) * 160 - 80;
    needle.style.transform = `rotate(${deg}deg)`;
  };
  slider.addEventListener('input', update);
  update();
});
