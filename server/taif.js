// أركيدو — محرّك لعبة "طيف" (مقتبسة من Wavelength)
// آلة حالة خالصة: لا تعرف شيئاً عن الشبكة، تُختبر بسهولة.
//
// الفكرة: هدف سرّي على طيف بين قطبين. الوسيط (لاعب من الفريق الأساسي) يرى
// الهدف ويعطي تلميحاً. قائد الفريق الأساسي يحرّك المؤشر نحو التخمين. الفريق
// الخصم يعترض: يخمّن إن كان الهدف يمين المؤشر أم يساره. ثم تُكشف النتيجة.

export const Phase = {
  LOBBY: 'lobby',         // انتظار انضمام الفرق
  CLUE: 'clue',           // الوسيط يرى الهدف ويكتب التلميح
  GUESS: 'guess',         // القائد يحرّك المؤشر (مباشر) ثم يثبّت
  INTERCEPT: 'intercept', // الخصم يخمّن اتجاه الهدف من المؤشر
  REVEAL: 'reveal',       // كُشف الهدف وحُسبت النقاط
  OVER: 'over'            // انتهت اللعبة
};

// نطاق دقّة التهديف (المسافة بين المؤشر والهدف على مقياس 0-100)
const BANDS = [
  { within: 5,  points: 4 }, // إصابة المركز
  { within: 12, points: 3 },
  { within: 20, points: 2 }
];

export class TaifGame {
  constructor(opts = {}) {
    this.cards = (opts.cards && opts.cards.length) ? opts.cards : [{ left: 'بارد', right: 'حار' }];
    this.totalRounds = opts.rounds ?? 6;   // إجمالي الجولات (تنقلب الأدوار كل جولة)
    this.timerSeconds = opts.timerSeconds ?? 45; // مؤقّت نقاش الفريق (يديره المضيف)

    this.teams = {
      green: { name: 'الفريق الأخضر', score: 0, players: 0 },
      red: { name: 'الفريق الأحمر', score: 0, players: 0 }
    };

    this.phase = Phase.LOBBY;
    this.round = 0;            // رقم الجولة الحالية (1-based عند البدء)
    this.activeTeam = null;    // الفريق صاحب الوسيط والقائد
    this.mediumId = null;      // معرّف مقبس الوسيط (يحدّده طرف الشبكة، قيمة معتمة هنا)
    this.target = null;        // الهدف السرّي 0-100
    this.card = null;          // { left, right }
    this.clue = '';            // تلميح الوسيط
    this.needle = 50;          // موضع مؤشر القائد 0-100
    this.locked = false;       // هل ثبّت القائد إجابته؟
    this.guess = null;         // تخمين الخصم: 'left' | 'right'
    this.lastScore = null;     // { activeTeam, activePts, oppTeam, oppPts, distance }

    this._deck = [];           // بطاقات مخلوطة لتجنّب التكرار داخل الجلسة
  }

  start({ rounds } = {}) {
    if (this.phase !== Phase.LOBBY) return false;
    if (rounds) this.totalRounds = rounds;
    this.round = 0;
    this.activeTeam = null;
    this._deck = shuffle([...this.cards]);
    return this.nextRound();
  }

  nextRound() {
    this.round++;
    if (this.round > this.totalRounds) {
      this.phase = Phase.OVER;
      this.card = null;
      this.target = null;
      return true;
    }
    // تنقلب الأدوار: الأخضر يبدأ، ثم يتبادلان
    this.activeTeam = this.activeTeam === 'green' ? 'red' : 'green';
    this.target = randInt(8, 92);          // نتجنّب الأطراف القصوى قليلاً
    if (!this._deck.length) this._deck = shuffle([...this.cards]);
    this.card = this._deck.pop();
    this.clue = '';
    this.needle = 50;
    this.locked = false;
    this.guess = null;
    this.lastScore = null;
    this.mediumId = null;      // يعيّنه طرف الشبكة لهذه الجولة
    this.phase = Phase.CLUE;
    return true;
  }

  // الوسيط يرسل تلميحه → ينتقل للتخمين
  submitClue(text) {
    if (this.phase !== Phase.CLUE) return false;
    const t = String(text || '').trim();
    if (!t) return false;
    this.clue = t.slice(0, 60);
    this.phase = Phase.GUESS;
    return true;
  }

  // القائد يحرّك المؤشر (مباشر، بلا تغيير مرحلة)
  moveNeedle(pos) {
    if (this.phase !== Phase.GUESS) return false;
    this.needle = clamp(Number(pos), 0, 100);
    return true;
  }

  // القائد يثبّت → ينتقل لاعتراض الخصم
  lockNeedle() {
    if (this.phase !== Phase.GUESS) return false;
    this.locked = true;
    this.phase = Phase.INTERCEPT;
    return true;
  }

  // الخصم يخمّن جهة الهدف من المؤشر → الكشف والتهديف
  submitGuess(dir) {
    if (this.phase !== Phase.INTERCEPT) return false;
    if (dir !== 'left' && dir !== 'right') return false;
    this.guess = dir;

    const distance = Math.abs(this.needle - this.target);
    let activePts = 0;
    for (const b of BANDS) { if (distance <= b.within) { activePts = b.points; break; } }

    // اتجاه الهدف الحقيقي بالنسبة للمؤشر (left = الهدف أصغر، أي ناحية القطب الأيسر)
    const realDir = this.target < this.needle ? 'left' : 'right';
    const oppTeam = this.activeTeam === 'green' ? 'red' : 'green';
    // الخصم يكسب نقطة الاعتراض فقط إن لم يُصب الأساسي المركز تماماً
    const oppPts = (dir === realDir && activePts < 4) ? 1 : 0;

    this.teams[this.activeTeam].score += activePts;
    this.teams[oppTeam].score += oppPts;
    this.lastScore = { activeTeam: this.activeTeam, activePts, oppTeam, oppPts, distance, realDir };
    this.phase = Phase.REVEAL;
    return this.lastScore;
  }

  get winner() {
    if (this.phase !== Phase.OVER) return null;
    const g = this.teams.green.score, r = this.teams.red.score;
    if (g === r) return 'tie';
    return g > r ? 'green' : 'red';
  }

  // اللقطة التي تُرسل للعملاء. الهدف سرّي: يظهر للوسيط فقط، وللجميع عند الكشف.
  snapshot({ forMedium = false } = {}) {
    const revealed = this.phase === Phase.REVEAL || this.phase === Phase.OVER;
    return {
      game: 'taif',
      phase: this.phase,
      teams: this.teams,
      round: this.round,
      totalRounds: this.totalRounds,
      activeTeam: this.activeTeam,
      card: this.card,
      clue: this.clue,
      needle: this.needle,
      locked: this.locked,
      guess: this.guess,
      // الهدف يُكشف للوسيط أثناء جولته، وللجميع عند الكشف
      target: (forMedium || revealed) ? this.target : null,
      lastScore: this.lastScore,
      winner: this.winner
    };
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo)); }
