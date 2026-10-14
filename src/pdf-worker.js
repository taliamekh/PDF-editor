import { OnPagePdfEditor } from './on-page-editor.js';

let editor;
let queue = Promise.resolve();
async function run({ id, method, args }) {
  try {
    editor ||= await OnPagePdfEditor.create();
    const result = await editor[method](...args);
    const transfers = [];
    if (result?.image?.data) transfers.push(result.image.data.buffer);
    if (result?.fontData) transfers.push(result.fontData.buffer);
    if (result instanceof Uint8Array) transfers.push(result.buffer);
    self.postMessage({ id, result }, transfers);
  } catch (error) { self.postMessage({ id, error: error.message || 'The PDF could not be processed.' }); }
}
self.onmessage = ({ data }) => { queue = queue.then(() => run(data)); };
