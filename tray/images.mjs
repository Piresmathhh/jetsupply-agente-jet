// Consulta somente arquivos verificados no servidor: principal até _7, JPG/PNG.
export const IMAGE_LOOKUP='https://agente-jet-imagens.marcos-rangel.workers.dev/imagens-servidor';
export async function lookupImageNames(skus,{fetcher=fetch,timeoutMs=30000}={}){
  const unique=[...new Set(skus.map(s=>String(s??'').trim()).filter(Boolean))];
  const batches=[];for(let i=0;i<unique.length;i+=2)batches.push(unique.slice(i,i+2));
  const names=new Set();let next=0;
  async function run(){
    while(next<batches.length){
      const batch=batches[next++],controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetcher(IMAGE_LOOKUP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skus:batch}),signal:controller.signal});
        if(!response.ok)throw Error('Consulta indisponível.');
        const data=await response.json();
        if(data?.ok!==true||!data.imagens||typeof data.imagens!=='object'||Array.isArray(data.imagens))throw Error('Resposta inválida.');
        for(const sku of batch){
          const list=data.imagens[sku]??[];
          if(!Array.isArray(list))throw Error('Lista inválida.');
          const escaped=sku.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          const pattern=new RegExp(`^${escaped}(?:_\\d+)?\\.(?:jpe?g|png|webp)$`,'i');
          for(const item of list){
            if(typeof item?.arquivo!=='string'||!pattern.test(item.arquivo))throw Error('Nome de imagem inválido.');
            names.add(item.arquivo);
          }
        }
      }finally{clearTimeout(timer);}
    }
  }
  try{await Promise.all(Array.from({length:Math.min(3,batches.length)},run));}
  catch{throw Error('Não foi possível consultar as imagens automaticamente. Tente novamente ou informe uma lista em “Opções de imagens”.');}
  return [...names];
}
