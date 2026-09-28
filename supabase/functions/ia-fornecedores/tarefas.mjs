// Tarefas de IA do modulo Fornecedores (De-Para Signus).
// JS puro, sem Deno nem rede: roda na Edge Function ia-fornecedores e nos testes do Node.
//
// O navegador nunca manda prompt: manda { tarefa, dados } e cada tarefa aqui
//   1. valida e recorta os dados de entrada (tamanho de lote, tamanho de texto),
//   2. monta o prompt no servidor, com o contexto que vem do banco (arvore, vocabulario, regras),
//   3. valida a saida da IA e descarta o que estiver fora do lote.
// Os textos dos prompts sao os do artifact v4; a unica mudanca e que os itens sao renumerados
// 1..n no prompt e o resultado volta com o indice que o navegador mandou.

export const SIGNUS_COLS = ['Código','Código de barras','Nome','Descrição técnica','Categoria de produto','Gênero','Selo','Grupo Setorial','Categoria de preço','Categoria fiscal','Classificação fiscal - NCM','Linha de produto','Marca','Fabricante','Mercadoria/Serviço (M/S)','Origem do produto','Unidade de medida','Peso (extendido)','Fabricação própria','Habilitado para faturamento','Estoque mínimo','Desativado','Nome reduzido','Código genérico','Quantidade por embalagem na compra','Especificação técnica','Curva ABC','Aplicar regra de múltiplo por embalagem','Estoque máximo','Quantidade por embalagem na venda','Quantidade de peças por embalagem','Unidade de negócio - Sigla','Aplicar regra de mínimo de venda','Quantidade mínima para venda / compra','Garantia (em dias)','Retirar o produto da sugestão automática de necessidade de compra (base consumo)','Altura','Largura','Profundidade','Volume','Rastreabilidade','Rastreabilidade na devolução','Observação','Exibe na cotação de venda','Nome da página para URL amigável','Descrição do produto e-commerce','Palavras chaves','Código do Fornecedor Padrão','Status migração','Mensagem de Crítica'];
export const SIGNUS_OUT_ONLY = ['Status migração', 'Mensagem de Crítica'];
export const TRANSFORMACOES = ['texto','capitalizar','maiusculas','numero','inteiro','ncm','ean','m_cm','mm_cm','g_kg','origem','cortar60','url'];

export const DEFAULT_TXT = {
  padrao: 'Tipo + Marca + Codigo + Voltagem/Tamanho + Cor + Observacoes',
  regrasNome: [
    'Tipo na linguagem do comprador (ex.: "Serra Sabre", "Martelete Perfurador", "Chave de Impacto"). Inclua o sistema de encaixe quando for relevante (ex.: "SDS Plus").',
    'Marca com a grafia oficial: DeWalt, Stanley, Irwin, Lenox, Black+Decker.',
    'Codigo do fabricante exatamente como na origem, em maiusculas.',
    'Voltagem/tamanho no formato 20V, 127V, 220V, 1/2", 10mm, 5Ah.',
    'Cor so quando diferencia o produto; ela vem antes das observacoes.',
    'Observacoes separadas por " - ". O que NAO acompanha fica explicito: quando a origem disser "apenas ferramenta", "bare", "sem bateria" ou equivalente, termine com "Sem Bateria e Sem Carregador". Em kits, diga o que acompanha (ex.: "Com 2 Baterias 5Ah e Carregador").',
    'Capitalizacao padrao (primeira letra maiuscula), preservando siglas e unidades (SDS, XR, MAX, V, Ah, mm).',
    'Nao use travessao. Nao invente informacao que nao esteja na origem.',
  ].join('\n'),
  regrasDesc: [
    'Portugues do Brasil correto, com acentuacao.',
    '1 a 3 paragrafos curtos explicando o que e o produto e para que serve, seguidos de "Especificacoes:" em lista com os dados da origem.',
    'Se a origem informar, inclua "Acompanha:" e "Nao acompanha:" (bateria, carregador, maleta, suporte).',
    'Use so fatos presentes nos dados. Pode explicar a funcao do tipo de produto de forma geral, sem numeros ou recursos que nao estejam na origem.',
    'Sem emojis, sem exageros de marketing, sem travessao.',
  ].join('\n'),
};

