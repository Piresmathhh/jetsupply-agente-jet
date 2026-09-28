/**
 * Motor do De-Para Signus (sem DOM, sem banco, sem IA).
 * Portado do artifact "De-Para Signus" v3. Todas as funcoes leem/escrevem o objeto de estado S
 * recebido em createEngine(S, XLSX). A tela e a persistencia ficam fora daqui.
 *
 * Estado esperado em S (ver tests/engine.test.mjs):
 *   grid, headerRow, headers, keyCol, items, sections   (planilha parseada)
 *   P      perfil do fornecedor { map, vmap, filtros, grupoPor, chave, siglas, ... }
 *   G      grupos  { [chaveGrupo]: { tree, prop, split, catProd, gc, ok, resp, ... } }
 *   T      textos  { [ref]: { nome, desc, st: 'sugerido'|'aprovado', editado, orig, fonte } }
 *   Y      vocabulario de tipos { [chaveNormalizada]: { raw, tipo, fonte } }
 *   tree   arvore Signus normalizada (normTree), carac: linhas de grupos de caracteristicas
 *   padroes { map, txt }   opts { useSug }
 */
export function createEngine(S, XLSX) {
  /* ============ Layout Signus ============ */
  const SIGNUS_SHEET = "Signus - Migração de Produtos -";
  const COLS = ['Código','Código de barras','Nome','Descrição técnica','Categoria de produto','Gênero','Selo','Grupo Setorial','Categoria de preço','Categoria fiscal','Classificação fiscal - NCM','Linha de produto','Marca','Fabricante','Mercadoria/Serviço (M/S)','Origem do produto','Unidade de medida','Peso (extendido)','Fabricação própria','Habilitado para faturamento','Estoque mínimo','Desativado','Nome reduzido','Código genérico','Quantidade por embalagem na compra','Especificação técnica','Curva ABC','Aplicar regra de múltiplo por embalagem','Estoque máximo','Quantidade por embalagem na venda','Quantidade de peças por embalagem','Unidade de negócio - Sigla','Aplicar regra de mínimo de venda','Quantidade mínima para venda / compra','Garantia (em dias)','Retirar o produto da sugestão automática de necessidade de compra (base consumo)','Altura','Largura','Profundidade','Volume','Rastreabilidade','Rastreabilidade na devolução','Observação','Exibe na cotação de venda','Nome da página para URL amigável','Descrição do produto e-commerce','Palavras chaves','Código do Fornecedor Padrão','Status migração','Mensagem de Crítica'];
  const GROUPS = [
    ['Identificacao', ['Código','Código de barras','Nome','Nome reduzido','Descrição técnica','Especificação técnica','Código genérico','Código do Fornecedor Padrão']],
    ['Classificacao', ['Marca','Fabricante','Linha de produto','Categoria de produto','Gênero','Selo','Grupo Setorial','Categoria de preço','Curva ABC']],
    ['Fiscal', ['Classificação fiscal - NCM','Categoria fiscal','Origem do produto','Mercadoria/Serviço (M/S)']],
    ['Logistica e embalagem', ['Unidade de medida','Peso (extendido)','Altura','Largura','Profundidade','Volume','Quantidade por embalagem na compra','Quantidade por embalagem na venda','Quantidade de peças por embalagem','Aplicar regra de múltiplo por embalagem','Quantidade mínima para venda / compra','Aplicar regra de mínimo de venda']],
    ['Estoque e operacao', ['Unidade de negócio - Sigla','Estoque mínimo','Estoque máximo','Fabricação própria','Habilitado para faturamento','Desativado','Retirar o produto da sugestão automática de necessidade de compra (base consumo)','Garantia (em dias)','Rastreabilidade','Rastreabilidade na devolução','Exibe na cotação de venda','Observação']],
    ['E-commerce', ['Nome da página para URL amigável','Descrição do produto e-commerce','Palavras chaves']],
  ];
  const HINTS = {
    'Código':'em branco: o Signus gera',
    'Código de barras':'EAN/GTIN unitario',
    'Classificação fiscal - NCM':'8 digitos',
    'Origem do produto':'0 a 8',
    'Peso (extendido)':'kg',
    'Altura':'cm','Largura':'cm','Profundidade':'cm',
    'Código do Fornecedor Padrão':'confirmar: ref. do produto no fornecedor ou codigo do fornecedor?',
    'Status migração':'retorno do Signus','Mensagem de Crítica':'retorno do Signus',
  };
  const OUT_ONLY = new Set(['Status migração','Mensagem de Crítica']);
  const TRANSFORMS = [
    ['texto','Texto (limpa espacos)'],['capitalizar','Capitalizar (preserva siglas)'],['maiusculas','MAIUSCULAS'],
    ['numero','Numero'],['inteiro','Inteiro'],['ncm','NCM (8 digitos)'],['ean','EAN (valida digito)'],
    ['m_cm','Metros para cm'],['mm_cm','mm para cm'],['g_kg','Gramas para kg'],['origem','Origem (0 a 8)'],
    ['cortar60','Cortar em 60 caracteres'],['url','Slug de URL'],
  ];
  const DEFAULT_FIXED = {'Mercadoria/Serviço (M/S)':'M','Unidade de medida':'UN'};
  const SIGLAS_BASE = 'A V W VA KW KVA MW HP CV HZ RPM VCA VCC IP IK BAR PSI MM CM KG LED USB SDS HSS PVC AC DC MAX NR BT UV CNC TCT PCD SAE NPT BSP ABNT II III IV XR XP ESD EPI'.split(' ');
  const LOWER_WORDS = new Set(['de','da','do','das','dos','e','em','com','para','p/','c/','sem','a','o','na','no','nas','nos','por','ou','ao','x']);

  /* ============ helpers ============ */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9+/]+/g,' ').trim();
  const isEmpty = v => v === null || v === undefined || String(v).trim() === '';
  const fmtN = n => Number(n).toLocaleString('pt-BR');
  function slugId(s){ return norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || ('p'+Date.now()); }
  function parseNum(v){
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim(); if (!s || /^(nd|n\/d|-|na)$/i.test(s)) return null;
    s = s.replace(/[^\d,.\-]/g,'');
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
    else if (s.includes(',')) s = s.replace(',','.');
    const n = parseFloat(s); return isFinite(n) ? n : null;
  }
  const round = (n, d=4) => n===null ? null : Math.round(n * 10**d) / 10**d;
  function eanValid(d){
    if (!/^\d{8}$|^\d{12,14}$/.test(d)) return false;
    const digits = d.split('').map(Number); const check = digits.pop();
    let sum = 0; digits.reverse().forEach((x,i)=> sum += x * (i%2===0 ? 3 : 1));
    return (10 - sum % 10) % 10 === check;
  }
  function digitsOf(v){
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v));
    let s = String(v).trim(); if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/,''); return s.replace(/\D/g,'');
  }
  function capitalize(s, siglas){
    let i = 0;
    return String(s).toLowerCase().split(/(\s+|(?=[\/(])|(?<=[\/(]))/).map(w=>{
      if (!w || /^\s+$/.test(w) || /^[\/(]$/.test(w)) return w;
      const up = w.toUpperCase(); const core = up.replace(/[^A-Z0-9+]/g,'');
      const first = i++ === 0;
      if (/\d/.test(w)) return up;
      if (siglas.has(core)) return up;
      if (!first && LOWER_WORDS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('');
  }
  function applyTransform(t, v, ctx){
    if (v === null || v === undefined) return '';
    switch (t) {
      case 'capitalizar': return capitalize(String(v).replace(/\s+/g,' ').trim(), ctx.siglas);
      case 'maiusculas': return String(v).replace(/\s+/g,' ').trim().toUpperCase();
      case 'numero': { const n = parseNum(v); return n===null ? '' : round(n); }
      case 'inteiro': { const n = parseNum(v); return n===null ? '' : Math.round(n); }
      case 'ncm': { const d = digitsOf(v); return d ? d.padStart(8,'0') : ''; }
      case 'ean': return digitsOf(v);
      case 'm_cm': { const n = parseNum(v); return n===null ? '' : round(n*100,2); }
      case 'mm_cm': { const n = parseNum(v); return n===null ? '' : round(n/10,2); }
      case 'g_kg': { const n = parseNum(v); return n===null ? '' : round(n/1000,4); }
      case 'origem': { const n = parseNum(v); return n===null ? '' : Math.round(n); }
      case 'cortar60': { const s = String(v).replace(/\s+/g,' ').trim(); if (s.length <= 60) return s; const base = s.split(' - ')[0].trim(); if (base.length <= 60 && base.length >= 25) { const tag = /sem bateria/i.test(s) ? ' S/ Bateria' : ''; return (base + tag).length <= 60 ? base + tag : base; } const c = s.slice(0,61); const sp = c.lastIndexOf(' '); let r = (sp > 30 ? c.slice(0, sp) : s.slice(0,60)); const op = r.lastIndexOf('('); if (op > 20 && r.indexOf(')', op) < 0) r = r.slice(0, op); return r.replace(/[\s,;:\-\/(]+$/,''); }
      case 'url': return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      default: return String(v).replace(/\s+/g,' ').trim();
    }
  }

  /* ============ reference data ============ */
  function normTree(rows){
    return rows.map(r => {
      const lv = [[r.ID_PRIMEIRO_NIVEL,r.NOME_PRIMEIRO_NIVEL],[r.ID_SEGUNDO_NIVEL,r.NOME_SEGUNDO_NIVEL],[r.ID_TERCEIRO_NIVEL,r.NOME_TERCEIRO_NIVEL],[r.ID_QUARTO_NIVEL,r.NOME_QUARTO_NIVEL]]
        .filter(([id,n]) => !isEmpty(id) && !isEmpty(n)).map(([id,n]) => [String(id).replace(/\.0$/,''), String(n).trim()]);
      if (!lv.length) return null;
      return { id: lv[lv.length-1][0], nome: lv[lv.length-1][1], path: lv.map(x=>x[1]).join(' > '), ids: lv.map(x=>x[0]), plat: String(r.PLATAFORMA_NOME||'') , raw: r };
    }).filter(Boolean);
  }
  function treeById(id){ return S.tree.find(t => t.id === String(id)); }
  function caracGroups(){
    const g = {};
    for (const r of S.carac) {
      const k = String(r.GRUPO_CARACT_CODIGO||'').trim(); if (!k) continue;
      (g[k] ||= { codigo:k, nome:String(r.GRUPO_CARACT_NOME||'').trim(), id:String(r.GRUPO_CARACT_ID||''), caracs:[] })
        .caracs.push({ id:String(r.CARACT_ID||'').replace(/\.0$/,''), nome:String(r.CARACT_NOME||'').trim(), tipo:String(r.CARACT_TIPO||''), seq:Number(r.CARACT_SEQUENCIA)||0, situacao:String(r.CARACT_SITUACAO||'') });
    }
    Object.values(g).forEach(x => x.caracs.sort((a,b)=>a.seq-b.seq));
    return g;
  }

  function blankProfile(nome){
    const map = {};
    const base = (S.padroes && S.padroes.map) || Object.fromEntries(Object.entries(DEFAULT_FIXED).map(([k,v])=>[k,{m:'fixo',v}]));
    for (const c of COLS) map[c] = base[c] ? {...base[c]} : {m:'vazio'};
    return { id: slugId(nome), nome, chave:'', sheet:'', headerRow:null, map, vmap:{}, filtros:[], grupoPor:'__secao', siglas:'', assinatura:'', atualizado:'' };
  }
  function signature(h){ return h.filter(x=>!isEmpty(x)).map(norm).sort().join('|'); }
  function sigScore(a, b){
    const A = new Set(a.split('|')), B = new Set(b.split('|')); if (!a || !b) return 0;
    let inter = 0; A.forEach(x => B.has(x) && inter++); return inter / (A.size + B.size - inter);
  }
  function trimSheet(ws){
    if (!ws['!ref']) return [];
    let maxR = 0, maxC = 0;
    for (const k in ws) {
      if (k[0] === '!') continue;
      const cell = ws[k]; if (cell.v === undefined || cell.v === null || cell.v === '') continue;
      const a = XLSX.utils.decode_cell(k); if (a.r > maxR) maxR = a.r; if (a.c > maxC) maxC = a.c;
    }
    ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:maxR, c:maxC}});
    return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, blankrows:true});
  }
  function detectHeader(grid){
    let best = 0, bestScore = -1;
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const row = grid[r] || [];
      const score = row.filter(v => typeof v === 'string' && v.trim() && isNaN(Number(v))).length;
      if (score > bestScore + 1) { best = r; bestScore = score; }
    }
    return best;
  }
  function parseItems(){
    const g = S.grid;
    S.headers = (g[S.headerRow] || []).map((h,i) => isEmpty(h) ? `Coluna ${XLSX.utils.encode_col(i)}` : String(h).replace(/\s+/g,' ').trim());
    const ncols = S.headers.length;
    if (S.P && S.P.chave) S.keyCol = S.headers.indexOf(S.P.chave);
    if (S.keyCol < 0 || S.keyCol >= ncols) S.keyCol = 0;
    S.items = []; S.sections = 0;
    let secao = '', chain = [], lastWasSec = false;
    for (let r = S.headerRow + 1; r < g.length; r++) {
      const row = (g[r] || []).slice(0, ncols);
      const filled = row.filter(v => !isEmpty(v));
      if (!filled.length) continue;
      if (filled.length === 1 && ncols > 2) {
        const t = String(filled[0]).replace(/\s+/g,' ').trim();
        chain = lastWasSec ? [...chain, t] : [t];
        secao = t; lastWasSec = true; S.sections++; continue;
      }
      lastWasSec = false;
      S.items.push({ r, row, secao, ctx: chain.join(' > ') });
    }
  }
  /* ============ mapping engine ============ */
  function colIdx(name){ return S.headers.indexOf(name); }
  function srcVal(item, name){ const i = colIdx(name); return i < 0 ? null : item.row[i]; }
  function passesFilters(item){
    for (const f of (S.P?.filtros || [])) {
      if (!f.col) continue;
      const v = srcVal(item, f.col); const sv = norm(v); const fv = norm(f.v);
      if (f.op === 'contem' && fv && sv.includes(fv)) return false;
      if (f.op === 'igual' && sv === fv) return false;
      if (f.op === 'vazio' && isEmpty(v)) return false;
      if (f.op === 'naovazio' && !isEmpty(v)) return false;
      if (f.op === 'secao' && fv && norm(item.ctx).includes(fv)) return false;
    }
    return true;
  }
  function siglaSet(){ return new Set([...SIGLAS_BASE, ...String(S.P?.siglas||'').toUpperCase().split(/[\s,;]+/).filter(Boolean)]); }
  function itemKey(item){ const v = item.row[S.keyCol]; return isEmpty(v) ? '' : String(v).trim(); }
  function groupKeyOf(item){
    const gp = S.P?.grupoPor || '__secao';
    let k = gp === '__secao' ? (item.secao || '(sem secao)') : String(srcVal(item, gp) ?? '(vazio)').trim() || '(vazio)';
    if (S.G[k]?.split) k = k + ' :: ' + itemKey(item);
    return k;
  }
  function mapItem(item, ctx){
    const P = S.P, o = {};
    for (const c of COLS) {
      const m = P.map[c] || {m:'vazio'};
      let v = '';
      if (m.m === 'col' && m.src) v = applyTransform(m.t || 'texto', srcVal(item, m.src), ctx);
      else if (m.m === 'fixo') v = m.v ?? '';
      else if (m.m === 'modelo' && m.v) {
        const raw = m.v.replace(/\{([^}]+)\}/g, (_, h) => { const x = srcVal(item, h.trim()); return isEmpty(x) ? '' : String(x).trim(); });
        v = applyTransform(m.t || 'texto', raw, ctx);
      }
      const vm = P.vmap[c]; if (vm && v !== '' && Object.prototype.hasOwnProperty.call(vm, String(v)) && vm[String(v)] !== '') v = vm[String(v)];
      o[c] = v;
    }
    const rule = ruleName(item, o); item._rule = rule;
    const tx = S.T[itemKey(item)];
    if (tx && tx.st === 'aprovado') {
      o['Nome'] = tx.nome || rule.nome;
      if (tx.desc) o['Descrição do produto e-commerce'] = tx.desc;
    } else if (ctx.useSug) {
      o['Nome'] = (tx && tx.nome) || rule.nome;
      if (tx && tx.desc) o['Descrição do produto e-commerce'] = tx.desc;
    }
    for (const c of COLS) { const m = P.map[c]; if (m && m.m === 'derivado' && m.src) o[c] = applyTransform(m.t || 'texto', o[m.src], ctx); }
    for (const c of OUT_ONLY) o[c] = '';
    return o;
  }
  function compute(){
    if (!S.P || !S.items.length) { S.out = null; return; }
    const ctx = { siglas: siglaSet(), useSug: !!(S.opts && S.opts.useSug) };
    const rows = []; const seenKey = {}, seenEan = {}, lastKey = {};
    S.items.forEach((item, ix) => { const k = itemKey(item); if (k) lastKey[k] = ix; });
    S.items.forEach((item, ix) => {
      const excl = !passesFilters(item);
      if (excl) { rows.push({ ix, item, excl: true, motivo: 'Removido por regra de filtro' }); return; }
      const k0 = itemKey(item);
      if (k0 && lastKey[k0] !== ix && passesFilters(S.items[lastKey[k0]])) { rows.push({ ix, item, excl: true, dup: true, motivo: 'Repetido na planilha: mantida a ocorrencia da linha ' + (S.items[lastKey[k0]].r+1) }); return; }
      const o = mapItem(item, ctx);
      const gk = groupKeyOf(item); const g = S.G[gk] || {};
      const cat = g.tree ? treeById(g.tree) : null;
      if (g.catProd && S.P.map['Categoria de produto']?.m !== 'col') o['Categoria de produto'] = o['Categoria de produto'] || g.catProd;
      const errs = [], warns = [];
      if (!o['Nome']) errs.push('Nome vazio');
      const ncm = String(o['Classificação fiscal - NCM']||'');
      if (!ncm) errs.push('NCM vazio'); else if (!/^\d{8}$/.test(ncm)) errs.push('NCM invalido: ' + ncm);
      const org = o['Origem do produto'];
      if (org === '' ) warns.push('Origem vazia'); else if (!(Number(org) >= 0 && Number(org) <= 8)) errs.push('Origem fora de 0 a 8');
      const ean = String(o['Código de barras']||'');
      if (ean && !eanValid(ean)) { warns.push('EAN invalido removido: ' + ean); o['Código de barras'] = ''; }
      if (!o['Marca']) warns.push('Marca vazia');
      if (!o['Unidade de medida']) errs.push('Unidade de medida vazia');
      if (!(Number(o['Peso (extendido)']) > 0)) warns.push('Peso vazio ou zero');
      if (['Altura','Largura','Profundidade'].some(c => !(Number(o[c]) > 0))) warns.push('Dimensao vazia ou zero');
      if (!cat) warns.push(g.prop ? 'Categoria proposta, ainda nao existe no Signus' : 'Sem categoria treeview');
      const tx = S.T[itemKey(item)];
      if (!tx || tx.st !== 'aprovado') warns.push('Nome aguardando aprovacao');
      if (o['Nome'] && String(o['Nome']).length > 120) warns.push('Nome com mais de 120 caracteres');
      const key = itemKey(item);
      if (key) { if (seenKey[key] !== undefined) errs.push('Ref. duplicada (linha ' + (S.items[seenKey[key]].r+1) + ')'); else seenKey[key] = ix; }
      const e2 = String(o['Código de barras']||'');
      if (e2) { if (seenEan[e2] !== undefined) errs.push('EAN duplicado (linha ' + (S.items[seenEan[e2]].r+1) + ')'); else seenEan[e2] = ix; }
      rows.push({ ix, item, o, gk, cat, g, errs, warns, key });
    });
    S.out = rows;
  }

  /* ============ auto mapping ============ */
  const RULES = [
    ['Código de barras', ['codigo de barras unitaria','codigo de barras unit','ean unitario','ean','gtin','ean13','codigo de barras','cod barras','barcode'], 'ean', ['colet','master','dun','caixa']],
    ['Nome', ['descricao do produto','descricao produto','descricao','nome do produto','nome','produto','desc'], 'texto', ['tecnica','complementar','curta']],
    ['Descrição técnica', ['descricao tecnica','especificacao tecnica','ficha tecnica'], 'texto', []],
    ['Marca', ['marca','brand'], 'texto', []],
    ['Fabricante', ['fabricante','manufacturer'], 'texto', []],
    ['Linha de produto', ['linha de produto','linha'], 'texto', []],
    ['Classificação fiscal - NCM', ['class fiscal ncm','ncm','classificacao fiscal','class fiscal'], 'ncm', []],
    ['Origem do produto', ['origem'], 'origem', []],
    ['Peso (extendido)', ['peso bruto','peso liquido','peso'], null, []],
    ['Altura', ['altura'], null, []],
    ['Largura', ['largura'], null, []],
    ['Profundidade', ['profundidade','comprimento'], null, []],
    ['Quantidade por embalagem na venda', ['emb unit multiplo','multiplo de venda','multiplo','emb unit','qtd embalagem'], 'inteiro', []],
    ['Quantidade por embalagem na compra', ['emb master','caixa master','master','qtd caixa'], 'inteiro', []],
    ['Garantia (em dias)', ['garantia'], 'inteiro', []],
    ['Código do Fornecedor Padrão', ['__KEY__'], 'texto', []],
  ];
  function unitTransform(h, kind){
    const n = norm(h);
    if (kind === 'peso') return /\bg\b|gram/.test(n) && !/\bkg\b/.test(n) ? 'g_kg' : 'numero';
    if (/\bmm\b/.test(n)) return 'mm_cm';
    if (/\bcm\b/.test(n)) return 'numero';
    if (/\bm\b|metro/.test(n)) return 'm_cm';
    return 'numero';
  }
  function autoMap(onlyEmpty){
    if (!S.P) return 0;
    const H = S.headers.map(h => ({ h, n: norm(h) }));
    const used = new Set(); let count = 0;
    for (const [tgt, pats, t, excl] of RULES) {
      if (onlyEmpty && S.P.map[tgt]?.m !== 'vazio') continue;
      let hit = null;
      if (pats[0] === '__KEY__') hit = S.headers[S.keyCol];
      else {
        for (const p of pats) {
          const cand = H.find(x => !used.has(x.h) && x.n === p) || H.find(x => !used.has(x.h) && x.n.includes(p) && !excl.some(e => x.n.includes(e)));
          if (cand) { hit = cand.h; break; }
        }
      }
      if (!hit) continue;
      used.add(hit);
      let tt = t;
      if (!tt) tt = tgt.startsWith('Peso') ? unitTransform(hit,'peso') : unitTransform(hit,'dim');
      S.P.map[tgt] = { m:'col', src: hit, t: tt }; count++;
    }
    if (S.P.map['Nome']?.m === 'col' && (!onlyEmpty || S.P.map['Nome reduzido']?.m === 'vazio')) S.P.map['Nome reduzido'] = { m:'derivado', src:'Nome', t:'cortar60' };
    if (S.P.map['Nome']?.m === 'col' && (!onlyEmpty || S.P.map['Nome da página para URL amigável']?.m === 'vazio')) S.P.map['Nome da página para URL amigável'] = { m:'derivado', src:'Nome', t:'url' };
    S.P.chave = S.headers[S.keyCol];
    return count;
  }

  /* ============ nome por regras ============ */
  const BRAND_FIX = { 'DEWALT':'DeWalt','B+D':'Black+Decker','BLACK+DECKER':'Black+Decker','BLACK & DECKER':'Black+Decker','BLACK+ DECKER':'Black+Decker','STANLEY':'Stanley','IRWIN':'Irwin','LENOX':'Lenox','MINIPA':'Minipa','FLUKE':'Fluke','MAKITA':'Makita','BOSCH':'Bosch','WEG':'WEG','3M':'3M','ABB':'ABB','SCHNEIDER':'Schneider Electric','SIEMENS':'Siemens','WHITE STONE':'White Stone','WHITESTONE':'White Stone','VONDER':'Vonder','TRAMONTINA':'Tramontina','STARRETT':'Starrett','GEDORE':'Gedore','MILWAUKEE':'Milwaukee','FORTG':'FortG','PORTER CABLE':'Porter Cable','CRAFTSMAN':'Craftsman' };
  const TIPO_BREAK = new Set(['MAX','XR','FLEXVOLT','POWERSHIFT','BRUSHLESS','LI-ION','LITIO','COM','C/','PROFISSIONAL','PROFESSIONAL','ATOMIC','KIT','-','–','/','ELETRICA','ELETRICO']);
  const TIPO_TRIM = new Set(['DE','DA','DO','DAS','DOS','PARA','P/','E','EM','COM','A','O','SEM','C/','S/']);
  const CORES = /\b(AMARELO|AMARELA|PRETO|PRETA|VERMELHO|VERMELHA|AZUL|LARANJA|VERDE|BRANCO|BRANCA|CINZA|ROSA|ROXO|ROXA|PRATA|DOURADO|DOURADA)\b/;
  const upNoAcc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();
  function brandName(m){ const u = String(m||'').trim().toUpperCase().replace(/\s+/g,' '); if (!u) return ''; return BRAND_FIX[u] || capitalize(String(m).trim(), siglaSet()); }
  function brandSet(){
    if (S._brands && S._brandsN === S.items.length) return S._brands;
    const b = new Set(Object.keys(BRAND_FIX).map(upNoAcc));
    const mc = S.P?.map?.['Marca']; const src = mc && mc.m === 'col' ? colIdx(mc.src) : -1;
    if (src >= 0) for (const it of S.items) { const v = it.row[src]; if (!isEmpty(v)) b.add(upNoAcc(v).trim()); }
    S._brands = b; S._brandsN = S.items.length; return b;
  }
  function rawTipo(desc){
    const brands = brandSet();
    const s = String(desc ?? '').replace(/[™®*]/g,' ').replace(/\s+/g,' ').trim();
    const words = s.split(' ');
    const out = [];
    for (const w of words) {
      if (!w) continue;
      const endsComma = /[,;:]$/.test(w);
      const clean = w.replace(/[,;:]+$/,'');
      const U = upNoAcc(clean);
      const isBrand = brands.has(U) || brands.has(U.replace(/[^A-Z0-9+& ]/g,''));
      if (!out.length) { // pula prefixos: medidas, KIT, marca, "X" (collab)
        if (/\d/.test(clean) || U === 'KIT' || U === 'X' || isBrand || /^[\/(\-–"]/.test(clean) || U.length <= 1) continue;
        if (U === 'MCLAREN') continue;
      } else if (/\d/.test(clean) && out.length === 1 && upNoAcc(out[0]).replace(/\./g,'').length <= 4 && /[A-Z]{2,}/.test(U) && !/^\d+(?:[.,]\d+)?(MM|CM|M|V|W|AH|MT|PCS|UN|G)$/.test(U)) { out.push(clean); continue; }
      else if (w.startsWith('(') || /\d/.test(clean) || TIPO_BREAK.has(U) || isBrand) break;
      if (out.length && brands.has(upNoAcc(out[out.length-1] + ' ' + clean))) { out.pop(); break; }
      out.push(clean);
      if (endsComma || out.length >= 7) break;
    }
    while (out.length > 1 && TIPO_TRIM.has(upNoAcc(out[out.length-1]))) out.pop();
    return out.join(' ').toUpperCase();
  }
  function fmtNum(n){ const f = parseFloat(String(n).replace(',', '.')); return isFinite(f) ? String(f).replace('.', ',') : String(n); }
  function medidas(DESC){
    const m = [];
    const volts = [...DESC.split(/CARREG/)[0].matchAll(/(?:^|[^\w\/])(\d{1,3}(?:\/\d{1,3})?)\s?V(?:OLTS?)?(?![A-Z0-9])/g)].map(x => x[1] + 'V');
    [...new Set(volts)].slice(0, 2).forEach(v => m.push(v));
    if (/\bBIVOLT\b/.test(DESC)) m.push('Bivolt');
    const w = DESC.match(/(?:^|[^\w])(\d{3,4})\s?W(?![A-Z0-9])/); if (w) m.push(w[1] + 'W');
    const inch = DESC.match(/(\d+-\d+\/\d+|\d+(?:\s\d+)?\/\d+|\d+(?:[.,]\d+)?)\s?(?:"|”|''|POL(?:EGADAS?)?\b)/); if (inch) m.push(inch[1].replace(/\s+/g,' ') + '"');
    const ax = DESC.match(/(\d+(?:[.,]\d+)?)\s?(?:MM)?\s?X\s?(\d+(?:[.,]\d+)?)\s?MM(?![A-Z0-9])/);
    if (ax) m.push(fmtNum(ax[1]) + 'x' + fmtNum(ax[2]) + 'mm');
    else { const mm = DESC.match(/(?:^|[^\w\/.,])(\d+(?:[.,]\d+)?)\s?MM(?![A-Z0-9])/); if (mm) m.push(fmtNum(mm[1]) + 'mm'); }
    return m;
  }
  function kitObs(DESC, CTX, tipoU){
    if (/^(BATERIA|CARREGADOR)/.test(tipoU)) return { obs: '', ah: true };
    const bare = /APENAS\s+(A\s+)?FERRAMENTA|\bBARE\b|SEM\s+BATERIA|NAO\s+ACOMPANHA\s+BATERIA/.test(DESC) || /\(BARE\)/.test(CTX);
    if (bare) return { obs: 'Sem Bateria e Sem Carregador', ah: false };
    const bat = DESC.match(/(\d+)\s*(?:X\s*)?BAT(?:ERIAS?|\.|S)?\s*(?:DE\s*)?(?:\d{2}(?:\/\d{2})?V\s*(?:MAX\s*)?)?(\d+(?:[.,]\d+)?)\s*AH/);
    const bat1 = !bat && DESC.match(/BATERIA\s*(?:DE\s*)?(?:\d{2}(?:\/\d{2})?V\s*(?:MAX\s*)?)?(\d+(?:[.,]\d+)?)\s*AH/);
    const kit = bat || bat1 || /\(KITS?\)/.test(CTX) || /\bKIT\b/.test(DESC);
    if (!kit) return { obs: '', ah: true };
    const parts = [];
    if (bat) { const n = Number(bat[1]); parts.push(`${n} Bateria${n > 1 ? 's' : ''} ${fmtNum(bat[2])}Ah`); }
    else if (bat1) parts.push(`Bateria ${fmtNum(bat1[1])}Ah`);
    if (/CARREG/.test(DESC)) parts.push('Carregador');
    if (/MALETA/.test(DESC)) parts.push('Maleta'); else if (/BOLSA/.test(DESC)) parts.push('Bolsa');
    if (!parts.length) return { obs: '', ah: false };
    const txt = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
    return { obs: 'Com ' + txt, ah: false };
  }
  function descSrc(item){ const m = S.P?.map?.['Nome']; return m && m.m === 'col' ? srcVal(item, m.src) : ''; }
  function ruleName(item, o){
    const desc = String(descSrc(item) ?? o['Nome'] ?? '');
    const DESC = upNoAcc(desc).replace(/[™®*]/g,' ').replace(/\s+/g,' ');
    const CTX = upNoAcc(item.ctx || '');
    const raw = rawTipo(desc);
    const rk = norm(raw);
    const voc = rk ? S.Y[rk] : null;
    const tipo = voc && voc.tipo ? voc.tipo : capitalize(raw.toLowerCase(), siglaSet());
    const tipoU = upNoAcc(tipo);
    const marca = brandName(o['Marca']);
    const cod = itemKey(item);
    const med = medidas(DESC);
    const k = kitObs(DESC, CTX, tipoU);
    const medF = k.ah ? med : med;
    const ahM = DESC.match(/(?:^|[^\w])(\d+(?:[.,]\d+)?)\s?AH(?![A-Z0-9])/);
    if (k.ah && ahM) medF.push(fmtNum(ahM[1]) + 'Ah');
    const cor = (DESC.match(CORES) || [])[1];
    const parts = [tipo, marca, cod, ...medF.slice(0, 3), cor && !tipoU.includes(cor) ? capitalize(cor.toLowerCase(), siglaSet()) : ''].filter(Boolean);
    let nome = parts.join(' ').replace(/\s+/g, ' ').trim();
    const obs = [];
    if (k.obs) obs.push(k.obs);
    const pk = DESC.match(/\bC\/\s?(\d+)\b(?!\s*(?:BAT|PC|PECA))/) || DESC.match(/\b(\d+)\s?(?:PCS|PECAS)\b/);
    if (pk && Number(pk[1]) > 1 && !k.obs.startsWith('Com')) obs.push('Embalagem com ' + Number(pk[1]));
    if (obs.length) nome += ' - ' + obs.join(' - ');
    return { nome, raw, rk, tipoFonte: voc && voc.tipo ? (voc.fonte || 'manual') : 'regra' };
  }


  return {
    COLS, GROUPS, HINTS, OUT_ONLY, TRANSFORMS, DEFAULT_FIXED, SIGNUS_SHEET,
    norm, isEmpty, parseNum, eanValid, digitsOf, capitalize, applyTransform, slugId,
    normTree, treeById, caracGroups,
    blankProfile, signature, sigScore,
    trimSheet, detectHeader, parseItems,
    colIdx, srcVal, passesFilters, siglaSet, itemKey, groupKeyOf, mapItem, compute,
    autoMap, unitTransform,
    brandName, brandSet, rawTipo, medidas, kitObs, ruleName, descSrc,
  };
}
