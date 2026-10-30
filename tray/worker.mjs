// Catálogo Tray conferido em 30/10/2026. Novos SKUs são registrados na consulta do agente.
const DEFAULT_SYNC_SKUS=["10075739","10075741","10075742","10075743","10075746","10075747","10075749","10076468","10076469","10077877","11134694","11134697","11134789","11134791","11134792","11422529","11422543","11422546","11422579","11422580","11422581","11422583","11422584","11422585","11422587","11422628","11422629","11422631","11422632","11422634","11422636","11422637","11422638","11422640","11422641","11422642","11422644","11422645","11422646","11422658","11422659","11422660","11422662","11422663","11422664","11422665","11422666","11422667","11422688","11422689","11422690","11422691","11422692","11422693","11422694","11422695","11422696","11422697","11422708","11422709","11422710","11422711","11422713","11422714","11422715","11422716","11422717","11422719","11422720","11422721","11422722","11422723","11422725","11422726","11422727","11422728","11422729","11422730","11807321","11807323","11807325","11807348","11807349","14354674","14355128","14355129","14355130","14355131","14355135","14355136","14449588","14449591","14449592","14449593","14449594","14449595","14449596","14449597","14449618","14449619","14449620","14449621","14449622","14449623","14449624","14449625","14449662","14449664","14449665","14449666","14449667","14449680","14449681","14449682","14449683","14449684","14449685","14449686","14449687","14449738","14449739","14449884","14449885","14449886","14449887","14449918","14449919","14449920","14449922","14449923","14449925","14449927","14449961","14449964","14449965","14449966","14449967","14449998","14449999","14450000","14450001","14450002","14450003","14450004","14450005","14450006","14450007","14450028","14450029","14450030","14450031","14450032","14450955","14451038","14451039","14451040","14451176","14451177","14451198","14451200","14451201","14451202","14451477","14451708","14451709","14451710","14451712","14451714","14451715","14451718","14451719","14451720","14451721","14451722","14451723","14451724","14451725","14451726","14451758","14451759","14451760","14451761","14451762","14451763","14452067","14452178","14452179","14452180","14452181","14452182","14452183","14452184","14452186","14452187","14452229","14452230","14452231","14452232","14452233","14452234","14452235","14452236","14452237","14452249","14452250","14452251","14452252","14452253","14452254","14452255","14452256","14452257","14452268","14452269","14452270","14452422","14452423","14452424","14452426","14452427","14452458","14452459","14452460","14452461","14452465","14452466","14452479","14452481","14452482","14452483","14452484","14452486","14452501","14452502","14452503","14452504","14452505","14452507","14452538","14452539","14452540","14452659","14452661","14452663","14452664","14452665","14452666","14452667","14452699","14452700","14452703","14452704","14452705","14452706","14452707","14452768","14452769","14452830","14452833","14452834","14452835","14452836","14452837","14452878","14452879","14452880","14452881","14454314","14456319","14848969","14848970","14848971","14848972","14848973","14848974","14848975","14848977","14849018","14849019","14849020","14849021","14849022","14849023","14849024","14849025","14849026","14849027","14849028","14849029","14849030","15220827","15265508","15265514","15265637","15265681","15265683","15265685","15265689","15265691","15265692","15265694","15265696","15265718","15265720","15265721","15265722","15265723","15265725","15265726","15265727","15265739","15265740","15265741","15265743","15265744","15265745","15265747","15265760","15265762","15265763","15265764","15265766","15265767","15265788","15265789","15265790","15265791","15265792","15265793","15265794","15265795","15265796","15265797","15265838","15265839","15265840","15265841","15265843","15265844","15265845","15265846","15265847","15265888","15265890","15265891","15265892","15265893","15265894","15265895","15265896","15265897","15265908","15265909","15265910","15265911","15265912","15265913","15265914","15265915","15265916","15265917","15265938","15265939","15265941","15265942","15265943","15267246"];

