import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { createEngine } from '../fornecedores/engine.mjs';
const fx = p => JSON.parse(readFileSync(new URL('./fixtures/' + p, import.meta.url)));
export function loadFixture() {
  const S = { G: {}, T: {}, Y: {}, opts: {}, padroes: null };
  const E = createEngine(S, XLSX);
  S.tree = E.normTree(JSON.parse(readFileSync(new URL('./fixtures/signus-categoria-treeview.json', import.meta.url))));
  S.carac = [];
  S.P = fx('perfil-mega-nexus-sbd.json');
  const ws = XLSX.utils.aoa_to_sheet(fx('mega-nexus-amostra.json'));
  S.grid = E.trimSheet(ws);
  S.headerRow = E.detectHeader(S.grid);
  S.keyCol = -1;
  E.parseItems();
  E.compute();
  return { S, E };
}
