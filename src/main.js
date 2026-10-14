import './style.css';

const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { type: 'module' });
let request = 0, view, selected, filename, zoom = 1, busy = false;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const promise = pending.get(data.id);
  if (!promise) return;
  pending.delete(data.id);
  data.error ? promise.reject(new Error(data.error)) : promise.resolve(data.result);
};
worker.onerror = () => {
  for (const promise of pending.values()) promise.reject(new Error('The PDF engine could not start. Refresh this page and try again.'));
  pending.clear();
};
function call(method, ...args) {
  const id = ++request;
  return new Promise((resolve,reject) => { pending.set(id,{resolve,reject}); worker.postMessage({id,method,args}); });
}

function setBusy(value, label = 'Checking the edited PDF…') {
  busy = value;
  $('busy').classList.toggle('hidden',!value);
  $('busy-label').textContent = label;
  $('download-btn').disabled = value || !view;
  $('open-btn').disabled = value;
  $('apply-btn').disabled = value || !selected || $('replacement').value === selected.text;
  for (const id of ['prev-page','next-page','zoom-in','zoom-out','undo-btn']) $(id).disabled = value;
  $('replacement').disabled = value;
  if (!value && view) updateControls();
}

function error(error, local = false) {
  const el = local ? $('edit-feedback') : $('global-feedback');
  el.textContent = error.message;
  el.classList.remove('hidden');
  el.classList.add('error');
}

function updateControls() {
  $('prev-page').disabled = busy || view.page === 0;
  $('next-page').disabled = busy || view.page === view.pages - 1;
  $('undo-btn').disabled = busy || !view.canUndo;
  $('zoom-out').disabled = busy || zoom <= .65;
  $('zoom-in').disabled = busy || zoom >= 1.8;
}

function draw(result) {
  view = result;
  $('welcome').classList.add('hidden');
  $('editor').classList.remove('hidden');
  const canvas = $('pdf-canvas');
  canvas.width = view.image.width;
  canvas.height = view.image.height;
  canvas.getContext('2d').putImageData(new ImageData(view.image.data,view.image.width,view.image.height),0,0);
  resizePaper();
  $('page-count').textContent = `${view.page + 1} / ${view.pages}`;
  $('edit-count').textContent = view.edits ? `${view.edits} ${view.edits === 1 ? 'edit' : 'edits'} applied · font & size checked` : 'Original document';
  $('page-notice').classList.toggle('hidden',view.objects.length !== 0);
  $('page-notice').textContent = 'No editable text on this page. It may be a scan or contain text inside a complex PDF structure.';
  selected = null;
  $('selection-empty').classList.remove('hidden');
  $('selection-form').classList.add('hidden');
  makeOverlay();
  updateControls();
}

function displayScale() {
  const available = Math.max(220,$('stage').clientWidth - 88);
  return Math.min(1,available / view.width) * zoom;
}

function resizePaper() {
  if (!view) return;
  const s = displayScale();
  $('paper').style.width = `${view.width * s}px`;
  $('paper').style.height = `${view.height * s}px`;
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
}

function makeOverlay() {
  const root = $('text-overlay');
  root.replaceChildren();
  for (const object of view.objects) {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'text-hit';
    box.dataset.index = object.index;
    box.style.left = `${object.box.x / view.width * 100}%`;
    box.style.top = `${object.box.y / view.height * 100}%`;
    box.style.width = `${Math.max(2,object.box.w) / view.width * 100}%`;
    box.style.height = `${Math.max(5,object.box.h) / view.height * 100}%`;
    box.setAttribute('aria-label',`Edit text: ${object.text}`);
    box.title = `Edit ${object.fontName}, ${Number(object.size.toFixed(2))} pt`;
    box.addEventListener('click',() => { if (!busy) select(object); });
    root.append(box);
  }
}

