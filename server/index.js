// أركيدو — سيرفر الوقت الفعلي (Express + Socket.IO)
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';

import { MillionaireGame, Phase } from './millionaire.js';
import { millionaireBank } from './qbank.js';
import { getProgress, saveProgress, recordAnswer, stats } from './progress.js';
import { TaifGame } from './taif.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// بنك بطاقات طيف (أقطاب متضادة) — يُحمَّل مرة واحدة
const taifCards = JSON.parse(
  readFileSync(join(__dirname, '../data/spectrums-taif.json'), 'utf8')
);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(join(__dirname, '../public')));

// فحص صحّة للاستضافة (Render/Railway)
app.get('/healthz', (_req, res) => res.json({ ok: true, sessions: sessions.size }));

// رمز جلسة قصير سهل القراءة
const newCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

/** @type {Map<string, Session>} */
const sessions = new Map();

// طيف: من يحقّ له تحريك/تثبيت المؤشر؟ الفريق الأساسي عدا الوسيط — إلا إن كان
// الوسيط هو اللاعب الوحيد في فريقه (يصبح قائداً أيضاً، تفادياً للجمود).
function canMoveNeedle(session, team, socketId) {
  const g = session.game;
  if (team !== g.activeTeam) return false;
  if (socketId !== g.mediumId) return true;
  return (session.players[g.activeTeam]?.length || 0) <= 1;
}

// صفحات اللاعب/المضيف الحيّة لكل لعبة (لتوليد الباركودات الصحيحة)
const PAGES = {
  millionaire: { host: 'host.html', play: 'play.html' },
  taif:        { host: 'taif-host.html', play: 'taif-play.html' }
};

class Session {
  constructor(code, gameType = 'millionaire') {
    this.code = code;
    this.gameType = PAGES[gameType] ? gameType : 'millionaire';

    if (this.gameType === 'taif') {
      this.game = new TaifGame({ cards: taifCards, rounds: 6 });
    } else {
      // مُعرّف ثابت لا يعتمد على رمز الجلسة، لتستمر الذاكرة بين الجلسات
      this.playerId = 'guest';
      const progress = getProgress(this.playerId, 'millionaire');
      this.game = new MillionaireGame({
        bank: millionaireBank,
        progress,
        onAnswer: (qid, correct) => recordAnswer(this.playerId, 'millionaire', qid, correct),
        onRoundSelected: (p) => saveProgress(this.playerId, 'millionaire', p)
      });
    }

    this.hostId = null;
    this.tvIds = new Set();
    // معرّفات مقابس اللاعبين بترتيب الانضمام (لتعيين أدوار طيف)
    this.players = { green: [], red: [] };
    this.mediumPtr = { green: 0, red: 0 }; // دوران دور الوسيط
    this.timer = null;
    this.timeLeft = this.game.timerSeconds;
  }

  room() { return `s:${this.code}`; }
  teamRoom(team) { return `s:${this.code}:${team}`; }

  // طيف: يعيّن وسيط الجولة من لاعبي الفريق الأساسي (دور دائري)
  assignMedium() {
    if (this.gameType !== 'taif') return;
    const t = this.game.activeTeam;
    const list = this.players[t] || [];
    if (!list.length) { this.game.mediumId = null; return; }
    const idx = this.mediumPtr[t] % list.length;
    this.game.mediumId = list[idx];
    this.mediumPtr[t]++;
  }

  // بثّ الحالة. في المليونير: المضيف يرى الإجابة. في طيف: الوسيط يرى الهدف.
  broadcast(io) {
    if (this.gameType === 'taif') {
      const pub = this.game.snapshot({ forMedium: false });
      io.to(this.hostId || '').emit('state', pub);          // المضيف محايد: لا يرى الهدف
      this.tvIds.forEach(id => io.to(id).emit('state', pub));
      // كل لاعب على حدة: الوسيط فقط يرى الهدف
      for (const team of ['green', 'red']) {
        for (const id of this.players[team]) {
          const forMedium = id === this.game.mediumId;
          io.to(id).emit('state', forMedium ? this.game.snapshot({ forMedium: true }) : pub);
        }
      }
    } else {
      io.to(this.hostId || '').emit('state', this.game.snapshot({ forHost: true }));
      const pub = this.game.snapshot({ forHost: false });
      this.tvIds.forEach(id => io.to(id).emit('state', pub));
      io.to(this.teamRoom('green')).emit('state', pub);
      io.to(this.teamRoom('red')).emit('state', pub);
    }
    io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
  }