const SYNC_PREFIX='__agente_sync__/';
const SYNC_STATE=SYNC_PREFIX+'state.json';
const LOCK_KEY=SYNC_PREFIX+'lock.json';
const jsonOptions={httpMetadata:{contentType:'application/json'}};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const dayAt=now=>new Date(now-3*3600000).toISOString().slice(0,10);
async function registerSyncSku(bucket,sku){
 if(!/^\d{1,30}$/.test(sku)||DEFAULT_SYNC_SKUS.includes(sku))return;
 const key=SYNC_PREFIX+'skus/'+sku+'.json';
 if(!await bucket.head(key))await bucket.put(key,JSON.stringify({sku}),{...jsonOptions,onlyIf:new Headers({'If-None-Match':'*'})});
}
async function syncCatalog(bucket){
 const skus=new Set(DEFAULT_SYNC_SKUS);let cursor;
 do{const page=await bucket.list({prefix:SYNC_PREFIX+'skus/',limit:1000,cursor});for(const item of page.objects){const code=item.key.slice((SYNC_PREFIX+'skus/').length).replace(/\.json$/,'');if(/^\d{1,30}$/.test(code))skus.add(code);}cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return [...skus].sort();
}
async function syncSkuImages(bucket,sku,{fetcher=fetch,day=dayAt(Date.now()),deadline=Date.now()+45000}={}){
 const result={updated:0,unchanged:0,missing:0,errors:[]};let consecutiveFailures=0;
 for(let suffix=0;suffix<=7;suffix++)for(const ext of ['jpg','png']){
  if(Date.now()>=deadline){result.errors.push('Prazo do lote esgotado: '+sku);return result;}
  const name=sku+(suffix?'_'+suffix:'')+'.'+ext,url=SERVER_IMAGE_BASE+name;
  const request=async method=>fetcher(url,{method,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(7000,deadline-Date.now())))});
  try{
   const head=await request('HEAD');
   if(head.status===404){result.missing++;consecutiveFailures=0;continue;}
   if(!head.ok||!/^image\/(jpeg|png)/i.test(head.headers.get('content-type')||''))throw Error('Resposta HTTP inesperada: '+head.status);
   if(Number(head.headers.get('content-length'))>5*1024*1024)throw Error('Imagem excede 5 MB');
   const response=await request('GET');if(!response.ok)throw Error('Download HTTP '+response.status);
   const bytes=await response.arrayBuffer(),magic=new Uint8Array(bytes);
   if(bytes.byteLength>5*1024*1024||!(magic[0]===255&&magic[1]===216||magic[0]===137&&magic[1]===80&&magic[2]===78&&magic[3]===71))throw Error('Conteúdo não é JPG/PNG válido');
   const hash=await digest(bytes),old=await bucket.get(name);let oldBytes;
   if(old){oldBytes=await old.arrayBuffer();if(await digest(oldBytes)===hash){result.unchanged++;consecutiveFailures=0;continue;}
    await bucket.put(SYNC_PREFIX+'backups/'+day+'/'+name,oldBytes,{httpMetadata:old.httpMetadata||{},onlyIf:new Headers({'If-None-Match':'*'})});
   }
   await bucket.put(name,bytes,{httpMetadata:{contentType:head.headers.get('content-type')},customMetadata:{sourceSHA256:hash,sourceURL:url,syncedAt:new Date().toISOString()}});
   result.updated++;consecutiveFailures=0;
  }catch(error){result.errors.push(name+': '+error.message);if(++consecutiveFailures>=3)return result;}
 }
 return result;
}
async function runDailySync(env,{now=Date.now(),fetcher=fetch,maxSkus=1,catalog=undefined}={}){
 const local=new Date(now-3*3600000);if(local.getUTCHours()<3)return {status:'before-start'};
 const bucket=env.IMAGENS,oldLock=await bucket.get(LOCK_KEY);
 if(oldLock&&(await oldLock.json()).until>now)return {status:'busy'};
 const lease=await bucket.put(LOCK_KEY,JSON.stringify({until:now+120000}),{...jsonOptions,onlyIf:oldLock?{etagMatches:oldLock.etag}:new Headers({'If-None-Match':'*'})});
 if(!lease)return {status:'busy'};
 try{
  const saved=await bucket.get(SYNC_STATE);let state=saved?await saved.json():null;
  const day=dayAt(now);
  if(state?.date===day&&state.completedAt)return {status:'already-complete',state};
  if(!state||state.completedAt){state={date:day,startedAt:new Date(now).toISOString(),skus:catalog||await syncCatalog(bucket),index:0,updated:0,unchanged:0,missing:0,errors:[]};}
  const deadline=Date.now()+45000;
  for(let n=0;n<maxSkus&&state.index<state.skus.length&&Date.now()<deadline;n++){
   const sku=state.skus[state.index],r=await syncSkuImages(bucket,sku,{fetcher,day:state.date,deadline});
   state.updated+=r.updated;state.unchanged+=r.unchanged;state.missing+=r.missing;state.errors.push(...r.errors);state.index++;
   await bucket.put(SYNC_STATE,JSON.stringify(state),jsonOptions);
  }
  if(state.index===state.skus.length){state.completedAt=new Date().toISOString();await bucket.put(SYNC_STATE,JSON.stringify(state),jsonOptions);await bucket.put(SYNC_PREFIX+'reports/'+state.date+'.json',JSON.stringify(state),jsonOptions);}
  return {status:state.completedAt?'complete':'running',state};
 }finally{await bucket.put(LOCK_KEY,JSON.stringify({until:0}),{...jsonOptions,onlyIf:{etagMatches:lease.etag}});}
}
async function syncStatus(bucket){
 const file=await bucket.get(SYNC_STATE);if(!file)return {status:'awaiting-first-run'};
 const s=await file.json();return {status:s.completedAt?(s.errors.length?'complete-with-errors':'complete'):'running',date:s.date,startedAt:s.startedAt,completedAt:s.completedAt||null,skus:s.skus.length,checked:s.index,updated:s.updated,unchanged:s.unchanged,errors:s.errors.length};
}

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
  if(String(chave||'').includes('/'))return null;
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
  async scheduled(controller,env,ctx){ctx.waitUntil(runDailySync(env,{now:controller.scheduledTime}));},
  async fetch(request, env, ctx) {
    const h = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: h });
    const url = new URL(request.url);
    if (url.pathname === '/sincronizacao') return Response.json(await syncStatus(env.IMAGENS),{headers:h});
    if (url.pathname === '/imagens-servidor') {
      let input = request.method === 'POST' ? await request.json().catch(() => ({})) : {skus:(url.searchParams.get('skus') || '').split(',')};
      const skus = [...new Set((Array.isArray(input.skus)?input.skus:[]).map(s=>String(s??'').trim()).filter(Boolean))];
      if(!skus.length || skus.length>2 || skus.some(s=>!/^\d{1,30}$/.test(s)))return Response.json({ok:false,error:'Envie de 1 a 2 SKUs numéricos.'},{status:400,headers:h});
      try {
        const result={};
        for(const sku of skus){
          const key=new Request('https://cache.interno/servidor-v1/'+encodeURIComponent(sku));
          const saved=await caches.default.match(key);
          if(saved){result[sku]=await saved.json();if(result[sku].length)ctx.waitUntil(registerSyncSku(env.IMAGENS,sku));continue;}
          const checked=await probeServerImages([sku]);
          const list=checked.names.map(arquivo=>({arquivo,seq:analisarNome(arquivo).seq}));
          result[sku]=list;
          if(list.length)ctx.waitUntil(registerSyncSku(env.IMAGENS,sku));
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