// Gera ui/jet-ui-escopo.css a partir de fornecedores/jet-ui.css: o mesmo sistema visual, valendo so dentro
// de um elemento com a classe "jet-ui". Serve para migrar o Agente (index.html) para o jet-ui uma tela por
// vez, sem mudar as telas que ainda nao foram convertidas.
//   :root / body      -> .jet-ui
//   *                 -> .jet-ui, .jet-ui *
//   outros seletores  -> .jet-ui <seletor>
// O tema escuro automatico (prefers-color-scheme) fica de fora: com ele, so a tela convertida escureceria
// no meio do Agente claro. Ele volta quando todas as telas estiverem no jet-ui.
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

// Percorre o CSS bloco a bloco (sem comentarios). Blocos @media tem regras dentro; o resto e seletor{...}.
function transformar(css) {
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
      if (!/prefers-color-scheme\s*:\s*dark/.test(cabeca)) out += `${cabeca}{${transformar(corpo)}}\n`;
    } else if (cabeca.startsWith('@')) {
      out += `${cabeca}{${corpo}}\n`;
    } else if (cabeca) {
      out += `${escopoSeletor(cabeca)}{${corpo.trim()}}\n`;
    }
    i = j;
  }
  return out;
}

export function gerar() {
  const origem = readFileSync(new URL('../fornecedores/jet-ui.css', import.meta.url), 'utf8');
  return '/* GERADO por scripts/gerar-jet-ui-escopo.mjs a partir de fornecedores/jet-ui.css. Nao editar a mao. */\n' +
    '/* jet-ui valendo so dentro de .jet-ui (migracao do Agente tela a tela; sem tema escuro automatico). */\n' +
    transformar(origem);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../ui/jet-ui-escopo.css', import.meta.url), gerar());
  console.log('ui/jet-ui-escopo.css gerado.');
}
