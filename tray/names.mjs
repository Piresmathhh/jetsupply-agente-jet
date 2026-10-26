const text=x=>x==null?'':String(x).trim();
const escapeRE=x=>text(x).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const connectors=new Set(['a','de','da','do','das','dos','e','em','com','para','por']);
function formatWords(value){
  return value.split(/\s+/).filter(Boolean).map((token,i)=>{
    if(connectors.has(token.toLowerCase())&&i)return token.toLowerCase();
    // Mantém unidades elétricas e siglas técnicas; palavras comuns seguem o padrão Zydon.
    if(/^(?:\d+(?:[.,]\d+)?(?:A|VCA|VCC|V|HZ|KA|P))(?:\/(?:\d+(?:[.,]\d+)?(?:A|VCA|VCC|V|HZ|KA|P)))?$/i.test(token))return token.toUpperCase();
    return token.toLowerCase().replace(/(^|[/])([a-zà-ÿ])/g,(_,sep,c)=>sep+c.toUpperCase());
  }).join(' ');
}
export function groupTitle({name,brand,sku,axisValue,axisValues=[],model}){
  let raw=text(name).replace(/\(\s*Subs?titu[ií]do\s+por\s*:\s*\d+\s*\)/gi,'').trim();
  if(sku)raw=raw.replace(new RegExp('\\s*-\\s*'+escapeRE(sku)+'(?=\\s*(?:-|$))','g'),'');
  const values=[...new Set(axisValues.map(text))];
  if(values.length>1){
    const numeric=values.map(value=>{const m=value.match(/^(\d+(?:[.,]\d+)?)\s*([^\d]*)$/);return m?{value,n:Number(m[1].replace(',','.')),unit:m[2].trim().toUpperCase()}:null;});
    let label;
    if(numeric.every(Boolean)&&new Set(numeric.map(v=>v.unit)).size===1){numeric.sort((a,b)=>a.n-b.n);label=`${numeric[0].value} a ${numeric.at(-1).value}`;}
    else label=values.join(', ');
    const pattern=escapeRE(axisValue).replace(/\\ /g,'\\s*');
    const re=new RegExp('(^|[^\\p{L}\\p{N}])'+pattern+'(?=$|[^\\p{L}\\p{N}])','iu');
    if(axisValue&&re.test(raw))raw=raw.replace(re,(_,prefix)=>prefix+label);
    else raw=`${raw} (${label})`;
  }
  if(brand)raw=raw.replace(new RegExp('(^|\\s|-)'+escapeRE(brand)+'(?=$|\\s|-)','gi'),'$1');
  const parts=raw.split(/\s*-\s*/).map(x=>x.trim()).filter(Boolean);
  const modelParts=text(model).split(/\s*-\s*/).map(x=>x.trim()).filter(x=>x&&x.toLowerCase()!==text(brand).toLowerCase());
  const result=parts.map(part=>modelParts.some(m=>m.toLowerCase()===part.toLowerCase())?part.toUpperCase():formatWords(part)).join(' - ');
  return [result,brand?text(brand).toUpperCase():''].filter(Boolean).join(' - ').replace(/\s{2,}/g,' ').trim();
}
