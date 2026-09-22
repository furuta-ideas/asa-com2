#!/usr/bin/env node
/* Asa-Com2 画面サイズのテスト（Playwright）
   iPad mini や iPhone で、右のログ欄・操作ボタンが画面の外に出ないことを確かめる。

     node test/layout.test.js [chromiumの実行ファイルパス]
*/
'use strict';
const path = require('path');
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('Playwright が無いのでスキップします（npm i -D playwright）'); process.exit(0); }
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const EXEC = process.argv[2] || process.env.CHROMIUM_PATH || undefined;
let fails = 0;
const SIZES = [
  ['iPad 10.9 横', 1180, 820], ['iPad mini 横', 1133, 744], ['iPad mini 縦', 744, 1133],
  ['iPhone 15 横', 852, 393], ['iPhone 15 縦', 393, 852], ['iPhone SE 横', 667, 375]
];
console.log('\n[画面サイズ] ログ欄と操作ボタンが画面内におさまるか');
(async () => {
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  for (const [name, w, h] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name:'Kyoko', lang:'ja-JP', voiceURI:'k' }], speak(){}, cancel(){}, resume(){},
        paused:false, speaking:false, pending:false, onvoiceschanged:null }});
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    });
    await p.goto(FILE);
    await p.click('#start');
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => {
      const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x:Math.round(b.x), y:Math.round(b.y), w:Math.round(b.width), h:Math.round(b.height), right:Math.round(b.right), bottom:Math.round(b.bottom) }; };
      return {
        vw: innerWidth, vh: innerHeight,
        scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
        side: box(document.getElementById('side')),
        ctrl: box(document.getElementById('ctrl')),
        keys: box(document.getElementById('keys')),
        pad: box(document.getElementById('padWrap'))
      };
    });
    const off = [];
    if (r.scrollW > r.vw + 1) off.push(`横にはみ出し(${r.scrollW}>${r.vw})`);
    if (r.ctrl && r.ctrl.bottom > r.vh + 1) off.push(`操作ボタンが下に出る(${r.ctrl.bottom}>${r.vh})`);
    if (r.side && r.side.right > r.vw + 1) off.push(`ログ欄が右に出る(${r.side.right}>${r.vw})`);
    if (r.keys && r.ctrl && r.keys.bottom > r.ctrl.y + 1) off.push('介助者用ボタンと操作ボタンが重なる');
    if (r.ctrl && r.ctrl.h < 40) off.push(`操作ボタンが潰れている(h=${r.ctrl.h})`);
    if (r.pad && r.pad.h < 120) off.push(`書く面が狭すぎる(h=${r.pad.h})`);
    if (off.length) fails++;
    console.log(`  ${off.length ? '✗' : '✓'} ${name.padEnd(12)} ${w}x${h}  ${off.length ? off.join(' / ') : 'おさまっている'}`);
    await p.close();
  }
  await b.close();
  console.log(`\n${fails === 0 ? '✅ すべての画面サイズでおさまっている' : '❌ ' + fails + ' 件 はみ出し'}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
