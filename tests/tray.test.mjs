import {test} from 'node:test';
import assert from 'node:assert/strict';
import {convert,categoryPaths,validEAN,occupiedRange} from '../tray/engine.mjs';
function source(){return {
  products:[['001',1,'6A'],['002',2,'10A']].map(([sku,n])=>({ID:String(n),'Código':sku,'Código barras':'',Nome:`Disjuntor ${sku}`,Marca:'WEG','Linha de produto':'MDWH','Categoria fiscal':'85362000','Garantia (em dias)':365,Peso:.105,'Altura (cm)':8,'Largura (cm)':1.8,'Profundidade (cm)':6.5})),
  characteristics:[['001',1,'6A'],['002',2,'10A']].flatMap(([sku,n,value])=>Object.entries({'Corrente Nominal':value,'Número de Polos':'1P Monopolar','Curva de Disparo':'B','Tensão de Emprego':'440VCA/250VCC','Frequência':'50/60Hz'}).map(([name,val])=>({PROD_ID:String(n),PROD_SKU:sku,PROD_COD_AGRUPAMENTO:'1',CATEGORIA_TREEVIEW_ID:'3',MARCA_NOME:'WEG',LINHA_NOME:'MDWH',CARACT_NOME:name,CARACT_VALOR:val}))),
  tree:[{ID_PRIMEIRO_NIVEL:1,NOME_PRIMEIRO_NIVEL:'Elétricos',ID_SEGUNDO_NIVEL:2,NOME_SEGUNDO_NIVEL:'Disjuntores',ID_TERCEIRO_NIVEL:3,NOME_TERCEIRO_NIVEL:'1P'}]
};}
const options={price:999,stock:1,images:['001.jpg','001_1.jpg','002.png'],imageBase:'https://example.com/fotos/',titles:{1:'Disjuntor agrupado'}};

