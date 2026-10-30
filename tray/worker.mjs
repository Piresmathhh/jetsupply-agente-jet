// Executar no servidor/Worker, nunca diretamente na página HTTPS (origem HTTP).
const SERVER_IMAGE_BASE='http://wmr8group.dalla.srv.br:8081//fotos_web/';
async function probeServerImages(skus,{fetcher=fetch,timeoutMs=7000}={}){
 const codes=[...new Set(skus.map(s=>String(s??'').trim()))];
 if(codes.some(s=>!/^\d{1,30}$/.test(s)))throw Error('SKU inválido.');
 const names=[],failures=[];let requests=0;
 for(const sku of codes)for(let suffix=0;suffix<=7;suffix++)for(const ext of ['jpg','png']){
  const name=sku+(suffix?'_'+suffix:'')+'.'+ext;
  try{const r=await fetcher(SERVER_IMAGE_BASE+name,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});requests++;if(r.status===404)continue;if(!r.ok||!/^image\//i.test(r.headers.get('content-type')||''))throw Error('Resposta inesperada: '+r.status+' '+r.headers.get('content-type'));names.push(name);}catch(error){failures.push(name+': '+error.message);if(failures.length>=3)throw Error('Verificação inconclusiva: '+failures.join(' | '));}
 }
 if(failures.length)throw Error('Verificação inconclusiva: alguns arquivos não puderam ser verificados. Tente novamente.');
 return {names,requests,maxSuffix:7};
}

const ORIGENS = ['https://agente.jetsupply.com.br','http://agente.jetsupply.com.br','https://piresmathhh.github.io'];
function cors(request) {
  const o = request.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGENS.includes(o) ? o : ORIGENS[0], 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
}
function analisarNome(chave) {
  const m = String(chave || '').match(/^(.*?)(?:_(\d+))?\.(jpe?g|png)$/i);
  if (!m) return null;
  return { base: m[1], seq: m[2] ? parseInt(m[2], 10) : 0 };
}
// Consulta as imagens de UM sku por prefixo. Guarda em cache por 10 min, entao
// gerar de novo o mesmo lote fica instantaneo.
async function imagensDoSku(env, ctx, sku) {
  const cache = caches.default;
  const chave = new Request('https://cache.interno/sku/' + encodeURIComponent(sku));
  const salvo = await cache.match(chave);
  if (salvo) return salvo.json();
  const achadas = [];
  let cursor;
  do {
    const lista = await env.IMAGENS.list({ prefix: sku, cursor, limit: 1000 });
    for (const objeto of lista.objects) {
      const info = analisarNome(objeto.key);
      if (!info || info.base !== sku) continue;
      achadas.push({ arquivo: objeto.key, seq: info.seq });
    }
    cursor = lista.truncated ? lista.cursor : null;
  } while (cursor);
  achadas.sort((a, b) => a.seq - b.seq);
  const corpo = JSON.stringify(achadas);
  ctx.waitUntil(cache.put(chave, new Response(corpo, { headers: { 'Cache-Control': 'max-age=600', 'Content-Type': 'application/json' } })));
  return achadas;
}
async function emParalelo(itens, limite, tarefa) {
  const saida = new Array(itens.length);
  let proximo = 0;
  async function operario() {
    while (proximo < itens.length) { const i = proximo++; saida[i] = await tarefa(itens[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, operario));
  return saida;
}
export default {
  async fetch(request, env, ctx) {
    const h = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: h });
    const url = new URL(request.url);
    if (url.pathname === '/imagens-servidor') {
      let input = request.method === 'POST' ? await request.json().catch(() => ({})) : {skus:(url.searchParams.get('skus') || '').split(',')};
      const skus = [...new Set((Array.isArray(input.skus)?input.skus:[]).map(s=>String(s??'').trim()).filter(Boolean))];
      if(!skus.length || skus.length>2 || skus.some(s=>!/^\d{1,30}$/.test(s)))return Response.json({ok:false,error:'Envie de 1 a 2 SKUs numéricos.'},{status:400,headers:h});
      try {
        const result={};
        for(const sku of skus){
          const key=new Request('https://cache.interno/servidor-v1/'+encodeURIComponent(sku));
          const saved=await caches.default.match(key);
          if(saved){result[sku]=await saved.json();continue;}
          const checked=await probeServerImages([sku]);
          const list=checked.names.map(arquivo=>({arquivo,seq:analisarNome(arquivo).seq}));
          result[sku]=list;
          ctx.waitUntil(caches.default.put(key,Response.json(list,{headers:{'Cache-Control':'max-age=600'}})));
        }
        return Response.json({ok:true,source:'servidor',maxSuffix:7,imagens:result},{headers:h});
      } catch (error) {return Response.json({ok:false,error:error.message},{status:503,headers:h});}
    }
    if (url.pathname === '/imagens') {
      let skus = [];
      if (request.method === 'POST') {
        const corpo = await request.json().catch(() => ({}));
        skus = Array.isArray(corpo.skus) ? corpo.skus : [];
      } else {
        skus = (url.searchParams.get('skus') || '').split(',');
      }
      const unicos = [...new Set(skus.map(s => String(s || '').trim()).filter(Boolean))];
      const t0 = Date.now();
      const listas = await emParalelo(unicos, 150, sku => imagensDoSku(env, ctx, sku));
      const resultado = {};
      unicos.forEach((sku, i) => { if (listas[i] && listas[i].length) resultado[sku] = listas[i]; });
      return Response.json({ ok: true, pedidos: unicos.length, encontrados: Object.keys(resultado).length, ms: Date.now() - t0, imagens: resultado }, { headers: h });
    }
    if (url.pathname === '/tudo') {
      const indice = {};
      let cursor;
      do {
        const lista = await env.IMAGENS.list({ cursor, limit: 1000 });
        for (const objeto of lista.objects) {
          const info = analisarNome(objeto.key);
          if (!info) continue;
          if (!indice[info.base]) indice[info.base] = [];
          indice[info.base].push({ arquivo: objeto.key, seq: info.seq });
        }
        cursor = lista.truncated ? lista.cursor : null;
      } while (cursor);
      const total = Object.values(indice).reduce((n, l) => n + l.length, 0);
      return Response.json({ ok: true, skus: Object.keys(indice).length, arquivos: total, imagens: indice }, { headers: h });
    }
    return new Response('Agente Jet - imagens R2. Use POST /imagens ou GET /tudo', { headers: h });
  }
};