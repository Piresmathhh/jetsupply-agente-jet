// Modulo Fornecedores (De-Para Signus) do Agente Jet.
//
// Tela portada do artifact De-Para Signus v4. O motor puro (layout Signus, transformacoes, parse, de-para,
// criticas, nome por regras) vem de engine.mjs, o mesmo testado em tests/. O que muda em relacao ao artifact:
//   banco     -> Supabase: 1 linha por grupo, texto e tipo + realtime (antes: documentos em buckets)
//   IA        -> Edge Function ia-fornecedores, que monta os prompts no servidor (antes: prompt no navegador)
//   usuario   -> login do Agente (auth.uid() + profiles)
//   download  -> XLSX.writeFile
import { createEngine } from './engine.mjs';
import { DEFAULT_TXT } from '../supabase/functions/ia-fornecedores/tarefas.mjs';

/* ============ Supabase (mesma sessao do index.html) ============ */
const SUPABASE_URL = 'https://alnhqvuezhcvgnfzdayr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsbmhxdnVlemhjdmduZnpkYXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNTg5NDAsImV4cCI6MjA5OTgzNDk0MH0.iHqBAUCw0l56IlqbbezGv9e1dUqgEQlqQ57Nkgu27VI';
// Mesma regra do index.html: "Lembrar de mim" desmarcado guarda a sessao so no sessionStorage.
const REMEMBER_KEY = 'jet_remember_me';
function authBackingStorage() {
  return localStorage.getItem(REMEMBER_KEY) === '0' ? window.sessionStorage : window.localStorage;
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: {
      getItem: (k) => authBackingStorage().getItem(k),
      setItem: (k, v) => authBackingStorage().setItem(k, v),
      removeItem: (k) => authBackingStorage().removeItem(k),
    },
  },
});

/* ============ helpers de tela ============ */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN = n => Number(n).toLocaleString('pt-BR');
function toast(msg, ms=3200){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true, ms); }

/* ============ state ============ */
const S = {
  step: 'arquivo',
  wb: null, fileName: '', isSample: false, sheetName: '',
  grid: [],            // all rows of the sheet (array of arrays)
  headerRow: 0, headers: [], keyCol: -1,
  items: [],           // {r, row, secao, ctx, excl}
  sections: 0,
  profiles: {}, profId: null, P: null,
  tree: [], carac: [], padroes: null,
  online: false, podeEditar: false, isAdmin: false, salvos: new Set(),
  opts: { useSug: false },
  dirty: false, saving: false,
  out: null, // computed rows
  caracVals: {}, // itemIndex -> {CARACT_ID: valor}
  catFilter: 'todos', revFilter: 'todos', revPage: 0,
  openVmap: null,
  verVazios: false, gruposAbertos: new Set(), manterVisiveis: new Set(), // etapa 2: campos vazios ficam escondidos
  aiCtl: null,
  G: {}, T: {}, Y: {}, prop: {}, txtView: 'itens', tipoFilter: 'todos', tipoPage: 0, me: null, names: {}, subs: [],
  catView: 'grupos', grpSearch: '', txtFilter: 'todos', txtPage: 0, deferRender: false,
  txtCfg: null, consol: null,
};

const E = createEngine(S, XLSX);
const {
  COLS, GROUPS, HINTS, OUT_ONLY, TRANSFORMS, SIGNUS_SHEET,
  norm, isEmpty, slugId, capitalize, applyTransform, treeById, caracGroups, blankProfile, signature, sigScore,
  trimSheet, detectHeader, parseItems, colIdx, srcVal, siglaSet, itemKey, compute, autoMap, descSrc,
} = E;

/* ============ profile ============ */
// Perfil no banco: fornecedor_perfis (id, nome, assinatura) + config com o resto do de-para.
const perfilDoBanco = r => ({ ...(r.config || {}), id: r.id, nome: r.nome, assinatura: r.assinatura || '', atualizado: r.updated_at });
async function saveProfile(){
  if (!S.P) return;
  S.P.assinatura = signature(S.headers);
  S.P.atualizado = new Date().toISOString();
  S.profiles[S.P.id] = S.P;
  if (!S.online) { S.dirty = false; renderSaveState(); return; }
  if (!S.podeEditar) { S.dirty = false; renderSaveState(); toast('Seu acesso e so de leitura: o perfil nao foi salvo.'); return; }
  if (S.saving) { scheduleSave(); return; }
  S.saving = true; renderSaveState();
  const { id, nome, assinatura, atualizado, ...config } = JSON.parse(JSON.stringify(S.P));
  const { error } = await sb.from('fornecedor_perfis').upsert({ id, nome, assinatura, config });
  if (error) toast('Nao foi possivel salvar o perfil (' + error.message + ').');
  else { S.dirty = false; S.salvos.add(id); }
  S.saving = false; renderSaveState();
}
function renderSaveState(){
  const el = $('#saveState');
  if (!S.online) { el.textContent = 'sem banco'; el.className = 'save-state off'; return; }
  if (!S.podeEditar) { el.textContent = 'so leitura'; el.className = 'save-state off'; return; }
  if (S.saving) { el.textContent = 'salvando...'; el.className = 'save-state'; return; }
  el.textContent = S.dirty ? 'alteracoes nao salvas' : 'salvo'; el.className = 'save-state' + (S.dirty ? ' dirty' : '');
}
function markDirty(){ S.dirty = true; renderSaveState(); scheduleSave(); }
let saveTimer = null;
function scheduleSave(){ if (!S.online || !S.P) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveProfile, 2500); }
function renderProfSel(){
  const sel = $('#profSel');
  const list = Object.values(S.profiles).sort((a,b)=>a.nome.localeCompare(b.nome));
  sel.innerHTML = (list.length ? '' : '<option value="">(nenhum perfil)</option>') + list.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
  if (S.profId) sel.value = S.profId;
}
function selectProfile(id){
  S.profId = id; S.P = S.profiles[id] || null;
  if (S.P) {
    for (const c of COLS) S.P.map[c] ||= {m:'vazio'};
    S.P.vmap ||= {}; S.P.filtros ||= [];
    subscribeProfile();
    if (S.wb && S.P.sheet && S.wb.SheetNames.includes(S.P.sheet) && S.P.sheet !== S.sheetName) { loadSheet(S.P.sheet); }
    else if (S.grid.length && S.P.headerRow !== null && S.P.headerRow !== S.headerRow) { S.headerRow = S.P.headerRow; parseItems(); }
    if (S.P.chave) S.keyCol = S.headers.findIndex(h => h === S.P.chave);
  }
  S.gruposAbertos.clear(); S.manterVisiveis.clear();
  S.dirty = false; renderProfSel(); renderSaveState(); refreshAll();
}

/* ============ file parsing ============ */
async function readFile(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array', cellDates:false, dense:false});
  return wb;
}
function openWorkbook(wb, name, isSample){
  S.wb = wb; S.fileName = name; S.isSample = !!isSample; S.caracVals = {};
  // choose sheet: profile hint, else the one with most filled cells
  let best = wb.SheetNames[0], bestN = -1;
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]; let n = 0; for (const k in ws) if (k[0] !== '!') n++;
    if (n > bestN) { bestN = n; best = sn; }
  }
  loadSheet(best, true);
}
function loadSheet(sn, autoProfile){
  S.sheetName = sn;
  S.grid = trimSheet(S.wb.Sheets[sn]);
  S.headerRow = detectHeader(S.grid);
  parseItems();
  if (autoProfile) matchProfile();
  refreshAll();
}
function matchProfile(){
  const sig = signature(S.headers);
  let best = null, bestS = 0;
  for (const p of Object.values(S.profiles)) { const s = sigScore(sig, p.assinatura || ''); if (s > bestS) { bestS = s; best = p; } }
  S.match = best && bestS >= 0.6 ? { p: best, s: bestS } : null;
  if (S.match && S.profId !== best.id) selectProfile(best.id);
}

/* ============ banco (Supabase) ============ */
// A tela trabalha com os registros no formato do artifact (S.G, S.T, S.Y, S.prop). Aqui eles viram linhas:
// 1 por grupo, texto e tipo. Cada gravacao manda so as colunas que mudaram, entao duas pessoas mexendo em
// campos ou itens diferentes nao sobrescrevem uma a outra. O realtime traz o que os outros gravam.
const enc = k => encodeURIComponent(k).replace(/\./g, '%2E');
const nz = v => (v === '' || v === undefined || v === null) ? null : v;
const KINDS = {
  g: {
    tabela: 'fornecedor_grupos', chave: 'chave', perfil: true, store: 'G',
    paraBanco: {
      tree: ['tree_id', v => v ? Number(v) : null], prop: ['proposta', nz], misto: ['misto', Boolean],
      semMatch: ['sem_match', Boolean], split: ['dividir', Boolean], catProd: ['cat_produto', nz],
      gc: ['grupo_carac', nz], resp: ['responsavel', nz], ok: ['aprovado', Boolean],
      fonte: ['fonte', nz], conf: ['confianca', nz], motivo: ['motivo', nz],
    },
    doBanco: r => ({
      k: r.chave, tree: r.tree_id == null ? '' : String(r.tree_id), prop: r.proposta || '', misto: r.misto,
      semMatch: r.sem_match, split: r.dividir, catProd: r.cat_produto || '', gc: r.grupo_carac || '',
      resp: r.responsavel || '', ok: r.aprovado, okPor: r.aprovado_por || '', fonte: r.fonte || '',
      conf: r.confianca || '', motivo: r.motivo || '', por: r.updated_by || '', em: r.updated_at,
    }),
  },
  t: {
    tabela: 'produto_textos', chave: 'ref', perfil: true, store: 'T',
    paraBanco: {
      nome: ['nome', nz], desc: ['descricao', nz], st: ['status', v => v || 'sugerido'], editado: ['editado', Boolean],
      orig: ['origem', nz], fonte: ['fonte', nz], duvida: ['duvida', nz],
    },
    doBanco: r => ({
      k: r.ref, nome: r.nome || '', desc: r.descricao || '', st: r.status, editado: r.editado, orig: r.origem || '',
      fonte: r.fonte || '', duvida: r.duvida || '', okPor: r.aprovado_por || '', por: r.updated_by || '', em: r.updated_at,
    }),
  },
  y: {
    tabela: 'tipos_vocabulario', chave: 'chave', perfil: false, store: 'Y',
    paraBanco: { raw: ['bruto', v => v || ''], tipo: ['tipo', nz], fonte: ['fonte', nz] },
    doBanco: r => ({ k: r.chave, raw: r.bruto, tipo: r.tipo || '', fonte: r.fonte || '', por: r.updated_by || '', em: r.updated_at }),
  },
};
const propDoBanco = r => ({ path: r.caminho, st: r.status, por: r.aprovado_por || r.updated_by || '', em: r.updated_at });

async function writeMany(kind, entries){ // entries: [[key, patch]]
  const K = KINDS[kind]; const store = S[K.store];
  const now = new Date().toISOString();
  const lotes = new Map(); // mesmas colunas -> mesmo upsert (colunas ausentes nao sao tocadas)
  for (const [k, patch] of entries) {
    store[k] = { ...(store[k] || {}), ...patch, k, por: S.me || '', em: now };
    const row = { [K.chave]: k };
    if (K.perfil && S.P) row.perfil_id = S.P.id;
    for (const [campo, v] of Object.entries(patch)) { const m = K.paraBanco[campo]; if (m) row[m[0]] = m[1](v); }
    const cols = Object.keys(row).sort().join(',');
    if (!lotes.has(cols)) lotes.set(cols, []);
    lotes.get(cols).push(row);
  }
  if (!S.online || (K.perfil && !S.P) || !entries.length) return;
  if (!S.podeEditar) { toast('Seu acesso e so de leitura: a alteracao nao foi salva.'); return; }
  try {
    if (K.perfil && !S.salvos.has(S.P.id)) await saveProfile(); // a linha do grupo/texto precisa do perfil no banco
    for (const rows of lotes.values()) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from(K.tabela).upsert(rows.slice(i, i + 500), { onConflict: K.perfil ? `perfil_id,${K.chave}` : K.chave, defaultToNull: false });
        if (error) throw error;
      }
    }
  } catch (e) { toast('Nao foi possivel salvar (' + (e.message || 'erro') + '). Tente de novo.'); }
}
const setGroup = (k, patch) => writeMany('g', [[k, patch]]);
const setText = (k, patch) => writeMany('t', [[k, patch]]);

