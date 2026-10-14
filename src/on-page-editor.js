import { ExactPdfEditor, PreservationError } from './pdf-editor.js';
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { splitSpacedWords } from './text-blocks.js';

export class OnPagePdfEditor extends ExactPdfEditor {
  static async create() {
    const base = await ExactPdfEditor.create();
    return new OnPagePdfEditor(base.e);
  }
  constructor(engine) { super(engine); this.ocrPages = new Map(); this.ocrHistory = []; this.ocrFrames = new Map(); }
  info(handle,index,textPage) {
    const object=super.info(handle,index,textPage),state=this.stateFor(object),chars=[...object.text];
    object.box=this.deviceBox(handle,100);
    // PDFium's text extraction collapses consecutive literal space glyphs.
    // Recover their count from the actual glyph sequence before range editing.
    if(state&&state.glyphs.length>chars.length){
      const visible=chars.filter(c=>! /\s/.test(c));
      if(state.glyphs.filter(g=>g[0]!==32).length===visible.length){let i=0;object.text=state.glyphs.map(g=>g[0]===32?' ':visible[i++]).join('');}
    }
    return object;
  }
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
    const nativeObjects=this.objects();
    view.objects.forEach(o=>{o.mode='exact';o.box=nativeObjects.find(n=>n.index===o.index)?.box||o.box;});
    view.objects=view.objects.flatMap(o=>{
      const native=nativeObjects.find(n=>n.index===o.index),ranges=this.nativeRanges(native);
      return ranges.length<2?[o]:ranges.map(range=>({...o,index:`range:${o.index}:${range.start}:${range.end}`,text:[...native.text].slice(range.start,range.end).join(''),box:this.rangeBounds(native,range.start,range.end)}));
    });
    if(ocr) {
      const converted=new Set(ocr.filter(o=>o.converted&&o.text).map(o=>this.convertedObject(o)?.index));
      view.objects = [...view.objects.filter(o=>!converted.has(String(o.index).startsWith('range:')?Number(String(o.index).split(':')[1]):o.index)),...ocr.filter(o=>o.text).map(o=>({index:`ocr:${o.id}`,text:o.text,fontName:o.fontName,size:o.size,box:o.rect,mode:'approximate',confidence:o.confidence}))];
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
  nativeRanges(object) {
    if(!object)return [];
    const chars=[...object.text],state=this.stateFor(object);
    if(!state||state.t3||state.glyphs.length!==chars.length||state.glyphs.some(g=>Math.abs(g[2])>.001))return [];
    const result=[];let start=-1,last=-1;
    for(let i=0;i<chars.length;i++){
      if(/\s/.test(chars[i]))continue;
      if(last>=0&&state.glyphs[i][1]-state.glyphs[last][1]-this.width(object.font,state.glyphs[last][0],object.size)>Math.max(2.5,object.size*.5)){
        result.push({start,end:last+1});start=i;
      }
      if(start<0)start=i;last=i;
    }
    if(start>=0)result.push({start,end:last+1});return result;
  }
  nativeFragment(object,start,end) {
    const state=this.stateFor(object),glyphs=state?.glyphs.slice(start,end);
    if(!glyphs?.length)return null;
    const M=this.e.M,h=M._FPDFPageObj_CreateTextObj(this.e.doc,object.font,object.size);
    if(!h)throw new Error('Could not isolate this text field.');
    const codes=new Uint32Array(glyphs.map(g=>g[0])),p=M._malloc(codes.byteLength);
    M.HEAPU32.set(codes,p>>2);const ok=M._FPDFText_SetCharcodes(h,p,codes.length);M._free(p);
    if(!ok){M._FPDFPageObj_Destroy(h);throw new Error('Could not retain the original glyphs.');}
    if(glyphs.length>1){const positions=new Float32Array(glyphs.slice(1).map(g=>g[1]-glyphs[0][1])),ptr=M._malloc(positions.byteLength);M.HEAPF32.set(positions,ptr>>2);M._FPDFText_SetPositions(h,ptr,positions.length);M._free(ptr);}
    const matrix=object.matrix.slice();matrix[4]+=matrix[0]*glyphs[0][1];matrix[5]+=matrix[1]*glyphs[0][1];this.setMatrix(h,matrix);
    M._FPDFPageObj_SetFillColor(h,...object.fill);M._FPDFPageObj_SetStrokeColor(h,...object.stroke);M._FPDFPageObj_SetStrokeWidth(h,object.strokeWidth);M._FPDFTextObj_SetTextRenderMode(h,object.renderMode);
    return h;
  }
  rangeBounds(object,start,end) {
    const h=this.nativeFragment(object,start,end);
    if(!h){const box=object.box;return {...box,w:0};}
    const box=this.deviceBox(h,100);this.e.M._FPDFPageObj_Destroy(h);return box;
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
  inkDensity(mask) {
    let peak=0,sum=0;for(const value of mask.data){peak=Math.max(peak,value);sum+=value;}
    // Normalize foreground contrast so colored letters retain their weight.
    return peak?sum/(peak*mask.data.length):0;
  }
  normalizeContrast(mask) {
    if(!mask)return null;
    let peak=0;for(const value of mask.data)peak=Math.max(peak,value);
    return !peak||peak===255?mask:{...mask,data:Uint8Array.from(mask.data,value=>Math.round(value*255/peak))};
  }
  outlinedItalic(rect) {
    const M=this.e.M,p=M._malloc(24),stems=[];
    try{
      for(const path of this.outlinePaths(rect)){
        M._FPDFPageObj_GetMatrix(path.handle,p);
        const matrix=Array.from(M.HEAPF32.subarray(p>>2,(p>>2)+6)),screen=this.screenMatrix(matrix);
        const add=(a,b)=>{
          if(!a||!b)return;
          const x=b[0]-a[0],y=b[1]-a[1],dx=screen[0]*x-screen[2]*y,dy=screen[1]*x-screen[3]*y;
          if(Math.abs(dy)<Math.max(1,path.box.h*.35))return;
          const slope=-dx/dy;
          if(Math.abs(slope)<=.4)stems.push({slope,weight:Math.abs(dy)});
        };
        let previous=null,start=null;
        for(let i=0;i<M._FPDFPath_CountSegments(path.handle);i++){
          const segment=M._FPDFPath_GetPathSegment(path.handle,i);
          M._FPDFPathSegment_GetPoint(segment,p,p+4);
          const point=[M.HEAPF32[p>>2],M.HEAPF32[(p+4)>>2]],type=M._FPDFPathSegment_GetType(segment);
          if(type===2)start=point;
          else if(type===0)add(previous,point);
          if(M._FPDFPathSegment_GetClose(segment))add(point,start);
          previous=point;
        }
      }
    }finally{M._free(p);}
    if(stems.length<2)return false;
    const total=stems.reduce((sum,s)=>sum+s.weight,0);
    const slanted=stems.filter(s=>s.slope>=.1&&s.slope<=.4).reduce((sum,s)=>sum+s.weight,0);
    // A similar word silhouette alone must never switch upright text to italics.
    return slanted/total>=.7;
  }
  matchFont(line,frame) {
    const source=this.normalizeContrast(this.trimMask(this.croppedMask(frame.image,line.rect,frame.scale)));
    if(!source)return {fontName:'Helvetica',size:Math.max(6,line.rect.h/.72)};
    const sourceDensity=this.inkDensity(source),matches=[];
    const italic=this.outlinedItalic(line.rect);
    const candidates=['Helvetica','Times-Roman','Helvetica-Bold','Times-Bold','Courier',...(italic?['Helvetica-Oblique','Times-Italic','Helvetica-BoldOblique','Times-BoldItalic','Courier-Oblique']:[])];
    for(const fontName of candidates) {
      const handle=this.nativeText(line.text,fontName,12);
      const candidate=this.normalizeContrast(this.trimMask(this.textBitmap(handle,3)));
      if(candidate) {
        const density=this.inkDensity(candidate),weightError=Math.abs(sourceDensity-density);
        const score=this.maskDistance(source,candidate);
        const size=Math.max(5,Math.min(80,12*(.75*(source.width/frame.scale)/(candidate.width/3)+.25*(source.height/frame.scale)/(candidate.height/3))));
        matches.push({fontName,size:Math.round(size*100)/100,score,weightError});
      }
      this.e.M._FPDFPageObj_Destroy(handle);
    }
    const best=items=>items.sort((a,b)=>a.score-b.score)[0];
    const chooseWeight=items=>{
      const regular=best(items.filter(m=>! /Bold/.test(m.fontName))),bold=best(items.filter(m=>/Bold/.test(m.fontName)));
      // A similar silhouette must not turn regular letters bold. Require a
      // clear shape advantage AND source ink coverage closer to bold strokes.
      return bold&&regular&&bold.score+.025<regular.score&&bold.weightError+.015<regular.weightError?bold:regular||bold;
    };
    const upright=chooseWeight(matches.filter(m=>! /Italic|Oblique/.test(m.fontName))),slanted=chooseWeight(matches.filter(m=>/Italic|Oblique/.test(m.fontName)));
    const match=slanted&&upright&&slanted.score+.025<upright.score?slanted:upright||slanted;
    return match?{fontName:match.fontName,size:match.size}:{fontName:'Helvetica',size:Math.max(6,line.rect.h/.72)};
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
    const records=lines.flatMap(splitSpacedWords).filter(l=>l.text.trim()&&l.rect.w>1&&l.rect.h>1&&!native.some(b=>overlaps(l.rect,b))&&this.outlinePaths(l.rect).length>0).map((line,id)=>({...line,id,...this.matchFont(line,frame),converted:false,rgba:[0,0,0,255]}));
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
  convertedObject(line) {const normalize=t=>t.replace(/\s+/g,' ').trim();return this.objects().find(o=>normalize(o.text)===normalize(line.text)&&line.matrix&&o.matrix.every((v,i)=>Math.abs(v-line.matrix[i])<.001));}
  approximateInline(line,scale=1.8) {
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
    const img=this.e.renderPage(scale,hidden);spec.image={...img,data:new Uint8ClampedArray(img.data)};
    if(!line.converted)this.e.M._FPDFPageObj_Destroy(h);
    return spec;
  }
  inline(index,scale=1.8) {
    if(String(index).startsWith('range:')){
      const [,parent,a,b]=String(index).split(':'),start=Number(a),end=Number(b),object=this.objects().find(o=>o.index===Number(parent));
      if(!object)throw new Error('Select this field again.');
      const spec=this.inline(Number(parent),scale),M=this.e.M,fragment=this.nativeFragment(object,start,end),siblings=[];
      try{
        const tp=M._FPDFText_LoadPage(this.e.page),info=this.info(fragment,-1,tp);M._FPDFText_ClosePage(tp);
        for(const [from,to]of[[0,start],[end,[...object.text].length]]){const h=this.nativeFragment(object,from,to);if(h){M._FPDFPage_InsertObject(this.e.page,h);siblings.push(h);}}
        const img=this.e.renderPage(scale,[object.handle]);
        return {...spec,index,text:[...object.text].slice(start,end).join(''),matrix:this.screenMatrix(info.matrix),image:{...img,data:new Uint8ClampedArray(img.data)}};
      }finally{for(const h of siblings){M._FPDFPage_RemoveObject(this.e.page,h);M._FPDFPageObj_Destroy(h);}if(fragment)M._FPDFPageObj_Destroy(fragment);}
    }
    if(String(index).startsWith('ocr:')) {
      const line=this.ocrPages.get(this.e.pageIndex)?.find(o=>o.id===Number(String(index).slice(4)));
      if(!line)throw new Error('Select this text again.');
      return this.approximateInline(line,scale);
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
    const image=this.e.renderPage(scale,[object.handle]);
    return {index,text:object.text,mode:'exact',fontName:object.fontName.replace(/^[A-Z]{6}\+/,''),size:object.size*Math.hypot(object.matrix[2],object.matrix[3]),rawSize:object.size,color:object.fill,matrix:this.screenMatrix(object.matrix),tracking:gaps.length?gaps[Math.floor(gaps.length/2)]:0,fontData,image:{...image,data:new Uint8ClampedArray(image.data)}};
  }
  renderCurrent(scale,index=null){
    if(index!==null)return {image:this.inline(index,scale).image};
    const image=this.e.renderPage(scale);return {image:{...image,data:new Uint8ClampedArray(image.data)}};
  }
  async isolateContent(page) {
    // Keep the original graphics state from leaking into generated objects.
    const pdf=await PDFDocument.load(this.bytes,{updateMetadata:false}),context=pdf.context,node=pdf.getPage(page).node;
    const contents=node.Contents(),refs=contents instanceof PDFArray?contents.asArray():contents?[contents]:[];
    const chunks=refs.map(ref=>context.lookup(ref)).map(stream=>{
      if(!(stream instanceof PDFRawStream))throw new PreservationError('This page has unsupported content streams.');
      return decodePDFRawStream(stream).decode();
    });
    const joined=new Uint8Array(chunks.reduce((n,c)=>n+c.length+1,4));let cursor=0;
    joined.set([113,10],cursor);cursor+=2;
    for(const chunk of chunks){joined.set(chunk,cursor);cursor+=chunk.length;joined[cursor++]=10;}
    joined.set([81,10],cursor);
    node.set(PDFName.of('Contents'),context.register(context.flateStream(joined)));
    this.e.open(await pdf.save({useObjectStreams:false,updateFieldAppearances:false}));this.e.loadPage(page);
  }
  translateHandle(handle,dx,dy) {
    const M=this.e.M,p=M._malloc(24);M._FPDFPageObj_GetMatrix(handle,p);
    const matrix=Array.from(M.HEAPF32.subarray(p>>2,(p>>2)+6));M._free(p);
    const origin=this.screenPoint(0,0),destination=this.screenPoint(dx,dy);
    matrix[4]+=destination.x-origin.x;matrix[5]+=destination.y-origin.y;
    this.setMatrix(handle,matrix);return matrix;
  }
  movementPreview(index,scale=1.8) {
    if(String(index).startsWith('range:'))return {image:this.inline(index,scale).image};
    const line=String(index).startsWith('ocr:')?this.ocrPages.get(this.e.pageIndex)?.find(o=>o.id===Number(String(index).slice(4))):null;
    const handles=line?(line.converted?[this.convertedObject(line)?.handle]:this.outlinePaths(line.rect).map(p=>p.handle)):[this.objects().find(o=>o.index===index)?.handle];
    const image=this.e.renderPage(scale,handles.filter(Boolean));return {image:{...image,data:new Uint8ClampedArray(image.data)}};
  }
  async move(index,x,y) {
    if(!this.bytes)throw new Error('Open a PDF first.');
    if(!Number.isFinite(x)||!Number.isFinite(y))throw new PreservationError('Choose a valid position on the page.');
    const page=this.e.pageIndex,current=this.view(),selected=current.objects.find(o=>o.index===index);
    if(!selected)throw new PreservationError('Select this text box again.');
    const dx=x-selected.box.x,dy=y-selected.box.y;
    if(Math.abs(dx)<.005&&Math.abs(dy)<.005)return {...current,movedIndex:index};
    const destination={...selected.box,x,y};
    if(x<-.01||y<-.01||x+destination.w>current.width+.01||y+destination.h>current.height+.01)throw new PreservationError('Keep the whole text box inside the page.');
    const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    if(current.objects.some(o=>o.index!==index&&overlaps(destination,o.box)&&!overlaps(selected.box,o.box)))throw new PreservationError('This position overlaps another text box. Move it to a clear area.');
    const oldBytes=this.bytes,snapshot=structuredClone([...this.ocrPages]),scale=1.5,frame=this.e.renderPage(scale),before={...frame,data:new Uint8ClampedArray(frame.data)};
    const M=this.e.M,normalize=t=>t.replace(/\s+/g,' ').trim(),close=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<.002);
    let fragments=[];
    try {
      await this.isolateContent(page);this.checkPixels(before,this.e.renderPage(scale),[],scale);
      let handles=[],original,expected,paths;
      const line=String(index).startsWith('ocr:')?this.ocrPages.get(page)?.find(o=>o.id===Number(String(index).slice(4))):null;
      if(line&&!line.converted){
        paths=this.outlinePaths(line.rect);handles=paths.map(p=>p.handle);
        if(!handles.length)throw new PreservationError('The original outlined letters could not be located.');
      }else if(String(index).startsWith('range:')){
        const [,parent,a,b]=String(index).split(':'),start=Number(a),end=Number(b),object=this.objects().find(o=>o.index===Number(parent));
        if(!object)throw new PreservationError('Select this field again.');
        for(const {start:from,end:to}of this.nativeRanges(object)){
          const handle=this.nativeFragment(object,from,to);if(!handle)continue;
          fragments.push(handle);M._FPDFPage_InsertObject(this.e.page,handle);
          if(from===start&&to===end)handles=[handle];
        }
        if(!handles.length)throw new PreservationError('This text field could not be isolated.');
        const tp=M._FPDFText_LoadPage(this.e.page);original=this.info(handles[0],-1,tp);M._FPDFText_ClosePage(tp);
        if(!M._FPDFPage_RemoveObject(this.e.page,object.handle))throw new PreservationError('This text field could not be moved.');
        M._FPDFPageObj_Destroy(object.handle);
      }else{
        original=line?this.convertedObject(line):this.objects().find(o=>o.index===index);
        if(!original)throw new PreservationError('The text box could not be located.');
        handles=[original.handle];
      }
      const digest=original?await this.fontDigest(original.font):null;
      const glyphs=original?JSON.stringify(this.stateFor(original)?.glyphs):null;
      const translated=handles.map(h=>this.translateHandle(h,dx,dy));expected=translated[0];
      const movedBounds=handles.map(h=>this.deviceBox(h,100));
      if(!M._FPDFPage_GenerateContent(this.e.page))throw new PreservationError('The PDF engine could not save this move.');
      this.e._pageDirty=false;
      const candidate=this.e.save({noRegen:true});if(!candidate?.length)throw new PreservationError('The moved PDF could not be exported.');
      this.e.open(candidate);this.e.loadPage(page);fragments=[];
      let movedIndex=index;
      if(original){
        const updated=this.objects().find(o=>normalize(o.text)===normalize(original.text)&&o.fontName===original.fontName&&Math.abs(o.size-original.size)<.0001&&close(o.matrix,expected));
        if(!updated||await this.fontDigest(updated.font)!==digest||JSON.stringify(this.stateFor(updated)?.glyphs)!==glyphs||!close(updated.fill,original.fill)||!close(updated.stroke,original.stroke)||updated.renderMode!==original.renderMode||Math.abs(updated.strokeWidth-original.strokeWidth)>.0001)throw new PreservationError('Export did not preserve this text’s font, size and glyphs. The move was cancelled.');
        if(line){line.matrix=updated.matrix;line.rect=this.deviceBox(updated.handle,100);}else movedIndex=updated.index;
      }else{
        // A move keeps the original vector lettering; no font substitution is needed.
        for(let i=0;i<paths.length;i++){
          const path=this.e.objectAt(paths[i].index),p=M._malloc(24);
          if(path?.type!==2){M._free(p);throw new PreservationError('An outlined letter did not survive the move.');}
          M._FPDFPageObj_GetMatrix(path.handle,p);const matrix=Array.from(M.HEAPF32.subarray(p>>2,(p>>2)+6));M._free(p);
          if(!close(matrix,translated[i]))throw new PreservationError('An outlined letter changed during export.');
        }
        line.rect=destination;
      }
      this.checkPixels(before,this.e.renderPage(scale),[selected.box,destination,...movedBounds],scale);
      this.history.push(oldBytes);if(this.history.length>15)this.history.shift();
      this.ocrHistory.push(snapshot);if(this.ocrHistory.length>15)this.ocrHistory.shift();
      this.bytes=candidate;this.edits++;
      return {...this.view(page),movedIndex};
    }catch(error){
      this.ocrPages=new Map(snapshot);this.e.open(oldBytes);this.e.loadPage(page);throw error;
    }
  }
  async apply(index,text) {
    const snapshot=structuredClone([...this.ocrPages]),oldBytes=this.bytes;
    let result;
    if(String(index).startsWith('range:')){
      const [,parent,a,b]=String(index).split(':'),start=Number(a),end=Number(b),object=this.objects().find(o=>o.index===Number(parent));
      if(!object)throw new Error('Select this field again.');
      const chars=[...object.text],range={start,end:start+[...text].length,box:this.rangeBounds(object,start,end),otherBoxes:this.nativeRanges(object).filter(r=>r.start!==start).map(r=>this.rangeBounds(object,r.start,r.end))};
      result=await super.apply(Number(parent),chars.slice(0,start).join('')+text+chars.slice(end).join(''),{lockSuffix:{oldEnd:end,newEnd:range.end},range});
    }else result=String(index).startsWith('ocr:')?await this.applyApproximate(index,text):await super.apply(index,text);
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
    let removed=[],newHandle=null,bounds=line.rect;
    try {
      // Isolate inherited page transforms before appending a new text object.
      // This changes only the in-memory working copy, never the uploaded file.
      const document=await PDFDocument.load(oldBytes,{updateMetadata:false});
      const node=document.getPage(page).node,contents=node.Contents();
      const streams=contents instanceof PDFArray?contents.asArray().map(ref=>document.context.lookup(ref)):[contents];
      const chunks=streams.filter(Boolean).map(stream=>{if(!(stream instanceof PDFRawStream))throw new Error('The original page stream could not be isolated.');return decodePDFRawStream(stream).decode();});
      const combined=new Uint8Array(chunks.reduce((n,c)=>n+c.length+1,4));
      combined.set([113,10]);let offset=2;
      for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;combined[offset++]=10;}
      combined.set([81,10],offset);
      node.set(PDFName.Contents,document.context.register(document.context.flateStream(combined)));
      const working=await document.save({useObjectStreams:false,updateFieldAppearances:false});
      this.e.open(working);this.e.loadPage(page);
      this.checkPixels(before,this.e.renderPage(scale),[],scale);
      removed=line.converted?[this.convertedObject(line)].filter(Boolean):this.outlinePaths(line.rect);
      if(!removed.length)throw new PreservationError('The original outlined letters could not be isolated safely. This edit was cancelled.');
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
      this.e._pageDirty=false;
      const candidate=this.e.save({noRegen:true});if(!candidate?.length)throw new Error('The PDF could not be exported.');
      this.e.open(candidate);this.e.loadPage(page);
      if(text){const normalize=t=>t.replace(/\s+/g,' ').trim();const updated=this.objects().find(o=>{const b=this.deviceBox(o.handle,100);return normalize(o.text)===normalize(text)&&this.stateFor(o)?.glyphs.length===[...text].length&&o.fontName===line.fontName&&Math.abs(o.size-line.size)<.001&&Math.abs(b.x-bounds.x)<.1&&Math.abs(b.y-bounds.y)<.1;});if(!updated)throw new PreservationError('The replacement did not survive PDF export.');line.matrix=updated.matrix;line.rect=bounds;}
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
