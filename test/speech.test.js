#!/usr/bin/env node
/* Asa-Com2 音声の解錠テスト（Playwright）
   ------------------------------------------------------------------
   iPadOS Safari は「ユーザー操作の中で、実際に音の出る発話を1回」行うまで
   音声合成を鳴らさない。その振る舞いを再現した偽エンジンを差し込み、

     ・起動画面をタッチしただけで挨拶が鳴ること
     ・そのあと（タイマー経由で確定する）文字の発音も鳴ること
     ・解錠に失敗しても、次に画面へ触れたときに立て直せること

   を確認する。実機で「発話ON/OFFを切り替えるまで声が出ない」不具合の再発防止。

     npm i -D playwright
     node test/speech.test.js [chromiumの実行ファイルパス]
   ------------------------------------------------------------------ */
'use strict';
const path = require('path');
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('Playwright が無いのでスキップします（npm i -D playwright）'); process.exit(0); }
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const EXEC = process.argv[2] || process.env.CHROMIUM_PATH || undefined;

/* iPadOS を模した音声合成エンジン。
   allowUnlock=false にすると「操作の中で発話しても解錠されない」端末を再現する。 */
function iosSpeechStub(allowUnlock) {
  window.__spoken = [];      // 実際に鳴った文
  window.__dropped = [];     // 鳴らずに捨てられた文
  let unlocked = false;
  const api = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [
      { name: 'Kyoko', lang: 'ja-JP', voiceURI: 'kyoko' },
      { name: 'Otoya', lang: 'ja-JP', voiceURI: 'otoya' }
    ],
    speak(u) {
      const gesture = !!(navigator.userActivation && navigator.userActivation.isActive);
      const audible = String(u.text || '').trim().length > 0 && (u.volume === undefined || u.volume > 0);
      if (!unlocked) {
        if (window.__allowUnlock && gesture && audible) unlocked = true;
        else { window.__dropped.push(u.text); return; }   // iOS はここで黙って捨てる
      }
      window.__spoken.push(u.text);
      api.speaking = true;
      if (u.onstart) setTimeout(() => u.onstart(), 0);
      setTimeout(() => { api.speaking = false; if (u.onend) u.onend(); }, 10);
    },
    cancel() { api.speaking = false; api.pending = false; },
    resume() { api.paused = false; },
    pause() { api.paused = true; },
    onvoiceschanged: null
  };
  window.__allowUnlock = allowUnlock;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: api });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.volume = 1; };
}

/* テンプレートの座標(0-100) → 実座標 */
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
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(900);
}
const KA = [[18, 26, 70, 26, 70, 58, 56, 84, 38, 92], [46, 10, 38, 46, 24, 92]];

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { fails++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});

  /* --- 1. ふつうの iPad：起動タッチだけで声が出るようになる --- */
  {
    console.log('\n[1] 起動画面をタッチしただけで声が出る');
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.addInitScript(iosSpeechStub, true);
    await page.goto(FILE);
    await page.click('#start');
    await page.waitForTimeout(300);
    let spoken = await page.evaluate(() => window.__spoken);
    check('起動の挨拶が鳴る', spoken.some(t => t.indexOf('じゅんび') >= 0), JSON.stringify(spoken));

    const box = await page.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const S = Math.min(box.w, box.h) * 0.5;
    await draw(page, place(KA, box, S, box.w * 0.2, box.h * 0.15));
    spoken = await page.evaluate(() => window.__spoken);
    check('そのあと書いた文字も発音される', spoken.indexOf('カ') >= 0, JSON.stringify(spoken));
    check('捨てられた発話が無い', (await page.evaluate(() => window.__dropped)).length === 0);
    await page.close();
  }

  /* --- 2. 起動時の解錠に失敗した端末：次に画面へ触れたときに立て直す --- */
  {
    console.log('\n[2] 起動時に解錠できなくても、書き始めれば声が出る');
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.addInitScript(iosSpeechStub, false);   // 起動タッチでは解錠しない端末
    await page.goto(FILE);
    await page.click('#start');
    await page.waitForTimeout(300);
    check('この時点では声が出ていない', (await page.evaluate(() => window.__spoken)).length === 0);

    await page.evaluate(() => { window.__allowUnlock = true; });  // 以降の操作では解錠できる
    const box = await page.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const S = Math.min(box.w, box.h) * 0.5;
    await draw(page, place(KA, box, S, box.w * 0.2, box.h * 0.15));
    const spoken = await page.evaluate(() => window.__spoken);
    check('書いた文字が発音される（ON/OFFの切り替え不要）', spoken.indexOf('カ') >= 0, JSON.stringify(spoken));
    await page.close();
  }

  /* --- 3. 一時停止で詰まった状態からの復帰 --- */
  {
    console.log('\n[3] 音声が一時停止で詰まっても復帰する');
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.addInitScript(iosSpeechStub, true);
    await page.goto(FILE);
    await page.click('#start');
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.speechSynthesis.pause(); window.__spoken.length = 0; });
    const box = await page.$eval('#pad', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const S = Math.min(box.w, box.h) * 0.5;
    await draw(page, place(KA, box, S, box.w * 0.2, box.h * 0.15));
    const spoken = await page.evaluate(() => window.__spoken);
    check('一時停止を解除して発音される', spoken.indexOf('カ') >= 0, JSON.stringify(spoken));
    await page.close();
  }

  await browser.close();
  console.log(`\n${fails === 0 ? '✅ すべて合格' : '❌ ' + fails + ' 件 失敗'}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
