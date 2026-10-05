/* index.html の中の筆画テンプレートを templates.json に書き出す。
   アプリと学習データで同じテンプレートを使うため、学習の前に必ず実行する。
     node training/extract_templates.js                                   */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sb = {}; vm.createContext(sb);
vm.runInContext(
  HTML.match(/\/\* ==RECOGNIZER-BEGIN==[\s\S]*?\/\* ==RECOGNIZER-END== \*\//)[0] + ';globalThis.Recog=Recog;', sb);
const raw = sb.Recog._raw;
fs.writeFileSync(path.join(__dirname, 'templates.json'), JSON.stringify(raw, null, 0) + '\n');
const n = {};
raw.forEach(r => { n[r.kind] = (n[r.kind] || 0) + 1; });
console.log(`templates.json を更新しました：${raw.length}件`, n,
            `／ 字の種類 ${new Set(raw.map(r => r.ch)).size}`);
