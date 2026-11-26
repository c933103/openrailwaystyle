import {hasMongolian, mongolianSegments} from './mongolian-text.mjs';

const joiner='\u200D', letter=/^\p{Letter}/u;
const joinBetween=(left,right)=>letter.test(left)&&letter.test(right)&&!left.endsWith('\u200C');
const breaks=/[ \t]+/u;
const columnBudget=10;
const graphemes=typeof Intl.Segmenter==='function' ? new Intl.Segmenter('mn',{granularity:'grapheme'}) : null;
const units=text=>graphemes?Array.from(graphemes.segment(text),part=>part.segment)
  :Array.from(text).reduce((parts,character)=>{
    if(parts.length&&/[\p{Mark}\u180B-\u180D\u180F\u200C\u200D]/u.test(character))parts[parts.length-1]+=character;
    else parts.push(character);
    return parts;
  },[]);

// Share normal word separators and joining controls between consecutive
// Mongolian segments; punctuation/other scripts remain their own text.
function runs(text){
  const parts=mongolianSegments(text), result=[];
  for(let i=0;i<parts.length;i++){
    let {text,mongolian}=parts[i];
    while(mongolian&&parts[i+2]?.mongolian&&/^[ \t\u200C\u200D]+$/u.test(parts[i+1].text)){
      text+=parts[i+1].text+parts[i+2].text; i+=2;
    }
    result.push({text,mongolian});
  }
  return result;
}

function columns(text, measure, limit){
  const output=[];
  let current='';
  const flush=()=>{if(current){output.push(current);current='';}};
  for(const word of text.split(breaks).filter(Boolean)){
    const append=current?current+' '+word:word;
    if(measure(append)<=limit){current=append;continue;}
    flush();
    if(measure(word)<=limit){current=word;continue;}
    // Do not split a variation selector or combining mark from its base.
    // Keep the letter's joining form at a forced break in a long word.
    const letters=units(word);
    for(let start=0;start<letters.length;){
      let end=start+1, segment='';
      const make=end=>{
        const head=start>0&&joinBetween(letters[start-1],letters[start])?joiner:'';
        const tail=end<letters.length&&joinBetween(letters[end-1],letters[end])?joiner:'';
        return head+letters.slice(start,end).join('')+tail;
      };
      segment=make(end);
      while(end<letters.length){
        const next=make(end+1);
        if(measure(next)>limit)break;
        segment=next;end++;
      }
      if(end===letters.length)current=segment;else output.push(segment);
      start=end;
    }
  }
  flush();
  return output;
}

// Canvas shapes a complete run in the font, then a clockwise quarter
// turn puts its joining spine top to bottom. Rotating separate glyphs
// would lose that shaping. This layout is only for point labels.
export function flatMongolianLayout(context,text,size,normalFont,mongolianFont,maxWidth){
  if(!hasMongolian(text)||!mongolianFont)return null;
  const lineHeight=size*1.2,limit=size*(Number.isFinite(maxWidth)&&maxWidth>0?maxWidth:columnBudget);
  const lines=text.split('\n').filter(Boolean).map(line=>{
    let width=0,height=lineHeight;const pieces=[];
    for(const part of runs(line)){
      context.font=part.mongolian?mongolianFont:normalFont;
      if(!part.mongolian){
        const {width:advance}=context.measureText(part.text);
        pieces.push({text:part.text,x:width,y:lineHeight/2,font:normalFont,rotated:false});
        pieces.at(-1).rect={left:width,right:width+advance,top:0,bottom:lineHeight};
        width+=advance;continue;
      }
      const measure=t=>context.measureText(t).width;
      for(const column of columns(part.text,measure,limit)){
        const m=context.measureText(column);
        const left=Math.max(0,m.actualBoundingBoxDescent||0);
        const right=Math.max(0,m.actualBoundingBoxAscent||0);
        const top=Math.max(0,m.actualBoundingBoxLeft||0);
        const bottom=Math.max(m.width,m.actualBoundingBoxRight||0);
        const x=width+Math.max(left,lineHeight/2);
        const step=Math.max(lineHeight,x-width+right+size*.15);
        pieces.push({text:column,x,y:top,font:mongolianFont,rotated:true,
          rect:{left:width,right:width+step,top:0,bottom:top+bottom}});
        width+=step;height=Math.max(height,top+bottom);
      }
    }
    return {width,height,pieces};
  });
  context.font=normalFont;
  const width=Math.max(0,...lines.map(line=>line.width));
  let height=0;
  const pieces=lines.flatMap(line=>{
    const offX=(width-line.width)/2, offY=height;
    height+=line.height;
    return line.pieces.map(piece=>({...piece,x:piece.x+offX,y:piece.y+offY,
      rect:{left:piece.rect.left+offX,right:piece.rect.right+offX,
        top:piece.rect.top+offY,bottom:piece.rect.bottom+offY}}));
  });
  return {width,height,pieces};
}
