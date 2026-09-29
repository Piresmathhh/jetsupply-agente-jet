import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const codigo = readFileSync(new URL('../ui/tema.js', import.meta.url), 'utf8');

// Navegador minimo: <html> com atributos, localStorage, um botao data-tema-btn e eventos.
function navegador(salvo) {
  const attrs = {}, store = salvo ? { jet_tema: salvo } : {}, ouvintes = {};
  const botao = { textContent: '', title: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, closest: sel => (sel === '[data-tema-btn]' ? botao : null) };
  const document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } },
    querySelectorAll: () => [botao],
    addEventListener: (ev, fn) => { ouvintes[ev] = fn; },
  };
  const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const window = {};
  vm.runInNewContext(codigo, { document, localStorage, window });
  ouvintes.DOMContentLoaded();
  return { attrs, store, botao, clicar: () => ouvintes.click({ target: botao }), window };
}

test('tema: sem escolha salva segue o sistema (sem data-theme)', () => {
  const n = navegador();
  assert.equal(n.attrs['data-theme'], undefined);
  assert.equal(n.botao.textContent, 'Tema: automático');
});

test('tema: escolha salva e aplicada antes da pagina aparecer', () => {
  assert.equal(navegador('light').attrs['data-theme'], 'light');
  assert.equal(navegador('dark').attrs['data-theme'], 'dark');
  assert.equal(navegador('qualquer').attrs['data-theme'], undefined);
});

test('tema: botao alterna automatico -> claro -> escuro -> automatico e salva', () => {
  const n = navegador();
  n.clicar(); assert.equal(n.attrs['data-theme'], 'light'); assert.equal(n.store.jet_tema, 'light'); assert.equal(n.botao.textContent, 'Tema: claro');
  assert.equal(n.botao.attrs['data-tema'], 'light');
  n.clicar(); assert.equal(n.attrs['data-theme'], 'dark'); assert.equal(n.store.jet_tema, 'dark'); assert.equal(n.botao.textContent, 'Tema: escuro');
  n.clicar(); assert.equal(n.attrs['data-theme'], undefined); assert.equal(n.store.jet_tema, undefined); assert.equal(n.botao.textContent, 'Tema: automático');
});