  startTimer(io, onExpire) {
    this.stopTimer();
    this.timeLeft = this.game.timerSeconds;
    io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
    this.timer = setInterval(() => {
      this.timeLeft--;
      io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
      if (this.timeLeft <= 0) { this.stopTimer(); if (onExpire) onExpire(); }
    }, 1000);
  }

  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

io.on('connection', (socket) => {
  let mySession = null;
  let myRole = null;   // 'host' | 'tv' | 'player'
  let myTeam = null;   // 'green' | 'red'

  // شاشة التلفزيون تنشئ جلسة جديدة (تحدّد نوع اللعبة)
  socket.on('tv:create', async (opts, cb) => {
    const code = newCode();
    const gameType = opts?.game === 'taif' ? 'taif' : 'millionaire';
    const session = new Session(code, gameType);
    sessions.set(code, session);

    mySession = session; myRole = 'tv';
    session.tvIds.add(socket.id);
    socket.join(session.room());

    const base = opts?.origin || '';
    const pages = PAGES[gameType];
    const qr = {
      host: await QRCode.toDataURL(`${base}/${pages.host}?s=${code}`, { margin: 1, width: 240 }),
      green: await QRCode.toDataURL(`${base}/${pages.play}?s=${code}&t=green`, { margin: 1, width: 240 }),
      red: await QRCode.toDataURL(`${base}/${pages.play}?s=${code}&t=red`, { margin: 1, width: 240 })
    };
    cb?.({ ok: true, code, game: gameType, qr });
    session.broadcast(io);
  });

  // شاشة التلفزيون تنضم لجلسة قائمة (إعادة اتصال أو شاشة ثانية)
  socket.on('tv:join', ({ code }, cb) => {
    const session = sessions.get(code);
    if (!session) return cb?.({ ok: false, error: 'جلسة غير موجودة' });
    mySession = session; myRole = 'tv';
    session.tvIds.add(socket.id);
    socket.join(session.room());
    cb?.({ ok: true, code, game: session.gameType });
    session.broadcast(io);
  });

  // المضيف يلتحق بجلسة أنشأتها شاشة التلفزيون (بمسح باركوده الخاص)
  socket.on('host:claim', ({ code }, cb) => {
    const session = sessions.get(code);
    if (!session) return cb?.({ ok: false, error: 'جلسة غير موجودة' });
    if (session.hostId) return cb?.({ ok: false, error: 'يوجد مضيف لهذه الجلسة بالفعل' });
    mySession = session; myRole = 'host';
    session.hostId = socket.id;
    socket.join(session.room());
    // إحصاء ذاكرة اللاعب خاص بالمليونير فقط
    const memory = session.gameType === 'millionaire'
      ? stats(session.playerId, 'millionaire', millionaireBank.size)
      : null;
    cb?.({ ok: true, code: session.code, game: session.gameType, memory });
    session.broadcast(io);
  });

  // لاعب ينضم لفريق
  socket.on('player:join', ({ code, team }, cb) => {
    const session = sessions.get(code);
    if (!session) return cb?.({ ok: false, error: 'جلسة غير موجودة' });
    if (team !== 'green' && team !== 'red') return cb?.({ ok: false, error: 'فريق غير صحيح' });
    mySession = session; myRole = 'player'; myTeam = team;
    socket.join(session.room());
    socket.join(session.teamRoom(team));
    session.players[team].push(socket.id);
    session.game.teams[team].players++;
    cb?.({ ok: true, code, team, game: session.gameType, teamName: session.game.teams[team].name });
    session.broadcast(io);
  });

  // ── أحداث "من سيربح الجائزة" ──────────────────────────────────────────

  socket.on('host:start', (opts) => {
    if (myRole !== 'host' || !mySession || mySession.gameType !== 'millionaire') return;
    const g = mySession.game;
    if (opts?.prizeMode) g.prizeMode = opts.prizeMode;
    if (opts?.prizeCap) g.prizeCap = opts.prizeCap;
    if (opts?.teamSize) g.teamSize = opts.teamSize;
    if (g.start()) {
      mySession.startTimer(io);
      mySession.broadcast(io);
    }
  });

  socket.on('player:buzz', () => {
    if (myRole !== 'player' || !mySession || mySession.gameType !== 'millionaire') return;
    if (mySession.game.buzz(myTeam)) {
      mySession.stopTimer();
      mySession.broadcast(io);
      io.to(mySession.room()).emit('buzz', { team: myTeam });
    }
  });

  socket.on('host:judge', ({ correct, steal }) => {
    if (myRole !== 'host' || !mySession || mySession.gameType !== 'millionaire') return;
    const g = mySession.game;
    if (correct) {
      const r = g.judgeCorrect();
      if (r) io.to(mySession.room()).emit('result', { type: 'correct', ...r });
    } else {
      const r = g.judgeWrong({ steal });
      if (r?.result === 'stolen') {
        io.to(mySession.room()).emit('result', { type: 'stolen', team: r.stealTeam });
      } else {
        io.to(mySession.room()).emit('result', { type: 'burned' });
      }
    }
    mySession.broadcast(io);
  });

  socket.on('host:next', () => {
    if (myRole !== 'host' || !mySession || mySession.gameType !== 'millionaire') return;
    mySession.game.nextQuestion();
    if (mySession.game.phase === Phase.QUESTION) mySession.startTimer(io);
    else mySession.stopTimer();
    mySession.broadcast(io);
  });

  // ── أحداث "طيف" ───────────────────────────────────────────────────────

  // المضيف يبدأ اللعبة
  socket.on('taif:start', (opts) => {
    if (myRole !== 'host' || !mySession || mySession.gameType !== 'taif') return;
    const g = mySession.game;
    if (opts?.rounds) g.totalRounds = Number(opts.rounds);
    if (g.start()) {
      mySession.assignMedium();
      mySession.broadcast(io);
    }
  });

  // الوسيط يرسل التلميح → يبدأ مؤقّت النقاش (قفل تلقائي عند انتهائه)
  socket.on('taif:clue', ({ text }) => {
    if (myRole !== 'player' || !mySession || mySession.gameType !== 'taif') return;
    const g = mySession.game;
    if (socket.id !== g.mediumId) return; // الوسيط فقط
    if (g.submitClue(text)) {
      mySession.startTimer(io, () => { if (g.lockNeedle()) mySession.broadcast(io); });
      mySession.broadcast(io);
    }
  });

  // القائد يحرّك المؤشر (مباشر) — حدث خفيف بلا لقطة كاملة
  socket.on('taif:needle', ({ pos }) => {
    if (myRole !== 'player' || !mySession || mySession.gameType !== 'taif') return;
    const g = mySession.game;
    if (!canMoveNeedle(mySession, myTeam, socket.id)) return;
    if (g.moveNeedle(pos)) io.to(mySession.room()).emit('taif:needle', { needle: g.needle });
  });

  // القائد يثبّت الإجابة
  socket.on('taif:lock', () => {
    if (myRole !== 'player' || !mySession || mySession.gameType !== 'taif') return;
    const g = mySession.game;
    if (!canMoveNeedle(mySession, myTeam, socket.id)) return;
    if (g.lockNeedle()) { mySession.stopTimer(); mySession.broadcast(io); }
  });

  // الخصم يخمّن اتجاه الهدف
  socket.on('taif:guess', ({ dir }) => {
    if (myRole !== 'player' || !mySession || mySession.gameType !== 'taif') return;
    const g = mySession.game;
    const oppTeam = g.activeTeam === 'green' ? 'red' : 'green';
    if (myTeam !== oppTeam) return; // الخصم فقط
    const r = g.submitGuess(dir);
    if (r) {
      mySession.stopTimer();
      io.to(mySession.room()).emit('taif:result', r);
      mySession.broadcast(io);
    }
  });

  // المضيف ينتقل للجولة التالية
  socket.on('taif:next', () => {
    if (myRole !== 'host' || !mySession || mySession.gameType !== 'taif') return;
    mySession.game.nextRound();
    mySession.assignMedium();
    mySession.stopTimer();
    mySession.broadcast(io);
  });

  // ── مشترك ────────────────────────────────────────────────────────────

  socket.on('host:timer', ({ action }) => {
    if (myRole !== 'host' || !mySession) return;
    if (action === 'stop') mySession.stopTimer();
    if (action === 'start') mySession.startTimer(io);
  });

  socket.on('disconnect', () => {
    if (!mySession) return;
    if (myRole === 'tv') mySession.tvIds.delete(socket.id);
    if (myRole === 'player' && myTeam) {
      mySession.game.teams[myTeam].players = Math.max(0, mySession.game.teams[myTeam].players - 1);
      const list = mySession.players[myTeam];
      const i = list.indexOf(socket.id);
      if (i !== -1) list.splice(i, 1);
      // طيف: لو انفصل الوسيط أثناء جولته، أعِد تعيين وسيط
      if (mySession.gameType === 'taif' && socket.id === mySession.game.mediumId) {
        mySession.assignMedium();
      }
    }
    if (myRole === 'host') {
      mySession.stopTimer();
      io.to(mySession.room()).emit('session:ended');
      sessions.delete(mySession.code);
      return;
    }
    mySession.broadcast(io);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🎮 أركيدو يعمل على http://localhost:${PORT}`);
  console.log(`   المضيف:    http://localhost:${PORT}/host.html`);
  console.log(`   التلفزيون: http://localhost:${PORT}/tv.html`);
});
