import fs from 'node:fs';
import assert from 'node:assert/strict';
import {OnPagePdfEditor} from '../src/on-page-editor.js';
const e=await OnPagePdfEditor.create();
e.open(new Uint8Array(fs.readFileSync('test-output/font-style-outlines.pdf')));e.renderOcr();
const lines=JSON.parse(fs.readFileSync('test-output/font-style-lines.json'));
let view=e.setOcrLines(lines);
for(const object of view.objects){const expected=lines.find(l=>l.text===object.text&&Math.abs(l.rect.y-object.box.y)<1);assert.equal(/Italic|Oblique/.test(object.fontName),expected.italic,`Style mismatch for ${object.text}`);}
const upright=view.objects.find(o=>o.text==='11'&&o.box.y<200),italic=view.objects.find(o=>o.text==='11'&&o.box.y>200);
e.inline(upright.index);view=await e.apply(upright.index,'12');assert(!/Italic|Oblique/.test(view.objects.find(o=>o.text==='12').fontName));
e.inline(italic.index);view=await e.apply(italic.index,'21');assert(/Italic|Oblique/.test(view.objects.find(o=>o.text==='21').fontName));
fs.writeFileSync('test-output/font-style-outlines-edited.pdf',e.download());
e.open(new Uint8Array(fs.readFileSync('test-output/font-style-native.pdf')));view=e.view();
const original=view.objects[0];assert(/Italic/.test(original.fontName));
view=await e.apply(original.index,'Italic text 54321.');assert.equal(view.objects[0].fontName,original.fontName);assert.equal(view.objects[0].size,original.size);
fs.writeFileSync('test-output/font-style-native-edited.pdf',e.download());
console.log('PASS: upright outlined fields stay upright; genuine outlined italics and original embedded italic fonts retain their style after edit and export.');
