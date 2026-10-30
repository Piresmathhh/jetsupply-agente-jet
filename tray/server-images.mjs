// Executar no servidor/Worker, nunca diretamente na página HTTPS (origem HTTP).
export const SERVER_IMAGE_BASE='http://wmr8group.dalla.srv.br:8081//fotos_web/';
export async function probeServerImages(skus,{fetcher=fetch,timeoutMs=7000}={}){
 const codes=[...new Set(skus.map(s=>String(s??'').trim()))];
 if(codes.some(s=>!/^\d{1,30}$/.test(s)))throw Error('SKU inválido.');
 const names=[],failures=[];let requests=0;
 for(const sku of codes)for(let suffix=0;suffix<=7;suffix++)for(const ext of ['jpg','png']){
  const name=sku+(suffix?'_'+suffix:'')+'.'+ext;
  try{const r=await fetcher(SERVER_IMAGE_BASE+name,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});requests++;if(r.status===404)continue;if(!r.ok||!/^image\//i.test(r.headers.get('content-type')||''))throw Error('Resposta inesperada');names.push(name);}catch{failures.push(name);if(failures.length>=3)throw Error('Verificação inconclusiva: servidor de imagens indisponível. Tente novamente.');}
 }
 if(failures.length)throw Error('Verificação inconclusiva: alguns arquivos não puderam ser verificados. Tente novamente.');
 return {names,requests,maxSuffix:7};
}