// Le a tabela inteira em paginas de 1000 (limite do PostgREST).
async function lerTudo(tabela, ordem, filtro){
  const out = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select('*').order(ordem).range(de, de + 999);
    if (filtro) q = q.eq(filtro[0], filtro[1]);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
function aplicarLinha(kind, ev, pid){
  const K = KINDS[kind];
  const row = ev.eventType === 'DELETE' ? ev.old : ev.new;
  if (!row || (K.perfil && row.perfil_id !== pid)) return;
  const k = row[K.chave];
  if (ev.eventType === 'DELETE') delete S[K.store][k]; else S[K.store][k] = K.doBanco(row);
  softRefresh();
}
function unsubscribeAll(){ S.subs.forEach(u => { try { u(); } catch {} }); S.subs = []; }
function subscribeProfile(){
  unsubscribeAll(); S.G = {}; S.T = {};
  if (!S.online || !S.P) return;
  const pid = S.P.id;
  const canal = sb.channel('fornecedores-perfil-' + pid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fornecedor_grupos', filter: `perfil_id=eq.${pid}` }, ev => aplicarLinha('g', ev, pid))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produto_textos', filter: `perfil_id=eq.${pid}` }, ev => aplicarLinha('t', ev, pid))
    .subscribe();
  S.subs.push(() => sb.removeChannel(canal));
  Promise.all([lerTudo('fornecedor_grupos', 'chave', ['perfil_id', pid]), lerTudo('produto_textos', 'ref', ['perfil_id', pid])])
    .then(([gs, ts]) => {
      if (!S.P || S.P.id !== pid) return;
      // o que ja chegou pelo realtime ou foi gravado aqui depois de abrir o perfil e mais novo que esta leitura
      for (const r of gs) if (!S.G[r.chave]) S.G[r.chave] = KINDS.g.doBanco(r);
      for (const r of ts) if (!S.T[r.ref]) S.T[r.ref] = KINDS.t.doBanco(r);
      softRefresh();
    })
    .catch(e => toast('Nao foi possivel ler os grupos e nomes deste perfil (' + (e.message || 'erro') + ').'));
}
// Vocabulario de tipos e arvore proposta valem para todos os fornecedores.
function subscribeGlobal(){
  sb.channel('fornecedores-global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tipos_vocabulario' }, ev => aplicarLinha('y', ev))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'arvore_proposta' }, ev => {
      const row = ev.eventType === 'DELETE' ? ev.old : ev.new; if (!row) return;
      if (ev.eventType === 'DELETE') delete S.prop[enc(row.caminho)]; else S.prop[enc(row.caminho)] = propDoBanco(row);
      if (S.step === 'categorias') softRefresh();
    })
    .subscribe();
}
let softTimer = null;
function softRefresh(){ clearTimeout(softTimer); softTimer = setTimeout(softRefreshNow, 300); }
function softRefreshNow(){
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('[data-pane]')) { S.deferRender = true; return; }
  refreshAll();
}
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (S.deferRender && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { S.deferRender = false; refreshAll(); }
}, 50));

