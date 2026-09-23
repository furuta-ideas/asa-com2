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
console.log('\n[画面サイズ・アイコン] 画面におさまるか／ホーム画面のアイコン');
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
  /* アイコン（ホーム画面に追加したときに使われる画像）が読めるか */
  {
    const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
    await p.goto(FILE);
    const res = await p.evaluate(async () => {
      const links = [...document.querySelectorAll('link[rel*="icon"]')].map(l => ({
        rel: l.getAttribute('rel'), sizes: l.getAttribute('sizes') || '', href: l.getAttribute('href')
      }));
      const load = href => new Promise(ok => {
        const im = new Image();
        im.onload = () => ok({ href, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => ok({ href, w: 0, h: 0 });
        im.src = href;
      });
      const loaded = await Promise.all(links.map(l => load(l.href)));
      const manifest = !!document.querySelector('link[rel="manifest"]');
      return { links, loaded, manifest };
    });
    const apple = res.links.filter(l => l.rel.indexOf('apple-touch-icon') >= 0);
    const bad = res.loaded.filter(x => x.w === 0);
    const sq = res.loaded.filter(x => x.w > 0 && x.w !== x.h);
    const ok180 = res.loaded.some(x => x.w === 180 && x.h === 180);
    if (apple.length === 0) { fails++; console.log('  ✗ apple-touch-icon の指定が無い'); }
    else console.log(`  ✓ apple-touch-icon ${apple.length}件（${apple.map(a => a.sizes || '既定').join(' / ')}）`);
    if (bad.length) { fails++; console.log('  ✗ 読み込めない画像: ' + bad.map(b => b.href).join(' ')); }
    else console.log('  ✓ アイコン画像がすべて読み込める');
    if (sq.length) { fails++; console.log('  ✗ 正方形でないアイコン: ' + sq.map(s => `${s.href} ${s.w}x${s.h}`).join(' ')); }
    else console.log('  ✓ すべて正方形');
    if (!ok180) { fails++; console.log('  ✗ 180x180 のアイコンが無い（iPad が使うサイズ）'); }
    else console.log('  ✓ 180x180 がある（iPad のホーム画面用）');
    if (!res.manifest) { fails++; console.log('  ✗ manifest の指定が無い'); }
    else console.log('  ✓ manifest がある');
    await p.close();
  }

  await b.close();
  console.log(`\n${fails === 0 ? '✅ すべての画面サイズでおさまっている' : '❌ ' + fails + ' 件 はみ出し'}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
