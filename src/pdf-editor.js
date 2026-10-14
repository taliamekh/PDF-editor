import { PdfEngine } from './vendor/bentopdf/core.js';

const closeNumber = (a, b) => Math.abs(a - b) < 0.0001;
const sameArray = (a, b) => a.length === b.length && a.every((n, i) => closeNumber(n, b[i]));
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

export class PreservationError extends Error {}

export class ExactPdfEditor {
  static async create() {
    const engine = await PdfEngine.create();
    // Never register a substitute-font provider. The existing font must carry an edit.
    engine._makeProvider = () => 0;
    return new ExactPdfEditor(engine);
  }

  constructor(engine) { this.e = engine; this.bytes = null; this.edits = 0; this.history = []; }

  open(bytes) {
    const previous = this.bytes, page = this.e.pageIndex;
    try {
      this.e.open(bytes);
      if (this.e.security?.signatures) throw new PreservationError('This PDF is digitally signed. Open an unsigned copy to edit its text.');
    } catch (error) {
      if (previous) { this.e.open(previous); this.e.loadPage(page); }
      throw error;
    }
    this.bytes = new Uint8Array(bytes);
    this.edits = 0;
    this.history = [];
    return this.view(0);
  }

  fontName(font) {
    const M = this.e.M;
    const n = M._FPDFFont_GetBaseFontName(font, 0, 0);
    if (!n) return 'Unknown font';
    const p = M._malloc(n);
    M._FPDFFont_GetBaseFontName(font, p, n);
    const name = M.UTF8ToString(p);
    M._free(p);
    return name;
  }

  fontBytes(font) {
    const M = this.e.M, out = M._malloc(4);
    let result = null;
    M.HEAPU32[out >> 2] = 0;
    if (M._FPDFFont_GetFontData(font, 0, 0, out)) {
      const n = M.HEAPU32[out >> 2];
      if (n && n < 32 * 1024 * 1024) {
        const p = M._malloc(n);
        if (M._FPDFFont_GetFontData(font, p, n, out)) result = M.HEAPU8.slice(p, p + n);
        M._free(p);
      }
    }
    M._free(out);
    return result;
  }

  async fontDigest(font) {
    const bytes = this.fontBytes(font);
    if (!bytes) return null;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  text(handle, textPage) {
    const M = this.e.M, n = M._FPDFTextObj_GetText(handle, textPage, 0, 0);
    if (!n) return '';
    const p = M._malloc(n);
    M._FPDFTextObj_GetText(handle, textPage, p, n);
    const result = M.UTF16ToString(p);
    M._free(p);
    return result;
  }

  info(handle, index, textPage) {
    const M = this.e.M, p = M._malloc(24);
    M._FPDFPageObj_GetMatrix(handle, p);
    const matrix = Array.from(M.HEAPF32.subarray(p >> 2, (p >> 2) + 6));
    M._FPDFTextObj_GetFontSize(handle, p);
    const size = M.HEAPF32[p >> 2];
    const font = M._FPDFTextObj_GetFont(handle);
    M._FPDFPageObj_GetFillColor(handle, p, p + 4, p + 8, p + 12);
    const fill = Array.from(M.HEAPU32.subarray(p >> 2, (p >> 2) + 4));
    M._FPDFPageObj_GetStrokeColor(handle, p, p + 4, p + 8, p + 12);
    const stroke = Array.from(M.HEAPU32.subarray(p >> 2, (p >> 2) + 4));
    M._FPDFPageObj_GetStrokeWidth(handle, p);
    const strokeWidth = M.HEAPF32[p >> 2];
    M._free(p);
    return { handle, index, text: this.text(handle, textPage), matrix, size, font, fontName: this.fontName(font), embedded: M._FPDFFont_GetIsEmbedded(font) === 1, renderMode: M._FPDFTextObj_GetTextRenderMode(handle), fill, stroke, strokeWidth, box: this.deviceBox(handle) };
  }

  deviceBox(handle, scale = 1) {
    const M = this.e.M, bounds = this.e._rawBounds(handle);
    if (!bounds) return { x: 0, y: 0, w: 0, h: 0 };
    const w = Math.round(this.e.pageWidth * scale), h = Math.round(this.e.pageHeight * scale);
    const p = M._malloc(8), points = [];
    for (const [x, y] of [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]]) {
      M._FPDF_PageToDevice(this.e.page, 0, 0, w, h, 0, x, y, p, p + 4);
      points.push([M.HEAP32[p >> 2], M.HEAP32[(p + 4) >> 2]]);
    }
    M._free(p);
    const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
    return { x: x / scale, y: y / scale, w: (Math.max(...points.map(p => p[0])) - x) / scale, h: (Math.max(...points.map(p => p[1])) - y) / scale };
  }