/* ============ people ============ */
function initials(n){ return String(n || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('') || '?'; }
async function resolveNames(ids){
  if (!S.online) return;
  const miss = [...new Set(ids.filter(id => id && !(id in S.names)))].slice(0, 64);
  if (!miss.length) return;
  miss.forEach(id => S.names[id] = '');
  const { data } = await sb.from('profiles').select('id,nome,email').in('id', miss);
  for (const p of data || []) S.names[p.id] = p.nome || p.email || '';
  softRefresh();
}
function whoHtml(id){
  if (!id) return '';
  const nm = S.names[id] || (id === S.me ? 'Voce' : 'Alguem');
  return `<span class="who ${id === S.me ? 'me' : ''}" title="${esc(nm)}"><i>${esc(initials(nm))}</i>${esc(id === S.me ? 'Voce' : nm.split(' ')[0])}</span>`;
}

/* ============ AI ============ */
// A IA roda na Edge Function ia-fornecedores: o navegador manda so a tarefa e os dados, os prompts ficam no servidor.
function aiAvailable(){ return S.online && S.podeEditar; }
async function ia(tarefa, dados, signal){
  if (signal && signal.aborted) throw { code: 'cancelled' };
  const { data, error } = await sb.functions.invoke('ia-fornecedores', { body: { tarefa, dados } });
  if (signal && signal.aborted) throw { code: 'cancelled' };
  if (error) throw { code: 'rede', message: 'Nao foi possivel falar com o servidor (' + error.message + ').' };
  if (data && data.error) throw { code: data.codigo || 'erro', message: data.error };
  return (data && data.resultado) || [];
}
function startAI(){
  S.aiCtl = new AbortController();
  $('#aiBar').hidden = false; $('#aiProg i').style.width = '0%';
  $$('button.ai').forEach(b => b.disabled = true);
  return S.aiCtl.signal;
}
function progAI(done, total, msg){ $('#aiProg i').style.width = Math.round(100*done/Math.max(total,1)) + '%'; $('#aiMsg').textContent = msg; }
function endAI(msg){
  $('#aiBar').hidden = true; $$('button.ai').forEach(b => b.disabled = false); S.aiCtl = null;
  if (msg) toast(msg, 6000);
}
function aiErr(e){
  const c = e && e.code;
  if (c === 'cancelled') return 'Interrompido. O que ja tinha sido gerado ficou salvo.';
  return (e && e.message) || 'A IA nao respondeu (' + (c || 'erro') + '). O que ja foi gerado ficou salvo.';
}
async function aiSuggestMapping(){
  if (!aiAvailable() || !S.P) return;
  const linhas = S.items.slice(0, 4).map(it => Object.fromEntries(S.headers.map((h,i)=>[h, it.row[i] ?? ''])));
  const btn = $('#aiMap'); btn.disabled = true; btn.textContent = 'Pensando...';
  try {
    const res = await ia('mapear_colunas', { cabecalhos: S.headers, linhas });
    let n = 0;
    for (const r of res) {
      if (!COLS.includes(r.destino) || !S.headers.includes(r.origem)) continue;
      S.P.map[r.destino] = { m:'col', src:r.origem, t:r.transformacao, ia:true }; n++;
    }
    markDirty(); refreshAll(); toast(n + ' campos mapeados pela IA. Revise os marcados com IA.');
  } catch (e) { toast(aiErr(e)); }
  btn.disabled = false; btn.textContent = 'Sugerir com IA';
}
function groupsList(){
  const map = new Map();
  if (!S.out) return [];
  for (const r of S.out) {
    if (r.excl) continue;
    let g = map.get(r.gk); if (!g) { g = { key:r.gk, ctx:r.item.ctx, n:0, ex:[], marcas:new Set(), rows:[] }; map.set(r.gk, g); }
    g.n++; g.rows.push(r); if (g.ex.length < 4) g.ex.push(r.o['Nome']); if (r.o['Marca']) g.marcas.add(r.o['Marca']);
  }
  return [...map.values()];
}
function normPath(p){ return String(p || '').split('>').map(s => s.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,4).join(' > '); }
function proposals(){
  const m = new Map();
  for (const g of Object.values(S.G)) if (g.prop && !g.tree) { const p = normPath(g.prop); m.set(p, (m.get(p) || 0) + 1); }
  for (const v of Object.values(S.prop)) if (v && v.path && !m.has(v.path)) m.set(v.path, 0);
  return m;
}
function catBatchesPending(){
  const gl = groupsList();
  const mine = S.catFilter === 'meus';
  return gl.filter(g => { const d = S.G[g.key] || {}; return !d.tree && !d.prop && !d.semMatch && (!mine || d.resp === S.me); });
}
async function aiSuggestCats(){
  if (!aiAvailable() || !S.P) return;
  const pending = catBatchesPending();
  if (!pending.length) { toast('Todos os grupos deste filtro ja tem categoria ou proposta.'); return; }
  const signal = startAI();
  const BATCH = 25; let done = 0, found = 0, prop = 0, mixed = 0;
  try {
    for (let b = 0; b < pending.length; b += BATCH) {
      const chunk = pending.slice(b, b + BATCH);
      progAI(done, pending.length, `Classificando grupos ${done+1} a ${Math.min(done+chunk.length, pending.length)} de ${pending.length}`);
      const res = await ia('categorias', { grupos: chunk.map(g => ({ g: g.key, contexto: g.ctx || g.key, marcas: [...g.marcas], n: g.n, exemplos: g.ex })) }, signal);
      const entries = [];
      for (const r of res) {
        const id = r.id != null && treeById(r.id) ? String(r.id) : '';
        const caminho = id ? treeById(id).path : (r.misto ? '' : normPath(r.caminho));
        entries.push([r.g, { tree: id, prop: id ? '' : caminho, misto: !!r.misto, semMatch: !id && !caminho, fonte: 'ia', conf: r.confianca || '', motivo: String(r.motivo||'').slice(0,120) }]);
        id ? found++ : r.misto ? mixed++ : prop++;
      }
      await writeMany('g', entries);
      done += chunk.length; compute(); renderGroups(); renderCounts();
    }
    endAI(`${found} grupos com categoria existente, ${prop} com categoria nova proposta, ${mixed} grupos mistos (use "Item a item").`);
  } catch (e) { endAI(aiErr(e)); }
  compute(); refreshAll();
}
async function aiExtractCarac(){
  if (!aiAvailable() || !S.P) return;
  const cg = caracGroups();
  const targets = S.out.filter(r => !r.excl && r.g && r.g.gc && cg[r.g.gc] && !S.caracVals[r.ix]);
  if (!targets.length) { toast('Nenhum item com grupo de caracteristicas definido (ou todos ja extraidos).'); return; }
  const byGc = {}; targets.forEach(r => (byGc[r.g.gc] ||= []).push(r));
  const signal = startAI(); let done = 0;
  try {
    for (const [gc, list] of Object.entries(byGc)) {
      for (let b = 0; b < list.length; b += 30) {
        const chunk = list.slice(b, b + 30);
        progAI(done, targets.length, `Extraindo caracteristicas: ${done} de ${targets.length}`);
        const res = await ia('caracteristicas', { grupo: gc, itens: chunk.map(r => ({ i: String(r.ix), nome: r.o['Nome'], descricao: r.o['Descrição técnica'] || '' })) }, signal);
        for (const x of res) if (x.valores && typeof x.valores === 'object') S.caracVals[Number(x.i)] = x.valores;
        done += chunk.length;
      }
    }
    endAI(`Caracteristicas extraidas para ${Object.keys(S.caracVals).length} itens. Elas saem na aba Caracteristicas do arquivo.`);
  } catch (e) { endAI(aiErr(e)); }
  renderGroups();
}
async function aiConsolidate(){
  if (!aiAvailable()) return;
  const props = [...proposals().entries()];
  if (props.length < 2) { toast('Poucas categorias propostas para consolidar.'); return; }
  const signal = startAI(); progAI(0, 1, 'Revisando a arvore proposta');
  try {
    const res = await ia('consolidar_arvore', { propostos: props.slice(0, 500).map(([caminho, grupos]) => ({ caminho, grupos })) }, signal);
    S.consol = res.map(x => ({ de: x.de, para: x.para, motivo: x.motivo || '', on: true }));
    endAI(S.consol.length ? `${S.consol.length} ajustes sugeridos. Revise antes de aplicar.` : 'A arvore proposta ja esta coerente.');
  } catch (e) { endAI(aiErr(e)); }
  renderArvore();
}
function txtCfg(){ return { ...DEFAULT_TXT, ...(S.padroes && S.padroes.txt || {}) }; }
function itemFacts(r){
  const skip = /preco|valor|ipi|icms|mva|cst|cest|ajuste|lp$|exclus|observacao sp|base reduzida|excecao/;
  const facts = [];
  S.headers.forEach((h, i) => { const v = r.item.row[i]; if (!isEmpty(v) && !skip.test(norm(h))) facts.push(`${h}: ${String(v).replace(/\s+/g,' ').trim()}`); });
  return facts.join(' ; ').slice(0, 900);
}
async function aiTexts(){
  if (!aiAvailable() || !S.P || !S.out) return;
  const regen = $('#genRegen').checked, withDesc = $('#genDesc').checked, lim = Number($('#txtLimit').value);
  const rows = filteredTextRows().filter(r => r.key && (regen || !(S.T[r.key] && S.T[r.key].nome)) && !(S.T[r.key] && S.T[r.key].st === 'aprovado')).slice(0, lim);
  if (!rows.length) { toast('Nenhum item sem sugestao neste filtro. Marque "refazer os ja sugeridos" para gerar de novo.'); return; }
  const signal = startAI();
  const BATCH = withDesc ? 12 : 25; let done = 0;
  try {
    for (let b = 0; b < rows.length; b += BATCH) {
      const chunk = rows.slice(b, b + BATCH);
      const porKey = new Map(chunk.map(r => [r.key, r]));
      progAI(done, rows.length, `Gerando nomes${withDesc ? ' e descricoes' : ''}: ${done} de ${rows.length}`);
      const res = await ia('textos', {
        perfil_id: S.P.id, com_descricao: withDesc,
        itens: chunk.map(r => ({ i: r.key, categoria: r.cat ? r.cat.path : (r.g && r.g.prop) || r.item.ctx || '', fatos: itemFacts(r) })),
      }, signal);
      const entries = [];
      for (const x of res) {
        const r = porKey.get(x.i); if (!r || !x.nome) continue;
        const patch = { nome: x.nome, st: 'sugerido', orig: String(r.item.row[colIdx(S.P.map['Nome']?.src)] ?? r.o['Nome'] ?? '').slice(0, 300), duvida: x.duvida || '', editado: false, fonte: 'ia' };
        if (withDesc && x.descricao) patch.desc = x.descricao;
        entries.push([r.key, patch]);
      }
      await writeMany('t', entries);
      done += chunk.length; compute(); renderTextos(); renderCounts();
    }
    endAI(`${done} itens com sugestao. Revise e aprove.`);
  } catch (e) { endAI(aiErr(e)); }
  compute(); refreshAll();
}
function refreshAIButtons(){
  const on = aiAvailable();
  $('#aiMap').hidden = !on; $('#aiCats').hidden = !on; $('#aiTexts').hidden = !on; $('#aiConsol').hidden = !on; $('#aiTipos').hidden = !on;
  $('#aiCarac').hidden = !on || !Object.values(S.G).some(g => g.gc);
}

/* ============ render: arquivo ============ */
function renderArquivo(){
  $('#sampleBanner').hidden = !S.isSample;
  const has = S.grid.length > 0; $('#filePanel').hidden = !has; if (!has) return;
  $('#fileName').textContent = S.fileName;
  $('#sheetSel').innerHTML = S.wb.SheetNames.map(s => `<option ${s===S.sheetName?'selected':''}>${esc(s)}</option>`).join('');
  $('#hdrRow').value = S.headerRow + 1;
  $('#keySel').innerHTML = S.headers.map((h,i) => `<option value="${i}" ${i===S.keyCol?'selected':''}>${esc(h)}</option>`).join('');
  const ex = S.out ? S.out.filter(r=>r.excl).length : 0;
  $('#fileTiles').innerHTML = [
    ['Linhas de produto', S.items.length], ['Secoes detectadas', S.sections], ['Colunas', S.headers.length], ['Excluidos', ex],
  ].map(([l,v]) => `<div class="tile"><span class="label">${l}</span><b>${fmtN(v)}</b></div>`).join('');
  $('#profMatch').innerHTML = S.match ? `<span class="pill ok">Perfil reconhecido pelo cabecalho: ${esc(S.match.p.nome)} (${Math.round(S.match.s*100)}% igual)</span>`
    : (S.P ? `<span class="pill">Usando perfil: ${esc(S.P.nome)}</span>` : `<span class="pill warn">Nenhum perfil para este cabecalho. Crie um em "Novo perfil".</span>`);
  const start = Math.max(0, S.headerRow - 2), end = Math.min(S.grid.length, S.headerRow + 40);
  const nc = S.headers.length;
  let h = '<thead><tr><th>#</th>' + S.headers.map((x,i)=>`<th>${i===S.keyCol?'&#9670; ':''}${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (let r = start; r < end; r++) {
    const row = S.grid[r] || []; const filled = row.slice(0,nc).filter(v=>!isEmpty(v)).length;
    const cls = r === S.headerRow ? 'hdr' : (r > S.headerRow && filled === 1 ? 'sec' : '');
    h += `<tr class="${cls}"><td class="num">${r+1}</td>` + Array.from({length:nc}, (_,i)=>`<td><span class="clip">${esc(row[i])}</span></td>`).join('') + '</tr>';
  }
  $('#rawTbl').innerHTML = h + '</tbody>';
}

/* ============ render: colunas ============ */
function previewFor(c){
  if (!S.out) return '';
  const vals = []; for (const r of S.out) { if (r.excl) continue; const v = r.o[c]; if (v !== '' && v != null) vals.push(v); if (vals.length >= 3) break; }
  return vals.join('  |  ');
}
function distinctFor(c){
  const m = S.P.map[c]; if (!S.out || !m || m.m === 'vazio') return [];
  const ctx = { siglas: siglaSet() }; const seen = new Map();
  for (const r of S.out) {
    if (r.excl) continue;
    let v = m.m === 'col' ? applyTransform(m.t||'texto', srcVal(r.item, m.src), ctx) : r.o[c];
    v = String(v); if (v === '') continue; seen.set(v, (seen.get(v)||0)+1); if (seen.size > 80) break;
  }
  return [...seen.entries()].sort((a,b)=>b[1]-a[1]);
}
const MODOS = [['vazio','Vazio','o campo sai em branco'],['col','Coluna','copia uma coluna da planilha'],['fixo','Fixo','mesmo valor para todos os itens'],['modelo','Modelo','junta colunas e texto, ex.: {MARCA} {ITEM}'],['derivado','Derivado','reaproveita outro campo do Signus ja montado']];
const MODOS_AJUDA = MODOS.map(([, l, d]) => l + ': ' + d).join('\n');
function renderColunas(){
  const grid = $('#mapGrid');
  $('#mapSemArquivo').hidden = !S.P || S.headers.length > 0;
  if (!S.P) { grid.innerHTML = '<div class="panel muted">Crie ou escolha um perfil de fornecedor para mapear as colunas.</div>'; $('#filters').innerHTML=''; $('#mapResumo').textContent = ''; $('#toggleVazios').hidden = true; $('#ajustesResumo').textContent = ''; return; }
  $('#siglas').value = S.P.siglas || '';
  renderFilters();
  const nF = (S.P.filtros || []).length, nS = String(S.P.siglas || '').split(/[\s,;]+/).filter(Boolean).length;
  $('#ajustesResumo').textContent = [nF ? `${nF} ${nF === 1 ? 'filtro' : 'filtros'}` : 'sem filtros', nS ? `${nS} ${nS === 1 ? 'sigla' : 'siglas'}` : 'sem siglas extras'].join(' · ');
  const campos = GROUPS.flatMap(([, cols]) => cols);
  const nVazios = campos.filter(c => (S.P.map[c]?.m || 'vazio') === 'vazio').length;
  $('#mapResumo').textContent = `${campos.length - nVazios} de ${campos.length} campos preenchidos` + (S.verVazios || !nVazios ? '' : `. Os ${nVazios} vazios estao escondidos.`);
  $('#toggleVazios').hidden = !nVazios;
  $('#toggleVazios').textContent = S.verVazios ? 'Esconder campos vazios' : `Mostrar campos vazios (${nVazios})`;
  const srcOpts = sel => '<option value="">(coluna)</option>' + S.headers.map(h => `<option ${h===sel?'selected':''}>${esc(h)}</option>`).join('');
  const derOpts = sel => '<option value="">(campo Signus)</option>' + COLS.filter(c=>!OUT_ONLY.has(c)).map(h => `<option ${h===sel?'selected':''}>${esc(h)}</option>`).join('');
  const trOpts = sel => TRANSFORMS.map(([k,l]) => `<option value="${k}" ${k===(sel||'texto')?'selected':''}>${l}</option>`).join('');
  let html = '';
  for (const [gname, cols] of GROUPS) {
    const setN = cols.filter(c => (S.P.map[c]?.m || 'vazio') !== 'vazio').length;
    const aberto = S.verVazios || S.gruposAbertos.has(gname);
    const visiveis = aberto ? cols : cols.filter(c => (S.P.map[c]?.m || 'vazio') !== 'vazio' || S.manterVisiveis.has(c));
    const ocultos = cols.length - visiveis.length;
    const btnGrupo = S.verVazios ? '' : ocultos ? `<button class="sm ghost" data-mgrp="${esc(gname)}">Mostrar ${ocultos} ${ocultos === 1 ? 'vazio' : 'vazios'}</button>` : S.gruposAbertos.has(gname) ? `<button class="sm ghost" data-mgrp="${esc(gname)}">Esconder vazios</button>` : '';
    html += `<div class="map-group${visiveis.length ? '' : ' fechado'}"><header><h3>${gname}</h3><span class="row" style="gap:8px">${btnGrupo}<span class="pill ${setN?'info':''}">${setN} de ${cols.length}</span></span></header>`;
    for (const c of visiveis) {
      const m = S.P.map[c] || {m:'vazio'}; const set = m.m !== 'vazio';
      const id = 'm' + COLS.indexOf(c);
      let mid = '', tr = '';
      if (m.m === 'col') { mid = `<select class="mono" data-f="src" data-c="${esc(c)}" aria-label="Coluna de origem para ${esc(c)}">${srcOpts(m.src)}</select>`; tr = `<select data-f="t" data-c="${esc(c)}" aria-label="Transformacao">${trOpts(m.t)}</select>`; }
      else if (m.m === 'fixo') mid = `<input class="mono" data-f="v" data-c="${esc(c)}" value="${esc(m.v)}" aria-label="Valor fixo para ${esc(c)}">`;
      else if (m.m === 'modelo') { mid = `<input class="mono" data-f="v" data-c="${esc(c)}" value="${esc(m.v)}" placeholder="{COLUNA} texto {OUTRA}" aria-label="Modelo para ${esc(c)}">`; tr = `<select data-f="t" data-c="${esc(c)}">${trOpts(m.t)}</select>`; }
      else if (m.m === 'derivado') { mid = `<select data-f="src" data-c="${esc(c)}">${derOpts(m.src)}</select>`; tr = `<select data-f="t" data-c="${esc(c)}">${trOpts(m.t)}</select>`; }
      const vmN = Object.keys(S.P.vmap[c] || {}).filter(k => S.P.vmap[c][k] !== '').length;
      const vmBtn = set && m.m !== 'fixo' ? `<button class="sm ghost" data-vmap="${esc(c)}">Valores${vmN ? ' ('+vmN+')' : ''}</button>` : '';
      const note = c === 'Nome' ? '<small>os nomes aprovados na etapa 4 substituem este valor</small>' : c === 'Descrição do produto e-commerce' ? '<small>preenchida pelas descricoes aprovadas na etapa 4</small>' : (HINTS[c] ? `<small>${esc(HINTS[c])}</small>` : '');
      html += `<div class="map-row ${set?'set':''}">
        <div class="tgt"><span class="dot"></span>${esc(c)} ${m.ia?'<span class="pill ai">IA</span>':''}${note}</div>
        <select id="${id}" data-f="m" data-c="${esc(c)}" aria-label="Origem do campo ${esc(c)}" title="${esc(MODOS_AJUDA)}">
          ${MODOS.map(([k,l,d])=>`<option value="${k}" title="${esc(d)}" ${m.m===k?'selected':''}>${l}</option>`).join('')}
        </select>
        <div>${mid}</div>
        <div>${tr}</div>
        <div class="row" style="gap:4px;flex-wrap:nowrap;min-width:0"><span class="prev" title="${esc(previewFor(c))}">${esc(previewFor(c))}</span>${vmBtn}</div>
        ${S.openVmap === c ? renderVmap(c) : ''}
      </div>`;
    }
    html += '</div>';
  }
  grid.innerHTML = html;
}
function renderVmap(c){
  const d = distinctFor(c); const vm = S.P.vmap[c] || {};
  if (!d.length) return `<div class="vmap"><span class="note">Sem valores para mapear.</span></div>`;
  return `<div class="vmap"><div style="grid-column:1/-1" class="row"><span class="label">De-para de valores: ${esc(c)}</span><span class="note">deixe em branco para manter o valor original</span><button class="sm ghost" data-vmapclose style="margin-left:auto">Fechar</button></div>` +
    d.map(([v,n]) => `<div class="vm"><span title="${esc(v)} (${n})">${esc(v)} <span class="muted">(${n})</span></span><span class="muted">&rarr;</span><input class="mono" data-vm="${esc(c)}" data-from="${esc(v)}" value="${esc(vm[v]||'')}"></div>`).join('') + '</div>';
}
function renderFilters(){
  const ops = [['contem','contem'],['igual','igual a'],['vazio','esta vazia'],['naovazio','esta preenchida'],['secao','secao contem']];
  $('#filters').innerHTML = (S.P.filtros || []).map((f,i) => `<div class="row" style="gap:6px">
    <span class="note">Excluir linha quando</span>
    <select data-fi="${i}" data-k="col" aria-label="Coluna do filtro">${f.op==='secao'?'<option value="__secao" selected>(secao)</option>':''}${S.headers.map(h=>`<option ${h===f.col?'selected':''}>${esc(h)}</option>`).join('')}</select>
    <select data-fi="${i}" data-k="op" aria-label="Condicao">${ops.map(([k,l])=>`<option value="${k}" ${k===f.op?'selected':''}>${l}</option>`).join('')}</select>
    ${['vazio','naovazio'].includes(f.op) ? '' : `<input data-fi="${i}" data-k="v" value="${esc(f.v)}" class="mono" style="width:220px" aria-label="Valor">`}
    <button class="sm ghost" data-fdel="${i}" aria-label="Remover regra">Remover</button></div>`).join('') || '<p class="note">Nenhuma regra. Ex.: excluir quando OBSERVACOES GERAIS contem "SUBSTITUIDO", ou quando STATUS igual a "NP".</p>';
  const ex = S.out ? S.out.filter(r=>r.excl).length : 0;
  const dp = S.out ? S.out.filter(r=>r.dup).length : 0;
  $('#filterNote').textContent = S.out ? `${fmtN(ex - dp)} de ${fmtN(S.items.length)} linhas excluidas pelas regras. ${dp ? fmtN(dp) + ' repeticoes da mesma ref. tambem ficam de fora (vale a ultima ocorrencia, que costuma estar na secao de categoria e nao em Lancamentos).' : ''}` : '';
}

/* ============ render: categorias ============ */
function treeOptions(sel){
  const byL = {};
  for (const t of S.tree) { const grp = t.path.split(' > ').slice(0,-1).join(' > '); (byL[grp] ||= []).push(t); }
  return '<option value="">(sem categoria)</option>' + Object.entries(byL).map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map(t=>`<option value="${esc(t.id)}" ${t.id===sel?'selected':''}>${esc(t.nome)} (${esc(t.id)})</option>`).join('')}</optgroup>`).join('');
}
function filteredGroups(){
  let gl = groupsList(); const f = S.catFilter;
  if (f === 'meus') gl = gl.filter(g => S.G[g.key]?.resp === S.me);
  if (f === 'livres') gl = gl.filter(g => !S.G[g.key]?.resp);
  if (f === 'sem') gl = gl.filter(g => !S.G[g.key]?.tree && !S.G[g.key]?.prop);
  if (f === 'pend') gl = gl.filter(g => !S.G[g.key]?.ok);
  const q = norm(S.grpSearch);
  if (q) gl = gl.filter(g => norm(g.key).includes(q) || norm(g.ex.join(' ')).includes(q) || norm(S.G[g.key]?.prop).includes(q));
  return gl;
}
function renderGroups(){
  $('#catGrupos').hidden = S.catView !== 'grupos'; $('#catArvore').hidden = S.catView !== 'arvore';
  $$('#catView .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === S.catView ? 'true' : 'false'));
  if (S.catView === 'arvore') { renderArvore(); return; }
  const tbl = $('#grpTbl');
  $('#groupBy').innerHTML = `<option value="__secao">Secao da planilha</option>` + S.headers.map(h => `<option ${S.P?.grupoPor===h?'selected':''}>${esc(h)}</option>`).join('');
  if (S.P) $('#groupBy').value = S.P.grupoPor || '__secao';
  const roots = [...new Set(S.tree.map(t=>t.path.split(' > ')[0]))];
  const nonElec = S.out && groupsList().some(g => S.G[g.key]?.prop);
  $('#treeWarn').innerHTML = S.tree.length && roots.length < 3 && S.out ? `<div class="banner"><span>A arvore do Signus carregada tem ${S.tree.length} folhas em <b>${esc(roots.join(', '))}</b>. O que nao couber nela vira categoria proposta${nonElec ? ' (veja em Arvore proposta)' : ''}.</span></div>` : '';
  if (!S.P || !S.out) { tbl.innerHTML = '<tbody><tr><td class="muted">Carregue uma planilha e escolha um perfil.</td></tr></tbody>'; return; }
  const cg = caracGroups();
  const gl = filteredGroups();
  resolveNames(gl.map(g => S.G[g.key]?.resp).filter(Boolean));
  let h = '<thead><tr><th>Grupo</th><th class="num">Itens</th><th>Exemplos</th><th>Categoria</th><th>IA</th><th>Responsavel</th><th>Aprovado</th><th>Categoria de produto</th><th>Grupo de caract.</th><th></th></tr></thead><tbody>';
  for (const g of gl.slice(0, 300)) {
    const d = S.G[g.key] || {};
    const conf = d.fonte === 'ia' ? `<span class="pill ${d.tree ? (d.conf==='alta'?'ok':d.conf==='media'?'ai':'warn') : d.prop ? 'info' : 'err'}" title="${esc(d.motivo||'')}">${d.tree ? esc(d.conf||'ia') : d.prop ? 'nova' : d.misto ? 'misto' : 'sem match'}</span>` : (d.tree || d.prop ? '<span class="pill">manual</span>' : '');
    const nC = g.rows.filter(r => S.caracVals[r.ix]).length;
    const isSplit = g.key.includes(' :: ');
    const baseKey = isSplit ? g.key.split(' :: ')[0] : g.key;
    const catCell = `<select data-gk="${esc(g.key)}" data-gf="tree" style="max-width:240px">${treeOptions(d.tree || '')}</select>` +
      (d.tree && treeById(d.tree) ? `<div class="note">${esc(treeById(d.tree).path)}</div>` : '') +
      (!d.tree ? `<input data-gk="${esc(g.key)}" data-gf="prop" value="${esc(d.prop||'')}" placeholder="ou proponha: Nivel 1 > Nivel 2 > Nivel 3" style="width:100%;margin-top:4px;font-size:12px" aria-label="Categoria proposta">` : '');
    h += `<tr>
      <td style="min-width:190px"><b>${esc(isSplit ? g.key.split(' :: ')[1] : g.key)}</b>${g.ctx && g.ctx !== g.key ? `<div class="note">${esc(isSplit ? baseKey : g.ctx)}</div>` : ''}</td>
      <td class="num">${g.n}</td>
      <td style="min-width:220px;max-width:320px"><span class="note clamp2" title="${esc(g.ex.join(' ; '))}">${esc(g.ex.slice(0,2).join(' ; '))}</span></td>
      <td style="min-width:250px">${catCell}</td>
      <td>${conf}</td>
      <td>${d.resp ? whoHtml(d.resp) + (d.resp === S.me ? ` <button class="sm ghost" data-release="${esc(g.key)}">Soltar</button>` : '') : `<button class="sm" data-claim="${esc(g.key)}">Assumir</button>`}</td>
      <td><input type="checkbox" data-gk="${esc(g.key)}" data-gf="ok" ${d.ok?'checked':''} aria-label="Grupo aprovado" ${!(d.tree||d.prop)?'disabled':''}>${d.ok && d.okPor ? `<div class="note">${whoHtml(d.okPor)}</div>` : ''}</td>
      <td><input data-gk="${esc(g.key)}" data-gf="catProd" value="${esc(d.catProd||'')}" list="catProdList" style="width:150px" aria-label="Categoria de produto"></td>
      <td><select data-gk="${esc(g.key)}" data-gf="gc" style="max-width:170px"><option value="">(nenhum)</option>${Object.values(cg).map(x=>`<option value="${esc(x.codigo)}" ${x.codigo===d.gc?'selected':''}>${esc(x.nome)}</option>`).join('')}</select>${nC?`<div class="note">${nC} com caracteristicas</div>`:''}</td>
      <td>${S.P.grupoPor === '__secao' ? (isSplit ? `<button class="sm ghost" data-unsplit="${esc(baseKey)}">Juntar</button>` : (g.n > 1 ? `<button class="sm ghost" data-split="${esc(g.key)}" title="Classificar cada item deste grupo separadamente">Item a item</button>` : '')) : ''}</td>
    </tr>`;
  }
  if (gl.length > 300) h += `<tr><td colspan="10" class="note">Mostrando 300 de ${gl.length} grupos. Use os filtros ou a busca.</td></tr>`;
  if (!gl.length) h += `<tr><td colspan="10" class="note">Nenhum grupo neste filtro.</td></tr>`;
  tbl.innerHTML = h + '</tbody>';
  const cps = [...new Set(Object.values(S.G).map(x => x.catProd).filter(Boolean))];
  $('#catProdList').innerHTML = cps.map(c => `<option value="${esc(c)}">`).join('');
  refreshAIButtons();
}
function renderArvore(){
  const props = proposals();
  const exist = new Set(S.tree.map(t => norm(t.path)));
  const itemsBy = {};
  if (S.out) for (const r of S.out) if (!r.excl && !r.cat && r.g && r.g.prop) { const p = normPath(r.g.prop); itemsBy[p] = (itemsBy[p] || 0) + 1; }
  // build tree
  const root = {};
  for (const [p, n] of props) {
    const parts = p.split(' > '); let node = root; let acc = [];
    parts.forEach((part, i) => { acc.push(part); node[part] ||= { _path: acc.join(' > '), _n: 0, _items: 0, _leaf: false, _kids: {} }; node[part]._n += n; node[part]._items += itemsBy[p] || 0; if (i === parts.length - 1) node[part]._leaf = true; node = node[part]._kids; });
  }
  const rows = [];
  const walk = (obj, lvl) => Object.keys(obj).sort((a,b)=>a.localeCompare(b)).forEach(k => { const x = obj[k]; rows.push({ name:k, lvl, ...x }); walk(x._kids, lvl+1); });
  walk(root, 1);
  const nLeaf = rows.filter(r => r._leaf).length, nOk = rows.filter(r => r._leaf && S.prop[enc(r._path)]?.st === 'aprovada').length;
  $('#propNote').textContent = `${nLeaf} categorias propostas, ${nOk} aprovadas`;
  $('#propTree').innerHTML = rows.length ? rows.map(r => {
    const st = S.prop[enc(r._path)]; const ok = st && st.st === 'aprovada';
    const inSignus = exist.has(norm(r._path)) || S.tree.some(t => norm(t.path).endsWith(norm(r._path)));
    return `<div class="pnode l${r.lvl}">
      <div class="nm"><b>${esc(r.name)}</b>${inSignus ? '<span class="exists">ja existe no Signus</span>' : ''}${r._leaf && ok ? `<span class="pill ok">aprovada</span> ${whoHtml(st.por)}` : ''}</div>
      <span class="note mono">${r._n} grupos${r._items ? ' / ' + r._items + ' itens' : ''}</span>
      <span class="row" style="gap:4px">${r._leaf ? `<button class="sm ghost" data-ren="${esc(r._path)}">Renomear</button>${ok ? `<button class="sm ghost" data-unapp="${esc(r._path)}">Desaprovar</button>` : `<button class="sm" data-app="${esc(r._path)}">Aprovar</button>`}` : ''}</span>
    </div>`;
  }).join('') : '<p class="note" style="padding:12px 14px">Nenhuma categoria proposta ainda. Rode "Sugerir categorias com IA" na aba Grupos ou escreva a proposta direto na linha do grupo.</p>';
  const cb = $('#consolBox');
  if (S.consol && S.consol.length) {
    cb.innerHTML = `<div class="panel stack" style="gap:8px"><div class="row" style="justify-content:space-between"><h3>Ajustes sugeridos pela IA</h3><span class="row"><button class="sm primary" id="consolApply">Aplicar marcados</button><button class="sm ghost" id="consolDrop">Descartar</button></span></div>` +
      S.consol.map((c, i) => `<label class="row" style="gap:8px;font-size:12.5px"><input type="checkbox" data-ci="${i}" ${c.on?'checked':''}><span class="mono">${esc(c.de)}</span><span class="muted">&rarr;</span><b class="mono">${esc(c.para)}</b><span class="note">${esc(c.motivo)}</span></label>`).join('') + '</div>';
  } else cb.innerHTML = '';
  const ren = S.renaming;
  if (ren) cb.insertAdjacentHTML('afterbegin', `<div class="panel row" style="gap:8px"><span class="label">Renomear</span><span class="mono note">${esc(ren)}</span><input id="renInput" value="${esc(ren)}" class="mono" style="flex:1;min-width:260px"><button class="sm primary" id="renOk">Aplicar</button><button class="sm ghost" id="renCancel">Cancelar</button></div>`);
}
async function renamePath(from, to){
  to = normPath(to); if (!to || to === from) return;
  const entries = Object.entries(S.G).filter(([k, g]) => g.prop && normPath(g.prop) === from).map(([k]) => [k, { prop: to }]);
  await writeMany('g', entries);
  toast(`${entries.length} grupos movidos para ${to}.`);
}
async function setPropStatus(path, st){
  S.prop[enc(path)] = { path, st, por: S.me || '', em: new Date().toISOString() };
  if (S.online) {
    if (!S.podeEditar) toast('Seu acesso e so de leitura: a alteracao nao foi salva.');
    else { const { error } = await sb.from('arvore_proposta').upsert({ caminho: path, status: st }); if (error) toast('Nao foi possivel salvar (' + error.message + ').'); }
  }
  renderArvore();
}
async function relink(){
  if (!S.tree.length) return;
  const byNorm = new Map(S.tree.map(t => [norm(t.path), t]));
  const entries = [];
  for (const [k, g] of Object.entries(S.G)) {
    if (g.tree || !g.prop) continue;
    const p = norm(g.prop);
    const hit = byNorm.get(p) || S.tree.find(t => norm(t.path).endsWith(p));
    if (hit) entries.push([k, { tree: hit.id, prop: '', fonte: 'religado' }]);
  }
  await writeMany('g', entries); compute(); refreshAll();
  toast(entries.length ? `${entries.length} grupos ligados a categorias que agora existem no Signus.` : 'Nenhuma categoria proposta encontrada na arvore atual do Signus. Quando a categoria for cadastrada na base de categorias do Agente, use Religar de novo.');
}
async function exportTree(){
  const props = [...proposals().keys()].sort();
  if (!props.length) { toast('Nenhuma categoria proposta para exportar.'); return; }
  const aoa = [['NOME_PRIMEIRO_NIVEL','NOME_SEGUNDO_NIVEL','NOME_TERCEIRO_NIVEL','NOME_QUARTO_NIVEL','STATUS','GRUPOS_DE_PRODUTO']];
  const cnt = proposals();
  for (const p of props) { const parts = p.split(' > '); aoa.push([parts[0]||'', parts[1]||'', parts[2]||'', parts[3]||'', S.prop[enc(p)]?.st === 'aprovada' ? 'Aprovada' : 'Proposta', cnt.get(p) || 0]); }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Arvore proposta');
  await saveXlsx(wb, `Arvore_proposta_${new Date().toISOString().slice(0,10)}.xlsx`, `${props.length} categorias exportadas.`);
}

/* ============ render: textos ============ */
function filteredTextRows(){
  if (!S.out) return [];
  let rows = S.out.filter(r => !r.excl && r.key);
  const f = S.txtFilter;
  if (f === 'sug') rows = rows.filter(r => S.T[r.key]?.st !== 'aprovado');
  if (f === 'tipo') rows = rows.filter(r => S.T[r.key]?.st !== 'aprovado' && !(S.T[r.key]?.nome) && r.item._rule?.tipoFonte === 'regra');
  if (f === 'ok') rows = rows.filter(r => S.T[r.key]?.st === 'aprovado');
  if ($('#txtMine').checked) rows = rows.filter(r => S.G[r.gk]?.resp === S.me);
  const g = $('#txtGroup').value; if (g) rows = rows.filter(r => r.gk === g);
  const q = norm($('#txtSearch').value);
  if (q) rows = rows.filter(r => norm(r.o['Nome']).includes(q) || norm(r.key).includes(q) || norm(S.T[r.key]?.nome).includes(q) || norm(r.item._rule?.nome).includes(q));
  return rows;
}
function currentName(r){ const t = S.T[r.key]; return (t && t.nome) || (r.item._rule && r.item._rule.nome) || ''; }
function nameSource(r){
  const t = S.T[r.key];
  if (t && t.nome) return t.editado ? ['editado', 'info'] : t.fonte === 'regra' ? ['regra', ''] : ['IA', 'ai'];
  const tf = r.item._rule?.tipoFonte;
  return tf === 'regra' ? ['regra, tipo sem padrao', 'warn'] : ['regra', ''];
}
function approvePatch(r){
  const t = S.T[r.key] || {};
  return { st: 'aprovado', nome: currentName(r), orig: t.orig || String(descSrc(r.item) ?? '').slice(0, 300), fonte: t.nome ? (t.fonte || 'ia') : 'regra' };
}
function renderTextos(){
  const cfg = txtCfg();
  if (document.activeElement?.closest?.('#padraoBox') == null) {
    $('#padraoNome').value = cfg.padrao; $('#regrasNome').value = cfg.regrasNome; $('#regrasDesc').value = cfg.regrasDesc;
  }
  $('#padraoResumo').textContent = ' ' + cfg.padrao;
  $$('#txtView .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === S.txtView ? 'true' : 'false'));
  $('#tiposPane').hidden = S.txtView !== 'tipos'; $('#itensPane').hidden = S.txtView !== 'itens';
  const tv = tipoList();
  const nSem = tv.filter(x => !x.voc?.tipo).length;
  $('#tiposNote').textContent = S.out ? `${fmtN(tv.length)} tipos diferentes nesta planilha, ${fmtN(nSem)} sem padrao${nSem ? ` (cerca de ${Math.ceil(nSem / 50)} chamadas de IA)` : ''}.` : '';
  if (S.txtView === 'tipos') { renderTipos(tv); refreshAIButtons(); return; }
  const tbl = $('#txtTbl');
  if (!S.P || !S.out) { tbl.innerHTML = '<tbody><tr><td class="muted">Carregue uma planilha e escolha um perfil.</td></tr></tbody>'; $('#txtPager').innerHTML=''; return; }
  const gsel = $('#txtGroup'); const cur = gsel.value;
  const gl = groupsList();
  gsel.innerHTML = `<option value="">Todos os grupos (${gl.length})</option>` + gl.map(g => `<option value="${esc(g.key)}" ${g.key===cur?'selected':''}>${esc(g.key.slice(0,60))} (${g.n})</option>`).join('');
  const rows = filteredTextRows();
  const PG = 40; const pages = Math.max(1, Math.ceil(rows.length / PG)); if (S.txtPage >= pages) S.txtPage = 0;
  const slice = rows.slice(S.txtPage * PG, S.txtPage * PG + PG);
  resolveNames(slice.map(r => S.T[r.key]?.por).filter(Boolean));
  let h = '<thead><tr><th>Ref.</th><th>Nome original</th><th style="min-width:360px">Nome padronizado</th><th style="min-width:300px">Descricao longa</th><th>Status</th></tr></thead><tbody>';
  for (const r of slice) {
    const t = S.T[r.key] || {};
    const ok = t.st === 'aprovado';
    const nm = currentName(r); const [src, cls] = nameSource(r);
    const origName = t.orig || String(descSrc(r.item) ?? '');
    h += `<tr class="txtrow ${ok?'approved':''}">
      <td class="mono">${esc(r.key)}<div class="note">${esc(r.cat ? r.cat.nome : (r.g && r.g.prop ? r.g.prop.split(' > ').pop() : ''))}</div></td>
      <td><div class="txt-orig">${esc(origName)}</div></td>
      <td><textarea class="txt-name" rows="2" data-tk="${esc(r.key)}" data-tf="nome" aria-label="Nome padronizado de ${esc(r.key)}">${esc(nm)}</textarea>
        <div class="note" style="margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="pill ${cls}">${esc(src)}</span>${nm.length} caracteres${t.duvida ? ' &middot; <span style="color:var(--warn)">' + esc(t.duvida) + '</span>' : ''}${!ok && r.item._rule?.tipoFonte === 'regra' && !t.nome ? ` &middot; tipo: <span class="mono">${esc(r.item._rule.raw)}</span>` : ''}</div></td>
      <td><textarea class="txt-desc" data-tk="${esc(r.key)}" data-tf="desc" rows="3" placeholder="(sem descricao)" aria-label="Descricao de ${esc(r.key)}">${esc(t.desc||'')}</textarea></td>
      <td style="min-width:120px">${ok ? `<span class="pill ok">aprovado</span><div style="margin-top:4px">${whoHtml(t.por)}</div><button class="sm ghost" data-unok="${esc(r.key)}">Reabrir</button>` : `<button class="sm primary" data-ok="${esc(r.key)}">Aprovar</button>`}</td>
    </tr>`;
  }
  if (!slice.length) h += '<tr><td colspan="5" class="note">Nenhum item neste filtro.</td></tr>';
  tbl.innerHTML = h + '</tbody>';
  const all = S.out.filter(r => !r.excl && r.key);
  const nOk = all.filter(r => S.T[r.key]?.st === 'aprovado').length;
  $('#txtPager').innerHTML = `<span class="muted">${fmtN(rows.length)} itens no filtro &middot; ${fmtN(nOk)} aprovados de ${fmtN(all.length)}</span><button class="sm" data-pg="-1" ${S.txtPage===0?'disabled':''}>Anterior</button><span class="mono">${S.txtPage+1} / ${pages}</span><button class="sm" data-pg="1" ${S.txtPage>=pages-1?'disabled':''}>Proxima</button>`;
  refreshAIButtons();
}
function tipoList(){
  if (!S.out) return [];
  const m = new Map();
  for (const r of S.out) {
    if (r.excl || !r.item._rule) continue;
    const { raw, rk } = r.item._rule; if (!rk) continue;
    let x = m.get(rk); if (!x) { x = { rk, raw, n: 0, ex: [], ctx: r.item.ctx, voc: S.Y[rk] }; m.set(rk, x); }
    x.n++; if (x.ex.length < 3) x.ex.push(String(descSrc(r.item) ?? '').replace(/\s+/g,' ').trim().slice(0, 140));
  }
  return [...m.values()].sort((a,b) => b.n - a.n);
}
function renderTipos(tv){
  let list = tv;
  if (S.tipoFilter === 'sem') list = list.filter(x => !x.voc?.tipo);
  if (S.tipoFilter === 'com') list = list.filter(x => x.voc?.tipo);
  const q = norm($('#tipoSearch').value); if (q) list = list.filter(x => x.rk.includes(q) || norm(x.voc?.tipo).includes(q));
  $$('#tipoFilter .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === S.tipoFilter ? 'true' : 'false'));
  const PG = 100; const pages = Math.max(1, Math.ceil(list.length / PG)); if (S.tipoPage >= pages) S.tipoPage = 0;
  const slice = list.slice(S.tipoPage * PG, S.tipoPage * PG + PG);
  let h = '<thead><tr><th>Tipo na planilha</th><th class="num">Itens</th><th>Exemplo</th><th style="min-width:260px">Tipo padrao</th><th>Fonte</th></tr></thead><tbody>';
  for (const x of slice) {
    const v = x.voc || {};
    h += `<tr><td class="mono">${esc(x.raw)}</td><td class="num">${x.n}</td><td style="max-width:420px"><span class="note clamp2" title="${esc(x.ex.join(' ; '))}">${esc(x.ex[0] || '')}</span></td>
      <td><input data-yk="${esc(x.rk)}" data-raw="${esc(x.raw)}" value="${esc(v.tipo || '')}" placeholder="${esc(capitalize(x.raw.toLowerCase(), siglaSet()))}" style="width:100%" aria-label="Tipo padrao para ${esc(x.raw)}"></td>
      <td>${v.tipo ? `<span class="pill ${v.fonte === 'ia' ? 'ai' : 'info'}">${v.fonte === 'ia' ? 'IA' : 'manual'}</span>` : '<span class="pill warn">sem padrao</span>'}</td></tr>`;
  }
  if (!slice.length) h += '<tr><td colspan="5" class="note">Nenhum tipo neste filtro.</td></tr>';
  $('#tipoTbl').innerHTML = h + '</tbody>';
  $('#tipoPager').innerHTML = `<span class="muted">${fmtN(list.length)} tipos</span><button class="sm" data-pg="-1" ${S.tipoPage===0?'disabled':''}>Anterior</button><span class="mono">${S.tipoPage+1} / ${pages}</span><button class="sm" data-pg="1" ${S.tipoPage>=pages-1?'disabled':''}>Proxima</button>`;
}
async function aiTipos(){
  if (!aiAvailable() || !S.out) return;
  const pend = tipoList().filter(x => !x.voc?.tipo);
  if (!pend.length) { toast('Todos os tipos desta planilha ja tem padrao.'); return; }
  const signal = startAI(); const BATCH = 50; let done = 0, n = 0;
  try {
    for (let b = 0; b < pend.length; b += BATCH) {
      const chunk = pend.slice(b, b + BATCH);
      const porRk = new Map(chunk.map(x => [x.rk, x]));
      progAI(done, pend.length, `Padronizando tipos: ${done} de ${pend.length}`);
      const res = await ia('tipos', { itens: chunk.map(x => ({ i: x.rk, bruto: x.raw, secao: x.ctx || '', exemplos: x.ex })) }, signal);
      const entries = [];
      for (const r of res) { const x = porRk.get(r.i); if (x && r.tipo) entries.push([x.rk, { raw: x.raw, tipo: r.tipo, fonte: 'ia' }]); }
      await writeMany('y', entries); n += entries.length;
      done += chunk.length; compute(); renderTextos(); renderCounts();
    }
    endAI(`${n} tipos padronizados. Os nomes ja foram remontados; revise e aprove.`);
  } catch (e) { endAI(aiErr(e)); }
  compute(); refreshAll();
}

/* ============ render: revisar ============ */
const ESS = ['Nome','Código de barras','Classificação fiscal - NCM','Marca','Origem do produto','Unidade de medida','Peso (extendido)','Altura','Largura','Profundidade'];
function renderRevisar(){
  const tbl = $('#revTbl');
  if (!S.out) { tbl.innerHTML = '<tbody><tr><td class="muted">Carregue uma planilha e escolha um perfil.</td></tr></tbody>'; $('#revTiles').innerHTML=''; $('#revPager').innerHTML=''; return; }
  const live = S.out.filter(r => !r.excl);
  const nErr = live.filter(r => r.errs.length).length, nWarn = live.filter(r => !r.errs.length && r.warns.length).length;
  const nOk = live.length - nErr - nWarn, nCat = live.filter(r => r.cat).length, nTx = live.filter(r => S.T[r.key]?.st === 'aprovado').length;
  $('#revTiles').innerHTML = [
    ['Itens', live.length, ''], ['Prontos', nOk, 'ok'], ['Com aviso', nWarn, 'warn'], ['Com erro', nErr, 'err'], ['Com categoria', nCat, ''], ['Nome aprovado', nTx, ''], ['Excluidos', S.out.length - live.length, ''],
  ].map(([l,v,c]) => `<div class="tile ${c}"><span class="label">${l}</span><b>${fmtN(v)}</b></div>`).join('');
  let rows = live;
  if (S.revFilter === 'err') rows = rows.filter(r => r.errs.length);
  if (S.revFilter === 'warn') rows = rows.filter(r => !r.errs.length && r.warns.length);
  if (S.revFilter === 'ok') rows = rows.filter(r => !r.errs.length && !r.warns.length);
  const q = norm($('#revSearch').value);
  if (q) rows = rows.filter(r => norm(r.o['Nome']).includes(q) || norm(r.key).includes(q) || String(r.o['Código de barras']).includes(q));
  const cols = $('#revCols').value === 'map' ? COLS.filter(c => S.P.map[c]?.m !== 'vazio') : ESS;
  const PG = 100; const pages = Math.max(1, Math.ceil(rows.length / PG)); if (S.revPage >= pages) S.revPage = 0;
  const slice = rows.slice(S.revPage*PG, S.revPage*PG + PG);
  let h = `<thead><tr><th>Linha</th><th>Ref. fornecedor</th>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}<th>Categoria</th><th>Criticas</th></tr></thead><tbody>`;
  for (const r of slice) {
    h += `<tr><td class="num">${r.item.r+1}</td><td class="mono">${esc(r.key)}</td>` + cols.map(c => {
      const v = r.o[c]; const num = typeof v === 'number';
      return `<td class="${num?'num':''}"><span class="clip" title="${esc(v)}">${esc(v)}</span></td>`;
    }).join('') + `<td>${r.cat ? `<span class="clip" title="${esc(r.cat.path)}">${esc(r.cat.nome)} <span class="muted mono">${esc(r.cat.id)}</span></span>` : r.g && r.g.prop ? `<span class="clip note" title="${esc(r.g.prop)}">proposta: ${esc(r.g.prop.split(' > ').pop())}</span>` : '<span class="muted">-</span>'}</td>
    <td><div class="crit">${r.errs.map(e=>`<span class="e">${esc(e)}</span>`).join('')}${r.warns.map(w=>`<span class="w">${esc(w)}</span>`).join('')}</div></td></tr>`;
  }
  tbl.innerHTML = h + '</tbody>';
  $('#revPager').innerHTML = `<span class="muted">${fmtN(rows.length)} itens</span><button class="sm" data-pg="-1" ${S.revPage===0?'disabled':''}>Anterior</button><span class="mono">${S.revPage+1} / ${pages}</span><button class="sm" data-pg="1" ${S.revPage>=pages-1?'disabled':''}>Proxima</button>`;
}

/* ============ bases ============ */
function renderBases(){
  $('#treeInfo').textContent = S.tree.length + ' categorias';
  $('#treeTbl').innerHTML = '<thead><tr><th>ID</th><th>Caminho</th><th>Plataforma</th></tr></thead><tbody>' + S.tree.map(t => `<tr><td class="num">${esc(t.id)}</td><td>${esc(t.path)}</td><td class="note">${esc(t.plat)}</td></tr>`).join('') + '</tbody>';
  const cg = caracGroups();
  $('#caracInfo').textContent = Object.keys(cg).length + ' grupos';
  $('#caracTbl').innerHTML = '<thead><tr><th>Grupo</th><th>Seq.</th><th>Caracteristica</th><th>Tipo</th></tr></thead><tbody>' +
    Object.values(cg).flatMap(g => g.caracs.map(c => `<tr><td>${esc(g.nome)} <span class="muted mono">${esc(g.codigo)}</span></td><td class="num">${c.seq}</td><td>${esc(c.nome)}</td><td class="note">${esc(c.tipo)}</td></tr>`)).join('') + '</tbody>';
}
// A arvore e a categorias_zydon do Agente (e a Categoria Treeview do Signus): ela nao e trocada por aqui.
// Os grupos de caracteristicas ficam em signus_caracteristicas; so admin substitui.
const caracDoBanco = r => ({ GRUPO_CARACT_ID: r.grupo_id, GRUPO_CARACT_CODIGO: r.grupo_codigo, GRUPO_CARACT_NOME: r.grupo_nome, CARACT_ID: r.caract_id, CARACT_SEQUENCIA: r.sequencia, CARACT_TIPO: r.tipo, CARACT_NOME: r.nome, CARACT_SITUACAO: r.situacao });
async function importRef(file, kind){
  if (kind === 'arvore') { toast('A arvore vem da base de categorias do Agente. Cadastre a categoria nova la e use "Religar".', 6000); return; }
  if (!S.isAdmin) { toast('So admin substitui a base de caracteristicas do Signus.'); return; }
  try {
    const wb = await readFile(file); const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
    const need = ['GRUPO_CARACT_CODIGO','CARACT_NOME','CARACT_ID'];
    if (!rows.length || !need.every(k => k in rows[0])) { toast('Arquivo nao parece a exportacao esperada (faltam colunas ' + need.join(', ') + ').'); return; }
    const linhas = rows.filter(r => String(r.GRUPO_CARACT_CODIGO).trim() && String(r.CARACT_ID).trim()).map(r => ({
      grupo_id: String(r.GRUPO_CARACT_ID || '').replace(/\.0$/, ''), grupo_codigo: String(r.GRUPO_CARACT_CODIGO).trim(), grupo_nome: String(r.GRUPO_CARACT_NOME || '').trim(),
      caract_id: String(r.CARACT_ID).replace(/\.0$/, '').trim(), sequencia: Number(r.CARACT_SEQUENCIA) || null, tipo: String(r.CARACT_TIPO || ''), nome: String(r.CARACT_NOME || '').trim(), situacao: String(r.CARACT_SITUACAO || ''),
    }));
    const { error } = await sb.from('signus_caracteristicas').upsert(linhas, { onConflict: 'grupo_codigo,caract_id' });
    if (error) throw error;
    // substitui: o que nao veio na exportacao nova sai da base
    const novas = new Set(linhas.map(l => l.grupo_codigo + '|' + l.caract_id));
    const antigas = (await lerTudo('signus_caracteristicas', 'grupo_codigo')).filter(r => !novas.has(r.grupo_codigo + '|' + r.caract_id));
    for (const r of antigas) await sb.from('signus_caracteristicas').delete().match({ grupo_codigo: r.grupo_codigo, caract_id: r.caract_id });
    S.carac = linhas.map(caracDoBanco);
    toast(`Base atualizada para todo o time: ${linhas.length} caracteristicas.`);
    compute(); refreshAll();
  } catch (e) { toast('Nao foi possivel atualizar a base (' + (e.message || 'arquivo ilegivel') + ').'); }
}

/* ============ export ============ */
async function saveXlsx(wb, filename, okMsg){
  try { XLSX.writeFile(wb, filename, { compression: true }); toast(okMsg); }
  catch (e) { toast('Nao foi possivel gerar o arquivo.'); }
}
async function exportFile(){
  if (!S.out || !S.P) return;
  compute();
  const incl = $('#inclErr').checked;
  const live = S.out.filter(r => !r.excl && (incl || !r.errs.length));
  if (!live.length) { toast('Nada para exportar com os filtros atuais.'); return; }
  const main = [COLS, ...live.map(r => COLS.map(c => r.o[c] === undefined ? '' : r.o[c]))];
  const ws = XLSX.utils.aoa_to_sheet(main);
  const textCols = ['Código de barras','Classificação fiscal - NCM','Código do Fornecedor Padrão','Código genérico'].map(c => COLS.indexOf(c));
  for (let r = 1; r < main.length; r++) for (const c of textCols) { const a = XLSX.utils.encode_cell({r, c}); if (ws[a] && ws[a].v !== '') { ws[a].t = 's'; ws[a].v = String(ws[a].v); ws[a].z = '@'; } }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SIGNUS_SHEET);
  const tv = [['Ref. fornecedor','Código de barras','Nome','ID_CATEGORIA_TREEVIEW','NOME_CATEGORIA','CAMINHO','CATEGORIA_PROPOSTA','Grupo da planilha','Fonte']];
  for (const r of live) tv.push([r.key, String(r.o['Código de barras']||''), r.o['Nome'], r.cat?.id || '', r.cat?.nome || '', r.cat?.path || '', r.cat ? '' : (r.g?.prop || ''), r.gk, r.g?.fonte || '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tv), 'Categoria Treeview');
  const cg = caracGroups(); const cv = [['Ref. fornecedor','Código de barras','Nome','GRUPO_CARACT_CODIGO','CARACT_ID','CARACT_NOME','VALOR']];
  for (const r of live) { const vals = S.caracVals[r.ix]; const g = r.g?.gc && cg[r.g.gc]; if (!vals || !g) continue;
    for (const c of g.caracs) if (vals[c.id]) cv.push([r.key, String(r.o['Código de barras']||''), r.o['Nome'], g.codigo, c.id, c.nome, vals[c.id]]); }
  if (cv.length > 1) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cv), 'Caracteristicas');
  const cr = [['Linha na planilha','Ref. fornecedor','Nome','Tipo','Mensagem']];
  for (const r of S.out) { if (r.excl) { cr.push([r.item.r+1, itemKey(r.item), '', 'Excluido', r.motivo || 'Removido']); continue; }
    r.errs.forEach(e => cr.push([r.item.r+1, r.key, r.o['Nome'], 'Erro', e])); r.warns.forEach(w => cr.push([r.item.r+1, r.key, r.o['Nome'], 'Aviso', w])); }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cr), 'Criticas');
  const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  await saveXlsx(wb, `Signus_Migracao_${slugId(S.P.nome)}_${stamp}.xlsx`, `${fmtN(live.length)} produtos exportados.`);
}

/* ============ refresh ============ */
function renderCounts(){
  $('#cntArquivo').textContent = S.items.length ? fmtN(S.items.length) : '';
  $('#cntColunas').textContent = S.P ? COLS.filter(c => S.P.map[c]?.m !== 'vazio').length + '/' + (COLS.length - 2) : '';
  const gl = S.P && S.out ? groupsList() : [];
  $('#cntCategorias').textContent = gl.length ? gl.filter(g => S.G[g.key]?.tree || S.G[g.key]?.prop).length + '/' + gl.length : '';
  const all = S.out ? S.out.filter(r => !r.excl && r.key) : [];
  $('#cntTextos').textContent = all.length ? fmtN(all.filter(r => S.T[r.key]?.st === 'aprovado').length) + '/' + fmtN(all.length) : '';
  $('#cntRevisar').textContent = S.out ? fmtN(S.out.filter(r => !r.excl && r.errs.length).length) + ' erros' : '';
}
function refreshAll(){
  compute(); renderCounts();
  const st = S.step;
  if (st === 'arquivo') renderArquivo();
  if (st === 'colunas') renderColunas();
  if (st === 'categorias') renderGroups();
  if (st === 'textos') renderTextos();
  if (st === 'revisar') renderRevisar();
  if (st === 'bases') renderBases();
  refreshAIButtons();
}
function go(step){
  S.step = step;
  $$('.step').forEach(b => b.setAttribute('aria-selected', b.dataset.step === step ? 'true' : 'false'));
  $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== step);
  try { localStorage.setItem('dps-step', step); } catch {}
  refreshAll();
}

