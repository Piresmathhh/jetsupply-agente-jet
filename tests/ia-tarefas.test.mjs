import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { createEngine } from '../fornecedores/engine.mjs';
import { TAREFAS, SIGNUS_COLS, SIGNUS_OUT_ONLY, TRANSFORMACOES, ErroEntrada, montarRequisicao } from '../supabase/functions/ia-fornecedores/tarefas.mjs';

const ctx = {
  vocabulario: ['Serra Sabre'],
  arvore: [{ id: '492', caminho: 'Materiais Elétricos > Disjuntores > Disjuntores Caixa Moldada > 3P Tripolar' }],
  propostos: [],
  txt: { padrao: 'P', regrasNome: 'R', regrasDesc: 'D' },
  exemplos: [],
  caracteristicas: { nome: 'ME - DISJUNTORES MINI', caracs: [{ id: '104', nome: 'Corrente Nominal', tipo: 'PRE-DEFINIDA' }] },
};

test('layout Signus da Edge Function igual ao do motor', () => {
  const E = createEngine({}, XLSX);
  assert.deepEqual(SIGNUS_COLS, E.COLS);
  assert.deepEqual(SIGNUS_OUT_ONLY, [...E.OUT_ONLY]);
  assert.deepEqual(TRANSFORMACOES, E.TRANSFORMS.map(t => t[0]));
});

test('entrada: recusa lote grande, indice repetido e lista vazia', () => {
  const itens = Array.from({ length: 51 }, (_, k) => ({ i: String(k), bruto: 'BR' }));
  assert.throws(() => TAREFAS.tipos.entrada({ itens }), ErroEntrada);
  assert.throws(() => TAREFAS.tipos.entrada({ itens: [{ i: 'a', bruto: 'x' }, { i: 'a', bruto: 'y' }] }), ErroEntrada);
  assert.throws(() => TAREFAS.categorias.entrada({ grupos: [] }), ErroEntrada);
  const itensTxt = Array.from({ length: 13 }, (_, k) => ({ i: String(k), fatos: 'x' }));
  assert.throws(() => TAREFAS.textos.entrada({ itens: itensTxt, com_descricao: true }), ErroEntrada);
  assert.equal(TAREFAS.textos.entrada({ itens: itensTxt }).length, 13);
});

test('entrada: textos longos sao recortados (sem prompt livre)', () => {
  const [x] = TAREFAS.tipos.entrada({ itens: [{ i: '1', bruto: 'A'.repeat(5000), exemplos: ['b'.repeat(5000), 'c', 'd', 'e'] }] });
  assert.equal(x.bruto.length, 120);
  assert.equal(x.exemplos.length, 3);
  assert.equal(x.exemplos[0].length, 200);
});

test('saida tipos: devolve o indice do navegador e descarta fora do lote', () => {
  const lote = TAREFAS.tipos.entrada({ itens: [{ i: 'k-serra', bruto: 'SERRA SABRE' }, { i: 'k-br', bruto: 'BR AR' }] });
  assert.match(TAREFAS.tipos.prompt(lote, ctx), /1 \| SERRA SABRE/);
  const r = TAREFAS.tipos.saida({ itens: [{ i: 1, tipo: 'Serra Sabre' }, { i: 2, tipo: 'Broca — Aco' }, { i: 3, tipo: 'Intruso' }, { i: 0, tipo: 'x' }] }, lote, ctx);
  assert.deepEqual(r, [{ i: 'k-serra', tipo: 'Serra Sabre' }, { i: 'k-br', tipo: 'Broca - Aco' }]);
});