  objects() {
    const M = this.e.M, tp = M._FPDFText_LoadPage(this.e.page), objects = [];
    try {
      for (let i = 0; i < this.e.objectCount(); i++) {
        const o = this.e.objectAt(i);
        if (o?.type === 1) objects.push(this.info(o.handle, i, tp));
      }
    } finally { M._FPDFText_ClosePage(tp); }
    return objects;
  }

  stateFor(object) {
    return (this.e._t3readState() || []).find(s => !s.inForm && s.font === object.font && closeNumber(s.size, object.size) && sameArray(s.m, object.matrix));
  }

  view(page = this.e.pageIndex, scale = 1.4) {
    this.e.loadPage(page);
    const objects = this.objects();
    const image = this.e.renderPage(scale);
    return { page, pages: this.e.pageCount, width: this.e.pageWidth, height: this.e.pageHeight, image: { ...image, data: new Uint8ClampedArray(image.data) }, edits: this.edits, canUndo: this.history.length > 0,
      objects: objects.filter(o => o.text && o.renderMode !== 3 && o.renderMode !== 7).map(o => ({ index: o.index, text: o.text, fontName: o.fontName.replace(/^[A-Z]{6}\+/, ''), size: o.size * Math.hypot(o.matrix[2], o.matrix[3]), box: o.box })) };
  }

  width(font, code, size) {
    const M = this.e.M, p = M._malloc(4);
    const ok = M._FPDFFont_GetGlyphWidth(font, code, size, p);
    const result = ok ? M.HEAPF32[p >> 2] : 0;
    M._free(p);
    return result;
  }

  glyphShape(font, code, size) {
    const M = this.e.M, path = M._FPDFFont_GetGlyphPath(font, code, size);
    if (!path) return null;
    const n = M._FPDFGlyphPath_CountGlyphSegments(path), p = M._malloc(8), parts = [];
    for (let i = 0; i < n; i++) {
      const segment = M._FPDFGlyphPath_GetGlyphPathSegment(path, i);
      M._FPDFPathSegment_GetPoint(segment, p, p + 4);
      parts.push([M._FPDFPathSegment_GetType(segment), M.HEAPF32[p>>2],M.HEAPF32[(p+4)>>2],M._FPDFPathSegment_GetClose(segment)]);
    }
    M._free(p);
    return JSON.stringify(parts);
  }

