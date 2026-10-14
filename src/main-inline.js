import './style.css';
import { createWorker } from 'tesseract.js';

const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./pdf-worker.js',import.meta.url),{type:'module'});
let request=0,view,selected,filename,zoom=1,busy=false,inlineField=null,inlineSpec=null,ocrWorker=null,fontSequence=0,uiQueue=Promise.resolve(),downloadedEdits=0;
const pending=new Map(),fontFaces=new Map(),failedDrafts=new Map();
function enqueue(action){const result=uiQueue.then(action);uiQueue=result.catch(error);return result;}
function draftKey(object){return `${view.page}:${object.box.x.toFixed(1)}:${object.box.y.toFixed(1)}`;}
worker.onmessage=({data})=>{const promise=pending.get(data.id);if(!promise)return;pending.delete(data.id);data.error?promise.reject(new Error(data.error)):promise.resolve(data.result);};
worker.onerror=()=>{for(const promise of pending.values())promise.reject(new Error('The PDF engine could not start. Refresh this page and try again.'));pending.clear();};
function call(method,...args){const id=++request;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});}
function draft(){return inlineField?.textContent??selected?.text??'';}
function changed(){return selected&&draft()!==selected.text;}
function setBusy(value,label='Checking the edited PDF…'){
  busy=value;$('busy').classList.toggle('hidden',!value);$('busy-label').textContent=label;
  $('download-btn').disabled=value||!view;$('open-btn').disabled=value;
  if(inlineField)inlineField.contentEditable=value?'false':'true';
  if(view)updateControls();
}
function updateControls(){
  $('prev-page').disabled=busy||view.page===0;$('next-page').disabled=busy||view.page===view.pages-1;
  $('undo-btn').disabled=busy||!view.canUndo;$('zoom-out').disabled=busy||zoom<=.35;$('zoom-in').disabled=busy||zoom>=6;
}
function feedback(message,type='success'){
  if(!view&&type==='error'){const global=$('global-feedback');global.textContent=message;global.classList.remove('hidden');return;}
  const el=$('edit-feedback');el.textContent=message;el.className=`inline-feedback ${type}`;el.classList.toggle('hidden',!message);
}
function error(err){feedback(err.message,'error');}
function paint(image){const canvas=$('pdf-canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(new ImageData(image.data,image.width,image.height),0,0);}
function clearInline(){selected=null;inlineSpec=null;inlineField=null;$('inline-layer').replaceChildren();$('selection-toolbar').classList.add('hidden');}
function draw(result){
  $('global-feedback').classList.add('hidden');
  view=result;clearInline();$('welcome').classList.add('hidden');$('editor').classList.remove('hidden');paint(view.image);resizePaper();
  $('page-count').textContent=`${view.page+1} / ${view.pages}`;
  $('edit-count').textContent=view.edits?`${view.edits} ${view.edits===1?'edit':'edits'} in your copy · original unchanged`:'Original file stays unchanged';
  $('mode-label').textContent=view.kind==='outlined'?'Outlined PDF · approximate matching':'Original font & size preserved';
  $('mode-label').classList.toggle('approximate',view.kind==='outlined');
  $('page-notice').classList.toggle('hidden',view.objects.length!==0);
  $('page-notice').textContent=view.kind==='outlined'?'This PDF stores letters as vector shapes. Recognizing its text locally…':view.kind==='image'?'This page is an image. Editing text inside scanned images is not supported yet.':'There is no directly editable text on this page.';
  makeOverlay();updateControls();
}
function displayScale(){const available=Math.max(220,$('stage').clientWidth-80);return Math.min(1,available/view.width)*zoom;}
function rasterScale(){return Math.min(4,Math.max(1.8,displayScale()*(window.devicePixelRatio||1)));}
function resizePaper(){if(!view)return;const s=displayScale();$('paper').style.width=`${view.width*s}px`;$('paper').style.height=`${view.height*s}px`;$('zoom-label').textContent=`${Math.round(zoom*100)}%`;positionInline();}
function makeOverlay(){
  const root=$('text-overlay');root.replaceChildren();
  for(const object of view.objects){
    const box=document.createElement('button');box.type='button';box.className='text-hit';box.dataset.index=object.index;
    box.style.left=`${object.box.x/view.width*100}%`;box.style.top=`${object.box.y/view.height*100}%`;
    box.style.width=`${Math.max(2,object.box.w)/view.width*100}%`;box.style.height=`${Math.max(5,object.box.h)/view.height*100}%`;
    box.setAttribute('aria-label',`Edit text: ${object.text}`);box.title=`Click to type · ${object.mode==='approximate'?'Matched font: ':''}${object.fontName}, ${Number(object.size.toFixed(2))} pt`;
    box.addEventListener('click',event=>{const point={x:event.clientX,y:event.clientY};enqueue(()=>select(object,point));});root.append(box);
  }
}
async function browserFont(spec){
  if(spec.fontData?.length){
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',spec.fontData)),b=>b.toString(16).padStart(2,'0')).join('');
    if(fontFaces.has(hash))return fontFaces.get(hash);
    try{const family=`pdf-face-${++fontSequence}`,face=new FontFace(family,spec.fontData.buffer);await face.load();document.fonts.add(face);fontFaces.set(hash,family);return family;}catch{}
  }
  return /Times|Serif/i.test(spec.fontName)?'Georgia':/Courier|Mono/i.test(spec.fontName)?'Courier New':'Arial';
}
function positionInline(){
  if(!inlineSpec||!inlineField||!view)return;
  const m=inlineSpec.matrix,s=displayScale(),anchor=$('inline-layer').firstElementChild;
  anchor.style.transform=`matrix(${m[0]*s},${m[1]*s},${m[2]*s},${m[3]*s},${m[4]*s},${m[5]*s})`;
}
function placeCaret(point){
  inlineField.focus({preventScroll:true});
  let range;
  if(point&&document.caretPositionFromPoint){const p=document.caretPositionFromPoint(point.x,point.y);if(p&&inlineField.contains(p.offsetNode)){range=document.createRange();range.setStart(p.offsetNode,p.offset);range.collapse(true);}}
  else if(point&&document.caretRangeFromPoint){const candidate=document.caretRangeFromPoint(point.x,point.y);if(candidate&&inlineField.contains(candidate.startContainer))range=candidate;}
  if(!range){range=document.createRange();range.selectNodeContents(inlineField);range.collapse(false);}
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
}
async function select(object,point){
  if(busy)return;if(selected?.index===object.index&&inlineField){placeCaret(point);return;}
  await applyDraft();
  const distance=o=>Math.hypot(o.box.x-object.box.x,o.box.y-object.box.y);
  object=view.objects.filter(o=>o.mode===object.mode).sort((a,b)=>distance(a)-distance(b))[0];
  if(!object)return;
  setBusy(true,'Opening the text at its original position…');
  try{
    const spec=await call('inline',object.index,rasterScale()),family=await browserFont(spec);
    selected=object;inlineSpec=spec;paint(spec.image);
    $('selection-toolbar').classList.remove('hidden');
    $('selected-font').textContent=`${spec.fontName} · ${spec.mode==='approximate'?'≈ ':''}${Number(spec.size.toFixed(2))} pt`;
    $('selected-mode').textContent=spec.mode==='approximate'?'Approximate match':'Original style locked';$('selected-mode').classList.toggle('approximate',spec.mode==='approximate');
    $('selection-help').textContent=spec.mode==='approximate'?'Approximate match. Click away to save; Esc cancels.':'Click away to save automatically; Esc cancels.';
    document.querySelectorAll('.text-hit').forEach(el=>el.classList.toggle('selected',el.dataset.index===String(object.index)));
    const anchor=document.createElement('div');anchor.className='inline-anchor';
    const field=document.createElement('div');field.className='inline-text';field.contentEditable='true';field.spellcheck=false;field.setAttribute('role','textbox');field.setAttribute('aria-label','Edit text on PDF');field.setAttribute('aria-multiline','false');field.textContent=failedDrafts.get(draftKey(object))??object.text;
    field.style.fontFamily=`"${family}"`;field.style.fontSize=`${spec.rawSize}px`;field.style.letterSpacing=`${spec.tracking||0}px`;
    const color=spec.color||[0,0,0,255];field.style.color=`rgba(${color[0]},${color[1]},${color[2]},${color[3]/255})`;
    const measure=document.createElement('canvas').getContext('2d');measure.font=`${spec.rawSize}px "${family}"`;const metric=measure.measureText('Hg');
    const ascent=metric.fontBoundingBoxAscent??spec.rawSize*.8,descent=metric.fontBoundingBoxDescent??spec.rawSize*.2,lineHeight=spec.rawSize*1.2;
    field.style.lineHeight=`${lineHeight}px`;field.style.transform=`translateY(-${(lineHeight-ascent-descent)/2+ascent}px)`;
    anchor.append(field);$('inline-layer').replaceChildren(anchor);inlineField=field;positionInline();
    field.addEventListener('input',()=>{feedback(draft().length>4000?'Maximum 4,000 characters per field.':'Editing your copy · click away to save',draft().length>4000?'error':'notice');});
    field.addEventListener('keydown',async event=>{
      if(event.key==='Enter'){event.preventDefault();enqueue(applyDraft);}
      if(event.key==='Escape'){event.preventDefault();enqueue(cancelDraft);}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();enqueue(applyDraft);}
    });
    field.addEventListener('paste',event=>{
      const text=event.clipboardData.getData('text/plain');event.preventDefault();
      if(/[\r\n]/.test(text)){feedback('Paste one line at a time to keep the page layout.','error');return;}
      document.execCommand('insertText',false,text);
    });
    field.addEventListener('blur',event=>{if(busy||event.relatedTarget?.closest('button'))return;enqueue(()=>inlineField===field?applyDraft():undefined);});
    setBusy(false);placeCaret(point);
  }catch(err){error(err);setBusy(false);}
}
async function cancelDraft(){if(busy||!view)return;setBusy(true,'Restoring the text…');try{if(selected)failedDrafts.delete(draftKey(selected));draw(await call('view',view.page));feedback('');}catch(err){error(err);}finally{setBusy(false);}}
async function applyDraft(){
  if(!selected)return true;
  if(!changed()){draw(view);return true;}
  const index=selected.index,text=draft(),approximate=selected.mode==='approximate',key=draftKey(selected);
  setBusy(true,approximate?'Saving the matched text and checking the surrounding page…':'Verifying the original font, size and exported page…');
  try{draw(await call('apply',index,text));failedDrafts.delete(key);feedback(approximate?'Autosaved in your edited copy. Approximate font; surrounding page checked.':'Autosaved in your edited copy. Original font and size verified.');return true;}
  catch(err){failedDrafts.set(key,text);try{draw(await call('view',view.page));}catch{}feedback(`${err.message} The original block was restored. You can edit another field or open another PDF; click this field to retry your draft.`,'error');return false;}finally{setBusy(false);}
}
async function recognizeIfNeeded(){
  if(view.kind!=='outlined'||view.ocrReady)return;
  setBusy(true,'Recognizing outlined text locally…');
  try{
    const frame=await call('renderOcr'),canvas=document.createElement('canvas');canvas.width=frame.image.width;canvas.height=frame.image.height;
    canvas.getContext('2d').putImageData(new ImageData(frame.image.data,frame.image.width,frame.image.height),0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    ocrWorker||=await createWorker('eng',1,{workerPath:new URL('/ocr/worker.min.js',location.origin).href,corePath:new URL('/ocr/core',location.origin).href,langPath:new URL('/ocr',location.origin).href,workerBlobURL:false,cacheMethod:'readOnly',logger:m=>{if(m.status==='recognizing text')$('busy-label').textContent=`Recognizing outlined text locally · ${Math.round(m.progress*100)}%`;}});
    await ocrWorker.setParameters({tessedit_pageseg_mode:'3',user_defined_dpi:'216',preserve_interword_spaces:'1'});
    const {data}=await ocrWorker.recognize(blob,{},{blocks:true});
    const rect=b=>({x:b.x0/frame.scale,y:b.y0/frame.scale,w:(b.x1-b.x0)/frame.scale,h:(b.y1-b.y0)/frame.scale});
    const lines=(data.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]).filter(l=>l.text.trim()).map(l=>({text:l.text.trim(),confidence:l.confidence,rect:rect(l.bbox),words:(l.words||[]).map(w=>({text:w.text,confidence:w.confidence,rect:rect(w.bbox)}))}));
    $('busy-label').textContent='Matching the appearance of the outlined letters…';draw(await call('setOcrLines',lines));
    feedback(view.objects.length?'Outlined text is ready. Click a line to type. Font and size are approximate.':'No vector text lines could be recognized safely.',view.objects.length?'notice':'error');
    $('page-notice').classList.toggle('hidden',view.objects.length!==0);
    if(!view.objects.length)$('page-notice').textContent='No editable vector lettering could be recognized on this page.';
  }catch(err){error(err);}finally{setBusy(false);}
}
async function openFile(file){
  if(!file||busy)return;if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){error(new Error('Choose a PDF file.'));return;}
  if(file.size>100*1024*1024){error(new Error('Choose a PDF smaller than 100 MB.'));return;}
  await applyDraft();
  setBusy(true,'Opening your PDF locally…');feedback('');
  try{const result=await call('open',new Uint8Array(await file.arrayBuffer()));filename=file.name;$('file-name').textContent=filename;zoom=1;downloadedEdits=0;failedDrafts.clear();draw(result);setBusy(false);await recognizeIfNeeded();}
  catch(err){error(err);}finally{setBusy(false);$('file-input').value='';}
}
$('open-btn').addEventListener('click',()=>{$('file-input').click();enqueue(applyDraft);});$('dropzone').addEventListener('click',()=> $('file-input').click());
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
$('file-input').addEventListener('change',e=>{const file=e.target.files[0];enqueue(()=>openFile(file));});
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('dragging');});
$('dropzone').addEventListener('drop',e=>{const file=e.dataTransfer.files[0];enqueue(()=>openFile(file));});
$('download-btn').addEventListener('click',()=>enqueue(async()=>{
  if(busy||!view||!await applyDraft())return;setBusy(true,'Preparing your free download…');
  try{const bytes=await call('download'),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=`${filename.replace(/\.pdf$/i,'')}-edited-copy.pdf`;document.body.append(a);a.click();a.remove();downloadedEdits=view.edits;setTimeout(()=>URL.revokeObjectURL(url),30000);feedback('New edited copy downloaded. Your original PDF is unchanged.');}
  catch(err){error(err);}finally{setBusy(false);}
}));
for(const[id,delta]of[['prev-page',-1],['next-page',1]])$(id).addEventListener('click',()=>enqueue(async()=>{if(busy||!view)return;await applyDraft();setBusy(true,'Opening page…');try{draw(await call('view',view.page+delta));setBusy(false);await recognizeIfNeeded();}catch(err){error(err);}finally{setBusy(false);}}));
for(const[id,factor]of[['zoom-in',1.2],['zoom-out',1/1.2]])$(id).addEventListener('click',()=>enqueue(async()=>{if(!view)return;await applyDraft();setZoom(zoom*factor);}));
$('undo-btn').addEventListener('click',()=>enqueue(async()=>{if(busy)return;setBusy(true,'Undoing the last edit…');try{draw(await call('undo'));feedback('Last edit undone.');}catch(err){error(err);}finally{setBusy(false);}}));
document.addEventListener('pointerdown',event=>{if(busy||!inlineField||inlineField.contains(event.target)||event.target.closest('button'))return;const field=inlineField;enqueue(()=>inlineField===field?applyDraft():undefined);},true);
let zoomRenderTimer;
function setZoom(value,point){
  if(!view)return;const stage=$('stage'),paper=$('paper'),before=paper.getBoundingClientRect(),s=displayScale();
  point||={x:stage.getBoundingClientRect().left+stage.clientWidth/2,y:stage.getBoundingClientRect().top+stage.clientHeight/2};
  const x=(point.x-before.left)/s,y=(point.y-before.top)/s;
  zoom=Math.max(.35,Math.min(6,value));resizePaper();updateControls();
  const after=paper.getBoundingClientRect(),next=displayScale();stage.scrollLeft+=after.left+x*next-point.x;stage.scrollTop+=after.top+y*next-point.y;
  clearTimeout(zoomRenderTimer);zoomRenderTimer=setTimeout(()=>enqueue(async()=>{if(!view)return;const frame=await call('renderCurrent',rasterScale(),selected?.index??null);paint(frame.image);if(!selected)view.image=frame.image;}),180);
}
$('stage').addEventListener('wheel',event=>{
  if(!view||busy)return;
  const mouseWheel=event.deltaMode!==0||(Math.abs(event.deltaY)>=50&&Math.abs(event.deltaX)<1);
  if(!event.ctrlKey&&!event.metaKey&&!mouseWheel)return;
  event.preventDefault();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?100:1);
  setZoom(zoom*Math.exp(-delta*(event.ctrlKey ? .012 : .003)),{x:event.clientX,y:event.clientY});
},{passive:false});
let gestureZoom;
$('stage').addEventListener('gesturestart',event=>{event.preventDefault();gestureZoom=zoom;},{passive:false});
$('stage').addEventListener('gesturechange',event=>{event.preventDefault();if(gestureZoom)setZoom(gestureZoom*event.scale,{x:event.clientX,y:event.clientY});},{passive:false});
window.addEventListener('resize',resizePaper);
window.addEventListener('beforeunload',e=>{if((view?.edits??0)!==downloadedEdits||changed()){e.preventDefault();e.returnValue='';}});
