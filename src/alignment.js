export function alignedPosition(box,target,alignment) {
  const result={x:box.x,y:box.y};
  if(alignment==='left')result.x=target.x;
  if(alignment==='center')result.x=target.x+(target.w-box.w)/2;
  if(alignment==='right')result.x=target.x+target.w-box.w;
  if(alignment==='top')result.y=target.y;
  if(alignment==='middle')result.y=target.y+(target.h-box.h)/2;
  if(alignment==='bottom')result.y=target.y+target.h-box.h;
  return result;
}

export function snapPosition(box,position,page,others,tolerance=5,disabled=false,axis=null) {
  let x=Math.max(0,Math.min(page.width-box.w,position.x)),y=Math.max(0,Math.min(page.height-box.h,position.y));
  if(axis==='x')y=box.y;if(axis==='y')x=box.x;
  const guides=[];
  if(!disabled)for(const dimension of ['x','y']){
    if(axis&&(axis==='x'?'y':'x')===dimension)continue;
    const size=dimension==='x'?'w':'h',extent=dimension==='x'?page.width:page.height,origin=dimension==='x'?x:y;
    const targets=[{value:extent/2,offset:box[size]/2,page:true},{value:0,offset:0,page:true},{value:extent,offset:box[size],page:true}];
    for(const other of others)for(const offset of [0,box[size]/2,box[size]])for(const value of [other[dimension],other[dimension]+other[size]/2,other[dimension]+other[size]])targets.push({value,offset,page:false});
    const best=targets.map(t=>({...t,delta:t.value-(origin+t.offset)})).filter(t=>Math.abs(t.delta)<=tolerance&&origin+t.delta>=-.001&&origin+t.delta+box[size]<=extent+.001).sort((a,b)=>Math.abs(a.delta)-Math.abs(b.delta)||Number(b.page)-Number(a.page))[0];
    if(best){if(dimension==='x')x+=best.delta;else y+=best.delta;guides.push({axis:dimension,value:best.value,page:best.page});}
  }
  return {x,y,guides};
}
