// أركيدو — سيرفر الوقت الفعلي (Express + Socket.IO)
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { customAlphabet } from 'nanoid';

import { MillionaireGame, Phase } from './millionaire.js';
import { millionaireBank } from './qbank.js';
import { getProgress, saveProgress, recordAnswer, stats } from './progress.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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

class Session {
  constructor(code, opts = {}) {
    this.code = code;
    // مُعرّف اللاعب يربط الجلسة بذاكرته الدائمة (سيصير License Key لاحقاً)
    this.playerId = opts.playerId || `guest:${code}`;
    const progress = getProgress(this.playerId, 'millionaire');
    this.game = new MillionaireGame({
      prizeMode: opts.prizeMode,
      prizeCap: opts.prizeCap,
      bank: millionaireBank,
      progress,
      // يُسجّل نتيجة كل سؤال في الذاكرة الدائمة
      onAnswer: (qid, correct) => recordAnswer(this.playerId, 'millionaire', qid, correct),
      // يحفظ "المرئي" بعد اختيار جولة جديدة
      onRoundSelected: (p) => saveProgress(this.playerId, 'millionaire', p)
    });
    this.hostId = null;
    this.tvIds = new Set();
    this.timer = null;
    this.timeLeft = this.game.timerSeconds;
  }

  room() { return `s:${this.code}`; }
  teamRoom(team) { return `s:${this.code}:${team}`; }

  // بثّ الحالة: المضيف يرى الإجابة، الباقي لا
  broadcast(io) {
    io.to(this.hostId || '').emit('state', this.game.snapshot({ forHost: true }));
    // التلفزيون + اللاعبون
    const pub = this.game.snapshot({ forHost: false });
    this.tvIds.forEach(id => io.to(id).emit('state', pub));
    io.to(this.teamRoom('green')).emit('state', pub);
    io.to(this.teamRoom('red')).emit('state', pub);
    // عدّاد منفصل
    io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
  }

  startTimer(io) {
    this.stopTimer();
    this.timeLeft = this.game.timerSeconds;
    io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
    this.timer = setInterval(() => {
      this.timeLeft--;
      io.to(this.room()).emit('timer', { timeLeft: this.timeLeft });
      if (this.timeLeft <= 0) this.stopTimer();
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

  // المضيف ينشئ جلسة جديدة
  socket.on('host:create', async (opts, cb) => {
    const code = newCode();
    // playerId = License Key مستقبلاً؛ الآن مُعرّف اختياري من المضيف أو ضيف
    const session = new Session(code, {
      playerId: opts?.playerId,
      prizeMode: opts?.prizeMode,
      prizeCap: opts?.prizeCap
    });
    sessions.set(code, session);

    mySession = session; myRole = 'host';
    session.hostId = socket.id;
    socket.join(session.room());

    const base = opts?.origin || '';
    const qr = {
      green: await QRCode.toDataURL(`${base}/play.html?s=${code}&t=green`, { margin: 1, width: 240 }),
      red: await QRCode.toDataURL(`${base}/play.html?s=${code}&t=red`, { margin: 1, width: 240 })
    };
    // إحصاء ذاكرة اللاعب: كم سؤال شاهد، كم متبقٍّ، كم بحاجة مراجعة
    const mem = stats(session.playerId, 'millionaire', millionaireBank.size);
    cb?.({ ok: true, code, qr, memory: mem });
    session.broadcast(io);
  });

  // شاشة التلفزيون تنضم بالرمز
  socket.on('tv:join', ({ code }, cb) => {
    const session = sessions.get(code);
    if (!session) return cb?.({ ok: false, error: 'جلسة غير موجودة' });
    mySession = session; myRole = 'tv';
    session.tvIds.add(socket.id);
    socket.join(session.room());
    cb?.({ ok: true, code });
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
    session.game.teams[team].players++;
    cb?.({ ok: true, code, team, teamName: session.game.teams[team].name });
    session.broadcast(io);
  });

  // المضيف يبدأ اللعبة
  socket.on('host:start', () => {
    if (myRole !== 'host' || !mySession) return;
    if (mySession.game.start()) {
      mySession.startTimer(io);
      mySession.broadcast(io);
    }
  });

  // لاعب يضغط Buzz
  socket.on('player:buzz', () => {
    if (myRole !== 'player' || !mySession) return;
    if (mySession.game.buzz(myTeam)) {
      mySession.stopTimer(); // يتجمّد العدّاد
      mySession.broadcast(io);
      io.to(mySession.room()).emit('buzz', { team: myTeam });
    }
  });

  // حكم المضيف
  socket.on('host:judge', ({ correct, steal }) => {
    if (myRole !== 'host' || !mySession) return;
    const g = mySession.game;
    if (correct) {
      const r = g.judgeCorrect();
      if (r) io.to(mySession.room()).emit('result', { type: 'correct', ...r });
    } else {
      const r = g.judgeWrong({ steal });
      if (r?.result === 'stolen') {
        mySession.startTimer(io); // وقت محدود للسرقة
        io.to(mySession.room()).emit('result', { type: 'stolen', team: r.stealTeam });
      } else {
        io.to(mySession.room()).emit('result', { type: 'burned' });
      }
    }
    mySession.broadcast(io);
  });

  socket.on('host:next', () => {
    if (myRole !== 'host' || !mySession) return;
    mySession.game.nextQuestion();
    if (mySession.game.phase === Phase.QUESTION) mySession.startTimer(io);
    else mySession.stopTimer();
    mySession.broadcast(io);
  });

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
    }
    if (myRole === 'host') {
      // الجلسة تموت مع المضيف
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
