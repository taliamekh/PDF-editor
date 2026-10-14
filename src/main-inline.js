import './style.css';
import { createWorker } from 'tesseract.js';
import { alignedPosition, snapPosition } from './alignment.js';

const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./pdf-worker.js',import.meta.url),{type:'module'});
let request=0,view,selected,filename,zoom=1,busy=false,inlineField=null,inlineSpec=null,ocrWorker=null,fontSequence=0,uiQueue=Promise.resolve(),downloadedEdits=0;
const pending=new Map(),fontFaces=new Map(),failedDrafts=new Map();
let moveMode=false,moveSelected=null,dragState=null,suppressMoveClick=false;
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
  $('edit-tool').disabled=busy;$('move-tool').disabled=busy;
  $('align-target').disabled=busy||!moveSelected;
  document.querySelectorAll('[data-align]').forEach(button=>button.disabled=busy||!moveSelected);
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
  clearMovement();
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
    box.setAttribute('aria-label',`${moveMode?'Move':'Edit'} text: ${object.text}`);box.title=`${moveMode?'Drag to move':'Click to type'} · ${object.mode==='approximate'?'Matched font: ':''}${object.fontName}, ${Number(object.size.toFixed(2))} pt`;
    box.addEventListener('click',event=>{if(moveMode){if(!suppressMoveClick)selectMovement(object);return;}const point={x:event.clientX,y:event.clientY};enqueue(()=>select(object,point));});
    box.addEventListener('pointerdown',event=>startDrag(event,object,box));root.append(box);
  }
}
function clearMovement(){
  moveSelected=null;$('alignment-toolbar').classList.toggle('hidden',!moveMode);$('align-target').replaceChildren(new Option('Page','page'));$('alignment-guides').replaceChildren();$('move-layer').replaceChildren();
  $('selection-help').textContent=moveMode?'Select a box, then drag or use the alignment buttons.':'Click away to autosave · original file unchanged';
  if(view)updateControls();
}
function selectMovement(object,reference=null){
  if(busy||!moveMode)return;
  moveSelected=object;$('alignment-toolbar').classList.remove('hidden');$('selection-toolbar').classList.remove('hidden');
  $('selected-font').textContent=`${object.fontName} · ${Number(object.size.toFixed(2))} pt`;
  $('selected-mode').textContent='Font & size kept';$('selected-mode').classList.remove('approximate');
  $('selection-help').textContent='Moves autosave · Shift-drag: straight line · Esc: cancel drag';
  const select=$('align-target'),oldReference=reference||view.objects.find(o=>String(o.index)===select.value);select.replaceChildren(new Option('Page','page'));
  for(const other of view.objects.filter(o=>o.index!==object.index)){
    const text=other.text.length>42?`${other.text.slice(0,39)}…`:other.text;
    select.add(new Option(text,String(other.index)));
    if(oldReference&&other.text===oldReference.text&&Math.hypot(other.box.x-oldReference.box.x,other.box.y-oldReference.box.y)<1)select.value=String(other.index);
  }
  document.querySelectorAll('.text-hit').forEach(el=>el.classList.toggle('move-selected',el.dataset.index===String(object.index)));updateControls();
  const guides=[];if(Math.abs(object.box.x+object.box.w/2-view.width/2)<.03)guides.push({axis:'x',value:view.width/2,page:true});if(Math.abs(object.box.y+object.box.h/2-view.height/2)<.03)guides.push({axis:'y',value:view.height/2,page:true});showGuides(guides);
}
async function commitMove(object,position){
  if(busy||!view)return;
  const reference=view.objects.find(o=>String(o.index)===$('align-target').value);
  setBusy(true,'Saving the new position and checking the exported PDF…');
  try{
    const result=await call('move',object.index,position.x,position.y);draw(result);setBusy(false);
    const moved=view.objects.find(o=>o.index===result.movedIndex);if(moved)selectMovement(moved,reference);
    feedback('Position autosaved in your copy. Font, size and surrounding page checked.');
  }catch(err){draw(await call('view',view.page));setBusy(false);const restored=view.objects.find(o=>o.index===object.index);if(restored)selectMovement(restored,reference);error(err);}
  finally{setBusy(false);}
}
function showGuides(guides){
  $('alignment-guides').replaceChildren(...guides.map(guide=>{
    const line=document.createElement('div');line.className=`alignment-guide ${guide.axis}${guide.page?' page':''}`;
    line.style[guide.axis==='x'?'left':'top']=`${guide.value/(guide.axis==='x'?view.width:view.height)*100}%`;
    if(guide.page&&Math.abs(guide.value-(guide.axis==='x'?view.width:view.height)/2)<.01){const label=document.createElement('span');label.className='guide-label';label.textContent='Page center';line.append(label);}
    return line;
  }));
}
function startDrag(event,object,element){
  if(!moveMode||busy||event.button!==0)return;event.preventDefault();stopWheelZoom();selectMovement(object);
  element.setPointerCapture(event.pointerId);suppressMoveClick=false;
  const state={object,element,id:event.pointerId,start:{x:event.clientX,y:event.clientY},position:{x:object.box.x,y:object.box.y},moved:false,ghost:null,preview:null};dragState=state;
  const update=event=>{
    if(dragState!==state||event.pointerId!==state.id)return;
    const s=displayScale(),dx=(event.clientX-state.start.x)/s,dy=(event.clientY-state.start.y)/s;
    if(!state.moved&&Math.hypot(dx,dy)*s<3)return;
    if(!state.moved){
      state.moved=true;$('paper').classList.add('dragging');
      const source=$('pdf-canvas'),ratio=source.width/view.width,pad=2,ghost=document.createElement('canvas');ghost.className='move-ghost';
      const b=object.box;ghost.width=Math.max(1,Math.ceil((b.w+pad*2)*ratio));ghost.height=Math.max(1,Math.ceil((b.h+pad*2)*ratio));
      ghost.getContext('2d').drawImage(source,(b.x-pad)*ratio,(b.y-pad)*ratio,ghost.width,ghost.height,0,0,ghost.width,ghost.height);
      state.ghost=ghost;state.pad=pad;$('move-layer').append(ghost);
      state.preview=call('movementPreview',object.index,rasterScale()).then(frame=>{if(dragState===state)paint(frame.image);}).catch(error);
    }
    const axis=event.shiftKey?(Math.abs(dx)>=Math.abs(dy)?'x':'y'):null;
    state.position=snapPosition(object.box,{x:object.box.x+dx,y:object.box.y+dy},view,view.objects.filter(o=>o.index!==object.index).map(o=>o.box),6/s,event.altKey,axis);
    const ghost=state.ghost;ghost.style.left=`${(state.position.x-state.pad)*s}px`;ghost.style.top=`${(state.position.y-state.pad)*s}px`;ghost.style.width=`${ghost.width/($('pdf-canvas').width/view.width)*s}px`;ghost.style.height=`${ghost.height/($('pdf-canvas').width/view.width)*s}px`;showGuides(state.position.guides);
  };
  const finish=event=>{
    if(dragState!==state||event.pointerId!==state.id)return;
    element.removeEventListener('pointermove',update);element.removeEventListener('pointerup',finish);element.removeEventListener('pointercancel',finish);element.removeEventListener('lostpointercapture',finish);
    dragState=null;$('paper').classList.remove('dragging');$('move-layer').replaceChildren();$('alignment-guides').replaceChildren();paint(view.image);
    if(state.moved){suppressMoveClick=true;setTimeout(()=>suppressMoveClick=false,0);if(event.type==='pointerup')enqueue(()=>commitMove(object,state.position));}
  };
  state.cancel=()=>finish({pointerId:state.id,type:'pointercancel'});
  element.addEventListener('pointermove',update);element.addEventListener('pointerup',finish);element.addEventListener('pointercancel',finish);element.addEventListener('lostpointercapture',finish);
}
for(const [id,mode]of[['edit-tool',false],['move-tool',true]])$(id).addEventListener('click',()=>enqueue(async()=>{
  if(busy||dragState)return;await applyDraft();moveMode=mode;clearInline();clearMovement();paint(view.image);
  $('paper').classList.toggle('move-mode',mode);$('edit-tool').classList.toggle('active',!mode);$('move-tool').classList.toggle('active',mode);$('edit-tool').setAttribute('aria-pressed',String(!mode));$('move-tool').setAttribute('aria-pressed',String(mode));
  $('stage-tip-text').textContent=mode?'Drag a text box · guides snap to page center and other boxes':'Click a field to edit · mouse wheel or trackpad pinch to zoom';makeOverlay();
}));
document.querySelectorAll('[data-align]').forEach(button=>button.addEventListener('click',()=>enqueue(async()=>{
  if(busy||!moveSelected)return;const reference=view.objects.find(o=>String(o.index)===$('align-target').value);
  const target=reference?.box||{x:0,y:0,w:view.width,h:view.height};await commitMove(moveSelected,alignedPosition(moveSelected.box,target,button.dataset.align));
})));
document.addEventListener('keydown',event=>{
  if(!moveMode||busy)return;
  if(event.key==='Escape'){if(dragState){event.preventDefault();dragState.cancel();}else{clearInline();clearMovement();document.querySelectorAll('.move-selected').forEach(el=>el.classList.remove('move-selected'));}return;}
  if(!moveSelected||event.target.closest('input,select,[contenteditable="true"]')||event.ctrlKey||event.metaKey||event.altKey)return;
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;event.preventDefault();
  enqueue(()=>{if(moveSelected){const box=moveSelected.box,step=event.shiftKey?10:1;return commitMove(moveSelected,{x:box.x+delta[0]*step,y:box.y+delta[1]*step});}});
});
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
let zoomRenderTimer,wheelZoomFrame=0,wheelZoomTarget=null,wheelZoomPoint=null;
function stopWheelZoom(){cancelAnimationFrame(wheelZoomFrame);wheelZoomFrame=0;wheelZoomTarget=null;}
function setZoom(value,point,animated=false){
  if(!animated)stopWheelZoom();
  if(!view)return;const stage=$('stage'),paper=$('paper'),before=paper.getBoundingClientRect(),s=displayScale();
  point||={x:stage.getBoundingClientRect().left+stage.clientWidth/2,y:stage.getBoundingClientRect().top+stage.clientHeight/2};
  const x=(point.x-before.left)/s,y=(point.y-before.top)/s;
  zoom=Math.max(.35,Math.min(6,value));resizePaper();updateControls();
  const after=paper.getBoundingClientRect(),next=displayScale();stage.scrollLeft+=after.left+x*next-point.x;stage.scrollTop+=after.top+y*next-point.y;
  clearTimeout(zoomRenderTimer);zoomRenderTimer=setTimeout(()=>enqueue(async()=>{if(!view)return;const frame=await call('renderCurrent',rasterScale(),selected?.index??null);paint(frame.image);if(!selected)view.image=frame.image;}),180);
}
function smoothWheelZoom(delta,point){
  wheelZoomTarget=Math.max(.35,Math.min(6,(wheelZoomTarget??zoom)*Math.exp(delta)));wheelZoomPoint=point;
  if(wheelZoomFrame)return;
  const tick=()=>{
    wheelZoomFrame=0;if(!view||busy||dragState){wheelZoomTarget=null;return;}
    const difference=Math.log(wheelZoomTarget/zoom);
    if(Math.abs(difference)<.001){const target=wheelZoomTarget;wheelZoomTarget=null;setZoom(target,wheelZoomPoint,true);return;}
    setZoom(zoom*Math.exp(Math.max(-.035,Math.min(.035,difference*.25))),wheelZoomPoint,true);
    wheelZoomFrame=requestAnimationFrame(tick);
  };
  wheelZoomFrame=requestAnimationFrame(tick);
}
$('stage').addEventListener('wheel',event=>{
  if(dragState){event.preventDefault();return;}
  if(!view||busy)return;
  // Coarse mouse wheels use line units or whole 100/120-pixel ticks.
  // Other pixel scrolling, including fast trackpad scrolls, should pan.
  const amount=Math.abs(event.deltaY),mouseWheel=event.deltaMode!==0||(Math.abs(event.deltaX)<1&&amount>=100&&(Math.abs(amount/100-Math.round(amount/100))<.001||Math.abs(amount/120-Math.round(amount/120))<.001));
  if(!event.ctrlKey&&!event.metaKey&&!mouseWheel)return;
  event.preventDefault();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?100:1);
  const pinch=event.ctrlKey||event.metaKey,change=-delta*(pinch ? .002 : .0013),limit=pinch ? .06 : .16;
  smoothWheelZoom(Math.max(-limit,Math.min(limit,change)),{x:event.clientX,y:event.clientY});
},{passive:false});
let gestureZoom;
$('stage').addEventListener('gesturestart',event=>{event.preventDefault();gestureZoom=zoom;},{passive:false});
$('stage').addEventListener('gesturechange',event=>{event.preventDefault();if(gestureZoom)setZoom(gestureZoom*Math.pow(event.scale,.4),{x:event.clientX,y:event.clientY});},{passive:false});
window.addEventListener('resize',resizePaper);
window.addEventListener('beforeunload',e=>{if((view?.edits??0)!==downloadedEdits||changed()){e.preventDefault();e.returnValue='';}});
