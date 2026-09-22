#!/usr/bin/env node
/* Asa-Com2 手書き認識エンジンの自動テスト
   ------------------------------------------------------------------
   index.html の RECOGNIZER-BEGIN / RECOGNIZER-END で囲まれたブロックを
   そのまま取り出して評価するので、アプリに載っているコードそのものを検証する。

     実行： node test/recognize.test.js [1字あたりの試行数] [ゆがみの強さ]
     例  ： node test/recognize.test.js 40 1.0
   ------------------------------------------------------------------ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = HTML.match(/\/\* ==RECOGNIZER-BEGIN==[\s\S]*?\/\* ==RECOGNIZER-END== \*\//);
if (!m) { console.error('index.html から認識エンジンのブロックが見つかりません'); process.exit(1); }
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[0] + '\n;globalThis.Recog = Recog;', sandbox);
const R = sandbox.Recog;

/* ---------- 合成筆跡（人が書いたようなゆがみを与える） ---------- */
let seed = 20260922;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rnd(a, b) { return a + rand() * (b - a); }
function toPts(flat) { const p = []; for (let i = 0; i < flat.length; i += 2) p.push({ x: flat[i], y: flat[i + 1] }); return p; }

function synth(strokes, sev) {
  const rot = rnd(-1, 1) * 6 * sev * Math.PI / 180;
  const sx = rnd(1 - 0.18 * sev, 1 + 0.18 * sev), sy = rnd(1 - 0.18 * sev, 1 + 0.18 * sev);
  const tx = rnd(-1, 1) * 20 * sev, ty = rnd(-1, 1) * 20 * sev, sh = rnd(-1, 1) * 0.12 * sev;
  const jit = 2.6 * sev, wob = rnd(0, 4) * sev, ph = rnd(0, 6.28), ph2 = rnd(0, 6.28);
  return strokes.map(st => {
    const n = Math.max(12, Math.round(rnd(18, 40))), dense = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) * (st.length - 1), i0 = Math.floor(t), i1 = Math.min(st.length - 1, i0 + 1), f = t - i0;
      dense.push({ x: st[i0].x + (st[i1].x - st[i0].x) * f, y: st[i0].y + (st[i1].y - st[i0].y) * f });
    }
    const cut0 = Math.round(rnd(0, 0.07 * sev * n)), cut1 = Math.round(rnd(0, 0.07 * sev * n));
    const cut = dense.slice(cut0, dense.length - cut1);
    const src = cut.length > 4 ? cut : dense;
    return src.map((p, i) => {
      const u = i / (src.length - 1);
      let x = p.x - 50, y = p.y - 50;
      x += Math.sin(u * 6.28 * 1.5 + ph) * wob; y += Math.sin(u * 6.28 * 1.2 + ph2) * wob;
      x += sh * y;
      const X = (x * Math.cos(rot) - y * Math.sin(rot)) * sx, Y = (x * Math.sin(rot) + y * Math.cos(rot)) * sy;
      return { x: X + 50 + tx + rnd(-jit, jit), y: Y + 50 + ty + rnd(-jit, jit) };
    });
  });
}