function select(object) {
  selected = object;
  document.querySelectorAll('.text-hit').forEach(el=>el.classList.toggle('selected',Number(el.dataset.index)===object.index));
  $('selection-empty').classList.add('hidden');
  $('selection-form').classList.remove('hidden');
  $('font-name').textContent = object.fontName;
  $('font-size').textContent = `${Number(object.size.toFixed(3))} pt`;
  $('replacement').value = object.text;
  $('edit-feedback').textContent = '';
  $('edit-feedback').classList.remove('error');
  draftChanged();
  $('replacement').focus({preventScroll:true});
}

function draftChanged() {
  $('char-count').textContent = `${$('replacement').value.length} chars`;
  $('apply-btn').disabled = busy || !selected || $('replacement').value === selected.text;
  if (!busy) { $('edit-feedback').textContent = ''; $('edit-feedback').classList.remove('error'); }
}

async function openFile(file) {
  if (!file || busy) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { error(new Error('Choose a PDF file.')); return; }
  if (file.size > 100 * 1024 * 1024) { error(new Error('Choose a PDF smaller than 100 MB for this browser editor.')); return; }
  setBusy(true,'Opening your PDF locally…');
  $('global-feedback').classList.add('hidden');
  try {
    const result = await call('open',new Uint8Array(await file.arrayBuffer()));
    filename = file.name;
    $('file-name').textContent = filename;
    zoom = 1;
    draw(result);
  } catch (err) { error(err); }
  finally { setBusy(false); $('file-input').value = ''; }
}

async function applyDraft() {
  if (!selected || $('replacement').value === selected.text) return true;
  const index = selected.index, replacement = $('replacement').value;
  setBusy(true,'Verifying the original font, size and exported page…');
  try {
    draw(await call('apply',index,replacement));
    const updated = view.objects.find(o=>o.index===index);
    if (updated) select(updated);
    $('edit-feedback').textContent = '✓ Applied. Original font and size verified.';
    $('edit-feedback').classList.remove('error');
    return true;
  } catch (err) { error(err,true); return false; }
  finally { setBusy(false); }
}

$('open-btn').addEventListener('click',()=> $('file-input').click());
$('dropzone').addEventListener('click',()=> $('file-input').click());
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
$('file-input').addEventListener('change',e=>openFile(e.target.files[0]));
for (const event of ['dragenter','dragover']) $('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('dragging');});
for (const event of ['dragleave','drop']) $('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('dragging');});
$('dropzone').addEventListener('drop',e=>openFile(e.dataTransfer.files[0]));
$('replacement').addEventListener('input',draftChanged);
$('replacement').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(e.ctrlKey||e.metaKey)applyDraft();}});
$('replacement').addEventListener('paste',e=>{
  const text = e.clipboardData.getData('text');
  if (/[\r\n]/.test(text)) { e.preventDefault(); error(new Error('Paste one line of text at a time to preserve the existing layout.'),true); }
});
$('apply-btn').addEventListener('click',applyDraft);
$('download-btn').addEventListener('click',async()=>{
  if (busy || !view) return;
  if (!await applyDraft()) return;
  setBusy(true,'Preparing your free download…');
  try {
    const bytes = await call('download');
    const url = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace(/\.pdf$/i,'')}-edited.pdf`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  } catch(err) { error(err); }
  finally { setBusy(false); }
});
for (const [id,delta] of [['prev-page',-1],['next-page',1]]) $(id).addEventListener('click',async()=>{
  if(busy || !view || !await applyDraft())return;
  setBusy(true,'Opening page…');
  try{draw(await call('view',view.page+delta));}catch(err){error(err);}finally{setBusy(false);}
});
for (const [id,delta] of [['zoom-in',.15],['zoom-out',-.15]]) $(id).addEventListener('click',()=>{zoom=Math.min(1.8,Math.max(.65,zoom+delta));resizePaper();updateControls();});
$('undo-btn').addEventListener('click',async()=>{if(busy)return;setBusy(true,'Undoing the last edit…');try{draw(await call('undo'));}catch(err){error(err);}finally{setBusy(false);}});
window.addEventListener('resize',resizePaper);
window.addEventListener('beforeunload',e=>{if(view?.edits || (selected && $('replacement').value!==selected.text)){e.preventDefault();e.returnValue='';}});
