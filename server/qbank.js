// أركيدو — محرّك بنك الأسئلة الذكي
// مسؤول عن: معرّف مستقر لكل سؤال · توزيع متساوي بين الأقسام ·
//          آلة حاسبة لعدد الأسئلة حسب اللاعبين · ذاكرة (لا تكرار) ·
//          أولوية الأسئلة الخاطئة عند إعادة التدوير.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** معرّف مستقر للسؤال من فئته ونصّه (FNV-1a hash) — لا يتغيّر بين الجلسات */
export function qid(q) {
  const s = (q.cat || '') + '|' + (q.q || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class QuestionBank {
  /** @param {string} file مسار ملف الأسئلة */
  constructor(file) {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    this.all = raw.map(q => ({ ...q, id: qid(q) }));
    // فهرسة حسب الفئة
    this.byCat = {};
    for (const q of this.all) (this.byCat[q.cat] ??= []).push(q);
    this.categories = Object.keys(this.byCat);
  }

  /** آلة حاسبة: عدد أسئلة الجولة حسب أكبر فريق — مضاعف لعدد الأقسام لضمان التوازن.
   *  القاعدة: سؤال واحد لكل لاعب من كل قسم → كل لاعب يضيف (عدد الأقسام) أسئلة.
   *  مثال (5 أقسام): لاعبان=10، 5 لاعبين=25، 10 لاعبين=50.
   *  @param maxPlayers عدد لاعبي أكبر فريق
   *  @param perCatPerPlayer كم سؤالاً يضيفه كل لاعب لكل قسم (افتراضي 1)
   *  @returns { total, perCat } */
  roundSize(maxPlayers, perCatPerPlayer = 1) {
    const cats = this.categories.length || 1;
    const players = Math.max(1, maxPlayers | 0);
    // كل قسم يأخذ عدداً = عدد اللاعبين (بحد أدنى 1)، فيبقى التوازن مضموناً
    const perCat = Math.max(1, Math.round(players * perCatPerPlayer));
    return { total: perCat * cats, perCat };
  }

  /** يختار جولة أسئلة متوازنة، بلا تكرار حسب ذاكرة اللاعب.
   *  @param progress كائن تقدّم اللاعب { seen:Set, wrong:Set }
   *  @param maxPlayers لحساب حجم الجولة
   *  @param opts { perPlayerFactor }
   *  @returns { questions, recycledCats } */
  selectRound(progress, maxPlayers, opts = {}) {
    const { perCat } = this.roundSize(maxPlayers, opts.perCatPerPlayer ?? 1);
    const seen = progress.seen;   // Set<qid>
    const wrong = progress.wrong; // Set<qid>
    const recycledCats = [];
    const chosen = [];

    for (const cat of this.categories) {
      const pool = this.byCat[cat];
      const result = this._pickFromCategory(pool, seen, wrong, perCat);
      if (result.recycled) recycledCats.push(cat);
      chosen.push(...result.picked);
    }

    // علّم المختارة كمرئية
    for (const q of chosen) seen.add(q.id);

    // اخلط ترتيب الأسئلة عبر الأقسام لكن أبقِ التوازن
    return { questions: shuffle(chosen), recycledCats };
  }

  /** يختار n أسئلة من قسم واحد: غير المرئي أولاً، فإن نفد أعاد التدوير
   *  بأولوية الأسئلة الخاطئة سابقاً. */
  _pickFromCategory(pool, seen, wrong, n) {
    const picked = [];
    let recycled = false;

    // 1) أسئلة لم تُرَ بعد (الذاكرة)
    const unseen = shuffle(pool.filter(q => !seen.has(q.id)));
    while (picked.length < n && unseen.length) picked.push(unseen.pop());

    // 2) إن لم تكفِ → دورة جديدة لهذا القسم: الأولوية للأسئلة الخاطئة
    if (picked.length < n) {
      recycled = true;
      const pickedIds = new Set(picked.map(q => q.id));
      const rest = pool.filter(q => !pickedIds.has(q.id));
      const wrongOnes = shuffle(rest.filter(q => wrong.has(q.id)));   // ما ثبتت → أولوية
      const others = shuffle(rest.filter(q => !wrong.has(q.id)));
      const ordered = [...wrongOnes, ...others];
      while (picked.length < n && ordered.length) picked.push(ordered.shift());
      // ابدأ دورة جديدة: أزل أسئلة هذا القسم من المرئي
      for (const q of pool) seen.delete(q.id);
    }
    return { picked, recycled };
  }

  get size() { return this.all.length; }
}

/** بنك "من سيربح الجائزة" الجاهز */
export const millionaireBank = new QuestionBank(
  join(__dirname, '../data/questions-millionaire.json')
);
