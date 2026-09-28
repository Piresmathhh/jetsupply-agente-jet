// Gera, a partir de fornecedores/jet-ui.css, os dois arquivos que o Agente (index.html) usa:
//   ui/jet-ui-tokens.css  so a paleta e as fontes (:root claro, escuro automatico e [data-theme]),
//                         valendo para a pagina toda. As variaveis antigas do Agente apontam para ela.
//   ui/jet-ui-escopo.css  os componentes do jet-ui valendo so dentro de .jet-ui, para as telas
//                         desenhadas com eles (ex.: Historico), sem afetar as classes antigas do Agente.
//     body -> .jet-ui   * -> .jet-ui, .jet-ui *   outros seletores -> .jet-ui <seletor>
//
// Uso: node scripts/gerar-jet-ui-escopo.mjs   (o teste tests/jet-ui-escopo.test.mjs confere se esta em dia)
import { readFileSync, writeFileSync } from 'node:fs';

const ESCOPO = '.jet-ui';

function escopoSeletor(sel) {
  return sel.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    if (s === ':root' || s === 'body' || s === 'html') return ESCOPO;
    if (s.startsWith(':root')) return ESCOPO + s.slice(':root'.length);
    if (s === '*') return `${ESCOPO}, ${ESCOPO} *`;
    return `${ESCOPO} ${s}`;
  }).join(',');
}

const ehToken = cabeca => cabeca.startsWith(':root');

// Percorre o CSS bloco a bloco (sem comentarios). Blocos @media tem regras dentro; o resto e seletor{...}.
// modo 'escopo': componentes sob .jet-ui, sem os blocos de paleta. modo 'tokens': so os blocos de paleta.
function transformar(css, modo) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '', i = 0;
  while (i < css.length) {
    const abre = css.indexOf('{', i);
    if (abre < 0) break;
    const cabeca = css.slice(i, abre).trim();
    let prof = 1, j = abre + 1;
    while (j < css.length && prof) { if (css[j] === '{') prof++; else if (css[j] === '}') prof--; j++; }
    const corpo = css.slice(abre + 1, j - 1);
    if (cabeca.startsWith('@media')) {
      const dentro = transformar(corpo, modo);
      if (dentro.trim()) out += `${cabeca}{${dentro}}\n`;
    } else if (cabeca.startsWith('@')) {
      if (modo === 'escopo') out += `${cabeca}{${corpo}}\n`;
    } else if (cabeca && ehToken(cabeca)) {
      if (modo === 'tokens') out += `${cabeca}{${corpo.trim()}}\n`;
    } else if (cabeca && modo === 'escopo') {
      out += `${escopoSeletor(cabeca)}{${corpo.trim()}}\n`;
    }
    i = j;
  }
  return out;
}

const CABECALHO = '/* GERADO por scripts/gerar-jet-ui-escopo.mjs a partir de fornecedores/jet-ui.css. Nao editar a mao. */\n';
const origem = () => readFileSync(new URL('../fornecedores/jet-ui.css', import.meta.url), 'utf8');
export function gerar() {
  return CABECALHO + '/* Componentes do jet-ui valendo so dentro de .jet-ui. A paleta vem de jet-ui-tokens.css. */\n' + transformar(origem(), 'escopo');
}
export function gerarTokens() {
  return CABECALHO + '/* Paleta e fontes do jet-ui para a pagina toda: claro, escuro automatico e [data-theme]. */\n' + transformar(origem(), 'tokens');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../ui/jet-ui-escopo.css', import.meta.url), gerar());
  writeFileSync(new URL('../ui/jet-ui-tokens.css', import.meta.url), gerarTokens());
  console.log('ui/jet-ui-escopo.css e ui/jet-ui-tokens.css gerados.');
}
