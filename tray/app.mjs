import {convert,imageNames,id,occupiedRange} from './engine.mjs';
const $=id=>document.getElementById(id),steps=['files','settings','review'];
const sources={},overrides={};let output=null,currentStep='files',busy=false;
const say=(message='',error=false)=>{$('status').textContent=message;$('status').dataset.error=String(error);};
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const required={products:['ID','Código','Nome','Peso'],characteristics:['PROD_ID','PROD_SKU','PROD_COD_AGRUPAMENTO','CATEGORIA_TREEVIEW_ID','CARACT_NOME','CARACT_VALOR'],tree:['ID_PRIMEIRO_NIVEL','NOME_PRIMEIRO_NIVEL']};
const ready=()=>Object.keys(required).every(k=>sources[k]);
function showStep(step,focus=false){
  if(busy)return;
  if(step==='settings'&&!ready()){say('Selecione as três planilhas antes de continuar.',true);step='files';}
  if(step==='review'&&!output){say('Prepare o lote em Ajustes para abrir a revisão.',true);step=ready()?'settings':'files';}
  currentStep=step;
  document.querySelectorAll('[data-pane]').forEach(n=>n.hidden=n.dataset.pane!==step);
  document.querySelectorAll('[data-step]').forEach(n=>{const active=n.dataset.step===step;n.setAttribute('aria-selected',String(active));n.tabIndex=active?0:-1;});
  if(focus)$('tab-'+step).focus();
}
document.querySelectorAll('[data-step]').forEach(tab=>{
  tab.addEventListener('click',()=>showStep(tab.dataset.step));
  tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const i=steps.indexOf(currentStep);const next=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;showStep(steps[next],true);});
});
document.querySelectorAll('[data-goto]').forEach(button=>button.addEventListener('click',()=>{say();showStep(button.dataset.goto);}));
$('continue').addEventListener('click',()=>{say();showStep('settings');});
function invalidate(){output=null;$('export-status').textContent='';}
async function readSheet(file,columns=[]){
  if(!file)throw Error('Selecione a planilha.');
  if(!window.XLSX)throw Error('Biblioteca de planilhas não carregada. Recarregue a página.');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=wb.Sheets[wb.SheetNames[0]];
  const range=occupiedRange(sheet,XLSX.utils.decode_cell);
  const data=XLSX.utils.sheet_to_json(sheet,{defval:null,raw:true,range:XLSX.utils.encode_range(range)});
  if(!data.length)throw Error(`${file.name}: planilha vazia.`);
  for(const key of columns)if(!(key in data[0]))throw Error(`${file.name}: coluna obrigatória ausente (${key}).`);
  for(const row of data)for(const key of Object.keys(row))if(/(^ID$|SKU|^Código|COD_BAR)/.test(key)&&typeof row[key]==='number'&&!Number.isSafeInteger(row[key]))throw Error(`${file.name}: identificador inseguro em ${key}. Exporte esse campo como texto.`);
  return data;
}
function updateSources(){
  const count=Object.keys(sources).length;
  for(const key of Object.keys(required))$(key+'-info').textContent=sources[key]?`${sources[key].name} · ${sources[key].data.length} registros`:'Nenhum arquivo';
  $('continue').disabled=!ready();$('file-summary').textContent=ready()?`${sources.products.data.length} produtos de origem · arquivos prontos para conferir.`:`${count} de 3 arquivos selecionados`;
  $('drop').hidden=ready();
}
async function loadSources(files,expected){
  if(!files.length)return;invalidate();say('Lendo arquivos…');$('continue').disabled=true;
  if(expected)delete sources[expected];
  try{
    const incoming={};
    for(const file of files){const data=await readSheet(file),key=Object.keys(required).find(k=>required[k].every(c=>c in data[0]));if(!key||expected&&key!==expected)throw Error(`${file.name}: esse arquivo não corresponde à planilha esperada.`);if(incoming[key])throw Error(`Foram selecionados dois arquivos do mesmo tipo (${key}). Escolha apenas um.`);incoming[key]={name:file.name,data};}
    Object.assign(sources,incoming);for(const key of Object.keys(overrides))delete overrides[key];say();
  }catch(error){say(error.message,true);}finally{updateSources();}
}
$('sources').addEventListener('change',event=>loadSources([...event.target.files]));
for(const key of Object.keys(required))$(key).addEventListener('change',event=>loadSources([...event.target.files],key));
for(const name of ['dragenter','dragover'])$('drop').addEventListener(name,event=>{event.preventDefault();$('drop').classList.add('over');});
for(const name of ['dragleave','drop'])$('drop').addEventListener(name,event=>{event.preventDefault();$('drop').classList.remove('over');if(name==='drop')loadSources([...event.dataTransfer.files]);});
for(const name of ['price','stock','image-base','commercial','inventory','photos','no-images','pilot'])$(name).addEventListener('input',invalidate);
for(const [name,target,empty] of [['commercial','commercial-info','Opcional · colunas SKU, Preço e Estoque'],['inventory','inventory-info','Nomes dos arquivos em JSON ou TXT']])$(name).addEventListener('change',()=>{invalidate();$(target).textContent=$(name).files[0]?.name||empty;});
$('photos').addEventListener('change',invalidate);
$('no-images').addEventListener('change',()=>{invalidate();$('image-fields').hidden=$('no-images').checked;});
$('pilot').addEventListener('change',()=>{invalidate();$('price').value=$('pilot').checked?'999':'';$('stock').value=$('pilot').checked?'1':'';});
$('commercial-template').addEventListener('click',()=>{try{
  if(!ready())throw Error('Carregue as três planilhas para gerar o modelo com os SKUs do lote.');
  const rows=sources.products.data.map(row=>[id(row['Código']),null,null]);
  const data=workbook({headers:['SKU','Preço','Estoque'],rows},'Preço e estoque');
  download(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'Modelo_Preco_Estoque.xlsx');
  say(`Modelo preparado com ${rows.length} SKUs. Preencha Preço e Estoque e carregue o arquivo em “Carregar valores por SKU”.`);
}catch(error){say(error.message,true);}});
function renderWarnings(){
  const messages=output.warnings,groups=new Map();
  for(const message of messages){const key=/arredondado para cima/.test(message)?'Medidas ajustadas para centímetros inteiros':/nenhuma imagem/.test(message)?'SKUs sem imagem no inventário':/EAN ausente/.test(message)?'SKUs sem EAN':message;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(message);}
  $('warnings-title').textContent=messages.length?`Avisos do lote (${messages.length})`:'Nenhum aviso no lote';$('warning-groups').replaceChildren();
  for(const [title,list] of groups){const row=element('div',undefined,'warning-group');row.append(element('b',list.length>1?`${title} · ${list.length}`:title));if(list.length>1){const details=element('details'),summary=element('summary','Ver itens'),ul=element('ul');list.forEach(x=>ul.append(element('li',x)));details.append(summary,ul);row.append(details);}$('warning-groups').append(row);}
  $('warnings-details').open=messages.some(x=>/VALORES DE TESTE/.test(x));
}
function renderReview(){
  $('summary').textContent=`${output.summary.parents} produto(s) · ${output.summary.variations} variação(ões) · ${output.summary.sourceProducts} SKUs`;
  $('product-rows').replaceChildren();
  for(const row of output.products.rows){const tr=element('tr'),cell=element('td',undefined,'name-cell'),input=element('textarea',undefined,'product-title');input.value=row[1];input.rows=2;input.maxLength=200;input.setAttribute('aria-label',`Nome do produto ${row[0]}`);
    input.addEventListener('input',()=>{row[1]=input.value;overrides[row[0]]=input.value;row[7]=row[7].replace(/^<p>[\s\S]*?<\/p>/,`<p>${esc(input.value)}</p>`);$('export-status').textContent='Nome ajustado neste lote.';});
    cell.append(input,element('span',`Ref. ${row[0]} · ${row.slice(4,7).filter(Boolean).join(' > ')}`,'product-meta'));
    const variants=output.variations.rows.filter(v=>v[0]===row[0]);tr.append(cell);for(const [label,value] of [['Variações',String(variants.length||'—')],['A partir de',new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(row[16])],['Estoque total',String(row[17])]]){const td=element('td',value,'num');td.dataset.label=label;tr.append(td);}$('product-rows').append(tr);
  }
  renderWarnings();$('requirements').textContent=output.requirements.map(x=>`${x.reference} — ${x.category}\n${Object.entries(x.attributes).map(([k,v])=>`  ${k}: ${v}`).join('\n')}`).join('\n\n');
  $('model-note').textContent=`Modelos da loja: Produtos ${output.models.product} · Variações ${output.models.variation} · Características ${output.models.property||'criar modelo para os atributos deste lote'}.`;
  $('downloads').replaceChildren();for(const [filename,,label] of exportTables()){const button=element('button',label);button.type='button';button.addEventListener('click',()=>exportOne(filename));$('downloads').append(button);}
}
async function prepare(){
  if(!ready()){showStep('files');say('Selecione as três planilhas.',true);return;}
  busy=true;$('generate').disabled=true;invalidate();say('Preparando revisão…');
  try{
    for(const name of ['price','stock','image-base'])if(!$(name).checkValidity()){$(name).reportValidity();throw Error('Revise o campo indicado.');}
    let images=[],commercialBySku={};
    if(!$('no-images').checked){const inv=$('inventory').files[0];if(inv){const text=await inv.text();images=inv.name.toLowerCase().endsWith('.json')?imageNames(JSON.parse(text)):text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}images.push(...[...$('photos').files].map(f=>f.name));if(!images.length)throw Error('Carregue a lista de imagens ou selecione “Sem imagens neste lote”.');}
    if($('commercial').files[0]){const knownSkus=new Set(sources.products.data.map(row=>id(row['Código'])));for(const row of await readSheet($('commercial').files[0],['SKU','Preço','Estoque'])){const sku=id(row.SKU);if(!sku||commercialBySku[sku])throw Error(`Preço/estoque: SKU vazio ou duplicado (${sku}).`);if(!knownSkus.has(sku))throw Error(`Preço/estoque: SKU ${sku} não pertence ao lote. Preserve os códigos do modelo, inclusive zeros à esquerda.`);commercialBySku[sku]={price:row['Preço'],stock:row.Estoque};}}
    output=convert(Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v.data])),{price:$('price').value,stock:$('stock').value,commercialBySku,images,imageBase:$('image-base').value,titles:overrides});
    if($('pilot').checked)output.warnings.unshift('VALORES DE TESTE: substitua preço e estoque antes de comercializar.');renderReview();say();busy=false;showStep('review');
  }catch(error){output=null;say(error.message,true);}finally{busy=false;$('generate').disabled=false;}
}
$('generate').addEventListener('click',prepare);
function exportTables(){return [['01_Produtos.xlsx',output.products,'Baixar produtos'],...(output.variations.rows.length?[['02_Variacoes.xlsx',output.variations,'Baixar variações']]:[]),['03_Caracteristicas.xlsx',output.properties,'Baixar características']];}
function validOutput(){
  if(!output)throw Error('Prepare o lote novamente.');
  const invalid=output.products.rows.find(r=>!r[1].trim()||r[1].length>200);if(invalid){$('product-rows').querySelectorAll('textarea')[[...output.products.rows].indexOf(invalid)].focus();throw Error(`Revise o nome do produto ${invalid[0]}.`);}
}
function workbook(table,name){
  const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([table.headers,...table.rows]);sheet['!cols']=table.headers.map(h=>({wch:Math.min(65,Math.max(18,h.length+2))}));sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:table.rows.length,c:table.headers.length-1}})};XLSX.utils.book_append_sheet(wb,sheet,name);const data=XLSX.write(wb,{bookType:'xlsx',type:'array'});if(table.rows.length>15000||data.byteLength>1000000)throw Error(`${name}: divida o lote para respeitar o limite de 15.000 registros ou 1 MB.`);return data;
}
function reportText(){return [`Produtos: ${output.summary.parents} | Variações: ${output.summary.variations} | SKUs: ${output.summary.sourceProducts}`,'Produtos ocultos e inativos. Este pacote é de cadastro completo, não de atualização isolada de preço/estoque.','\nONDE IMPORTAR NA TRAY','Aplicativos → Meus aplicativos → Importação de Dados via Excel.','Alternativa: Produtos → Lista de produtos → Mais opções → Importar produtos do Excel.','Extraia o ZIP. Envie cada XLSX separadamente na ordem abaixo e aguarde a conclusão e a conferência de erros antes do próximo.',`1. 01_Produtos.xlsx → Produtos → Importar Produtos de um Modelo → modelo ${output.models.product}.`,...(output.variations.rows.length?[`2. 02_Variacoes.xlsx → Variações → Importar Variações de um Modelo → modelo ${output.models.variation}.`]:[]),`3. 03_Caracteristicas.xlsx → Características → Importar Características de um Modelo → ${output.models.property||'criar modelo correspondente aos atributos e à ordem das colunas'}.`,'Dados: linha 2, coluna A. Itens ausentes do arquivo: Nenhuma ação.','Cadastre os atributos e vincule-os às categorias antes de importar características. O modelo 14874 só atende aos quatro atributos do piloto, na mesma ordem.','LEIA-ANTES.txt e relatorio.json são para consulta; não importar. Modelo_Preco_Estoque.xlsx deve ser preenchido e carregado no agente, não diretamente na Tray.','\nNOMES',...output.products.rows.map(r=>`${r[0]}: ${r[1]}`),'\nAVISOS',...output.warnings,'\nCATEGORIAS E ATRIBUTOS',$('requirements').textContent].join('\n');}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportOne(filename){try{validOutput();const [name,table]=exportTables().find(x=>x[0]===filename);download(new Blob([workbook(table,name.slice(3,-5))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name);$('export-status').textContent='Arquivo preparado para download.';}catch(error){say(error.message,true);}}
$('download-report').addEventListener('click',()=>{try{validOutput();download(new Blob([reportText()],{type:'text/plain;charset=utf-8'}),'Relatorio_Tray.txt');}catch(error){say(error.message,true);}});
$('download-all').addEventListener('click',async()=>{try{validOutput();if(!window.JSZip)throw Error('Biblioteca de pacotes não carregada. Recarregue a página.');$('download-all').disabled=true;$('export-status').textContent='Preparando pacote…';const zip=new JSZip();for(const [name,table] of exportTables())zip.file(name,workbook(table,name.slice(3,-5)));zip.file('LEIA-ANTES.txt',reportText());zip.file('relatorio.json',JSON.stringify(output,null,2));download(await zip.generateAsync({type:'blob'}),'TopClick_Tray.zip');$('export-status').textContent='Pacote preparado para download.';}catch(error){say(error.message,true);}finally{$('download-all').disabled=false;}});