/* ============ events ============ */
$('#steps').addEventListener('click', e => { const b = e.target.closest('.step'); if (b) go(b.dataset.step); });
const drop = $('#drop');
['dragover','dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
$('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
async function handleFile(f){
  toast('Lendo ' + f.name + '...', 8000);
  try { const wb = await readFile(f); openWorkbook(wb, f.name, false); toast(`${fmtN(S.items.length)} produtos lidos.`); }
  catch (e) { toast('Nao foi possivel ler este arquivo. Confira se e .xlsx, .xls ou .csv.'); }
}
$('#sheetSel').addEventListener('change', e => { loadSheet(e.target.value, true); if (S.P) { S.P.sheet = S.sheetName; markDirty(); } });
$('#hdrRow').addEventListener('change', e => { const v = Math.max(1, parseInt(e.target.value)||1) - 1; S.headerRow = v; parseItems(); if (S.P) { S.P.headerRow = v; markDirty(); } refreshAll(); });
$('#keySel').addEventListener('change', e => { S.keyCol = Number(e.target.value); if (S.P) { S.P.chave = S.headers[S.keyCol]; markDirty(); } refreshAll(); });
$('#profSel').addEventListener('change', e => selectProfile(e.target.value));
$('#newProfBtn').addEventListener('click', () => { $('#newProfBox').hidden = false; $('#newProfBtn').hidden = true; $('#newProfName').focus(); });
$('#newProfCancel').addEventListener('click', () => { $('#newProfBox').hidden = true; $('#newProfBtn').hidden = false; });
function createProfile(){
  const nome = $('#newProfName').value.trim(); if (!nome) { $('#newProfName').focus(); return; }
  const p = blankProfile(nome); if (S.profiles[p.id]) p.id += '-' + Date.now().toString(36);
  p.sheet = S.sheetName; p.headerRow = S.headerRow; p.chave = S.headers[S.keyCol] || '';
  S.profiles[p.id] = p; S.profId = p.id; S.P = p; subscribeProfile();
  if (S.headers.length) autoMap(false);
  $('#newProfBox').hidden = true; $('#newProfBtn').hidden = false; $('#newProfName').value = '';
  renderProfSel(); markDirty(); saveProfile(); go('colunas'); toast('Perfil criado com sugestoes pelos nomes das colunas. Revise.');
}
$('#newProfOk').addEventListener('click', createProfile);
$('#newProfName').addEventListener('keydown', e => { if (e.key === 'Enter') createProfile(); });
$('#saveProf').addEventListener('click', () => { clearTimeout(saveTimer); saveProfile(); });
$('#autoMap').addEventListener('click', () => { const n = autoMap(true); markDirty(); refreshAll(); toast(n ? `${n} campos vazios preenchidos pelos nomes das colunas.` : 'Nenhum campo vazio com correspondencia pelo nome.'); });
$('#aiMap').addEventListener('click', aiSuggestMapping);
$('#aiCats').addEventListener('click', aiSuggestCats);
$('#aiCarac').addEventListener('click', aiExtractCarac);
$('#aiTexts').addEventListener('click', aiTexts);
$('#aiConsol').addEventListener('click', aiConsolidate);
$('#aiStop').addEventListener('click', () => S.aiCtl && S.aiCtl.abort());
$('#savePadrao').addEventListener('click', async () => {
  if (!S.P) return;
  const map = {}; for (const c of COLS) if (S.P.map[c]?.m === 'fixo' && S.P.map[c].v !== '') map[c] = { m:'fixo', v: S.P.map[c].v };
  S.padroes = { ...(S.padroes || {}), map };
  if (!S.isAdmin) { toast('So admin grava o padrao do time. Ele vale nesta sessao.'); return; }
  const { error } = await sb.from('configuracoes').upsert({ chave: 'fornecedores_padroes', valor: { map } });
  toast(error ? 'Nao foi possivel gravar o padrao (' + error.message + ').' : Object.keys(map).length + ' valores fixos gravados como padrao para novos perfis.');
});
$('#siglas').addEventListener('change', e => { if (!S.P) return; S.P.siglas = e.target.value; markDirty(); refreshAll(); });
$('#addFilter').addEventListener('click', () => { if (!S.P) return; S.P.filtros.push({ col: S.headers[0], op:'contem', v:'' }); markDirty(); renderFilters(); });
$('#filters').addEventListener('change', e => {
  const i = e.target.dataset.fi; if (i === undefined) return; const f = S.P.filtros[i]; f[e.target.dataset.k] = e.target.value;
  if (e.target.dataset.k === 'op' && f.op === 'secao') f.col = '__secao';
  if (e.target.dataset.k === 'op' && f.op !== 'secao' && f.col === '__secao') f.col = S.headers[0];
  markDirty(); compute(); renderColunas(); renderCounts();
});
$('#filters').addEventListener('click', e => { const i = e.target.dataset.fdel; if (i === undefined) return; S.P.filtros.splice(Number(i), 1); markDirty(); compute(); renderColunas(); renderCounts(); });
$('#mapGrid').addEventListener('change', e => {
  const el = e.target; const c = el.dataset.c;
  if (el.dataset.vm) { const col = el.dataset.vm; (S.P.vmap[col] ||= {})[el.dataset.from] = el.value.trim(); if (!el.value.trim()) delete S.P.vmap[col][el.dataset.from]; markDirty(); compute(); renderCounts(); return; }
  if (!c) return;
  const m = S.P.map[c] ||= { m:'vazio' }; delete m.ia;
  if (el.dataset.f === 'm') {
    const nm = el.value; const old = m;
    if (nm === 'vazio') S.manterVisiveis.add(c); // nao some da tela no mesmo instante em que a pessoa escolhe Vazio
    S.P.map[c] = nm === 'col' ? { m:'col', src: old.m==='col'?old.src:'', t: old.t||'texto' } : nm === 'fixo' ? { m:'fixo', v:'' } : nm === 'modelo' ? { m:'modelo', v:'', t:'texto' } : nm === 'derivado' ? { m:'derivado', src:'', t:'texto' } : { m:'vazio' };
  } else m[el.dataset.f] = el.value;
  markDirty(); compute(); renderColunas(); renderCounts();
});
$('#mapGrid').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.vmap) { S.openVmap = S.openVmap === b.dataset.vmap ? null : b.dataset.vmap; renderColunas(); }
  if (b.hasAttribute('data-vmapclose')) { S.openVmap = null; renderColunas(); }
  if (b.dataset.mgrp) { const g = b.dataset.mgrp; if (S.gruposAbertos.has(g)) S.gruposAbertos.delete(g); else S.gruposAbertos.add(g); renderColunas(); }
});
$('#toggleVazios').addEventListener('click', () => { S.verVazios = !S.verVazios; S.gruposAbertos.clear(); S.manterVisiveis.clear(); renderColunas(); });
$('#mapSemArquivo').addEventListener('click', e => { if (e.target.closest('[data-goto]')) go('arquivo'); });
$('#groupBy').addEventListener('change', e => { if (!S.P) return; S.P.grupoPor = e.target.value; markDirty(); refreshAll(); });
$('#catView').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.catView = b.dataset.v; renderGroups(); });
$('#grpTbl').addEventListener('change', async e => {
  const el = e.target; const gk = el.dataset.gk; if (!gk) return;
  const f = el.dataset.gf; const patch = {};
  if (f === 'tree') { patch.tree = el.value; patch.fonte = el.value ? 'manual' : ''; patch.conf = ''; patch.semMatch = false; if (el.value) patch.prop = ''; }
  else if (f === 'prop') { patch.prop = normPath(el.value); patch.fonte = 'manual'; patch.semMatch = false; }
  else if (f === 'ok') { patch.ok = el.checked; patch.okPor = el.checked ? (S.me || '') : ''; }
  else patch[f] = el.value;
  await setGroup(gk, patch); compute(); renderGroups(); renderCounts();
});
$('#grpTbl').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.split) await setGroup(b.dataset.split, { split: true });
  else if (b.dataset.unsplit) await setGroup(b.dataset.unsplit, { split: false });
  else if (b.dataset.claim) await setGroup(b.dataset.claim, { resp: S.me || 'local' });
  else if (b.dataset.release) await setGroup(b.dataset.release, { resp: '' });
  else return;
  compute(); renderGroups(); renderCounts();
});
$('#claimFree').addEventListener('click', async () => {
  const free = groupsList().filter(g => !S.G[g.key]?.resp && !S.G[g.key]?.ok).slice(0, 20);
  if (!free.length) { toast('Nenhum grupo livre.'); return; }
  await writeMany('g', free.map(g => [g.key, { resp: S.me || 'local' }]));
  S.catFilter = 'meus'; $$('#catFilter .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.f === 'meus' ? 'true':'false'));
  renderGroups(); renderCounts(); toast(`${free.length} grupos agora estao com voce.`);
});
$('#grpSearch').addEventListener('input', e => { S.grpSearch = e.target.value; renderGroups(); });
$('#catFilter').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.catFilter = b.dataset.f; $$('#catFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true':'false')); renderGroups(); });
$('#catArvore').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ren) { S.renaming = b.dataset.ren; renderArvore(); $('#renInput')?.focus(); }
  else if (b.id === 'renCancel') { S.renaming = null; renderArvore(); }
  else if (b.id === 'renOk') { const from = S.renaming; S.renaming = null; await renamePath(from, $('#renInput').value); compute(); renderArvore(); }
  else if (b.dataset.app) setPropStatus(b.dataset.app, 'aprovada');
  else if (b.dataset.unapp) setPropStatus(b.dataset.unapp, 'proposta');
  else if (b.id === 'consolDrop') { S.consol = null; renderArvore(); }
  else if (b.id === 'consolApply') {
    const list = (S.consol || []).filter(c => c.on); S.consol = null;
    const entries = [];
    for (const c of list) for (const [k, g] of Object.entries(S.G)) if (g.prop && normPath(g.prop) === c.de) entries.push([k, { prop: c.para }]);
    await writeMany('g', entries); compute(); renderArvore(); toast(`${list.length} ajustes aplicados em ${entries.length} grupos.`);
  }
});
$('#catArvore').addEventListener('change', e => { const i = e.target.dataset.ci; if (i !== undefined && S.consol) S.consol[i].on = e.target.checked; });
$('#relink').addEventListener('click', relink);
$('#exportTree').addEventListener('click', exportTree);
// textos
$('#txtFilter').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.txtFilter = b.dataset.f; S.txtPage = 0; $$('#txtFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true':'false')); renderTextos(); });
['#txtMine','#txtGroup'].forEach(s => $(s).addEventListener('change', () => { S.txtPage = 0; renderTextos(); }));
$('#txtSearch').addEventListener('input', () => { S.txtPage = 0; renderTextos(); });
$('#txtPager').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.txtPage += Number(b.dataset.pg); renderTextos(); });
$('#txtTbl').addEventListener('change', async e => {
  const el = e.target; const k = el.dataset.tk; if (!k) return;
  const cur = S.T[k] || {};
  const r = S.out.find(x => x.key === k);
  const val = el.value.trim();
  if (el.dataset.tf === 'nome' && r && !cur.nome && val === (r.item._rule?.nome || '')) return;
  const patch = { [el.dataset.tf]: val, editado: el.dataset.tf === 'nome' ? true : !!cur.editado, st: cur.st === 'aprovado' ? 'aprovado' : 'sugerido' };
  if (el.dataset.tf === 'desc' && !cur.nome && r) patch.nome = r.item._rule?.nome || '';
  if (!cur.orig && r) patch.orig = String(descSrc(r.item) ?? '').slice(0, 300);
  if (!cur.fonte) patch.fonte = 'regra';
  await setText(k, patch); compute(); renderCounts();
});
$('#txtTbl').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ok) { const r = S.out.find(x => x.key === b.dataset.ok); if (r) await setText(r.key, approvePatch(r)); }
  else if (b.dataset.unok) await setText(b.dataset.unok, { st: 'sugerido' });
  else return;
  compute(); renderTextos(); renderCounts();
});
$('#approveVisible').addEventListener('click', async () => {
  const rows = filteredTextRows().slice(S.txtPage * 40, S.txtPage * 40 + 40).filter(r => S.T[r.key]?.st !== 'aprovado' && currentName(r));
  if (!rows.length) { toast('Nada para aprovar nesta pagina.'); return; }
  await writeMany('t', rows.map(r => [r.key, approvePatch(r)])); compute(); renderTextos(); renderCounts(); toast(`${rows.length} itens aprovados.`);
});
$('#txtView').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.txtView = b.dataset.v; renderTextos(); });
$('#tipoFilter').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.tipoFilter = b.dataset.f; S.tipoPage = 0; renderTextos(); });
$('#tipoSearch').addEventListener('input', () => { S.tipoPage = 0; renderTextos(); });
$('#tipoPager').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tipoPage += Number(b.dataset.pg); renderTextos(); });
$('#tipoTbl').addEventListener('change', async e => {
  const el = e.target; const k = el.dataset.yk; if (!k) return;
  const tipo = el.value.replace(/\s+/g, ' ').trim();
  await writeMany('y', [[k, { raw: el.dataset.raw, tipo, fonte: tipo ? 'manual' : '' }]]); compute(); renderCounts();
});
$('#aiTipos').addEventListener('click', aiTipos);
$('#savePadraoTxt').addEventListener('click', async () => {
  const txt = { padrao: $('#padraoNome').value.trim() || DEFAULT_TXT.padrao, regrasNome: $('#regrasNome').value.trim() || DEFAULT_TXT.regrasNome, regrasDesc: $('#regrasDesc').value.trim() || DEFAULT_TXT.regrasDesc };
  S.padroes = { ...(S.padroes || {}), txt };
  if (!S.isAdmin) toast('So admin grava as regras do time. Elas valem nesta sessao; a IA no servidor usa as regras gravadas.');
  else { const { error } = await sb.from('configuracoes').upsert({ chave: 'fornecedores_txt', valor: txt }); toast(error ? 'Nao foi possivel salvar as regras (' + error.message + ').' : 'Regras salvas para o time.'); }
  renderTextos();
});
$('#resetPadraoTxt').addEventListener('click', () => { $('#padraoNome').value = DEFAULT_TXT.padrao; $('#regrasNome').value = DEFAULT_TXT.regrasNome; $('#regrasDesc').value = DEFAULT_TXT.regrasDesc; });
$('#useSug').addEventListener('change', e => { S.opts.useSug = e.target.checked; compute(); renderRevisar(); renderCounts(); });
$('#revFilter').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; S.revFilter = b.dataset.f; S.revPage = 0; $$('#revFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true':'false')); renderRevisar(); });
$('#revCols').addEventListener('change', renderRevisar);
$('#revSearch').addEventListener('input', () => { S.revPage = 0; renderRevisar(); });
$('#revPager').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.revPage += Number(b.dataset.pg); renderRevisar(); });
$('#exportBtn').addEventListener('click', exportFile);
$('#treeIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) importRef(f, 'arvore'); e.target.value=''; });
$('#caracIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) importRef(f, 'carac'); e.target.value=''; });


/* ============ boot ============ */
function bloquear(html){ $('#gate').innerHTML = html; $('#gate').hidden = false; $$('[data-pane]').forEach(p => p.hidden = true); $('#steps').hidden = true; }
async function boot(){
  if (typeof XLSX === 'undefined') { toast('Nao foi possivel carregar o leitor de planilhas. Recarregue a pagina.', 8000); return; }
  let st = 'arquivo'; try { st = localStorage.getItem('dps-step') || 'arquivo'; } catch {}
  go(st);
  renderProfSel(); renderSaveState();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { bloquear('<b>Entre no Agente Jet para usar esta tela.</b> <a href="./">Ir para o login</a>'); return; }
  S.me = session.user.id;
  const { data: perfil } = await sb.from('profiles').select('nome,email,role').eq('id', S.me).maybeSingle();
  const role = perfil && perfil.role;
  if (!['admin', 'editor', 'comum'].includes(role)) { bloquear('<b>Seu cadastro ainda nao foi aprovado.</b> Peca a um admin do Agente Jet.'); return; }
  S.names[S.me] = (perfil.nome || perfil.email || '');
  S.podeEditar = role === 'admin' || role === 'editor'; S.isAdmin = role === 'admin';
  $('#quem').textContent = (perfil.nome || perfil.email || '') + (S.podeEditar ? '' : ' (so leitura)');
  await connect();
}
async function connect(){
  try {
    const [pf, arvore, carac, cfg, tipos, props] = await Promise.all([
      lerTudo('fornecedor_perfis', 'id'),
      lerTudo('fornecedores_arvore', 'caminho'),
      lerTudo('signus_caracteristicas', 'grupo_codigo'),
      sb.from('configuracoes').select('chave,valor').in('chave', ['fornecedores_padroes', 'fornecedores_txt']),
      lerTudo('tipos_vocabulario', 'chave'),
      lerTudo('arvore_proposta', 'caminho'),
    ]);
    S.online = true;
    for (const r of pf) { S.profiles[r.id] = perfilDoBanco(r); S.salvos.add(r.id); }
    S.tree = arvore.map(r => ({ id: String(r.id), nome: r.nome, path: r.caminho, ids: [], plat: '', raw: r }));
    S.carac = carac.map(caracDoBanco);
    const cf = Object.fromEntries((cfg.data || []).map(c => [c.chave, c.valor]));
    S.padroes = { map: cf.fornecedores_padroes?.map || null, txt: cf.fornecedores_txt || null };
    for (const r of tipos) S.Y[r.chave] = KINDS.y.doBanco(r);
    for (const r of props) S.prop[enc(r.caminho)] = propDoBanco(r);
    subscribeGlobal();
    refreshAIButtons(); renderSaveState(); renderProfSel();
    if (S.grid.length && !S.P) matchProfile();
    if (!S.P) { const first = Object.keys(S.profiles)[0]; if (first) selectProfile(first); }
    else subscribeProfile();
    refreshAll();
  } catch (e) { toast('Nao foi possivel ler o banco (' + (e.message || 'erro') + ').', 8000); }
}
boot();
