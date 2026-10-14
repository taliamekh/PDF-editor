import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve('public/ocr');
await fs.mkdir(path.join(root,'core'),{recursive:true});
const core = path.dirname(require.resolve('tesseract.js-core',{paths:[path.dirname(require.resolve('tesseract.js'))]}));
for (const file of await fs.readdir(core)) if (file.endsWith('.wasm.js')) await fs.copyFile(path.join(core,file),path.join(root,'core',file));
await fs.copyFile(path.join(path.dirname(require.resolve('tesseract.js')),'../dist/worker.min.js'),path.join(root,'worker.min.js'));
await fs.copyFile(path.join(path.dirname(require.resolve('tesseract.js')),'../LICENSE.md'),path.join(root,'TESSERACT-LICENSE.txt'));
await fs.copyFile(path.join(core,'LICENSE'),path.join(root,'CORE-LICENSE.txt'));
const language = path.join(root,'eng.traineddata.gz');
try { await fs.access(language); } catch {
  const response = await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  if (!response.ok) throw new Error(`Language data download failed (${response.status})`);
  await fs.writeFile(language,new Uint8Array(await response.arrayBuffer()));
}
console.log('Local OCR worker, core variants and English language data ready.');
