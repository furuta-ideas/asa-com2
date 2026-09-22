#!/usr/bin/env node
/* リリース前に index.html の更新日時（BUILD）を今の日本時間に書き換える。
     node tools/stamp.js            … 現在時刻を入れる
     node tools/stamp.js "2026-09-22 16:20" … 指定した時刻を入れる
   画面のヘッダーと起動画面に「更新 YYYY-MM-DD HH:MM」として表示される。 */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const arg = process.argv[2];
function nowJst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);   // 日本時間
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
const stamp = arg || nowJst();
if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)) {
  console.error('日時は "YYYY-MM-DD HH:MM" の形式で指定してください');
  process.exit(1);
}
const src = fs.readFileSync(file, 'utf8');
const re = /var BUILD='[^']*';\s*\/\* ==BUILD== \*\//;
if (!re.test(src)) { console.error('index.html に BUILD の行が見つかりません'); process.exit(1); }
fs.writeFileSync(file, src.replace(re, `var BUILD='${stamp}';  /* ==BUILD== */`));
console.log(`更新日時を ${stamp}（日本時間）にしました`);
