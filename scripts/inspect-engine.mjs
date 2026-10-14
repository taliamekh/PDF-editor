import fs from 'node:fs';
import { PdfEngine } from '../src/vendor/bentopdf/core.js';
const e = await PdfEngine.create();
e.open(new Uint8Array(fs.readFileSync(new URL('../test-output/fixture.pdf', import.meta.url))));
console.log('APIs', Object.keys(e.M).filter(x=> /FPDF.*(SetText|Charcodes|Positions|GetFont|GetText|GetUnicode|GetChar|GetMatrix|GetBounds|GlyphPath)|_ec.*(text_state|font)/.test(x)));
console.log('MODEL',JSON.stringify(e.buildModel()));
console.log('STATE',JSON.stringify(e._t3readState()));
console.log('TEXT',JSON.stringify(e.pageTextJson()));
e.close();