const TRIALS = parseInt(process.argv[2] || '40', 10);
const SEV = parseFloat(process.argv[3] || '1.0');
let fails = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { fails++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

/* ---------- 1. 自己一致 ---------- */
console.log('\n[1] すべてのテンプレートが自分自身を1位で認識する');
let selfNg = [];
for (const r of R._raw) {
  const res = R.recognize(r.s.map(toPts), {});
  if (!res.cands.length || res.cands[0].ch !== r.ch) selfNg.push(`${r.ch}→${res.cands[0] ? res.cands[0].ch : '?'}`);
}
check(`自己一致 ${R._raw.length} 件`, selfNg.length === 0, selfNg.join(' '));

/* ---------- 2. ゆがみ耐性 ---------- */
console.log(`\n[2] ゆがみ耐性（ゆがみ ${SEV} / 1字 ${TRIALS} 回）`);
const byChar = {}, conf = {};
let ok = 0, top3 = 0, tot = 0;
for (const r of R._raw) {
  for (let t = 0; t < TRIALS; t++) {
    const res = R.recognize(synth(r.s.map(toPts), SEV), {});
    const got = res.cands.length ? res.cands[0].ch : '?';
    tot++;
    if (got === r.ch) ok++;
    if (res.cands.some(c => c.ch === r.ch)) top3++;
    const key = r.ch + '#' + r.s.length;
    byChar[key] = byChar[key] || { ch: r.ch, n: 0, ok: 0 };
    byChar[key].n++; if (got === r.ch) byChar[key].ok++;
    if (got !== r.ch) conf[r.ch + '→' + got] = (conf[r.ch + '→' + got] || 0) + 1;
  }
}
const top1pct = ok / tot * 100, top3pct = top3 / tot * 100;
console.log(`  top1 ${top1pct.toFixed(1)}%   top3 ${top3pct.toFixed(1)}%   (${tot}件)`);
const bad = Object.values(byChar).filter(v => v.ok / v.n < 0.85);
if (bad.length) console.log('  正解率85%未満: ' + bad.map(b => `${b.ch}(${(b.ok / b.n * 100).toFixed(0)}%)`).join(' '));
const cf = Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (cf.length) console.log('  取り違え上位: ' + cf.map(([k, v]) => `${k}×${v}`).join('  '));
check('top1 が 95% 以上', top1pct >= 95, `${top1pct.toFixed(1)}%`);
check('top3 が 99% 以上', top3pct >= 99, `${top3pct.toFixed(1)}%`);

/* ---------- 3. 即確定の安全性 ---------- */
console.log('\n[3] 書き足しの見込み判定（1画目で確定してしまわないこと）');
for (const ch of ['メ', 'タ', 'ナ', 'ハ', 'ホ', 'ア', 'ク', 'ヌ']) {
  const raw = R._raw.find(r => r.ch === ch);
  const res = R.recognize(synth([raw.s[0]].map(toPts), 0.6), {});
  check(`${ch} の1画目は「書き足しの見込みあり」`, res.continuable === true);
}
{
  const raw = R._raw.find(r => r.ch === 'ヘ');
  const res = R.recognize(synth(raw.s.map(toPts), 0.6), {});
  check('ヘ（1画で完結）は即確定できる', res.continuable === false && res.cands[0].ch === 'ヘ');
}

/* ---------- 4. 小さな記号（濁点・半濁点・句点） ---------- */
console.log('\n[4] 小さく書かれた記号の判定');
const CELL = 600, AVG = 300;   /* マス600px・本人の字の大きさ300px を想定 */
function circle(cx, cy, r) {
  const p = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return p;
}
function seg(x1, y1, x2, y2) {
  const p = []; for (let i = 0; i <= 8; i++) p.push({ x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8 });
  return p;
}
check('小さな丸 → dot（句点／半濁点）', R.markOf([circle(300, 300, 28)], CELL, AVG) === 'dot');
check('小さな2点 → daku（濁点）',
  R.markOf([seg(300, 280, 316, 308), seg(336, 280, 352, 308)], CELL, AVG) === 'daku');
check('1画で続けて書いた濁点 → daku',
  R.markOf([[{ x: 300, y: 280 }, { x: 314, y: 306 }, { x: 330, y: 282 }, { x: 344, y: 308 }]], CELL, AVG) === 'daku');
check('ちょんと打った点 → dot', R.markOf([seg(300, 300, 306, 306)], CELL, AVG) === 'dot');
check('大きな丸（＝文字の0やロ）は記号ではない', R.markOf([circle(300, 300, 150)], CELL, AVG) === null);
check('小さく細長い線（小さめの「ー」）は記号ではない', R.markOf([seg(260, 300, 360, 302)], CELL, AVG) === null);
check('3画以上は記号ではない',
  R.markOf([seg(300, 300, 310, 310), seg(320, 300, 330, 310), seg(340, 300, 350, 310)], CELL, AVG) === null);
check('字の大きさが分からないときも小さな丸を拾える', R.markOf([circle(300, 300, 40)], CELL, 0) === 'dot');

/* ---------- 5. ジグザグ（削除） ---------- */
console.log('\n[5] ジグザグ（1文字削除）の判定');
function zig(turns, w, h, cx, cy) {
  const p = [];
  for (let i = 0; i <= turns; i++) {
    const x = cx - w / 2 + (i % 2 === 0 ? 0 : w), y = cy - h / 2 + h * (i / turns);
    const px = p.length ? p[p.length - 1] : { x: cx - w / 2, y: cy - h / 2 };
    for (let k = 1; k <= 10; k++) p.push({ x: px.x + (x - px.x) * k / 10, y: px.y + (y - px.y) * k / 10 });
  }
  return p;
}
check('大きく5回折り返したジグザグ → 削除', R.isZigzag([zig(6, 420, 180, 300, 300)], CELL, 'normal') === true);
check('3回折り返したジグザグ → 削除', R.isZigzag([zig(4, 420, 160, 300, 300)], CELL, 'normal') === true);
check('1回折り返しただけ（レ字）→ 削除ではない', R.isZigzag([zig(2, 420, 140, 300, 300)], CELL, 'normal') === false);
check('ただの横線 → 削除ではない', R.isZigzag([seg(80, 300, 520, 300)], CELL, 'normal') === false);
for (const ch of ['シ', 'ツ', 'ミ', 'サ', 'ヨ', 'ス', 'ヌ', 'ソ', 'ン', 'ヲ', 'ラ', 'ニ']) {
  const raw = R._raw.find(r => r.ch === ch);
  const ink = synth(raw.s.map(toPts), 0.8).map(st => st.map(p => ({ x: p.x * 5, y: p.y * 5 })));
  let hit = false;
  for (const st of ink) if (R.isZigzag([st], CELL, 'normal')) hit = true;
  check(`${ch} を書いても削除と誤判定しない`, !hit);
}

/* ---------- 6. 数字のON/OFF ---------- */
console.log('\n[6] 数字の設定');
{
  const seven = R._raw.find(r => r.ch === '7');
  const off = R.recognize(seven.s.map(toPts), { useDigits: false });
  check('「数字をつかう」OFF で数字が候補に出ない', off.cands.every(c => !/[0-9]/.test(c.ch)));
  const ka = R._raw.find(r => r.ch === 'カ');
  const only = R.recognize(ka.s.map(toPts), { digitsOnly: true });
  check('「数字だけモード」でカタカナが候補に出ない', only.cands.every(c => /[0-9]/.test(c.ch)));
}

/* ---------- 7. 表示用の筆跡正規化 ---------- */
console.log('\n[7] 入力中の行に出す筆跡データ');
{
  const ink = R.inkOf([seg(120, 200, 480, 260)]);
  const flat = ink[0];
  let inRange = true;
  for (const v of flat) if (v < -0.001 || v > 1.001) inRange = false;
  check('筆跡が 0〜1 に正規化される', inRange && ink.length === 1);
}

console.log(`\n${fails === 0 ? '✅ すべて合格' : '❌ ' + fails + ' 件 失敗'}\n`);
process.exit(fails === 0 ? 0 : 1);