test('saida categorias: id inexistente vira proposta; id valido usa o caminho da arvore', () => {
  const lote = TAREFAS.categorias.entrada({ grupos: [{ g: 'SERRAS', n: 3 }, { g: 'DISJ', n: 2 }, { g: 'OUTLET', n: 9 }] });
  const r = TAREFAS.categorias.saida({ itens: [
    { g: 'g1', id: '999', caminho: 'Ferramentas Eletricas >  Serras > Serra Sabre', misto: false, confianca: 'alta', motivo: 'ok' },
    { g: 'g2', id: '492', caminho: 'qualquer', misto: false, confianca: 'media', motivo: 'ok' },
    { g: 'g3', id: null, caminho: 'X > Y', misto: true, confianca: 'baixa', motivo: 'misto' },
    { g: 'g9', id: null, caminho: 'A > B', misto: false, confianca: 'alta', motivo: 'fora' },
  ] }, lote, ctx);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { g: 'SERRAS', id: null, caminho: 'Ferramentas Eletricas > Serras > Serra Sabre', misto: false, confianca: 'alta', motivo: 'ok' });
  assert.equal(r[1].caminho, ctx.arvore[0].caminho);
  assert.equal(r[2].caminho, null);
});

test('saida consolidar_arvore: so aceita "de" que foi proposto', () => {
  const lote = TAREFAS.consolidar_arvore.entrada({ propostos: [{ caminho: 'A > B > Serras', grupos: 2 }, { caminho: 'A > B > Serra', grupos: 1 }] });
  const r = TAREFAS.consolidar_arvore.saida({ itens: [
    { de: 'A > B > Serra', para: 'A > B > Serras', motivo: 'plural' },
    { de: 'Z > Z', para: 'A', motivo: 'invalido' },
    { de: 'A > B > Serras', para: 'A > B > Serras', motivo: 'igual' },
  ] }, lote, ctx);
  assert.deepEqual(r, [{ de: 'A > B > Serra', para: 'A > B > Serras', motivo: 'plural' }]);
});

test('saida mapear_colunas: destino e origem precisam existir', () => {
  const lote = TAREFAS.mapear_colunas.entrada({ cabecalhos: ['ITEM', 'NCM'], linhas: [{ ITEM: 'X1', NCM: '8467' }] });
  const r = TAREFAS.mapear_colunas.saida({ itens: [
    { destino: 'Classificação fiscal - NCM', origem: 'NCM', transformacao: 'ncm' },
    { destino: 'Status migração', origem: 'ITEM', transformacao: 'texto' },
    { destino: 'Nome', origem: 'NAO EXISTE', transformacao: 'texto' },
  ] }, lote, ctx);
  assert.deepEqual(r, [{ destino: 'Classificação fiscal - NCM', origem: 'NCM', transformacao: 'ncm' }]);
});

test('saida caracteristicas e textos: filtra ids e descricao so quando pedida', () => {
  const lc = TAREFAS.caracteristicas.entrada({ grupo: 'ME-DJ-MINI', itens: [{ i: 'r1', nome: 'Disjuntor 20A' }] });
  assert.deepEqual(TAREFAS.caracteristicas.saida({ itens: [{ i: 1, valores: [{ id: '104', valor: '20 A' }, { id: '999', valor: 'x' }] }] }, lc, ctx), [{ i: 'r1', valores: { 104: '20 A' } }]);
  const lt = TAREFAS.textos.entrada({ itens: [{ i: 'r1', fatos: 'ITEM: X1' }] });
  assert.deepEqual(TAREFAS.textos.saida({ itens: [{ i: 1, nome: 'Serra — X1', descricao: 'longa', duvida: '' }] }, lt, ctx), [{ i: 'r1', nome: 'Serra - X1', duvida: '' }]);
});

test('requisicao: modelo por nivel, effort fora do Haiku, saida em json_schema', () => {
  const lote = TAREFAS.tipos.entrada({ itens: [{ i: '1', bruto: 'BR' }] });
  const rt = montarRequisicao('tipos', lote, ctx);
  assert.equal(rt.model, 'claude-haiku-4-5');
  assert.equal(rt.output_config.effort, undefined);
  assert.equal(rt.output_config.format.type, 'json_schema');
  const lc = TAREFAS.categorias.entrada({ grupos: [{ g: 'x' }] });
  const rc = montarRequisicao('categorias', lc, ctx, { modelos: { padrao: 'claude-sonnet-5' }, esforco: { padrao: 'medium' } });
  assert.equal(rc.model, 'claude-sonnet-5');
  assert.equal(rc.output_config.effort, 'medium');
});
