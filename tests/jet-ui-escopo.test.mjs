import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerar } from '../scripts/gerar-jet-ui-escopo.mjs';

const css = readFileSync(new URL('../ui/jet-ui-escopo.css', import.meta.url), 'utf8');

test('jet-ui-escopo.css em dia com fornecedores/jet-ui.css (rode node scripts/gerar-jet-ui-escopo.mjs)', () => {
  assert.equal(css, gerar());
});

test('jet-ui-escopo.css: toda regra fica dentro de .jet-ui e sem tema escuro automatico', () => {
  const semMedia = css.replace(/@media[^{]*\{/g, '').replace(/^\/\*.*\*\/$/gm, '');
  for (const m of semMedia.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(',').map(s => s.trim()).filter(Boolean)) assert.ok(sel.startsWith('.jet-ui'), 'seletor fora do escopo: ' + sel);
  }
  assert.ok(!/prefers-color-scheme/.test(css));
  assert.ok(!/:root|(^|[\s,])body[\s{,]/m.test(css));
});
