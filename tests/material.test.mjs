import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/material-tokens.css', import.meta.url), 'utf8');
const bloco = inicio => { const i = css.indexOf(inicio); assert.ok(i >= 0, inicio); return css.slice(i, css.indexOf('}', css.indexOf('{', i) + 1) + 1); };
const cores = txt => new Set([...txt.matchAll(/(--md-[a-z-]+):#/g)].map(m => m[1]));

test('material: toda cor do tema claro tem versao no escuro automatico e no forcado', () => {
  const claro = cores(bloco(':root{'));
  const auto = cores(bloco('@media (prefers-color-scheme:dark)'));
  const forcado = cores(bloco(':root[data-theme="dark"]'));
  assert.ok(claro.size > 20);
  assert.deepEqual([...claro].filter(c => !auto.has(c)), []);
  assert.deepEqual([...claro].filter(c => !forcado.has(c)), []);
});

test('material: nomes antigos usados pelo JavaScript continuam definidos', () => {
  for (const v of ['--bg', '--surface', '--raised', '--ink', '--muted', '--faint', '--line', '--line-strong', '--accent', '--accent-ink', '--accent-soft', '--ok', '--ok-soft', '--warn', '--warn-soft', '--err', '--err-soft', '--f-mono'])
    assert.match(css, new RegExp(`${v}:var\\(--md-`), v);
});

test('material: a tela de Fornecedores usa o material.css e a fonte Roboto', () => {
  const html = readFileSync(new URL('../fornecedores.html', import.meta.url), 'utf8');
  assert.match(html, /href="ui\/material-tokens\.css"[\s\S]*href="ui\/material\.css"/);
  assert.match(html, /family=Roboto:/);
  assert.doesNotMatch(html, /fornecedores\/jet-ui\.css/);
});

test('material: o Agente usa as cores do Material e o menu da conta, sem a paleta antiga', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /href="ui\/material-tokens\.css"/);
  assert.match(html, /href="ui\/material-conta\.css"/);
  assert.match(html, /family=Roboto:/);
  assert.doesNotMatch(html, /jet-ui/);
  assert.doesNotMatch(html, /fill="#fff"/, 'o logo da barra segue a cor do tema');
});
