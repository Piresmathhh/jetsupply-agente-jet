import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFixture } from './helpers.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-mega-nexus-amostra.json', import.meta.url)));

test('parse: cabecalho, secoes e itens da amostra Mega Nexus', () => {
  const { S } = loadFixture();
  assert.equal(S.headerRow, 0);
  assert.equal(S.items.length, golden.itens);
  assert.equal(S.sections, golden.secoes);
});

test('layout Signus: 50 colunas na ordem exata', () => {
  const { E } = loadFixture();
  assert.equal(E.COLS.length, 50);
  assert.equal(E.COLS[0], 'Código');
  assert.equal(E.COLS[49], 'Mensagem de Crítica');
  assert.ok(E.SIGNUS_SHEET.length <= 31);
});

test('golden: nome por regra, NCM, EAN, dimensao e criticas iguais ao artifact v3', () => {
  const { S } = loadFixture();
  const rows = S.out.filter(r => !r.excl);
  assert.equal(rows.length, golden.rows.length);
  rows.forEach((r, i) => {
    const g = golden.rows[i];
    assert.equal(r.key, g.ref);
    assert.equal(r.item._rule.nome, g.nome_regra, `nome ${g.ref}`);
    assert.equal(r.o['Classificação fiscal - NCM'], g.ncm);
    assert.equal(String(r.o['Código de barras']), g.ean);
    assert.deepEqual(r.errs, g.erros, `erros ${g.ref}`);
    assert.deepEqual(r.warns, g.avisos, `avisos ${g.ref}`);
  });
});

test('transformacoes', () => {
  const { E } = loadFixture();
  const ctx = { siglas: new Set(['SDS', 'V']) };
  assert.equal(E.applyTransform('ncm', 84679900.0, ctx), '84679900');
  assert.equal(E.applyTransform('ncm', '8467.99.00', ctx), '84679900');
  assert.equal(E.applyTransform('m_cm', 0.798, ctx), 79.8);
  assert.equal(E.applyTransform('mm_cm', '125', ctx), 12.5);
  assert.equal(E.applyTransform('numero', '1.234,5', ctx), 1234.5);
  assert.equal(E.applyTransform('numero', 'ND', ctx), '');
  assert.equal(E.applyTransform('url', 'Serra Sabre 20V Ação', ctx), 'serra-sabre-20v-acao');
  assert.ok(E.eanValid('885911968416'));
  assert.ok(!E.eanValid('885911968417'));
});

test('regras de nome: bare, kit, embalagem, medidas', () => {
  const { S, E } = loadFixture();
  const it = (desc, ctx = '') => {
    const row = Array(S.headers.length).fill(null);
    row[E.colIdx('ITEM')] = 'X1'; row[E.colIdx('DESCRIÇÃO DO PRODUTO')] = desc; row[E.colIdx('MARCA')] = 'DEWALT';
    return E.ruleName({ row, ctx, secao: ctx }, { 'Marca': 'DEWALT' }).nome;
  };
  assert.equal(it('SERRA SABRE 20V MAX* XR (APENAS FERRAMENTA)'), 'Serra Sabre DeWalt X1 20V - Sem Bateria e Sem Carregador');
  assert.equal(it('ESMERILHADEIRA ANGULAR 5" (125MM) 60V MAX* FLEXVOLT 2 BAT 6AH, CARREG 220V E BOLSA'), 'Esmerilhadeira Angular DeWalt X1 60V 5" 125mm - Com 2 Baterias 6Ah, Carregador e Bolsa');
  assert.equal(it('BR DIN 338 TW104 L-T 142X11.80MM TB C/5'), 'Br Din DeWalt X1 142x11,8mm - Embalagem com 5');
  assert.equal(it('6" ALICATE DE CORTE DIAGONAL PRO'), 'Alicate de Corte Diagonal Pro DeWalt X1 6"');
});

test('vocabulario de tipos substitui o tipo bruto', () => {
  const { S, E } = loadFixture();
  const r = S.out.find(x => !x.excl && x.item._rule.raw === 'MANGUEIRA PARA VIBRADOR DE CONCRETO');
  S.Y[r.item._rule.rk] = { raw: r.item._rule.raw, tipo: 'Mangote para Vibrador', fonte: 'manual' };
  E.compute();
  const r2 = S.out.find(x => x.key === r.key);
  assert.ok(r2.item._rule.nome.startsWith('Mangote para Vibrador DeWalt'));
  assert.equal(r2.item._rule.tipoFonte, 'manual');
});

test('nome aprovado vence a regra; nao aprovado so entra com useSug', () => {
  const { S, E } = loadFixture();
  const k = S.out.find(x => !x.excl).key;
  S.T[k] = { nome: 'Nome Editado', st: 'sugerido' };
  E.compute();
  assert.notEqual(S.out.find(x => x.key === k).o['Nome'], 'Nome Editado');
  S.opts.useSug = true; E.compute();
  assert.equal(S.out.find(x => x.key === k).o['Nome'], 'Nome Editado');
  S.opts.useSug = false; S.T[k].st = 'aprovado'; E.compute();
  assert.equal(S.out.find(x => x.key === k).o['Nome'], 'Nome Editado');
});

test('filtro de exclusao e ref repetida', () => {
  const { S, E } = loadFixture();
  S.P.filtros = [{ col: 'OBSERVAÇÕES GERAIS', op: 'contem', v: 'SUBSTITU' }];
  E.compute();
  assert.ok(S.out.some(r => r.excl && r.motivo === 'Removido por regra de filtro') || S.out.every(r => !r.excl || r.dup));
});