export class ErroEntrada extends Error {}

/* ============ helpers ============ */
const txt = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lista = (v, maxItens, maxTxt) => (Array.isArray(v) ? v : []).slice(0, maxItens).map(x => txt(x, maxTxt)).filter(Boolean);
const semTravessao = s => String(s).replace(/\s*[—–]\s*/g, ' - ');
export function normPath(p) {
  return String(p || '').split('>').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4).join(' > ');
}
function arr(dados, campo, max) {
  const v = dados?.[campo];
  if (!Array.isArray(v) || !v.length) throw new ErroEntrada(`"${campo}" deve ser uma lista com itens.`);
  if (v.length > max) throw new ErroEntrada(`Lote grande demais: no maximo ${max} itens por chamada.`);
  return v;
}
// Indices do navegador: precisam ser unicos, senao nao da para devolver o resultado ao item certo.
function indices(itens, campo) {
  const vistos = new Set();
  return itens.map(x => {
    const i = String(x?.[campo] ?? '').slice(0, 200);
    if (!i || vistos.has(i)) throw new ErroEntrada(`Cada item precisa de "${campo}" unico.`);
    vistos.add(i); return i;
  });
}
const esquemaLista = (props, required) => ({
  type: 'object', additionalProperties: false, required: ['itens'],
  properties: { itens: { type: 'array', items: { type: 'object', additionalProperties: false, required, properties: props } } },
});
// Resposta "i" da IA (1..n) -> item do lote, ou null se estiver fora dele.
const doLote = (lote, i) => { const n = Number(i); return Number.isInteger(n) && n >= 1 && n <= lote.length ? lote[n - 1] : null; };

