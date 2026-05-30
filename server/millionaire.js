// أركيدو — محرّك لعبة "من سيربح الجائزة"
// آلة حالة خالصة: لا تعرف شيئاً عن الشبكة، تُختبر بسهولة.

import { millionaireBank } from './qbank.js';

// مراحل اللعبة
export const Phase = {
  LOBBY: 'lobby',       // انتظار انضمام الفرق
  QUESTION: 'question', // السؤال معروض، بانتظار Buzz
  BUZZED: 'buzzed',     // فريق ضغط، بانتظار حكم المضيف
  STOLEN: 'stolen',     // الفريق الثاني يسرق
  REVEAL: 'reveal',     // كُشفت الإجابة
  OVER: 'over'          // انتهت اللعبة
};

export class MillionaireGame {
  constructor(opts = {}) {
    this.prizeMode = opts.prizeMode || 'eidiya';   // eidiya | gift
    this.prizeCap = opts.prizeCap ?? 100;          // سقف العيدية بالريال
    this.timerSeconds = opts.timerSeconds ?? 12;

    // ذاكرة اللاعب (التقدّم) ودوال الحفظ تُحقن من الشبكة.
    // progress = { seen:Set, wrong:Set } · onAnswer(qid, correct) للتسجيل الدائم.
    this.bank = opts.bank || millionaireBank;
    this.progress = opts.progress || { seen: new Set(), wrong: new Set() };
    this.onAnswer = opts.onAnswer || (() => {});
    this.onRoundSelected = opts.onRoundSelected || (() => {});

    this.teams = {
      green: { name: 'الفريق الأخضر', score: 0, players: 0 },
      red: { name: 'الفريق الأحمر', score: 0, players: 0 }
    };

    this.phase = Phase.LOBBY;
    this.deck = [];            // تُملأ عند البدء من بنك الأسئلة الذكي
    this.index = -1;
    this.current = null;
    this.buzzedBy = null;      // 'green' | 'red'
    this.lockedTeams = {};     // فرق مُنعت من الـ Buzz لهذا السؤال
    this.totalQuestions = 0;   // يُحدّد حسب أكبر فريق عند البدء
    this.lastResult = null;    // 'correct' | 'wrong' | 'burned'
    this.recycled = false;     // هل بدأت إعادة تدوير البنك لهذا اللاعب؟
  }

  start() {
    if (this.phase !== Phase.LOBBY) return false;
    // آلة حاسبة + توزيع متساوٍ + ذاكرة (لا تكرار) عبر بنك الأسئلة الذكي
    const maxPlayers = Math.max(this.teams.green.players, this.teams.red.players, 1);
    const { questions, recycledCats } = this.bank.selectRound(this.progress, maxPlayers);
    this.deck = questions;
    this.totalQuestions = questions.length;
    this.recycled = recycledCats.length > 0;
    this.onRoundSelected(this.progress);   // احفظ "المرئي" المحدّث
    return this.nextQuestion();
  }

  nextQuestion() {
    this.index++;
    if (this.index >= this.totalQuestions || this.index >= this.deck.length) {
      this.phase = Phase.OVER;
      this.current = null;
      return true;
    }
    this.current = this.deck[this.index];
    this.phase = Phase.QUESTION;
    this.buzzedBy = null;
    this.lockedTeams = {};
    this.lastResult = null;
    return true;
  }

  // ضغط فريق على الـ Buzz — الأسرع فقط يُقبل
  buzz(team) {
    if (this.phase !== Phase.QUESTION && this.phase !== Phase.STOLEN) return false;
    if (this.lockedTeams[team]) return false;
    if (this.buzzedBy) return false; // وصل أحد قبلك
    this.buzzedBy = team;
    this.phase = Phase.BUZZED;
    return true;
  }

  // حكم المضيف: صح
  judgeCorrect() {
    if (this.phase !== Phase.BUZZED) return false;
    const team = this.buzzedBy;
    const reward = this._reward();
    this.teams[team].score += reward;
    this.lastResult = 'correct';
    this.phase = Phase.REVEAL;
    // ثبتت في الذاكرة → تخرج من قائمة المراجعة
    if (this.current) this.onAnswer(this.current.id, true);
    return { team, reward };
  }

  // حكم المضيف: خطأ — مع خيار الانتقال أو الحرق
  judgeWrong({ steal = true } = {}) {
    if (this.phase !== Phase.BUZZED) return false;
    const wrongTeam = this.buzzedBy;
    this.lockedTeams[wrongTeam] = true;
    const other = wrongTeam === 'green' ? 'red' : 'green';

    if (steal && !this.lockedTeams[other]) {
      // الفريق الثاني يسرق
      this.buzzedBy = null;
      this.phase = Phase.STOLEN;
      this.lastResult = 'wrong';
      return { result: 'stolen', stealTeam: other };
    }
    // لا أحد يكسب — السؤال يحترق → ما ثبت في رأس أحد، يدخل قائمة المراجعة
    this.lastResult = 'burned';
    this.phase = Phase.REVEAL;
    if (this.current) this.onAnswer(this.current.id, false);
    return { result: 'burned' };
  }

  // إيقاف/استئناف ليس جزءاً من الحالة المنطقية (العدّاد يُدار في الشبكة)

  _reward() {
    if (this.prizeMode === 'gift') return 1; // صندوق واحد
    // عيدية: مبلغ عشوائي ضمن السقف، يميل للأعلى مع تقدّم الأسئلة
    const base = Math.round(this.prizeCap / this.totalQuestions);
    const jitter = Math.round((Math.random() * 0.6 + 0.7) * base);
    return Math.max(1, Math.min(jitter, this.prizeCap));
  }

  get winner() {
    if (this.phase !== Phase.OVER) return null;
    const g = this.teams.green.score, r = this.teams.red.score;
    if (g === r) return 'tie';
    return g > r ? 'green' : 'red';
  }

  // اللقطة التي تُرسل للعملاء (التلفزيون/المضيف). المضيف يرى الإجابة.
  snapshot({ forHost = false } = {}) {
    const base = {
      phase: this.phase,
      teams: this.teams,
      prizeMode: this.prizeMode,
      prizeCap: this.prizeCap,
      questionNumber: this.index + 1,
      totalQuestions: this.totalQuestions,
      buzzedBy: this.buzzedBy,
      lockedTeams: this.lockedTeams,
      lastResult: this.lastResult,
      winner: this.winner
    };
    if (this.current) {
      base.question = {
        cat: this.current.cat,
        q: this.current.q,
        options: this.current.options,
        // الإجابة تُكشف للمضيف دائماً، وللجميع عند REVEAL
        answer: (forHost || this.phase === Phase.REVEAL) ? this.current.answer : null
      };
    }
    return base;
  }
}
