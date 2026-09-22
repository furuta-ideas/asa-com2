/* Asa-Com2 画面テスト（Playwright）
   実際に指の軌跡を再現して、書く→読む→濁点→「。」で確定→ジグザグ削除までを通しで確認する。

     npm i -D playwright
     node test/e2e.test.js [chromiumの実行ファイルパス]

   Playwright が入っていない環境ではスキップする（認識エンジン本体の検証は
   recognize.test.js が担当するので、そちらだけでも十分に回せる）。 */
'use strict';
const path = require('path');
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('Playwright が無いのでスキップします（npm i -D playwright）'); process.exit(0); }
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const EXEC = process.argv[2] || process.env.CHROMIUM_PATH || undefined;

/* テンプレート座標(0-100) → キャンバス上の実座標へ */
function place(strokes, box, size, ox, oy) {
  return strokes.map(f => {
    const p = [];
    for (let i = 0; i < f.length; i += 2)
      p.push({ x: box.x + ox + f[i] / 100 * size, y: box.y + oy + f[i + 1] / 100 * size });
    return p;
  });
}
async function draw(page, strokes) {
  for (const st of strokes) {
    await page.mouse.move(st[0].x, st[0].y);
    await page.mouse.down();
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      for (let k = 1; k <= 6; k++)
        await page.mouse.move(a.x + (b.x - a.x) * k / 6, a.y + (b.y - a.y) * k / 6);
    }
    await page.mouse.up();
    await page.waitForTimeout(90);   // 画と画の間（書き足し待ち 400ms より短い）
  }
  await page.waitForTimeout(1200);   // 確定待ち（「。」は長め）
}
const row = page => page.$$eval('#cells .cell .ch', els => els.map(e => e.textContent).join(''));

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const spoken = [];
  await page.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'Kyoko', lang: 'ja-JP', voiceURI: 'kyoko' }],
      speak: u => window.__spoken.push(u.text),
      cancel: () => {}, onvoiceschanged: null
    }});
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  await page.goto(FILE);
  await page.click('#start');
  await page.waitForTimeout(500);

  const box = await page.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  console.log('canvas', Math.round(box.w) + '×' + Math.round(box.h));
  const S = Math.min(box.w, box.h) * 0.55;    // 字の大きさ
  const OX = box.w * 0.2, OY = box.h * 0.15;

  const T = {
    カ: [[18,26, 70,26, 70,58, 56,84, 38,92],[46,10, 38,46, 24,92]],
    ハ: [[38,18, 16,88],[58,22, 84,88]],
    ヘ: [[16,64, 48,30, 86,72]],
    ン: [[18,24, 36,34],[20,74, 46,86, 74,60, 82,30]],
    '7': [[18,18, 82,18, 44,92]]
  };
  let ng = 0;
  const expect = (name, got, want) => {
    const ok = got === want;
    if (!ok) ng++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  期待:${want} / 実際:${got}`}`);
  };

  // 1. カ を書く
  await draw(page, place(T.カ, box, S, OX, OY));
  expect('「カ」を書いて認識される', await row(page), 'カ');

  // 2. 濁点（小さな2点）を続けて書く → ガ
  const d = (dx, dy, s) => [[{ x: box.x + OX + dx, y: box.y + OY + dy }, { x: box.x + OX + dx + s * .5, y: box.y + OY + dy + s }],
                            [{ x: box.x + OX + dx + s * 1.3, y: box.y + OY + dy }, { x: box.x + OX + dx + s * 1.8, y: box.y + OY + dy + s }]];
  await draw(page, d(S * 1.1, S * 0.1, S * 0.12));
  expect('続けて「゛」を書くと濁音になる', await row(page), 'ガ');

  // 3. ハ → 小さい丸（半濁点）→ パ
  await draw(page, place(T.ハ, box, S, OX, OY));
  expect('「ハ」を書いて認識される', await row(page), 'ガハ');
  const circ = (cx, cy, r) => { const p = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2; p.push({ x: box.x + OX + cx + Math.cos(a) * r, y: box.y + OY + cy + Math.sin(a) * r }); } return [p]; };
  await draw(page, circ(S * 1.2, S * 0.2, S * 0.1));
  expect('「ハ」のあとの小さな丸は半濁点になる', await row(page), 'ガパ');

  // 4. もう一度丸 → 半濁点を取り消して「。」＝文の確定
  await draw(page, circ(S * 1.2, S * 0.2, S * 0.1));
  const logText = await page.$$eval('.logItem .b', e => e.map(x => x.textContent));
  expect('もう一度丸を書くと半濁点を戻して文が確定する', logText.join('|'), 'ガハ。');
  expect('確定後、入力中の行は空になる', await row(page), '');

  // 5. ン を書いて、ジグザグで消す
  await draw(page, place(T.ン, box, S, OX, OY));
  expect('「ン」を書いて認識される', await row(page), 'ン');
  const zig = [];
  { const y0 = box.y + box.h * 0.35, x0 = box.x + box.w * 0.15, w = box.w * 0.6, h = box.h * 0.3;
    for (let i = 0; i <= 5; i++) { const x = x0 + (i % 2 ? w : 0), y = y0 + h * i / 5;
      const pv = zig.length ? zig[zig.length - 1] : { x: x0, y: y0 };
      for (let k = 1; k <= 8; k++) zig.push({ x: pv.x + (x - pv.x) * k / 8, y: pv.y + (y - pv.y) * k / 8 }); } }
  await draw(page, [zig]);
  expect('ジグザグで1文字消える', await row(page), '');

  // 6. 認識できない走り書き
  /* どの字にも当てはまらない走り書き（5画）*/
  const scribble = [];
  for (let i = 0; i < 5; i++) {
    const x = box.x + box.w * (0.2 + i * 0.12), y = box.y + box.h * 0.3;
    scribble.push([{ x: x, y: y }, { x: x + 40, y: y + 120 }, { x: x - 20, y: y + 180 }]);
  }
  await page.evaluate(() => { window.__spoken.length = 0; });
  await draw(page, scribble);
  const sp = await page.evaluate(() => window.__spoken);
  console.log('  走り書き後の発話:', JSON.stringify(sp));
  expect('読めないときは「認識できません。」と言う', sp.includes('認識できません。'), true);


  if (errors.length) { console.log('\n⚠ JSエラー:'); errors.forEach(e => console.log('   ' + e)); }
  console.log(ng === 0 && errors.length === 0 ? '\n✅ E2E すべて合格' : `\n❌ ${ng} 件失敗 / JSエラー ${errors.length} 件`);
  await browser.close();
  process.exit(ng === 0 && errors.length === 0 ? 0 : 1);
})();
