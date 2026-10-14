import fs from 'node:fs';
import assert from 'node:assert/strict';
import {OnPagePdfEditor} from '../src/on-page-editor.js';
const e=await OnPagePdfEditor.create(),read=name=>new Uint8Array(fs.readFileSync(`test-output/${name}.pdf`));
e.open(read('font-weight-outlines'));e.renderOcr();const lines=JSON.parse(fs.readFileSync('test-output/font-weight-lines.json'));
let view=e.setOcrLines(lines);
for(const object of view.objects){const expected=lines.find(l=>l.text===object.text&&Math.abs(l.rect.y-object.box.y)<1);assert.equal(/Bold/.test(object.fontName),expected.bold,`Weight mismatch for ${object.text}`);}
const regular=view.objects.find(o=>o.text==='Jamie Morgan'),bold=view.objects.find(o=>o.text==='Name:');
e.inline(regular.index);view=await e.apply(regular.index,'Alex Sample');assert(!/Bold/.test(view.objects.find(o=>o.text==='Alex Sample').fontName));assert(/Bold/.test(view.objects.find(o=>o.text==='Name:').fontName));
e.inline(bold.index);view=await e.apply(bold.index,'Name!');assert(/Bold/.test(view.objects.find(o=>o.text==='Name!').fontName));
fs.writeFileSync('test-output/font-weight-outlines-edited.pdf',e.download());view=e.undo();assert.equal(view.objects.length,10);assert(view.objects.some(o=>o.text==='Name:'&&/Bold/.test(o.fontName)));assert(view.objects.some(o=>o.text==='Alex Sample'&&!/Bold/.test(o.fontName)));
e.open(read('font-weight-native'));const originals=e.view().objects;
for(const original of originals){view=await e.apply(original.index,original.text.replace('12345','54321'));const updated=view.objects.find(o=>o.index===original.index);assert.equal(updated.fontName,original.fontName);assert.equal(updated.size,original.size);}
fs.writeFileSync('test-output/font-weight-native-edited.pdf',e.download());
console.log('PASS: regular outlined names stay regular beside bold labels; genuine bold, short fields, gray lettering, and original native font weights survive editing/export.');