/* ============ tarefas ============ */
// nivel: qual modelo usar (configuravel em configuracoes.fornecedores_ia). lote: maximo por chamada.
// entrada(dados) -> lote normalizado. prompt(lote, ctx) -> texto. saida(json, lote, ctx) -> resultado.
export const TAREFAS = {
  tipos: {
    nivel: 'rapido', lote: 50, maxTokens: 4000, contexto: ['vocabulario'],
    entrada(dados) {
      const itens = arr(dados, 'itens', 50); const ids = indices(itens, 'i');
      return itens.map((x, k) => ({ i: ids[k], bruto: txt(x.bruto, 120), secao: txt(x.secao, 120), exemplos: lista(x.exemplos, 3, 200) })).filter(x => x.bruto);
    },
    prompt: (lote, ctx) => `Voce padroniza o TIPO de produto no cadastro de um distribuidor de ferramentas, abrasivos e materiais (Jet Supply, Brasil).
O "tipo" e o comeco do nome do produto, como o comprador procura. As planilhas dos fabricantes usam abreviacoes e ordens diferentes.

Tipos ja padronizados pelo time (reutilize exatamente quando for o mesmo produto):
${ctx.vocabulario.length ? ctx.vocabulario.slice(0, 300).join(' | ') : '(nenhum ainda)'}

Tipos encontrados na planilha (i | tipo bruto | secao da planilha | ate 3 exemplos de descricao completa):
${lote.map((x, k) => `${k + 1} | ${x.bruto} | ${x.secao || '-'} | ${x.exemplos.join(' // ')}`).join('\n')}

Regras:
- 1 a 5 palavras, portugues do Brasil com acentuacao correta, capitalizacao de titulo com preposicoes minusculas (ex.: "Broca para Metal", "Serra Sabre", "Martelete Perfurador", "Chave de Impacto", "Disco Flap").
- Expanda abreviacoes (BR = Broca, AR = aco rapido, MD = madeira, P/ = para, CX = caixa).
- Inclua o que define o produto: aplicacao (Metal, Madeira, Concreto) e sistema de encaixe quando existir (SDS Plus, SDS Max).
- Nao inclua marca, linha comercial (Extreme, Atomic, Pro), normas (DIN 338, ANSI), voltagem, medidas, cor nem "sem fio".
- Mesmo produto = mesmo tipo: nao crie variacoes para o que ja esta na lista do time.
- Se os exemplos mostram produtos diferentes sob o mesmo tipo bruto, use o tipo mais especifico que ainda vale para todos (ex.: "Broca").
Responda no formato pedido: itens = [{"i":1,"tipo":"..."}]`,
    esquema: esquemaLista({ i: { type: 'integer' }, tipo: { type: 'string' } }, ['i', 'tipo']),
    saida(json, lote) {
      const out = new Map();
      for (const r of json?.itens || []) {
        const x = doLote(lote, r.i); const tipo = txt(semTravessao(r.tipo || ''), 80);
        if (x && tipo) out.set(x.i, { i: x.i, tipo });
      }
      return [...out.values()];
    },
  },

  categorias: {
    nivel: 'padrao', lote: 25, maxTokens: 6000, contexto: ['arvore', 'propostos'],
    entrada(dados) {
      const grupos = arr(dados, 'grupos', 25); const ids = indices(grupos, 'g');
      return grupos.map((x, k) => ({ g: ids[k], contexto: txt(x.contexto, 200), marcas: lista(x.marcas, 10, 60), n: Math.max(0, Math.floor(Number(x.n) || 0)), exemplos: lista(x.exemplos, 4, 200) }));
    },
    prompt: (lote, ctx) => `Voce classifica produtos de um distribuidor B2B (materiais eletricos, ferramentas e MRO) na arvore de categorias do ERP Signus.

Arvore de categorias que ja existe no Signus (id | caminho):
${ctx.arvore.length ? ctx.arvore.map(t => `${t.id} | ${t.caminho}`).join('\n') : '(vazia)'}

Caminhos ja propostos pelo time para categorias novas (reutilize exatamente quando servir, para nao criar duplicatas):
${ctx.propostos.length ? ctx.propostos.slice(0, 200).join('\n') : '(nenhum ainda)'}

Grupos de produtos da planilha do fornecedor:
${lote.map((g, k) => `g${k + 1} | contexto: ${g.contexto || '-'} | marcas: ${g.marcas.join(', ') || '-'} | ${g.n} itens | exemplos: ${g.exemplos.join(' ; ')}`).join('\n')}

Regras:
- Se uma categoria que JA EXISTE serve para todos os itens do grupo, use o id dela e repita o caminho em "caminho".
- Se nao existe, id = null e "caminho" = a categoria nova proposta, com 3 ou 4 niveis, do geral para o especifico, na linguagem do comprador. Ex.: "Ferramentas Eletricas > Marteletes > Martelete Perfurador", "Ferramentas Eletricas > Serras > Serra Sabre", "Acessorios para Ferramentas > Brocas > Brocas SDS Plus".
- Nao force encaixe: ferramenta nao e disjuntor nem fusivel.
- Se o grupo mistura tipos diferentes de produto (ex.: secoes comerciais como lancamentos, outlet, em breve), responda misto = true, id = null e caminho = null.
- Nao inclua marca, voltagem nem "com bateria/sem bateria" no caminho.
Responda no formato pedido: itens = [{"g":"g1","id":"492" ou null,"caminho":"N1 > N2 > N3" ou null,"misto":false,"confianca":"alta"|"media"|"baixa","motivo":"ate 12 palavras"}]`,
    esquema: esquemaLista({
      g: { type: 'string' }, id: { anyOf: [{ type: 'string' }, { type: 'null' }] }, caminho: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      misto: { type: 'boolean' }, confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] }, motivo: { type: 'string' },
    }, ['g', 'id', 'caminho', 'misto', 'confianca', 'motivo']),
    saida(json, lote, ctx) {
      const porId = new Map(ctx.arvore.map(t => [String(t.id), t]));
      const out = new Map();
      for (const r of json?.itens || []) {
        const g = doLote(lote, String(r.g || '').replace(/\D/g, '')); if (!g) continue;
        const existe = r.id != null && porId.get(String(r.id));
        const misto = !existe && !!r.misto;
        out.set(g.g, {
          g: g.g, id: existe ? String(r.id) : null,
          caminho: existe ? existe.caminho : (misto ? null : (normPath(semTravessao(r.caminho || '')) || null)),
          misto, confianca: ['alta', 'media', 'baixa'].includes(r.confianca) ? r.confianca : 'baixa',
          motivo: txt(semTravessao(r.motivo || ''), 120),
        });
      }
      return [...out.values()];
    },
  },

  consolidar_arvore: {
    nivel: 'complexo', lote: 1, maxTokens: 8000, contexto: ['arvore'],
    entrada(dados) {
      const props = arr(dados, 'propostos', 500)
        .map(x => ({ caminho: normPath(txt(x?.caminho, 300)), grupos: Math.max(0, Math.floor(Number(x?.grupos) || 0)) }))
        .filter(x => x.caminho);
      if (props.length < 2) throw new ErroEntrada('Poucas categorias propostas para consolidar.');
      return props;
    },
    prompt: (lote, ctx) => `Abaixo esta uma arvore de categorias proposta para um catalogo de ferramentas e materiais (distribuidor B2B no Brasil), com a quantidade de grupos de produtos em cada caminho.
Arvore existente no Signus (nao mexer, so reutilizar nomes de niveis quando fizer sentido):
${ctx.arvore.map(t => t.caminho).slice(0, 300).join('\n') || '(vazia)'}

Caminhos propostos (caminho | grupos):
${lote.map(p => `${p.caminho} | ${p.grupos}`).join('\n')}

Tarefa: deixe a arvore coerente. Junte sinonimos e duplicatas (singular/plural, grafias diferentes), padronize nomes de niveis, mantenha 3 ou 4 niveis e nao crie niveis com um unico filho sem necessidade.
Responda no formato pedido, so com as mudancas (omita os caminhos que ficam iguais): itens = [{"de":"<caminho proposto exato>","para":"<novo caminho>","motivo":"ate 10 palavras"}]`,
    esquema: esquemaLista({ de: { type: 'string' }, para: { type: 'string' }, motivo: { type: 'string' } }, ['de', 'para', 'motivo']),
    saida(json, lote) {
      const propostos = new Set(lote.map(p => p.caminho));
      const out = new Map();
      for (const r of json?.itens || []) {
        const de = normPath(r.de), para = normPath(semTravessao(r.para || ''));
        if (propostos.has(de) && para && para !== de) out.set(de, { de, para, motivo: txt(semTravessao(r.motivo || ''), 120) });
      }
      return [...out.values()];
    },
  },

  textos: {
    nivel: 'padrao', lote: 25, maxTokens: 16000, contexto: ['txt', 'exemplos'],
    entrada(dados) {
      const comDescricao = !!dados?.com_descricao;
      const itens = arr(dados, 'itens', comDescricao ? 12 : 25); const ids = indices(itens, 'i');
      return itens.map((x, k) => ({ i: ids[k], categoria: txt(x.categoria, 200), fatos: txt(x.fatos, 900), comDescricao })).filter(x => x.fatos);
    },
    prompt(lote, ctx) {
      const cfg = ctx.txt, withDesc = !!lote[0]?.comDescricao, ex = ctx.exemplos;
      return `Voce padroniza o cadastro de produtos de um distribuidor de ferramentas e materiais (Jet Supply), para ERP e e-commerce.

PADRAO DO NOME: ${cfg.padrao}
REGRAS DO NOME:
${cfg.regrasNome}
${withDesc ? `\nREGRAS DA DESCRICAO LONGA:\n${cfg.regrasDesc}\n` : ''}
${ex.length ? `EXEMPLOS APROVADOS PELO TIME (siga o mesmo estilo):\n${ex.map(e => `origem: ${e.origem}\nnome: ${e.nome}`).join('\n')}\n` : ''}
ITENS (i | categoria | dados da planilha do fornecedor):
${lote.map((r, k) => `${k + 1} | ${r.categoria || '-'} | ${r.fatos}`).join('\n')}

Responda no formato pedido: itens = [{"i":1,"nome":"...",${withDesc ? '"descricao":"texto com quebras de linha \\n",' : ''}"duvida":"o que faltou ou ficou ambiguo na origem, ou vazio"}]`;
    },
    esquema: esquemaLista({ i: { type: 'integer' }, nome: { type: 'string' }, descricao: { type: 'string' }, duvida: { type: 'string' } }, ['i', 'nome', 'descricao', 'duvida']),
    saida(json, lote) {
      const out = new Map();
      for (const r of json?.itens || []) {
        const x = doLote(lote, r.i); const nome = txt(semTravessao(r.nome || ''), 200);
        if (!x || !nome) continue;
        const item = { i: x.i, nome, duvida: txt(r.duvida, 200) };
        if (x.comDescricao && r.descricao) item.descricao = semTravessao(r.descricao).trim().slice(0, 4000);
        out.set(x.i, item);
      }
      return [...out.values()];
    },
  },

  mapear_colunas: {
    nivel: 'padrao', lote: 1, maxTokens: 4000, contexto: [],
    entrada(dados) {
      const cabecalhos = lista(dados?.cabecalhos, 200, 120);
      if (!cabecalhos.length) throw new ErroEntrada('"cabecalhos" deve ser uma lista com itens.');
      const linhas = (Array.isArray(dados?.linhas) ? dados.linhas : []).slice(0, 4).map(l =>
        Object.fromEntries(cabecalhos.map(h => [h, l && typeof l === 'object' ? txt(l[h], 200) : ''])));
      return [{ cabecalhos, linhas }];
    },
    prompt: ([x]) => `Voce faz o de-para de colunas de uma planilha de produtos de um fornecedor para o layout de migracao de produtos do ERP Signus.

Colunas do fornecedor com 4 linhas de exemplo (JSON):
${JSON.stringify(x.linhas.length ? x.linhas : [Object.fromEntries(x.cabecalhos.map(h => [h, '']))]).slice(0, 12000)}

Campos do Signus (destino):
${SIGNUS_COLS.filter(c => !SIGNUS_OUT_ONLY.includes(c) && c !== 'Código').join('\n')}

Transformacoes possiveis: ${TRANSFORMACOES.join(', ')}.
Regras: o Signus usa dimensoes em cm e peso em kg (se a coluna estiver em metros use m_cm; em mm use mm_cm). NCM usa "ncm", codigo de barras unitario usa "ean", origem usa "origem". Nao mapeie colunas de preco, impostos (IPI, ICMS, MVA, CST) ou observacoes comerciais. So mapeie quando houver correspondencia clara.
Responda no formato pedido: itens = [{"destino":"<campo Signus exato>","origem":"<coluna do fornecedor exata>","transformacao":"<uma das transformacoes>"}]`,
    esquema: esquemaLista({ destino: { type: 'string' }, origem: { type: 'string' }, transformacao: { type: 'string', enum: TRANSFORMACOES } }, ['destino', 'origem', 'transformacao']),
    saida(json, [x]) {
      const destinos = new Set(SIGNUS_COLS.filter(c => !SIGNUS_OUT_ONLY.includes(c) && c !== 'Código'));
      const origens = new Set(x.cabecalhos);
      const out = new Map();
      for (const r of json?.itens || []) {
        if (!destinos.has(r.destino) || !origens.has(r.origem)) continue;
        out.set(r.destino, { destino: r.destino, origem: r.origem, transformacao: TRANSFORMACOES.includes(r.transformacao) ? r.transformacao : 'texto' });
      }
      return [...out.values()];
    },
  },

  caracteristicas: {
    nivel: 'rapido', lote: 30, maxTokens: 8000, contexto: ['caracteristicas'],
    entrada(dados) {
      const grupo = txt(dados?.grupo, 60);
      if (!grupo) throw new ErroEntrada('"grupo" (codigo do grupo de caracteristicas) e obrigatorio.');
      const itens = arr(dados, 'itens', 30); const ids = indices(itens, 'i');
      return itens.map((x, k) => ({ i: ids[k], grupo, nome: txt(x.nome, 200), descricao: txt(x.descricao, 600) })).filter(x => x.nome);
    },
    prompt: (lote, ctx) => {
      const grp = ctx.caracteristicas;
      return `Extraia caracteristicas tecnicas de produtos a partir do nome/descricao. Grupo: ${grp.nome}.
Caracteristicas (id | nome | tipo):
${grp.caracs.map(c => `${c.id} | ${c.nome} | ${c.tipo}`).join('\n')}

Produtos (i | nome | descricao tecnica):
${lote.map((r, k) => `${k + 1} | ${r.nome} | ${r.descricao}`).join('\n')}

Regras: preencha so o que estiver explicito no texto; nao deduza. Use unidade quando houver (ex.: "20 A", "230 V"). Numero de polos no formato "1P", "2P", "3P", "4P", "1P+N", "3P+N".
Responda no formato pedido: itens = [{"i":1,"valores":[{"id":"<id da caracteristica>","valor":"<valor>"}]}]`;
    },
    esquema: esquemaLista({
      i: { type: 'integer' },
      valores: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'valor'], properties: { id: { type: 'string' }, valor: { type: 'string' } } } },
    }, ['i', 'valores']),
    saida(json, lote, ctx) {
      const validos = new Set(ctx.caracteristicas.caracs.map(c => String(c.id)));
      const out = new Map();
      for (const r of json?.itens || []) {
        const x = doLote(lote, r.i); if (!x) continue;
        const valores = {};
        for (const v of Array.isArray(r.valores) ? r.valores : []) {
          const valor = txt(v?.valor, 120);
          if (validos.has(String(v?.id)) && valor) valores[String(v.id)] = valor;
        }
        out.set(x.i, { i: x.i, valores });
      }
      return [...out.values()];
    },
  },
};

