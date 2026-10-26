import {convert,imageNames,id,occupiedRange} from './engine.mjs';
const $=id=>document.getElementById(id);
const form=$('converter'),status=$('status');let output=null;
const say=(message,error=false)=>{status.textContent=message;status.dataset.error=String(error);};
async function readSheet(file,required){
  if(!file)throw Error('Selecione as planilhas necessárias.');
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
  const sheet=wb.Sheets[wb.SheetNames[0]];
  // BIFF antigo pode declarar 65.535 linhas e 255 colunas para poucos registros.
  // Delimita a leitura pelas células preenchidas, sem descartar linhas reais.
  const range=occupiedRange(sheet,XLSX.utils.decode_cell);
  const data=XLSX.utils.sheet_to_json(sheet,{defval:null,raw:true,range:XLSX.utils.encode_range(range)});
  if(!data.length)throw Error(`${file.name}: planilha vazia.`);
  for(const key of required)if(!(key in data[0]))throw Error(`${file.name}: coluna obrigatória ausente (${key}).`);
  // Identificadores são texto. Números inseguros devem ser corrigidos na origem.
  for(const r of data)for(const key of Object.keys(r))if(/(^ID$|SKU|^Código|COD_BAR)/.test(key)&&typeof r[key]==='number'&&!Number.isSafeInteger(r[key]))throw Error(`${file.name}: identificador numérico inseguro em ${key}. Exporte como texto.`);
  return data;
}
function workbook(table,name){
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([table.headers,...table.rows]);
  ws['!cols']=table.headers.map(h=>({wch:Math.min(65,Math.max(18,h.length+2))}));
  ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:table.rows.length,c:table.headers.length-1}})};
  XLSX.utils.book_append_sheet(wb,ws,name);return XLSX.write(wb,{bookType:'xlsx',type:'array'});
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function reportText(result){return [
  `Produtos: ${result.summary.parents} | Variações: ${result.summary.variations} | SKUs de origem: ${result.summary.sourceProducts}`,
  `Modelos Tray: produtos ${result.models.product}; variações ${result.models.variation}; características ${result.models.property??'CRIAR MODELO COM AS COLUNAS DESTE LOTE'}.`,
  'Todos os produtos estão ocultos e inativos. Não alterar produtos ausentes do lote.',
  'Verifique disponibilidade e correspondência das imagens antes de ativar.',
  '\nAVISOS',...result.warnings.map(x=>`• ${x}`),'\nVÍNCULOS NECESSÁRIOS',
  ...result.requirements.map(x=>`${x.reference} — ${x.category}\n${Object.entries(x.attributes).map(([k,v])=>`  ${k}: ${v}`).join('\n')}\n  Eixo variável: ${x.variationAxis||'nenhum'}`)
].join('\n');}
function invalidate(){output=null;$('result').hidden=true;say('Dados alterados. Valide novamente antes de baixar.');}
form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
$('pilot').addEventListener('change',()=>{if($('pilot').checked){$('price').value='999';$('stock').value='1';}else{$('price').value='';$('stock').value='';}});
form.addEventListener('submit',async event=>{
  event.preventDefault();output=null;$('result').hidden=true;$('generate').disabled=true;say('Lendo e validando o lote…');
  try{
    if(!window.XLSX||!window.JSZip)throw Error('Bibliotecas não carregadas. Verifique a conexão e recarregue.');
    const [products,characteristics,tree]=await Promise.all([
      readSheet($('products').files[0],['ID','Código','Nome','Peso']),
      readSheet($('characteristics').files[0],['PROD_ID','PROD_SKU','PROD_COD_AGRUPAMENTO','CATEGORIA_TREEVIEW_ID','CARACT_NOME','CARACT_VALOR']),
      readSheet($('tree').files[0],['ID_PRIMEIRO_NIVEL','NOME_PRIMEIRO_NIVEL'])
    ]);
    let images=[],commercialBySku={};
    if(!$('no-images').checked){
      const inv=$('inventory').files[0];if(inv){const text=await inv.text();images=inv.name.toLowerCase().endsWith('.json')?imageNames(JSON.parse(text)):text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
      images.push(...[...$('photos').files].map(f=>f.name));
      if(!images.length)throw Error('Carregue o inventário de imagens ou marque “Gerar sem imagens”.');
    }
    if($('commercial').files[0])for(const r of await readSheet($('commercial').files[0],['SKU','Preço','Estoque'])){
      const sku=id(r.SKU);if(!sku||commercialBySku[sku])throw Error(`Preço/estoque: SKU vazio ou duplicado (${sku}).`);
      commercialBySku[sku]={price:r['Preço'],stock:r.Estoque};
    }
    const titles=$('titles').value.trim()?JSON.parse($('titles').value):{};
    if(!titles||Array.isArray(titles)||typeof titles!=='object')throw Error('Títulos: informe um objeto JSON com grupo e título.');
    output=convert({products,characteristics,tree},{price:$('price').value,stock:$('stock').value,commercialBySku,images,imageBase:$('image-base').value,titles});
    if($('pilot').checked)output.warnings.unshift('VALORES DE TESTE: substitua preço e estoque antes de comercializar.');
    const files=[['01_Produtos.xlsx',workbook(output.products,'Produtos')]];
    if(output.variations.rows.length)files.push(['02_Variacoes.xlsx',workbook(output.variations,'Variacoes')]);
    files.push(['03_Caracteristicas.xlsx',workbook(output.properties,'Caracteristicas')]);
    // Limites observados no importador da loja: 15 mil linhas e 1 MB por arquivo.
    for(const [name,data] of files){const table=name.startsWith('01')?output.products:name.startsWith('02')?output.variations:output.properties;if(table.rows.length>15000||data.byteLength>1000000)throw Error(`${name}: excede o limite de 15.000 registros ou 1 MB. Divida o lote.`);}
    const report=reportText(output),zip=new JSZip();files.forEach(([name,data])=>zip.file(name,data));zip.file('LEIA-ANTES.txt',report);zip.file('relatorio.json',JSON.stringify(output,null,2));
    const zipBlob=await zip.generateAsync({type:'blob'}),downloads=$('downloads');downloads.replaceChildren();
    const all=document.createElement('button');all.type='button';all.textContent='Baixar pacote completo (.zip)';all.addEventListener('click',()=>download(zipBlob,'TopClick_Tray.zip'));downloads.append(all);
    for(const [name,data] of files){const button=document.createElement('button');button.type='button';button.textContent=name;button.addEventListener('click',()=>download(new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name));downloads.append(button);}
    $('summary').textContent=`${output.summary.parents} produto(s) · ${output.summary.variations} variação(ões) · ${output.summary.photos} imagens nas variações`;
    $('report').textContent=report;$('result').hidden=false;say(`Arquivos preparados. Revise os ${output.warnings.length} avisos antes de importar.`);
  }catch(error){output=null;$('result').hidden=true;say(error.message,true);}finally{$('generate').disabled=false;}
});
