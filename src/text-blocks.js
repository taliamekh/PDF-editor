// Keep normal word spacing within a field; split larger visual gaps and columns.
export function splitSpacedWords(line) {
  const words=(line.words||[]).filter(w=>w.text.trim()).sort((a,b)=>a.rect.x-b.rect.x);
  if(!words.length)return [line];
  const gaps=words.slice(1).map((w,i)=>w.rect.x-(words[i].rect.x+words[i].rect.w)).filter(g=>g>0).sort((a,b)=>a-b);
  const normal=gaps[Math.floor((gaps.length-1)*.25)]||0;
  const threshold=Math.max(2.5,line.rect.h*.45,Math.min(normal,line.rect.h*.22)*2.2);
  const groups=[];let group=[];
  for(const word of words){const last=group.at(-1);if(last&&word.rect.x-last.rect.x-last.rect.w>threshold){groups.push(group);group=[];}group.push(word);}
  if(group.length)groups.push(group);
  return groups.map(group=>{
    const x=Math.min(...group.map(w=>w.rect.x)),y=Math.min(...group.map(w=>w.rect.y)),r=Math.max(...group.map(w=>w.rect.x+w.rect.w)),b=Math.max(...group.map(w=>w.rect.y+w.rect.h));
    return {text:group.map(w=>w.text.trim()).join(' '),confidence:Math.min(...group.map(w=>w.confidence??line.confidence)),rect:{x,y,w:r-x,h:b-y}};
  });
}
