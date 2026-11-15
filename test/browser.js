'use strict';
// Minimal Chromium DevTools client. Uses only Node.js 22+ built-ins.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
module.exports = async function browser() {
  const executable = process.env.CHROMIUM_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find(p => fs.existsSync(p));
  if (!executable) throw new Error('Set CHROMIUM_PATH to a Chrome/Edge/Chromium executable.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'asacom2-test-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir='+profile, 'about:blank'], {windowsHide:true,stdio:'ignore'});
  let socket;
  try {
    const endpoint = path.join(profile, 'DevToolsActivePort');
    for(let i=0;!fs.existsSync(endpoint)&&i<150;i++) await delay(100);
    const port=fs.readFileSync(endpoint,'utf8').split('\n')[0];
    const pages=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    let id=0;const pending=new Map();
    socket.onmessage=event=>{const message=JSON.parse(event.data);if(!message.id)return;const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);if(message.error)p.reject(new Error(JSON.stringify(message.error)));else p.resolve(message.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},10000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await send('Page.enable');await send('Runtime.enable');
    return {send,evaluate,delay,async close(){socket.close();child.kill();if(path.dirname(path.resolve(profile))!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('asacom2-test-'))throw new Error('Unexpected test profile path');for(let i=0;i<30;i++){try{fs.rmSync(profile,{recursive:true,force:true});break;}catch{await delay(100);}}}};
  } catch(e) {if(socket)socket.close();child.kill();throw e;}
};
