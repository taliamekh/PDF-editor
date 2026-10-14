import { ExactPdfEditor, PreservationError } from './pdf-editor.js';

export class OnPagePdfEditor extends ExactPdfEditor {
  static async create() {
    const base = await ExactPdfEditor.create();
    return new OnPagePdfEditor(base.e);
  }
  constructor(engine) { super(engine); this.ocrPages = new Map(); this.ocrHistory = []; this.ocrFrames = new Map(); }
  open(bytes) {
    const old = this.ocrPages;
    this.ocrPages = new Map(); this.ocrFrames = new Map();
    try { const result = super.open(bytes); this.ocrHistory = []; return result; }
    catch (err) { this.ocrPages = old; throw err; }
  }
  view(page = this.e.pageIndex, scale = 1.8) {
    const view = super.view(page,scale);
    const kinds = { paths:0, images:0, forms:0 };
    for(let i=0;i<this.e.objectCount();i++) {
      const o=this.e.objectAt(i);
      if(o?.type===2)kinds.paths++;
      if(o?.type===3)kinds.images++;
      if(o?.type===5)kinds.forms++;
    }
    const ocr = this.ocrPages.get(page);
    view.kind = ocr || kinds.paths>30 ? 'outlined' : view.objects.length ? 'text' : kinds.images ? 'image' : kinds.forms ? 'nested' : 'empty';
    view.ocrReady = !!ocr;
    view.objects.forEach(o=>o.mode='exact');
    if(ocr) {
      const converted=new Set(ocr.filter(o=>o.converted&&o.text).map(o=>this.convertedObject(o)?.index));
      view.objects = [...view.objects.filter(o=>!converted.has(o.index)),...ocr.filter(o=>o.text).map(o=>({index:`ocr:${o.id}`,text:o.text,fontName:o.fontName,size:o.size,box:o.rect,mode:'approximate',confidence:o.confidence}))];
    }
    return view;
  }
  screenPoint(x,y) {
    const M=this.e.M,p=M._malloc(16),precision=100;
    M._FPDF_DeviceToPage(this.e.page,0,0,Math.round(this.e.pageWidth*precision),Math.round(this.e.pageHeight*precision),0,Math.round(x*precision),Math.round(y*precision),p,p+8);
    const result={x:M.HEAPF64[p>>3],y:M.HEAPF64[(p+8)>>3]};
    M._free(p); return result;
  }
  screenMatrix(matrix) {
    const M=this.e.M,p=M._malloc(8),precision=100;
    const point=(x,y)=>{M._FPDF_PageToDevice(this.e.page,0,0,Math.round(this.e.pageWidth*precision),Math.round(this.e.pageHeight*precision),0,x,y,p,p+4);return [M.HEAP32[p>>2]/precision,M.HEAP32[(p+4)>>2]/precision];};
    const origin=point(matrix[4],matrix[5]),x=point(matrix[4]+matrix[0]*100,matrix[5]+matrix[1]*100),y=point(matrix[4]-matrix[2]*100,matrix[5]-matrix[3]*100);
    M._free(p);
    return [(x[0]-origin[0])/100,(x[1]-origin[1])/100,(y[0]-origin[0])/100,(y[1]-origin[1])/100,...origin];
  }
  setMatrix(handle,matrix) {
    const M=this.e.M,p=M._malloc(24);M.HEAPF32.set(matrix,p>>2);
    const ok=M._FPDFPageObj_SetMatrix(handle,p);M._free(p);if(!ok)throw new Error('Could not position the replacement text.');
  }
  nativeText(text,fontName,size,rect=null,rgba=[0,0,0,255],tracking=0) {
    const M=this.e.M,fp=this.e._allocStr(fontName),h=M._FPDFPageObj_NewTextObj(this.e.doc,fp,size);M._free(fp);
    if(!h)throw new Error('The matching font could not be loaded.');
    const p=M._malloc((text.length+1)*2);M.stringToUTF16(text,p,(text.length+1)*2);
    const ok=M._FPDFText_SetText(h,p);M._free(p);
    if(!ok){M._FPDFPageObj_Destroy(h);throw new Error('The matching font could not encode this text.');}
    M._FPDFPageObj_SetFillColor(h,...rgba);
    if(rect) {
      const origin=this.screenPoint(0,0),x=this.screenPoint(1,0),y=this.screenPoint(0,-1);
      const matrix=[x.x-origin.x,x.y-origin.y,y.x-origin.x,y.y-origin.y,origin.x,origin.y];
      this.setMatrix(h,matrix);
      const b=this.deviceBox(h,100),placed=this.screenPoint(rect.x-b.x,rect.y-b.y);
      matrix[4]=placed.x;matrix[5]=placed.y;this.setMatrix(h,matrix);
    }
    return h;
  }
  textBitmap(handle,scale=3) {
    const M=this.e.M,bmp=M._FPDFTextObj_GetRenderedBitmap(this.e.doc,this.e.page,handle,scale);
    if(!bmp)return null;
    const width=M._FPDFBitmap_GetWidth(bmp),height=M._FPDFBitmap_GetHeight(bmp),stride=M._FPDFBitmap_GetStride(bmp),p=M._FPDFBitmap_GetBuffer(bmp);
    const data=new Uint8Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const j=p+y*stride+x*4;data[y*width+x]=Math.round((255-M.HEAPU8[j])*M.HEAPU8[j+3]/255);}
    M._FPDFBitmap_Destroy(bmp);
    return {width,height,data};
  }
  croppedMask(image,rect,scale) {
    const x0=Math.max(0,Math.round(rect.x*scale)),y0=Math.max(0,Math.round(rect.y*scale));
    const width=Math.max(1,Math.min(image.width-x0,Math.round(rect.w*scale))),height=Math.max(1,Math.min(image.height-y0,Math.round(rect.h*scale)));
    const data=new Uint8Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const p=((y0+y)*image.width+x0+x)*4;
      data[y*width+x]=255-Math.min(image.data[p],image.data[p+1],image.data[p+2]);
    }
    return {width,height,data};
  }
  trimMask(image) {
    if(!image)return null;
    let x0=image.width,y0=image.height,x1=0,y1=0;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[y*image.width+x]>40){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x0>x1)return null;
    const width=x1-x0+1,height=y1-y0+1,data=new Uint8Array(width*height);
    for(let y=0;y<height;y++)data.set(image.data.subarray((y+y0)*image.width+x0,(y+y0)*image.width+x0+width),y*width);
    return {width,height,data};
  }
  maskDistance(source,candidate) {
    const w=Math.min(200,source.width),h=Math.min(24,source.height);
    let difference=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const a=source.data[Math.min(source.height-1,Math.floor(y*source.height/h))*source.width+Math.min(source.width-1,Math.floor(x*source.width/w))]/255;
      const b=candidate.data[Math.min(candidate.height-1,Math.floor(y*candidate.height/h))*candidate.width+Math.min(candidate.width-1,Math.floor(x*candidate.width/w))]/255;
      difference+=Math.abs(a-b);
    }
    return difference/(w*h)+Math.abs(Math.log((candidate.width/candidate.height)/(source.width/source.height)))*.2;
  }
  matchFont(line,frame) {
    const source=this.trimMask(this.croppedMask(frame.image,line.rect,frame.scale));
    if(!source)return {fontName:'Helvetica',size:Math.max(6,line.rect.h/.72)};
    let best=null;
    for(const fontName of ['Helvetica','Times-Roman','Helvetica-Bold','Times-Bold','Times-Italic','Helvetica-Oblique','Courier']) {
      const handle=this.nativeText(line.text,fontName,12);
      const candidate=this.trimMask(this.textBitmap(handle,3));
      if(candidate) {
        const score=this.maskDistance(source,candidate);
        const size=Math.max(5,Math.min(80,12*(.75*(source.width/frame.scale)/(candidate.width/3)+.25*(source.height/frame.scale)/(candidate.height/3))));
        if(!best||score<best.score)best={fontName,size:Math.round(size*100)/100,score};
      }
      this.e.M._FPDFPageObj_Destroy(handle);
    }
    return best||{fontName:'Helvetica',size:Math.max(6,line.rect.h/.72)};
  }
  renderOcr() {
    const scale=Math.min(3,4096/Math.max(this.e.pageWidth,this.e.pageHeight)),img=this.e.renderPage(scale);
    const image={...img,data:new Uint8ClampedArray(img.data)};
    this.ocrFrames.set(this.e.pageIndex,{scale,image});
    return {scale,image:{...image,data:new Uint8ClampedArray(image.data)}};
  }
  setOcrLines(lines) {
    const frame=this.ocrFrames.get(this.e.pageIndex);
    if(!frame)throw new Error('Recognize this page again.');
    const native=this.objects().map(o=>this.deviceBox(o.handle,100));
    const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    const records=lines.filter(l=>l.text.trim()&&l.rect.w>1&&l.rect.h>1&&!native.some(b=>overlaps(l.rect,b))&&this.outlinePaths(l.rect).length>0).map((line,id)=>({...line,id,...this.matchFont(line,frame),converted:false,rgba:[0,0,0,255]}));
    this.ocrPages.set(this.e.pageIndex,records);
    this.ocrFrames.delete(this.e.pageIndex);
    return this.view();
  }
  outlinePaths(rect) {
    const result=[],M=this.e.M,p=M._malloc(8),pad=1.4;
    for(let i=0;i<this.e.objectCount();i++) {
      const o=this.e.objectAt(i);if(o?.type!==2)continue;
      M._FPDFPath_GetDrawMode(o.handle,p,p+4);
      if(M.HEAP32[p>>2]===0)continue;
      const box=this.deviceBox(o.handle,100),cx=box.x+box.w/2,cy=box.y+box.h/2;
      if(cx<rect.x-pad||cx>rect.x+rect.w+pad||cy<rect.y-pad||cy>rect.y+rect.h+pad)continue;
      if(box.h>rect.h*1.8||box.w>Math.max(rect.w*1.1,rect.h*1.5))continue;
      if(box.w>rect.w*.6&&box.h<rect.h*.15)continue;
      result.push({handle:o.handle,index:i,box,color:this.e.objectFill(o.handle)});
    }
    M._free(p);return result;
  }
  convertedObject(line) {return this.objects().find(o=>o.text===line.text&&line.matrix&&o.matrix.every((v,i)=>Math.abs(v-line.matrix[i])<.001));}
  approximateInline(line) {
    let h,hidden;
    if(line.converted){const obj=this.convertedObject(line);if(!obj)throw new Error('This text block could not be located.');h=obj.handle;hidden=[h];}
    else {
      const paths=this.outlinePaths(line.rect);
      if(!paths.length)throw new PreservationError('This recognized line is part of an image, rather than vector text. Editing image text is not supported yet.');
      const colors=new Map();for(const p of paths){const color=p.color;if(color){const k=JSON.stringify([color.r,color.g,color.b,color.a]);colors.set(k,(colors.get(k)||0)+1);}}
      if(colors.size)line.rgba=JSON.parse([...colors].sort((a,b)=>b[1]-a[1])[0][0]);
      h=this.nativeText(line.text,line.fontName,line.size,line.rect,line.rgba);hidden=paths.map(p=>p.handle);
    }
    const tp=this.e.M._FPDFText_LoadPage(this.e.page),info=this.info(h,-1,tp);this.e.M._FPDFText_ClosePage(tp);
    const spec={index:`ocr:${line.id}`,text:line.text,mode:'approximate',fontName:line.fontName,size:line.size,rawSize:line.size,color:line.rgba,matrix:this.screenMatrix(info.matrix),fontData:this.fontBytes(info.font),tracking:0};
    const img=this.e.renderPage(1.8,hidden);spec.image={...img,data:new Uint8ClampedArray(img.data)};
    if(!line.converted)this.e.M._FPDFPageObj_Destroy(h);
    return spec;
  }
  inline(index) {
    if(String(index).startsWith('ocr:')) {
      const line=this.ocrPages.get(this.e.pageIndex)?.find(o=>o.id===Number(String(index).slice(4)));
      if(!line)throw new Error('Select this text again.');
      return this.approximateInline(line);
    }
    const object=this.objects().find(o=>o.index===index);
    if(!object)throw new Error('Select this text again.');
    let fontData=this.fontBytes(object.font);
    try {
      const paragraphs=this.e.buildModel();
      const paragraph=paragraphs.find(p=>this.e.paragraphObjects(p.id).includes(object.handle));
      if(paragraph){const run=paragraph.runs.findIndex(r=>Math.abs(r.size-object.size)<.01&&r.text.includes(object.text));const bytes=this.e.synthRunFont(paragraph.id,Math.max(0,run));if(bytes&&bytes!=='dishonest')fontData=bytes;}
    } catch {}
    const state=this.stateFor(object),gaps=state?.glyphs.slice(0,-1).map((g,i)=>state.glyphs[i+1][1]-g[1]-this.width(object.font,g[0],object.size)).sort((a,b)=>a-b)||[];
    const image=this.e.renderPage(1.8,[object.handle]);
    return {index,text:object.text,mode:'exact',fontName:object.fontName.replace(/^[A-Z]{6}\+/,''),size:object.size*Math.hypot(object.matrix[2],object.matrix[3]),rawSize:object.size,color:object.fill,matrix:this.screenMatrix(object.matrix),tracking:gaps.length?gaps[Math.floor(gaps.length/2)]:0,fontData,image:{...image,data:new Uint8ClampedArray(image.data)}};
  }
  async apply(index,text) {
    const snapshot=structuredClone([...this.ocrPages]),oldBytes=this.bytes;
    const result=String(index).startsWith('ocr:')?await this.applyApproximate(index,text):await super.apply(index,text);
    if(this.bytes!==oldBytes){this.ocrHistory.push(snapshot);if(this.ocrHistory.length>15)this.ocrHistory.shift();}
    return result;
  }
  async applyApproximate(index,text) {
    if(text.length>4000||/[\r\n\u0000]/.test(text))throw new PreservationError('Edit one line at a time, without line breaks.');
    const page=this.e.pageIndex,line=this.ocrPages.get(page)?.find(o=>o.id===Number(String(index).slice(4)));
    if(!line)throw new Error('Select this line again.');
    if(text===line.text)return this.view();
    const M=this.e.M,oldBytes=this.bytes,snapshot=structuredClone([...this.ocrPages]);
    const scale=Math.min(1.5,4096/Math.max(this.e.pageWidth,this.e.pageHeight)),raw=this.e.renderPage(scale),before={...raw,data:new Uint8ClampedArray(raw.data)};
    const removed=line.converted?[this.convertedObject(line)].filter(Boolean):this.outlinePaths(line.rect);
    if(!removed.length)throw new PreservationError('The original outlined letters could not be isolated safely. This edit was cancelled.');
    let newHandle=null,bounds=line.rect;
    try {
      if(text) {
        newHandle=this.nativeText(text,line.fontName,line.size,line.rect,line.rgba);
        bounds=this.deviceBox(newHandle,100);
        if(bounds.x<0||bounds.y<0||bounds.x+bounds.w>this.e.pageWidth||bounds.y+bounds.h>this.e.pageHeight)throw new PreservationError('This line extends beyond the page. Shorten the replacement.');
        const removedHandles=new Set(removed.map(o=>o.handle));
        const others=[...this.ocrPages.get(page).filter(o=>o.id!==line.id&&o.text),...this.objects().filter(o=>!removedHandles.has(o.handle)).map(o=>({rect:this.deviceBox(o.handle,100)}))];
        if(others.some(o=>Math.min(bounds.x+bounds.w,o.rect.x+o.rect.w)-Math.max(bounds.x,o.rect.x)>1&&Math.min(bounds.y+bounds.h,o.rect.y+o.rect.h)-Math.max(bounds.y,o.rect.y)>1))throw new PreservationError('This line overlaps nearby text. Shorten the replacement.');
      }
      for(const o of removed){if(!M._FPDFPage_RemoveObject(this.e.page,o.handle))throw new Error('Could not remove the outlined letters.');M._FPDFPageObj_Destroy(o.handle);}
      if(newHandle){M._FPDFPage_InsertObject(this.e.page,newHandle);newHandle=null;}
      if(!M._FPDFPage_GenerateContent(this.e.page))throw new Error('The approximate edit could not be saved.');
      const candidate=this.e.save({noRegen:true});if(!candidate?.length)throw new Error('The PDF could not be exported.');
      this.e.open(candidate);this.e.loadPage(page);
      if(text){const updated=this.objects().find(o=>{const b=this.deviceBox(o.handle,100);return o.text===text&&o.fontName===line.fontName&&Math.abs(o.size-line.size)<.001&&Math.abs(b.x-bounds.x)<.1&&Math.abs(b.y-bounds.y)<.1;});if(!updated)throw new PreservationError('The replacement did not survive PDF export.');line.matrix=updated.matrix;line.rect=bounds;}
      this.checkPixels(before,this.e.renderPage(scale),[...removed.map(o=>o.box||line.rect),line.rect,bounds],scale);
      line.converted=true;line.text=text;
      this.history.push(oldBytes);if(this.history.length>15)this.history.shift();this.bytes=candidate;this.edits++;
      return this.view(page);
    } catch(error) {
      if(newHandle)M._FPDFPageObj_Destroy(newHandle);
      this.ocrPages=new Map(snapshot);this.e.open(oldBytes);this.e.loadPage(page);throw error;
    }
  }
  undo() {
    if(this.history.length)this.ocrPages=new Map(this.ocrHistory.pop()||[]);
    return super.undo();
  }
}