  preservePositions(before, after, oldText, newText, object, lockSuffix = false) {
    const old = [...oldText], fresh = [...newText];
    if (before.glyphs.length !== old.length || after.glyphs.length !== fresh.length) throw new PreservationError('This text uses a complex character encoding. This version cannot edit it with verified preservation.');
    if (before.glyphs.some(g => Math.abs(g[2]) > 0.001)) throw new PreservationError('This text contains several baselines inside one object. Exact editing is not available for this block yet.');
    if (fresh.length < 2) return;
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < fresh.length && old[prefix] === fresh[prefix]) prefix++;
    while (suffix < old.length - prefix && suffix < fresh.length - prefix && old[old.length - 1 - suffix] === fresh[fresh.length - 1 - suffix]) suffix++;
    const codes = new Uint32Array(after.glyphs.map(g=>g[0]));
    for (let i=0;i<prefix;i++) codes[i]=before.glyphs[i][0];
    for (let i=0;i<suffix;i++) codes[fresh.length-suffix+i]=before.glyphs[old.length-suffix+i][0];
    const M = this.e.M, codesPtr = M._malloc(codes.byteLength);
    M.HEAPU32.set(codes,codesPtr>>2);
    const encoded = M._FPDFText_SetCharcodes(object.handle,codesPtr,codes.length);
    M._free(codesPtr);
    if (!encoded) throw new PreservationError('The PDF engine could not retain the original character encodings.');
    after = this.stateFor(object);
    const gaps = before.glyphs.slice(0, -1).map((g, i) => before.glyphs[i + 1][1] - g[1] - this.width(object.font, g[0], object.size));
    gaps.sort((a,b) => a-b);
    const tracking = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const positions = new Float32Array(fresh.length);
    for (let i = 1; i < fresh.length; i++) positions[i] = positions[i - 1] + this.width(object.font, after.glyphs[i - 1][0], object.size) + tracking;
    for (let i = 0; i < prefix; i++) positions[i] = before.glyphs[i][1];
    if (prefix && prefix < fresh.length) positions[prefix] = prefix < old.length ? before.glyphs[prefix][1] : before.glyphs[prefix - 1][1] + this.width(object.font, before.glyphs[prefix - 1][0], object.size) + tracking;
    for (let i = Math.max(1, prefix + 1); i < fresh.length; i++) positions[i] = positions[i - 1] + this.width(object.font, after.glyphs[i - 1][0], object.size) + tracking;
    if (suffix) {
      const oldStart = old.length - suffix, newStart = fresh.length - suffix;
      const origin = lockSuffix === true ? before.glyphs[oldStart][1] : positions[newStart];
      for (let i = 0; i < suffix; i++) positions[newStart + i] = origin + before.glyphs[oldStart + i][1] - before.glyphs[oldStart][1];
    }
    if(lockSuffix&&typeof lockSuffix==='object')for(let i=lockSuffix.newEnd;i<fresh.length;i++)positions[i]=before.glyphs[lockSuffix.oldEnd+i-lockSuffix.newEnd][1];
    const p = M._malloc((fresh.length - 1) * 4);
    M.HEAPF32.set(positions.subarray(1), p >> 2);
    const ok = M._FPDFText_SetPositions(object.handle, p, fresh.length - 1);
    M._free(p);
    if (!ok) throw new PreservationError('The PDF engine could not preserve this text’s character positions.');
  }

  checkPixels(before, after, boxes, scale) {
    if (before.width !== after.width || before.height !== after.height) throw new PreservationError('Export changed the page dimensions. The edit was cancelled.');
    let changed = 0;
    const masks = boxes.map(b => ({ x: Math.floor(b.x * scale) - 5, y: Math.floor(b.y * scale) - 5, r: Math.ceil((b.x + b.w) * scale) + 5, b: Math.ceil((b.y + b.h) * scale) + 5 }));
    for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
      if (masks.some(b => x >= b.x && x <= b.r && y >= b.y && y <= b.b)) continue;
      const p = (y * before.width + x) * 4;
      if ([0,1,2,3].some(c => Math.abs(before.data[p+c] - after.data[p+c]) > 2) && ++changed > 8) throw new PreservationError('Export altered content outside the selected text. The edit was cancelled to keep your PDF accurate.');
    }
    return changed;
  }

  documentCharacters(font) {
    const page = this.e.pageIndex, pinned = this.e.pinnedPages;
    const result = new Set();
    this.e.pinnedPages = new Set([page]);
    try {
      for (let i = 0; i < this.e.pageCount; i++) {
        this.e.loadPage(i);
        for (const o of this.objects()) if (o.font === font) for (const c of o.text) result.add(c);
      }
    } finally { this.e.loadPage(page); this.e.pinnedPages = pinned; }
    return result;
  }

  async apply(index, newText, options = {}) {
    if (!this.bytes) throw new Error('Open a PDF first.');
    if (newText.length > 4000 || /[\r\n\u0000]/.test(newText)) throw new PreservationError('Edit one existing text line at a time, with no line breaks (maximum 4,000 characters).');
    const page = this.e.pageIndex, oldBytes = this.bytes, objects = this.objects();
    const original = objects.find(o => o.index === index);
    if (!original) throw new PreservationError('Select the text again before editing.');
    if (newText === original.text) return this.view();
    if (/[\u0590-\u08ff\u0900-\u109f\u1780-\u17ff]/.test(original.text + newText)) throw new PreservationError('This text requires complex script shaping. Exact editing for this script is not available in this version.');
    const originalState = this.stateFor(original);
    if (!originalState || originalState.t3) throw new PreservationError('This block uses a font or structure that this version cannot preserve exactly.');
    const known = this.documentCharacters(original.font);
    const digest = await this.fontDigest(original.font);
    const scale = Math.min(1.5, 4096 / Math.max(this.e.pageWidth, this.e.pageHeight));
    const before = this.e.renderPage(scale);
    const beforeImage = { ...before, data: new Uint8ClampedArray(before.data) };
    try {
      const M = this.e.M;
      if (!newText) {
        if (!M._FPDFPage_RemoveObject(this.e.page, original.handle)) throw new PreservationError('The text block could not be removed.');
        M._FPDFPageObj_Destroy(original.handle);
      } else {
        const p = M._malloc((newText.length + 1) * 2);
        M.stringToUTF16(newText, p, (newText.length + 1) * 2);
        const ok = M._FPDFText_SetText(original.handle, p);
        M._free(p);
        if (!ok) throw new PreservationError('The original font could not encode the replacement text.');
      }
      if (newText) {
        const freshState = this.stateFor(original);
        if (!freshState || freshState.glyphs.some(g => g[0] === 0)) throw new PreservationError('A replacement character is missing from the original embedded font. No replacement font will be used.');
        const notdef = this.glyphShape(original.font, 0, original.size);
        for (const [i,c] of [...newText].entries()) {
          if (known.has(c)) continue;
          const shape = this.glyphShape(original.font, freshState.glyphs[i]?.[0], original.size);
          if (!shape || (shape === notdef && c !== ' ')) throw new PreservationError(`The original embedded font cannot render “${c}”. Try a character already in this PDF. No replacement font will be used.`);
        }
        this.preservePositions(originalState, freshState, original.text, newText, original, options.lockSuffix);
      }
      const bounds = newText ? this.deviceBox(original.handle) : original.box;
      const editedBounds = options.range ? this.rangeBounds(original,options.range.start,options.range.end) : bounds;
      if(options.range && options.range.otherBoxes.some(box=>overlaps(editedBounds,box)&&!overlaps(options.range.box,box)))throw new PreservationError('This text reaches the next field. Shorten it to keep the existing spacing.');
      if (newText && (bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.w > this.e.pageWidth + 1 || bounds.y + bounds.h > this.e.pageHeight + 1)) throw new PreservationError('The replacement extends beyond this page. Shorten the text to keep its original size.');
      if (objects.some(o => o.index !== index && o.text && overlaps(bounds,o.box) && !overlaps(original.box,o.box))) throw new PreservationError('The replacement overlaps nearby text. Shorten it to keep the original font and size.');
      if (!M._FPDFPage_GenerateContent(this.e.page)) throw new PreservationError('The PDF engine could not save this edit.');
      this.e._pageDirty = false;
      const candidate = this.e.save({ noRegen: true });
      if (!candidate?.length) throw new PreservationError('The edited PDF could not be exported.');
      this.e.open(candidate);
      this.e.loadPage(page);
      const afterObjects = this.objects(), updated = afterObjects.find(o=>o.index===index);
      if (newText && (!updated || updated.text !== newText || updated.fontName !== original.fontName || updated.embedded !== original.embedded || await this.fontDigest(updated.font) !== digest || !closeNumber(updated.size,original.size) || !sameArray(updated.matrix,original.matrix) || updated.renderMode !== original.renderMode || !sameArray(updated.fill,original.fill) || !sameArray(updated.stroke,original.stroke) || !closeNumber(updated.strokeWidth,original.strokeWidth))) throw new PreservationError('The downloaded PDF did not preserve the text’s font, size, or formatting. The edit was cancelled.');
      for (const beforeObject of objects.filter(o=>o.index!==index)) {
        const afterObject = afterObjects.find(o=>o.text===beforeObject.text && closeNumber(o.size,beforeObject.size) && sameArray(o.matrix,beforeObject.matrix) && o.fontName===beforeObject.fontName);
        if (!afterObject) throw new PreservationError('Export changed another text object. The edit was cancelled.');
      }
      if (!newText && afterObjects.some(o=>o.text===original.text && sameArray(o.matrix,original.matrix))) throw new PreservationError('The original text was not completely removed. The deletion was cancelled.');
      this.checkPixels(beforeImage, this.e.renderPage(scale), options.range?[options.range.box,editedBounds]:[original.box,bounds], scale);
      this.history.push(oldBytes);
      if (this.history.length > 15) this.history.shift();
      this.bytes = candidate;
      this.edits++;
      return this.view(page);
    } catch (error) {
      this.e.open(oldBytes);
      this.e.loadPage(page);
      throw error;
    }
  }

  undo() {
    if (!this.history.length) return this.view();
    const page = this.e.pageIndex;
    this.bytes = this.history.pop();
    this.e.open(this.bytes);
    this.edits = Math.max(0,this.edits-1);
    return this.view(page);
  }

  download() { return this.bytes.slice(); }
}