test('Tray: referência comercial do pai liga produtos, variações e características, independente da ordem',()=>{
  const s=source();s.products.reverse();s.characteristics.reverse();const r=convert(s,options);
  assert.equal(r.products.rows[0][0],'001');
  assert.ok(r.variations.rows.every(row=>row[0]==='001'));
  assert.equal(r.properties.rows[0][0],'001');
  assert.equal(r.requirements[0].groupId,'1');assert.equal(r.requirements[0].reference,'001');
  assert.equal(r.products.rows[0][1],'Disjuntor agrupado');
});
test('Tray: pai ausente fica pendente sem inventar referência comercial',()=>{
  const s=source();s.characteristics.forEach(row=>row.PROD_COD_AGRUPAMENTO='999');
  const r=convert(s,options);assert.equal(r.products.rows.length,0);assert.equal(r.variations.rows.length,0);assert.equal(r.properties.rows.length,0);assert.equal(r.skippedGroups[0].groupId,'999');assert.deepEqual(r.skippedGroups[0].skus,['001','002']);assert.equal(r.summary.skippedSkus,2);
});
test('Tray: grupo sem pai não impede exportação dos outros grupos',()=>{
  const s=source(),extra=structuredClone(s);extra.products.forEach((p,i)=>{p.ID=String(i+10);p['Código']='X'+i;p.Peso=null;});extra.characteristics.forEach(c=>{c.PROD_ID=String(Number(c.PROD_ID)+9);c.PROD_SKU='X'+(Number(c.PROD_ID)-10);c.PROD_COD_AGRUPAMENTO='999';});s.products.push(...extra.products);s.characteristics.push(...extra.characteristics);
  const r=convert(s,options);assert.equal(r.products.rows.length,1);assert.equal(r.variations.rows.length,2);assert.ok(r.variations.rows.every(v=>v[0]==='001'));assert.equal(r.properties.rows.length,1);assert.equal(r.summary.sourceProducts,4);assert.equal(r.summary.exportedSkus,2);assert.equal(r.summary.skippedSkus,2);assert.equal(r.summary.skippedGroups,1);assert.ok(r.warnings.some(w=>w.includes('999')&&w.includes('X0')));
});
test('Tray: ignora intervalo BIFF inflado sem perder zeros ou registros reais',()=>{
  const sheet={'!ref':'A1:IU65535',A1:{v:'SKU'},A2:{v:'001'},B2:{v:0},Z65535:{v:''}};
  assert.deepEqual(occupiedRange(sheet,k=>({r:Number(k.slice(1))-1,c:k.charCodeAt(0)-65})),{s:{r:0,c:0},e:{r:1,c:1}});
  assert.throws(()=>occupiedRange({'!ref':'A1:IU65535'},()=>{}),/vazia/);
});
test('Tray: mantém SKU com zeros, um eixo e atributos fixos; 25/18/5 colunas',()=>{
  const r=convert(source(),options);assert.equal(r.products.headers.length,25);assert.equal(r.variations.headers.length,18);assert.equal(r.properties.headers.length,5);
  assert.deepEqual(r.variations.rows.map(x=>x[1]),['001','002']);assert.equal(r.products.rows[0][17],2);assert.equal(r.products.rows[0][2],'Não');assert.equal(r.products.rows[0][3],'Não');
  assert.equal(r.variations.rows[0][11],'https://example.com/fotos/001.jpg');assert.equal(r.variations.rows[0][12],'https://example.com/fotos/001_1.jpg');assert.equal(r.variations.rows[1][11],'https://example.com/fotos/002.png');assert.equal(r.variations.rows[1][12],null);
  assert.deepEqual(r.variations.rows[0].slice(5,11),[105,8,2,7,999,1]);assert.equal(r.models.property,14874);
});
test('Tray: funciona com mais de um grupo e não mistura os saldos',()=>{
  const s=source(),extra=structuredClone(s);extra.products.forEach((p,i)=>{p.ID=String(i+10);p['Código']='X'+i;});extra.characteristics.forEach(c=>{c.PROD_ID=String(Number(c.PROD_ID)+9);c.PROD_SKU='X'+(Number(c.PROD_ID)-10);c.PROD_COD_AGRUPAMENTO='10';});
  s.products.push(...extra.products);s.characteristics.push(...extra.characteristics);const r=convert(s,options);assert.equal(r.products.rows.length,2);assert.equal(r.variations.rows.length,4);assert.deepEqual(r.products.rows.map(x=>x[17]),[2,2]);
});
test('Tray: preço ausente não vira zero e estoque zero é preservado',()=>{
  assert.throws(()=>convert(source(),{stock:1}),/Preço.*ausente/);assert.throws(()=>convert(source(),{price:1}),/Estoque.*ausente/);
  const r=convert(source(),{price:10,stock:0});assert.equal(r.products.rows[0][17],0);assert.equal(r.variations.rows[0][10],0);
  assert.throws(()=>convert(source(),{price:10,stock:.5}),/inválido/);
});
test('Tray: valores por SKU vencem o padrão, inclusive saldo zero',()=>{const r=convert(source(),{...options,commercialBySku:{'001':{price:15,stock:0}}});assert.equal(r.variations.rows[0][9],15);assert.equal(r.variations.rows[0][10],0);assert.equal(r.products.rows[0][17],1);});
test('Tray: bloqueia duplicidade de SKU e divergência de associação',()=>{const s=source();s.products[1]['Código']='001';assert.throws(()=>convert(s,options),/duplicado/);const t=source();t.characteristics[0].PROD_SKU='outra';assert.throws(()=>convert(t,options),/conflitantes/);});
test('Tray: bloqueia segundo eixo variável e valores de eixo duplicados',()=>{const s=source();s.characteristics.find(x=>x.PROD_ID==='2'&&x.CARACT_NOME==='Número de Polos').CARACT_VALOR='2P';assert.throws(()=>convert(s,options),/2 eixos/);});
test('Tray: árvore de quatro níveis não é achatada e códigos ambíguos são bloqueados',()=>{const s=source();Object.assign(s.tree[0],{ID_QUARTO_NIVEL:4,NOME_QUARTO_NIVEL:'Subcategoria'});s.characteristics.forEach(x=>x.CATEGORIA_TREEVIEW_ID='4');assert.throws(()=>convert(s,options),/4 níveis/);assert.throws(()=>categoryPaths([...s.tree,{...s.tree[0],NOME_PRIMEIRO_NIVEL:'Outro'}]),/ambíguo/);});
test('Tray: EAN inválido vira aviso e HTML do título é escapado',()=>{assert.equal(validEAN('7891327113183'),true);assert.equal(validEAN('7891327113184'),false);const s=source();s.products[0]['Código barras']='123';const invalid=convert(s,options);assert.equal(invalid.variations.rows[0][2],'');assert.ok(invalid.warnings.some(w=>w.includes('123')&&w.includes('fora do padrão')));const r=convert(source(),{...options,titles:{1:'<script>alert(1)</script>'}});assert.ok(r.products.rows[0][7].includes('&lt;script&gt;'));});
test('Tray: não inventa URLs sem inventário e exige revisão para mais de sete imagens',()=>{const r=convert(source(),{price:1,stock:1});assert.equal(r.variations.rows[0][11],null);assert.throws(()=>convert(source(),{...options,images:Array.from({length:8},(_,i)=>i?`001_${i}.jpg`:'001.jpg')}),/aceita 7/);});
test('Tray: atributos novos exigem outro modelo técnico',()=>{const s=source();s.characteristics.forEach(x=>{if(x.CARACT_NOME==='Frequência')x.CARACT_NOME='Acabamento';});const r=convert(s,options);assert.equal(r.models.property,null);assert.ok(r.properties.headers.includes('Acabamento'));});
test('Tray: EAN 55313 não bloqueia o SKU e fica registrado no aviso',()=>{
  const s=source();s.products[0]['Código']='14454314';s.products[0]['Código barras']='55313';s.characteristics.filter(c=>c.PROD_ID==='1').forEach(c=>c.PROD_SKU='14454314');
  const r=convert(s,options);assert.equal(r.variations.rows[0][1],'14454314');assert.equal(r.variations.rows[0][2],'');assert.ok(r.warnings.some(w=>w.includes('14454314')&&w.includes('55313')));
});
test('Tray: EAN válido é preservado e repetição vira aviso sem bloquear lote',()=>{
  const s=source();s.products.forEach(p=>p['Código barras']='7891327113183');const r=convert(s,options);
  assert.equal(r.variations.rows[0][2],'7891327113183');assert.equal(r.variations.rows[1][2],'');assert.ok(r.warnings.some(w=>w.includes('duplicado')));
});
test('Tray: fonte com apenas eixo variável não gera linhas vazias de características',()=>{
  const s=source();s.characteristics=s.characteristics.filter(c=>c.CARACT_NOME==='Corrente Nominal');const r=convert(s,options);
  assert.equal(r.products.rows.length,1);assert.equal(r.variations.rows.length,2);assert.equal(r.properties.rows.length,0);assert.equal(r.models.property,null);
});
test('Tray: marca não é repetida no campo modelo e hífen técnico é preservado',()=>{
  for(const [input,expected] of [['WEG - MDWS','MDWS'],['WEG - MDW-63','MDW-63'],['MDWH','MDWH']]){const s=source();s.products.forEach(p=>p['Linha de produto']=input);const r=convert(s,options);assert.equal(r.products.rows[0][8],'WEG');assert.equal(r.products.rows[0][9],expected);}
});
