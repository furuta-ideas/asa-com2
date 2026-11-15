'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
assert.doesNotMatch(html,/Recog|CNN|recognize|recognise/);
assert.match(html,/id="confirmInk"/);
assert.match(html,/type:'handwriting'/);
console.log('✓ Recognition removed; manual handwriting confirmation enabled.');
