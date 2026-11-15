'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const browser=require('./browser');
const FILE=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
(async()=>{
  const b=await browser();let count=0;
  const pass=name=>{count++;console.log('✓ '+name);};
  const js=b.evaluate;
  const click=id=>js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const records=()=>js("JSON.parse(localStorage.getItem('asacom2.log')||'[]')");
  async function load(){
    await b.send('Page.navigate',{url:FILE});
    for(let i=0;i<100;i++){if(await js("!!document.getElementById('confirmInk') && document.getElementById('build').textContent.length>0"))break;await b.delay(30);}
    await click('start');await b.delay(80);
  }
  async function stroke(points){
    const r=await js("(()=>{const r=document.getElementById('pad').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
    const xy=p=>({x:r.x+p[0]*r.w,y:r.y+p[1]*r.h});
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...xy(points[0]),button:'left',clickCount:1});
    for(const p of points.slice(1))await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...xy(p),button:'left',buttons:1});
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...xy(points.at(-1)),button:'left',clickCount:1});
  }
  try{
    await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.testSpeech=[];Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(u){window.testSpeech.push(u.text);}}});window.SpeechSynthesisUtterance=function(text){this.text=text;};window.pageErrors=[];window.addEventListener('error',e=>pageErrors.push(e.message));`});
    await b.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:2,mobile:false});
    await load();await js("localStorage.clear()");await load();
    assert.equal(await js("document.getElementById('confirmInk').disabled"),true);pass('空欄の確定は無効');
    const guides=await js("(()=>{const el=document.getElementById('padWrap');return [getComputedStyle(el,'::before').borderLeftStyle,getComputedStyle(el,'::after').borderTopStyle,getComputedStyle(el,'::before').pointerEvents];})()");assert.deepEqual(guides,['dashed','dashed','none']);pass('入力面の縦横ガイドが表示され、筆跡操作を妨げない');
    const shape=[[.1,.1],[.3,.1],[.3,.3],[.1,.3],[.1,.1]];
    await stroke(shape);await stroke([[.5,.1],[.7,.2],[.5,.3],[.7,.4],[.5,.5]]);await stroke([[.1,.7],[.8,.7]]);
    await b.delay(1600);
    assert.equal((await records()).length,0);assert.equal(await js("document.getElementById('confirmInk').disabled"),false);
    assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);
    assert.deepEqual(await js('window.testSpeech'),['じゅんびが できました。いちもじずつ かいて ください。']);pass('丸・ジグザグ・横線を変換せず、待ち時間で一文字として上段へ追加');
    await stroke(shape);await b.delay(150);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);
    await stroke([[.5,.1],[.5,.3]]);await b.delay(150);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);
    await b.delay(350);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),2);assert.equal((await records()).length,0);pass('書き足しで400ms待ちを延長し、次の文字を上段に順番に追加');
    await click('confirmInk');let log=await records();
    assert.equal(log.length,1);assert.equal(log[0].type,'handwriting-sentence');assert.equal(log[0].characters.length,2);assert.equal(log[0].characters[0].strokes.length,3);assert.equal(log[0].characters[1].strokes.length,2);assert.ok(log[0].characters[0].bounds.height>200);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),0);pass('確定ボタンは文章全体を右側へ移し、上段をクリア');
    const shown=await js("[...document.querySelectorAll('.logItem polyline')].map(e=>e.getAttribute('points'))");
    assert.deepEqual(shown,log[0].characters.flatMap(c=>c.strokes.map(s=>s.points.map(p=>p.x+','+p.y).join(' '))));pass('右ペインは文章内の文字の順序・筆跡を維持');
    assert.equal(await js("document.getElementById('confirmInk').disabled"),true);await click('confirmInk');assert.equal((await records()).length,1);
    await load();assert.deepEqual(await records(),log);assert.equal(await js("document.querySelectorAll('.logItem svg').length"),2);pass('再読み込みで復元、空の二重確定は増えない');
    await stroke([[.1,.1],[.2,.2]]);await stroke([[.3,.3],[.4,.4]]);await click('undoInk');await click('confirmInk');assert.equal((await records())[1].characters[0].strokes.length,1);pass('待ち時間内の確定ボタンも最後の文字を含めて文章にする');
    await stroke([[.2,.2],[.3,.3]]);await click('clearInk');assert.equal(await js("document.getElementById('confirmInk').disabled"),true);assert.equal((await records()).length,2);pass('一画もどす・書き直すは未確定の筆跡だけを変更');
    await stroke([[.1,.1],[.9,.8]]);
    await js("window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');}");
    await click('confirmInk');assert.equal(await js("document.getElementById('confirmInk').disabled"),false);assert.equal((await records()).length,2);assert.match(await js("document.getElementById('status').textContent"),/保存できません/);
    assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);
    await js('Storage.prototype.setItem=window.originalSetItem');await click('confirmInk');assert.equal((await records()).length,3);pass('保存失敗時は上段を保持、再試行で文章を記録');
    await stroke(shape);await b.delay(450);await click('deleteChar');assert.equal(await js("document.querySelectorAll('#cells .cell').length"),0);assert.equal((await records()).length,3);pass('上段の文字だけを一文字削除できる');
    await stroke(shape);await click('confirmInk');const original=(await records()).at(-1).characters[0].strokes;await stroke(shape);
    for(const [width,height] of [[744,1133],[1180,820],[744,1133],[1180,820]]){await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});await b.delay(80);}
    await click('confirmInk');assert.deepEqual((await records()).at(-1).characters[0].strokes,original);pass('画面回転を繰り返しても元の筆跡を保持');
    await js("{const first=JSON.parse(localStorage.getItem('asacom2.log'))[3];first.characters=Array.from({length:30},()=>first.characters[0]);localStorage.setItem('asacom2.log',JSON.stringify([first]));}");await load();
    let wrapped=false;
    for(const [name,width,height] of [['iPad',1180,820],['mini',1133,744],['mini portrait',744,1133],['iPhone',393,852],['iPhone landscape',852,393],['SE landscape',667,375]]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});await b.delay(80);
      const r=await js("(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};return {pad:box('pad'),log:box('log'),confirm:box('confirmInk'),scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('.sentenceInk svg')].map(e=>{const r=e.getBoundingClientRect();return {y:r.y,right:r.right};})};})()");
      assert.ok(r.pad.h>=120,JSON.stringify({name,r}));assert.ok(r.confirm.bottom<=height+1);assert.ok(r.confirm.right<=width+1);assert.ok(r.scroll<=width+1);assert.ok(r.items.every(i=>i.right<=r.log.right+1));if(new Set(r.items.map(i=>Math.round(i.y))).size>1)wrapped=true;pass('確定ボタン・右ペイン・折り返し: '+name);
    }
    assert.ok(wrapped);assert.equal(await js("document.querySelectorAll('.logItem svg').length"),30);
    // A very wide confirmation and a multiline one must both fit without cropping.
    await stroke([[.01,.2],[.99,.2]]);await click('confirmInk');
    const fits=await js("(()=>{const s=document.querySelector('.logItem:last-child svg');return s.getBoundingClientRect().right<=document.getElementById('log').getBoundingClientRect().right;})()");assert.ok(fits);pass('長い一行の筆跡も切らずに表示');
    await js("{const raw=JSON.parse(localStorage.getItem('asacom2.log'))[0].characters[0];raw.date='2026-11-15';localStorage.setItem('asacom2.log',JSON.stringify([{type:'text',date:'2026-10-05',time:'12:00',text:'<img src=x onerror=alert(1)>旧記録'},raw]));}");await load();assert.equal(await js("document.querySelectorAll('.logItem img').length"),0);assert.match(await js("document.querySelector('.logItem').textContent"),/旧記録/);assert.equal(await js("document.querySelectorAll('.logItem svg').length"),1);pass('旧テキスト記録と前回の手書き記録を引き継ぐ');
    await click('gear');assert.equal(await js("document.getElementById('sheet').hidden"),false);assert.doesNotMatch(await js("document.getElementById('sheet').textContent"),/候補|早く確定|読み取る文字/);
    await click('highContrast');assert.equal(await js("document.body.classList.contains('hc')"),true);await click('closeSheet');pass('認識用設定を除去、ハイコントラストを維持');
    await b.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    const padBox=await js("(()=>{const r=document.getElementById('pad').getBoundingClientRect();return {x:r.x+30,y:r.y+30};})()");
    await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...padBox,id:1}]});
    await b.delay(450);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),0);assert.equal(await js("document.getElementById('confirmInk').disabled"),true);
    await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:padBox.x+40,y:padBox.y+40,id:1}]});
    await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await b.delay(450);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);await click('confirmInk');assert.equal((await records()).at(-1).characters[0].strokes.length,1);pass('タッチ操作で文字の自動確定と文章確定');
    await js("localStorage.setItem('asacom2.log','broken-json')");await load();await stroke(shape);await click('confirmInk');
    assert.equal(await js("localStorage.getItem('asacom2.log')"),'broken-json');assert.equal(await js("document.getElementById('confirmInk').disabled"),false);pass('読めない旧データを上書きしない');
    await js("localStorage.setItem('asacom2.log','[]')");await load();
    await click('gear');await js("document.getElementById('strokeGapMs').value='800';document.getElementById('strokeGapMs').dispatchEvent(new Event('change'));document.getElementById('guideLines').value='none';document.getElementById('guideLines').dispatchEvent(new Event('change'));");assert.equal(await js("getComputedStyle(document.getElementById('padWrap'),'::before').display"),'none');await click('closeSheet');
    await stroke(shape);await b.delay(500);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),0);await b.delay(400);assert.equal(await js("document.querySelectorAll('#cells .cell').length"),1);await click('confirmInk');pass('書き足し待ち時間とガイドを設定から変更できる');
    await js("localStorage.setItem('asacom2.manual.settings','{}');localStorage.setItem('asacom2.settings',JSON.stringify({strokeGapMs:600}))");await load();assert.equal(await js("document.getElementById('strokeGapMs').value"),'600');pass('旧版の書き足し待ち時間設定を引き継ぐ');
    assert.deepEqual(await js('window.pageErrors'),[]);
    const source=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');assert.doesNotMatch(source,/Recog|CNN|recognize|recognise|fetch\(/);pass('認識エンジン・外部通信なし、実行エラーなし');
    if(process.env.SCREENSHOT_PATH){await b.send('Emulation.setDeviceMetricsOverride',{width:1180,height:820,deviceScaleFactor:1,mobile:false});await b.delay(80);await click('gear');await click('highContrast');await click('closeSheet');await stroke(shape);await click('confirmInk');const shot=await b.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.SCREENSHOT_PATH,Buffer.from(shot.data,'base64'));}
    console.log('\n'+count+' checks passed.');
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
