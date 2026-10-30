import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lookupImageNames} from '../tray/images.mjs';
test('imagens Tray: consulta SKUs sem perder zeros e retorna somente nomes reais',async()=>{
  let sent;
  const names=await lookupImageNames(['001','001','002'],{fetcher:async(url,options)=>{sent=JSON.parse(options.body).skus;return{ok:true,json:async()=>({ok:true,imagens:{'001':[{arquivo:'001.png'},{arquivo:'001_2.jpg'}],'002':[]}})};}});
  assert.deepEqual(sent,['001','002']);assert.deepEqual(names,['001.png','001_2.jpg']);
});
test('imagens Tray: divide lotes respeitando o limite do worker',async()=>{
  const sizes=[];await lookupImageNames(Array.from({length:85},(_,i)=>String(i)),{fetcher:async(url,o)=>{sizes.push(JSON.parse(o.body).skus.length);return{ok:true,json:async()=>({ok:true,imagens:{}})};}});
  assert.equal(sizes.length,43);assert.equal(sizes.filter(n=>n===2).length,42);assert.equal(sizes.filter(n=>n===1).length,1);
});
test('imagens Tray: falha parcial não vira inventário vazio silencioso',async()=>{
  await assert.rejects(lookupImageNames(['001'],{fetcher:async()=>({ok:false})}),/Não foi possível/);
});
test('imagens Tray: rejeita URL ou nome que não pertence ao SKU consultado',async()=>{
  for(const arquivo of ['https://outro.test/001.jpg','999.jpg','../001.jpg'])await assert.rejects(lookupImageNames(['001'],{fetcher:async()=>({ok:true,json:async()=>({ok:true,imagens:{'001':[{arquivo}]}})})}),/Não foi possível/);
});
