// Checa se o JavaScript embutido no index.html tem erro de sintaxe (chave sem fechar,
// vírgula sobrando, etc.) antes de considerar o deploy saudável. Não executa o código,
// só valida a sintaxe (node --check) — não pega bugs de lógica, só quebra evidente.
const fs = require('fs');
const { execSync } = require('child_process');

const html = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

let combined = '';
let match;
while ((match = scriptRegex.exec(html))) {
  combined += match[1] + '\n;\n';
}

if (!combined.trim()) {
  console.error('Nenhum <script> inline encontrado em index.html — confira o regex do checador.');
  process.exit(1);
}

const tmpFile = '.tmp-inline-check.js';
fs.writeFileSync(tmpFile, combined);

try {
  execSync(`node --check ${tmpFile}`, { stdio: 'inherit' });
  console.log('OK: o JavaScript embutido em index.html passou na checagem de sintaxe.');
} catch (e) {
  console.error('Erro de sintaxe no JavaScript embutido em index.html — veja acima.');
  process.exit(1);
} finally {
  fs.unlinkSync(tmpFile);
}
