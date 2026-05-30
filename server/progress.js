// أركيدو — ذاكرة تقدّم اللاعب (تخزين دائم على القرص)
// يخزّن لكل مُعرّف لاعب: الأسئلة المرئية + الأسئلة المُجاب عنها خطأً.
// المُعرّف الآن = License Key (أو مُعرّف مؤقت). يُستبدل بقاعدة بيانات لاحقاً.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const STORE = join(DATA_DIR, 'progress.json');

function load() {
  try { return JSON.parse(readFileSync(STORE, 'utf-8')); }
  catch { return {}; }
}

let db = load();        // { [playerId]: { [game]: { seen:[], wrong:[] } } }
let saveTimer = null;

function persist() {
  // كتابة مؤجّلة (debounce) لتقليل I/O
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(STORE, JSON.stringify(db), 'utf-8');
    } catch (e) { console.error('progress persist failed:', e.message); }
  }, 400);
}

/** يعيد تقدّم اللاعب للعبة معيّنة كـ Sets قابلة للتعديل */
export function getProgress(playerId, game = 'millionaire') {
  const rec = ((db[playerId] ??= {})[game] ??= { seen: [], wrong: [] });
  return {
    seen: new Set(rec.seen),
    wrong: new Set(rec.wrong),
    _rec: rec
  };
}

/** يحفظ تقدّم اللاعب بعد جولة (يكتب الـ Sets للقرص) */
export function saveProgress(playerId, game, progress) {
  const rec = ((db[playerId] ??= {})[game] ??= { seen: [], wrong: [] });
  rec.seen = [...progress.seen];
  rec.wrong = [...progress.wrong];
  persist();
}

/** يسجّل نتيجة سؤال: صحيح يزيل من الخطأ، خاطئ يضيف للخطأ */
export function recordAnswer(playerId, game, qid, correct) {
  const p = getProgress(playerId, game);
  p.seen.add(qid);
  if (correct) p.wrong.delete(qid);   // ثبتت → اخرج من قائمة المراجعة
  else p.wrong.add(qid);              // ما ثبتت → ادخل قائمة المراجعة
  saveProgress(playerId, game, p);
}

/** إحصاء سريع لتقدّم اللاعب */
export function stats(playerId, game, bankSize) {
  const p = getProgress(playerId, game);
  return {
    seen: p.seen.size,
    wrong: p.wrong.size,
    remaining: Math.max(0, bankSize - p.seen.size),
    bankSize,
    completed: p.seen.size >= bankSize
  };
}

/** إعادة تعيين (لأغراض الاختبار) */
export function _reset(playerId) { delete db[playerId]; persist(); }
export function _flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } try { writeFileSync(STORE, JSON.stringify(db), 'utf-8'); } catch {} }
