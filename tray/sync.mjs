import {DEFAULT_SYNC_SKUS} from './sync-catalog.mjs';
import {SERVER_IMAGE_BASE} from './server-images.mjs';
export const SYNC_PREFIX='__agente_sync__/';
export const SYNC_STATE=SYNC_PREFIX+'state.json';
const LOCK_KEY=SYNC_PREFIX+'lock.json';
const jsonOptions={httpMetadata:{contentType:'application/json'}};
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const dayAt=now=>new Date(now-3*3600000).toISOString().slice(0,10);
export async function registerSyncSku(bucket,sku){
 if(!/^\d{1,30}$/.test(sku)||DEFAULT_SYNC_SKUS.includes(sku))return;
 const key=SYNC_PREFIX+'skus/'+sku+'.json';
 if(!await bucket.head(key))await bucket.put(key,JSON.stringify({sku}),{...jsonOptions,onlyIf:new Headers({'If-None-Match':'*'})});
}
export async function syncCatalog(bucket){
 const skus=new Set(DEFAULT_SYNC_SKUS);let cursor;
 do{const page=await bucket.list({prefix:SYNC_PREFIX+'skus/',limit:1000,cursor});for(const item of page.objects){const code=item.key.slice((SYNC_PREFIX+'skus/').length).replace(/\.json$/,'');if(/^\d{1,30}$/.test(code))skus.add(code);}cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return [...skus].sort();
}
export async function syncSkuImages(bucket,sku,{fetcher=fetch,day=dayAt(Date.now()),deadline=Date.now()+45000}={}){
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
export async function runDailySync(env,{now=Date.now(),fetcher=fetch,maxSkus=1,catalog=undefined}={}){
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
export async function syncStatus(bucket){
 const file=await bucket.get(SYNC_STATE);if(!file)return {status:'awaiting-first-run'};
 const s=await file.json();return {status:s.completedAt?(s.errors.length?'complete-with-errors':'complete'):'running',date:s.date,startedAt:s.startedAt,completedAt:s.completedAt||null,skus:s.skus.length,checked:s.index,updated:s.updated,unchanged:s.unchanged,errors:s.errors.length};
}
