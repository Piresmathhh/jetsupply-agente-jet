import { writeFileSync } from 'node:fs';
import { loadFixture } from './helpers.mjs';
const { S } = loadFixture();
const rows = S.out.filter(r => !r.excl).map(r => ({ ref: r.key, secao: r.item.secao, nome_regra: r.item._rule.nome, tipo_bruto: r.item._rule.raw, ncm: r.o['Classificação fiscal - NCM'], ean: String(r.o['Código de barras']), altura_cm: r.o['Altura'], erros: r.errs, avisos: r.warns }));
writeFileSync(new URL('./fixtures/golden-mega-nexus-amostra.json', import.meta.url), JSON.stringify({ itens: S.items.length, secoes: S.sections, rows }, null, 1));
console.log(S.items.length, S.sections, rows.length);
