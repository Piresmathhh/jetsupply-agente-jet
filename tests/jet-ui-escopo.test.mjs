import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerar, gerarTokens } from '../scripts/gerar-jet-ui-escopo.mjs';

const ler = p => readFileSync(new URL('../ui/' + p, import.meta.url), 'utf8');
const css = ler('jet-ui-escopo.css');
const tokens = ler('jet-ui-tokens.css');

test('ui/jet-ui-escopo.css e ui/jet-ui-tokens.css em dia com fornecedores/jet-ui.css (rode node scripts/gerar-jet-ui-escopo.mjs)', () => {
  assert.equal(css, gerar());
  assert.equal(tokens, gerarTokens());
});

test('jet-ui-escopo.css: toda regra fica dentro de .jet-ui e nao redefine a paleta', () => {
  const semMedia = css.replace(/@media[^{]*\{/g, '').replace(/^\/\*.*\*\/$/gm, '');
  for (const m of semMedia.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(',').map(s => s.trim()).filter(Boolean)) assert.ok(sel.startsWith('.jet-ui'), 'seletor fora do escopo: ' + sel);
  }
  assert.ok(!/:root|(^|[\s,])body[\s{,]/m.test(css));
  assert.ok(!/--bg\s*:/.test(css), 'a paleta fica so em jet-ui-tokens.css');
});

test('jet-ui-tokens.css: paleta clara, escuro automatico e tema forcado, sem componentes', () => {
  assert.match(tokens, /:root\{--bg:#ECEFEA/);
  assert.match(tokens, /prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)/);
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.ok(!/\.panel|button|table/.test(tokens));
});
