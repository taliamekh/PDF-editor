import fs from 'node:fs';
import assert from 'node:assert/strict';
import {OnPagePdfEditor} from '../src/on-page-editor.js';
import {alignedPosition,snapPosition} from '../src/alignment.js';
const e=await OnPagePdfEditor.create(),read=name=>new Uint8Array(fs.readFileSync(`test-output/${name}.pdf`));
const near=(a,b)=>assert(Math.abs(a-b)<.03,`${a} != ${b}`);
let v=e.open(read('spaced-native')),selected=v.objects.find(o=>o.text==='Alex Example'),siblings=v.objects.filter(o=>o.index!==selected.index);
const original=e.download();
v=await e.move(selected.index,selected.box.x+20,selected.box.y+60);
let moved=v.objects.find(o=>o.index===v.movedIndex);
assert.equal(moved.text,selected.text);near(moved.box.x,selected.box.x+20);near(moved.box.y,selected.box.y+60);assert.equal(moved.fontName,selected.fontName);near(moved.size,selected.size);
for(const sibling of siblings)assert.deepEqual(v.objects.find(o=>o.text===sibling.text)?.box,sibling.box);
v=await e.apply(moved.index,'Alex Sample');moved=v.objects.find(o=>o.text==='Alex Sample');
const center=alignedPosition(moved.box,{x:0,y:0,w:v.width,h:v.height},'center');v=await e.move(moved.index,center.x,center.y);moved=v.objects.find(o=>o.index===v.movedIndex);near(moved.box.x+moved.box.w/2,v.width/2);
fs.writeFileSync('test-output/alignment-native.pdf',e.download());
const saved=e.download();e.open(saved);assert(e.view().objects.some(o=>o.text==='Alex Sample'));e.open(original);
v=e.view();selected=v.objects.find(o=>o.text==='12345');const before=e.download(),save=e.e.save.bind(e.e);
e.e.save=()=>original;await assert.rejects(e.move(selected.index,selected.box.x,selected.box.y+100),/preserve|cancelled/);e.e.save=save;assert.deepEqual(e.download(),before);assert.equal(e.view().objects.length,4);
v=await e.move(selected.index,selected.box.x,selected.box.y+100);e.undo();assert.deepEqual(e.download(),before);assert.equal(e.view().objects.length,4);
await assert.rejects(e.move(selected.index,-50,10),/inside/);

e.open(read('font-style-native'));v=e.view();selected=v.objects[0];v=await e.move(selected.index,selected.box.x+25,selected.box.y+50);moved=v.objects.find(o=>o.index===v.movedIndex);assert.equal(moved.fontName,selected.fontName);near(moved.size,selected.size);

const ocr=JSON.parse(fs.readFileSync('test-output/font-style-lines.json','utf8'));
e.open(read('font-style-outlines'));e.renderOcr();v=e.setOcrLines(ocr);
selected=v.objects.find(o=>o.text==='Ref:');assert(selected);
const outlinedBefore=e.download(),pathCount=e.e.objectCount(),oldFont=selected.fontName;
v=await e.move(selected.index,selected.box.x+100,selected.box.y+100);moved=v.objects.find(o=>o.index===v.movedIndex);assert.equal(e.e.objectCount(),pathCount);assert.equal(e.objects().length,0);assert.equal(moved.fontName,oldFont);near(moved.box.x,selected.box.x+100);near(moved.box.y,selected.box.y+100);
fs.writeFileSync('test-output/alignment-outlined.pdf',e.download());
e.undo();assert.deepEqual(e.download(),outlinedBefore);assert.deepEqual(e.view().objects.find(o=>o.index===selected.index).box,selected.box);
v=await e.move(selected.index,selected.box.x+100,selected.box.y+100);v=await e.apply(selected.index,'Ref!');moved=v.objects.find(o=>o.index===selected.index);assert.equal(moved.text,'Ref!');v=await e.move(moved.index,moved.box.x+10,moved.box.y+40);moved=v.objects.find(o=>o.index===v.movedIndex);assert.equal(moved.text,'Ref!');assert.equal(moved.fontName,oldFont);e.undo();assert.equal(e.view().objects.find(o=>o.index===selected.index).text,'Ref!');

const box={x:40,y:50,w:100,h:20},page={width:612,height:792};
near(alignedPosition(box,{x:200,y:300,w:80,h:30},'center').x,190);near(alignedPosition(box,{x:200,y:300,w:80,h:30},'middle').y,305);
const snapped=snapPosition(box,{x:253,y:51},page,[],6);near(snapped.x,256);assert(snapped.guides.some(g=>g.page&&g.value===306));
const reference=snapPosition(box,{x:201,y:148},page,[{x:200,y:150,w:90,h:20}],3);near(reference.x,200);near(reference.y,150);
near(snapPosition(box,{x:253,y:51},page,[],6,true).x,253);near(snapPosition(box,{x:90,y:180},page,[],6,true,'x').y,50);
console.log('PASS: native/range/italic and vector-outline moves, font/size/glyph preservation, sibling positions, editing after moving, page/box snapping, export/reopen, undo, bounds and rollback.');

