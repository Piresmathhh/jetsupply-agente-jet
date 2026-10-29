// Motor puro: não consulta contas, não publica produtos e não utiliza IA.
import {groupTitle} from './names.mjs';
// IDs conferidos na árvore Tray. Nomes nunca criam vínculos automaticamente.
export const CATEGORY_IDS = Object.freeze({'22':'5','23':'19','24':'15','25':'17','603':'25','604':'29'});
export const PRODUCT_FIELDS = ['Referência (código fornecedor)','Nome do produto','Exibir na loja','Exibir produto ativo','Código da categoria principal (ID)','Reservado F - não importar','Reservado G - não importar','HTML da descrição completa','Marca','Modelo','NCM do produto','Tempo de garantia','Peso do produto (gramas)','Altura (cm)','Largura (cm)','Comprimento (cm)','Preço de venda em reais','Estoque do produto','Endereço da imagem principal do produto',...Array.from({length:6},(_,i)=>`Endereço da imagem do produto ${i+2}`)];
export const VARIATION_FIELDS = ['Código de referência do produto','Referência da Variação','Código EAN/GTIN/UPC','Tipo da variação 1 (exemplo: Cor)','Nome da variação 1 (exemplo: Branco)','Peso da variação (gramas)','Altura (cm)','Largura (cm)','Comprimento (cm)','Preço de venda em reais','Estoque da variação','Endereço da imagem principal da variação',...Array.from({length:6},(_,i)=>`Endereço da imagem da variação ${i+2}`)];
export const id = x => x == null ? '' : String(x).trim();
export function occupiedRange(sheet,decodeCell) {
  const range={s:{r:Infinity,c:Infinity},e:{r:0,c:0}};
  for(const [key,cell] of Object.entries(sheet)){
    if(key.startsWith('!')||cell.v===undefined||cell.v===null||cell.v==='')continue;
    const p=decodeCell(key);range.s.r=Math.min(range.s.r,p.r);range.s.c=Math.min(range.s.c,p.c);range.e.r=Math.max(range.e.r,p.r);range.e.c=Math.max(range.e.c,p.c);
  }
  if(!Number.isFinite(range.s.r))throw Error('Planilha vazia.');
  if(range.e.r>200000||range.e.c>500||(range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>5000000)throw Error('Intervalo muito grande. Exporte um lote menor.');
  return range;
}
const esc = x => id(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrName = x => id(x)==='Número de Polos'?'Número de polos':id(x);
export function validEAN(s) {
  s=id(s); if(![8,12,13,14].includes(s.length)||!/^[0-9]+$/.test(s))return false;
  const a=[...s.slice(0,-1)].reverse();
  return (10-a.reduce((v,c,i)=>v+Number(c)*(i%2?1:3),0)%10)%10===Number(s.at(-1));
}
function number(x,label,{integer=false,positive=false}={}) {
  if(x===null||x===undefined||id(x)==='')throw Error(`${label}: valor ausente.`);
  const n=Number(typeof x==='string'?x.replace(',','.'):x);
  if(!Number.isFinite(n)||n<0||(positive&&n===0)||(integer&&!Number.isInteger(n)))throw Error(`${label}: valor inválido (${id(x)}).`);
  return n;
}
export function categoryPaths(rows) {
  const out=new Map();
  for(const r of rows){let path=[];for(const level of ['PRIMEIRO','SEGUNDO','TERCEIRO','QUARTO']){
    const name=id(r[`NOME_${level}_NIVEL`]),code=id(r[`ID_${level}_NIVEL`]);
    if(!name)continue;
    path.push(name);
    if(!code||code==='0')throw Error(`Categoria sem código: ${path.join(' > ')}`);
    if(out.has(code)&&JSON.stringify(out.get(code))!==JSON.stringify(path))throw Error(`Código de categoria ambíguo: ${code}`);
    out.set(code,[...path]);
  }}return out;
}
export function imageNames(manifest) {
  const list=Array.isArray(manifest)?manifest:Object.values(manifest||{}).flat();
  return [...new Set(list.map(x=>id(typeof x==='string'?x:x.name)).filter(Boolean))];
}
function photos(sku,names,base,warnings) {
  const safe=sku.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(`^${safe}(?:_(\\d+))?\\.(?:jpe?g|png|webp)$`,'i');
  const files=names.filter(n=>re.test(n)).sort((a,b)=>Number(a.match(re)[1]||0)-Number(b.match(re)[1]||0)||a.localeCompare(b));
  if(files.length>7)throw Error(`SKU ${sku}: ${files.length} imagens; o perfil atual aceita 7. Divida/revise antes de exportar.`);
  if(!files.length)warnings.push(`SKU ${sku}: nenhuma imagem no inventário.`);
  return Array.from({length:7},(_,i)=>files[i]?base+encodeURIComponent(files[i]):null);
}
export function convert({products,characteristics,tree}, options={}) {
  if(!products?.length||!characteristics?.length||!tree?.length)throw Error('Carregue as três planilhas com dados.');
  const warnings=[], groups=new Map(),attrs=new Map(),meta=new Map(),seen=new Set(),eanSeen=new Set();
  const cats=categoryPaths(tree), names=imageNames(options.images);
  const base=options.imageBase?id(options.imageBase).replace(/\/*$/,'/'):'';
  if(names.length&&!/^https?:\/\//i.test(base))throw Error('Informe a URL pública das imagens, começando com http:// ou https://.');
  if(base.startsWith('http:'))warnings.push('Servidor de imagens usa HTTP. Verifique se a Tray consegue baixar as URLs.');
  if(names.length)warnings.push('URLs montadas a partir do inventário de nomes; disponibilidade HTTP não foi verificada nesta conversão.');
  for(const r of characteristics){
    const pid=id(r.PROD_ID), name=attrName(r.CARACT_NOME), value=id(r.CARACT_VALOR);
    if(!pid||!name||!value)throw Error('Característica sem PROD_ID, nome ou valor.');
    if(!attrs.has(pid))attrs.set(pid,new Map());
    const a=attrs.get(pid);if(a.has(name)&&a.get(name)!==value)throw Error(`Produto ${pid}: característica duplicada e conflitante (${name}).`);
    a.set(name,value);
    const prev=meta.get(pid);
    if(prev&&['PROD_COD_AGRUPAMENTO','CATEGORIA_TREEVIEW_ID','MARCA_NOME','LINHA_NOME','PROD_SKU'].some(k=>id(prev[k])!==id(r[k])))throw Error(`Produto ${pid}: metadados conflitantes nas características.`);
    meta.set(pid,r);
  }
  const sourceGroups=new Map();
  for(const p of products){const group=id(meta.get(id(p.ID))?.PROD_COD_AGRUPAMENTO);if(!group||group==='0')continue;if(!sourceGroups.has(group))sourceGroups.set(group,[]);sourceGroups.get(group).push(p);}
  const skippedGroups=[...sourceGroups].filter(([group,items])=>!items.some(p=>id(p.ID)===group)).map(([group,items])=>({groupId:group,reason:'Produto pai ausente no lote',skus:items.map(p=>id(p['Código']))}));
  const skippedIds=new Set(skippedGroups.map(g=>g.groupId));
  for(const group of skippedGroups)warnings.push(`Grupo ${group.groupId}: pai ausente. ${group.skus.length} SKU(s) não incluídos: ${group.skus.join(', ')}. Inclua o pai nas duas exportações e gere esse grupo novamente.`);
  for(const p of products){
    const pid=id(p.ID),sku=id(p['Código']),m=meta.get(pid);
    if(m&&skippedIds.has(id(m.PROD_COD_AGRUPAMENTO)))continue;
    let ean=id(p['Código barras']);
    if(!pid||!sku||seen.has(sku))throw Error(`SKU vazio ou duplicado: ${sku}`);seen.add(sku);
    if(!m)throw Error(`SKU ${sku}: sem características vinculadas ao ID ${pid}.`);
    if(id(m.PROD_SKU)!==sku)throw Error(`SKU ${sku}: diverge do arquivo de características.`);
    if(ean&&(!validEAN(ean)||eanSeen.has(ean))){
      warnings.push(`SKU ${sku}: EAN ${validEAN(ean)?'duplicado':'fora do padrão'} (${ean}); exportado em branco. Corrija o código de barras antes de integrar canais que exigem GTIN.`);
      ean='';
    }else if(ean)eanSeen.add(ean);else warnings.push(`SKU ${sku}: EAN ausente.`);
    const group=id(m.PROD_COD_AGRUPAMENTO);
    if(!group||group==='0')throw Error(`SKU ${sku}: grupo ausente. Defina o agrupamento no Signus.`);
    const cat=cats.get(id(m.CATEGORIA_TREEVIEW_ID));
    if(!cat)throw Error(`SKU ${sku}: categoria não encontrada na árvore.`);
    if(cat.length>3)throw Error(`SKU ${sku}: categoria possui 4 níveis. Faça um de-para explícito para a Tray; não truncamos a árvore.`);
    const trayCategoryId=CATEGORY_IDS[id(m.CATEGORIA_TREEVIEW_ID)];
    if(!trayCategoryId)throw Error(`SKU ${sku}: categoria Signus ${id(m.CATEGORIA_TREEVIEW_ID)} sem vínculo cadastrado com a Tray. Cadastre o ID existente na Tray antes de exportar; nenhuma categoria será criada por nome.`);
    const commercial=options.commercialBySku?.[sku]||{};
    const price=number(commercial.price??options.price,`Preço do SKU ${sku}`,{positive:true});
    const stock=number(commercial.stock??options.stock,`Estoque do SKU ${sku}`,{integer:true});
    const dims=['Altura (cm)','Largura (cm)','Profundidade (cm)'].map(k=>{const n=number(p[k],`${k} do SKU ${sku}`,{positive:true});if(n!==Math.ceil(n))warnings.push(`SKU ${sku}: ${k} ${n} → ${Math.ceil(n)} cm, arredondado para cima para envio.`);return Math.ceil(n);});
    const item={p,pid,sku,ean,m,group,cat,trayCategoryId,a:attrs.get(pid),price,stock,dims,weight:Math.round(number(p.Peso,`Peso do SKU ${sku}`,{positive:true})*1000),photos:photos(sku,names,base,warnings)};
    if(!groups.has(group))groups.set(group,[]);groups.get(group).push(item);
  }
  if(meta.size!==products.length)throw Error('Quantidade de IDs nas características difere dos produtos. Revise registros sem correspondência e IDs duplicados.');
  const parentRows=[],variationRows=[],fixedRows=[],allFixed=new Set(),requirements=[];
  for(const [group,items] of groups){
    if(items.length>100)throw Error(`Grupo ${group}: excede 100 variações por produto.`);
    const first=items.find(x=>x.pid===group);
    if(!first)throw Error(`Grupo ${group}: produto pai ausente no lote. Inclua o produto cujo ID é igual ao código de agrupamento.`);
    const reference=first.sku;
    for(const key of ['trayCategoryId','cat','brand','model','ncm']){
      const values=items.map(x=>JSON.stringify(key==='trayCategoryId'?x.trayCategoryId:key==='cat'?x.cat:key==='brand'?x.p.Marca:key==='model'?x.p['Linha de produto']:x.p['Categoria fiscal']));
      if(new Set(values).size!==1)throw Error(`Grupo ${group}: ${key} diverge entre SKUs. Revise o agrupamento.`);
    }
    const keys=new Set(items.flatMap(x=>[...x.a.keys()])),varying=[],fixed={};
    for(const key of keys){const vals=items.map(x=>x.a.get(key));if(vals.some(x=>x===undefined))throw Error(`Grupo ${group}: atributo ${key} ausente em um SKU.`);if(new Set(vals).size>1)varying.push(key);else fixed[key]=vals[0];}
    if(items.length>1&&varying.length!==1)throw Error(`Grupo ${group}: detectados ${varying.length} eixos variáveis (${varying.join(', ')}). Este perfil exige exatamente um eixo; não cria combinações por suposição.`);
    const axis=varying[0];
    if(axis&&new Set(items.map(x=>x.a.get(axis))).size!==items.length)throw Error(`Grupo ${group}: duas referências têm o mesmo valor de ${axis}.`);
    const title=id(options.titles?.[reference]||options.titles?.[group]||groupTitle({name:first.p.Nome,brand:first.p.Marca,sku:first.sku,axisValue:axis?first.a.get(axis):'',axisValues:axis?items.map(x=>x.a.get(axis)):[],model:first.p['Linha de produto']}));
    if(!title||title.length>200)throw Error(`Grupo ${group}: título ausente ou maior que 200 caracteres.`);
    const cat=[first.trayCategoryId,null,null];
    const model=id(first.p['Linha de produto']).split(/\s+-\s+/).filter(part=>part.toLowerCase()!==id(first.p.Marca).toLowerCase()).join(' - ');
    const description=`<p>${esc(title)}</p><ul>${Object.entries(fixed).map(([k,v])=>`<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul>`;
    parentRows.push([reference,title,'Não','Não',...cat,description,id(first.p.Marca),model,id(first.p['Categoria fiscal']),`${number(first.p['Garantia (em dias)'],'Garantia',{integer:true})} dias`,first.weight,...first.dims,Math.min(...items.map(x=>x.price)),items.reduce((n,x)=>n+x.stock,0),...first.photos]);
    if(axis){items.sort((a,b)=>a.a.get(axis).localeCompare(b.a.get(axis),'pt-BR',{numeric:true}));for(const x of items)variationRows.push([reference,x.sku,x.ean,axis,x.a.get(axis),x.weight,...x.dims,x.price,x.stock,...x.photos]);}
    else warnings.push(`Grupo ${group}: produto simples; referência comercial mantida no relatório como SKU ${first.sku}.`);
    Object.keys(fixed).forEach(k=>allFixed.add(k));fixedRows.push({reference,fixed});
    requirements.push({reference,groupId:group,parentId:first.pid,category:first.cat.join(' > '),signusCategoryId:id(first.m.CATEGORIA_TREEVIEW_ID),trayCategoryId:first.trayCategoryId,attributes:fixed,variationAxis:axis||null,skus:items.map(x=>x.sku)});
  }
  const fixedKeys=[...allFixed].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  // Preserva o modelo técnico já validado para o piloto.
  const pilotKeys=['Número de polos','Curva de Disparo','Tensão de Emprego','Frequência'];
  const order=fixedKeys.length===4&&pilotKeys.every(k=>allFixed.has(k))?pilotKeys:fixedKeys;
  return {products:{headers:PRODUCT_FIELDS,rows:parentRows},variations:{headers:VARIATION_FIELDS,rows:variationRows},properties:{headers:['Referência produto',...order],rows:order.length?fixedRows.filter(x=>Object.keys(x.fixed).length).map(x=>[x.reference,...order.map(k=>x.fixed[k]??null)]):[]},warnings,requirements,skippedGroups,summary:{sourceProducts:products.length,exportedSkus:requirements.reduce((n,r)=>n+r.skus.length,0),skippedSkus:skippedGroups.reduce((n,g)=>n+g.skus.length,0),skippedGroups:skippedGroups.length,parents:parentRows.length,variations:variationRows.length,photos:variationRows.reduce((n,r)=>n+r.slice(11).filter(Boolean).length,0)},models:{product:133457,variation:24682,property:order.join('|')===pilotKeys.join('|')?14874:null}};
}
