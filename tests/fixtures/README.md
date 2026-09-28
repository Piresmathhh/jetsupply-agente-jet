# Fixtures do motor De-Para Signus

- `mega-nexus-amostra.json`: 101 linhas da planilha Mega Nexus (Stanley Black & Decker), **anonimizada**
  porque o repositorio e publico: condicoes fiscais e comerciais (IPI, ICMS, MVA, CEST, CST, ST, LP, %AJUSTE,
  STATUS, observacoes) trocadas por valores neutros e EANs trocados por codigos ficticios (prefixo 200),
  mantendo comprimento, validade do digito verificador e repeticoes. Refs, descricoes, medidas e secoes
  sao as originais, porque sao elas que exercitam as regras de nome.
- `golden-mega-nexus-amostra.json`: saida esperada do motor sobre a amostra (`node tests/gen-golden.mjs`).
  Foi regerado depois da anonimizacao e conferido contra o golden do artifact v4: a unica diferenca sao os
  EANs, todos seguindo o mapa da anonimizacao.
- `perfil-mega-nexus-sbd.json`, `signus-categoria-treeview.json`: perfil do fornecedor e arvore Treeview
  exportados do artifact.

A planilha completa **nao** entra no repositorio.
