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
  await page.waitForTimeout(1800);   // 確定待ち（書き足し待ち1000ms＋記号の判定）
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
  const buildOnStart = await page.$eval('#buildStart', e => e.textContent).catch(() => '');
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

  // 0. 更新日時（どの版が動いているか分かるように出している）
  {
    const start = buildOnStart;
    const head = await page.$eval('#build', e => e.textContent).catch(() => '');
    const ok = /^更新 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(head) && head === start;
    expect('ヘッダーと起動画面に更新日時が出る', ok ? 'ok' : `head=${head} start=${start}`, 'ok');
  }

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
  /* どの字にも当てはまらない走り書き（格子のもつれ）
     既定（いちばん近い字にする＝ON）では、必ずどれかの字に寄せる */
  const scribble = [
    [{ x: .20, y: .20 }, { x: .80, y: .80 }],
    [{ x: .80, y: .20 }, { x: .20, y: .80 }],
    [{ x: .20, y: .50 }, { x: .80, y: .50 }],
    [{ x: .50, y: .20 }, { x: .50, y: .80 }]
  ].map(st => st.map(p => ({ x: box.x + box.w * p.x, y: box.y + box.h * p.y })));
  await page.evaluate(() => { window.__spoken.length = 0; });
  await draw(page, scribble);
  const sp = await page.evaluate(() => window.__spoken);
  console.log('  走り書き後の発話:', JSON.stringify(sp));
  expect('読めない筆跡でも「認識できません」と言わず何かに寄せる',
    sp.length > 0 && !sp.includes('認識できません。'), true);

  /* 覚えさせる：候補ボタンで直すと、その筆跡を覚えて次から正しく読む */
  {
    const p3 = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await p3.addInitScript(() => {
      window.__spoken = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name: 'Kyoko', lang: 'ja-JP', voiceURI: 'kyoko' }],
        speak: u => window.__spoken.push(u.text),
        cancel: () => {}, resume: () => {}, paused: false, speaking: false, pending: false, onvoiceschanged: null
      }});
      window.SpeechSynthesisUtterance = function (t) { this.text = t; this.volume = 1; };
      try { localStorage.removeItem('asacom2.ink'); } catch (e) {}
    });
    await p3.goto(FILE);
    await p3.click('#start');
    await p3.waitForTimeout(300);
    const b3 = await p3.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const S3 = Math.min(b3.w, b3.h) * 0.5, OX3 = b3.w * 0.2, OY3 = b3.h * 0.15;
    /* 「ア」を書いて、候補ボタンで別の字に直す（＝直した字として覚えさせる） */
    const A = [[15, 26, 85, 26], [72, 14, 73, 40, 62, 64, 40, 82, 18, 92]];
    await draw(p3, place(A, b3, S3, OX3, OY3));
    const chips = await p3.$$('#cands .chip');
    if (chips.length) {
      const target = await chips[0].evaluate(e => e.textContent.trim().charAt(0));
      await chips[0].click();
      await p3.waitForTimeout(200);
      const learned = await p3.evaluate(() => {
        try { const o = JSON.parse(localStorage.getItem('asacom2.ink') || '{}'); return (o && o.ink) || {}; }
        catch (e) { return {}; }
      });
      expect('候補ボタンで直すと、その筆跡を覚える', Object.keys(learned).includes(target) ? 'ok' : `覚えた字=${JSON.stringify(Object.keys(learned))} 直した字=${target}`, 'ok');
      /* 同じ筆跡をもう一度書くと、覚えた字が選ばれる */
      await p3.evaluate(() => { window.__spoken.length = 0; });
      await draw(p3, place(A, b3, S3, OX3, OY3));
      const row2 = await p3.$$eval('#cells .cell .ch', els => els.map(e => e.textContent));
      expect('覚えた字が次の認識に効く', row2[row2.length - 1] === target ? 'ok' : `結果=${row2[row2.length - 1]} 期待=${target}`, 'ok');
    } else {
      expect('候補ボタンが出る', 'なし', 'あり');
    }
    await p3.close();
  }

  /* ひらがな：既定（カタカナとひらがなの両方）で「か」を書いて濁点をつけると「が」になる。
     「カタカナだけ」に設定すると、同じ筆跡がカタカナとして読まれる。 */
  {
    const KA_H = [[20,26, 44,25, 68,24, 68,44, 62,64, 50,82, 34,92],
                  [44,10, 38,30, 32,56, 22,92],
                  [82,28, 88,50]];
    async function writeKa(settings) {
      const pg = await browser.newPage({ viewport: { width: 1180, height: 820 } });
      await pg.addInitScript(st => {
        window.__spoken = [];
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
          getVoices: () => [{ name: 'Kyoko', lang: 'ja-JP', voiceURI: 'kyoko' }],
          speak: u => window.__spoken.push(u.text),
          cancel: () => {}, resume: () => {}, paused: false, speaking: false, pending: false, onvoiceschanged: null
        }});
        window.SpeechSynthesisUtterance = function (t) { this.text = t; this.volume = 1; };
        try {
          localStorage.removeItem('asacom2.ink');
          if (st) localStorage.setItem('asacom2.settings', JSON.stringify(st));
          else localStorage.removeItem('asacom2.settings');
        } catch (e) {}
      }, settings);
      await pg.goto(FILE);
      await pg.click('#start');
      await pg.waitForTimeout(300);
      const bx = await pg.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const sz = Math.min(bx.w, bx.h) * 0.55, ox = bx.w * 0.2, oy = bx.h * 0.15;
      await draw(pg, place(KA_H, bx, sz, ox, oy));
      return { pg, bx, sz, ox, oy };
    }

    const hira = await writeKa(null);
    expect('既定の設定でひらがな「か」が書ける', await row(hira.pg), 'か');
    const dk = (dx, dy, s, bx, ox, oy) =>
      [[{ x: bx.x + ox + dx, y: bx.y + oy + dy }, { x: bx.x + ox + dx + s * .5, y: bx.y + oy + dy + s }],
       [{ x: bx.x + ox + dx + s * 1.3, y: bx.y + oy + dy }, { x: bx.x + ox + dx + s * 1.8, y: bx.y + oy + dy + s }]];
    await draw(hira.pg, dk(hira.sz * 1.1, hira.sz * 0.1, hira.sz * 0.12, hira.bx, hira.ox, hira.oy));
    expect('ひらがなにも濁点がつく（か＋゛→が）', await row(hira.pg), 'が');
    /* トップ画面の案内も設定に合わせて変わる */
    const gtext = await hira.pg.$eval('#gKanaText', e => e.textContent).catch(() => '');
    expect('案内が「カタカナとひらがな」になっている', /カタカナとひらがな/.test(gtext) ? 'ok' : gtext, 'ok');
    await hira.pg.close();

    const kata = await writeKa({ kanaMode: 'kata' });
    const got = await row(kata.pg);
    const isHira = ch => ch >= '\u3041' && ch <= '\u3096';
    /* ひらがなの「か」は3画。カタカナだけの設定では3画の該当字が無いので、
       「カ」で確定して3画目が別の字になることがある。ここで確かめたいのは
       「ひらがなが出ないこと」なので、文字数は問わない。 */
    expect('「カタカナだけ」にすると ひらがなにはならない',
      got.length > 0 && ![...got].some(isHira) ? 'ok' : `結果=${got}`, 'ok');
    const gtext2 = await kata.pg.$eval('#gKanaText', e => e.textContent).catch(() => '');
    expect('案内が「カタカナのみ」になっている', /カタカナのみ/.test(gtext2) ? 'ok' : gtext2, 'ok');
    await kata.pg.close();
  }

  /* 設定で OFF（＋読み取りを「きびしい」）にすると、これまでどおり「認識できません」と言う */
  {
    const p2 = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await p2.addInitScript(() => {
      window.__spoken = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name: 'Kyoko', lang: 'ja-JP', voiceURI: 'kyoko' }],
        speak: u => window.__spoken.push(u.text),
        cancel: () => {}, resume: () => {}, paused: false, speaking: false, pending: false, onvoiceschanged: null
      }});
      window.SpeechSynthesisUtterance = function (t) { this.text = t; this.volume = 1; };
      try { localStorage.setItem('asacom2.settings',
        JSON.stringify({ alwaysGuess: false, strictness: 'strict' })); } catch (e) {}
    });
    await p2.goto(FILE);
    await p2.click('#start');
    await p2.waitForTimeout(300);
    const b2 = await p2.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const sc2 = [
      [{ x: .20, y: .20 }, { x: .80, y: .80 }], [{ x: .80, y: .20 }, { x: .20, y: .80 }],
      [{ x: .20, y: .50 }, { x: .80, y: .50 }], [{ x: .50, y: .20 }, { x: .50, y: .80 }]
    ].map(st => st.map(p => ({ x: b2.x + b2.w * p.x, y: b2.y + b2.h * p.y })));
    await p2.evaluate(() => { window.__spoken.length = 0; });
    await draw(p2, sc2);
    const sp2 = await p2.evaluate(() => window.__spoken);
    console.log('  （設定OFF時）走り書き後の発話:', JSON.stringify(sp2));
    expect('設定を OFF（＋きびしい）にすると「認識できません」と言う', sp2.includes('認識できません。'), true);
    await p2.close();
  }

  if (errors.length) { console.log('\n⚠ JSエラー:'); errors.forEach(e => console.log('   ' + e)); }
  console.log(ng === 0 && errors.length === 0 ? '\n✅ E2E すべて合格' : `\n❌ ${ng} 件失敗 / JSエラー ${errors.length} 件`);
  await browser.close();
  process.exit(ng === 0 && errors.length === 0 ? 0 : 1);
})();