// Modelos padrao por nivel. Sobrescritos por configuracoes.fornecedores_ia =
//   { modelos: { rapido, padrao, complexo }, esforco: {...}, tarefas: { textos: { modelo, esforco }, ... } }
// "tarefas" vale acima do nivel: permite trocar o modelo de uma tarefa so (ex.: textos, a mais cara).
export const MODELOS_PADRAO = {
  modelos: { rapido: 'claude-haiku-4-5', padrao: 'claude-opus-5', complexo: 'claude-opus-5' },
  esforco: { padrao: 'low', complexo: 'high' },
};

// Monta o corpo da chamada a Messages API. Haiku 4.5 nao aceita "effort"; os demais aceitam.
export function montarRequisicao(tarefa, lote, ctx, cfg = MODELOS_PADRAO) {
  const t = TAREFAS[tarefa];
  const porTarefa = cfg?.tarefas?.[tarefa] || {};
  const modelo = porTarefa.modelo || cfg?.modelos?.[t.nivel] || MODELOS_PADRAO.modelos[t.nivel];
  const esforco = porTarefa.esforco ?? cfg?.esforco?.[t.nivel] ?? MODELOS_PADRAO.esforco[t.nivel];
  const output_config = { format: { type: 'json_schema', schema: t.esquema } };
  if (esforco && !/haiku/.test(modelo)) output_config.effort = esforco;
  return {
    model: modelo,
    max_tokens: t.maxTokens,
    messages: [{ role: 'user', content: t.prompt(lote, ctx) }],
    output_config,
  };
}
