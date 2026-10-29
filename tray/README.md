# Perfil Tray — Top Click

Abra `tray.html` pelo mesmo servidor do Agente Jet. O link **Tray** no menu leva à nova tela. Este módulo não usa Supabase nem Claude e não altera o fluxo Zydon.

## Operação

1. Carregue Consulta Produtos, Consulta Características e TreeView Shopping de Preços (`.xls` ou `.xlsx`, cabeçalho na primeira linha).
2. Defina preço e estoque padrão ou envie uma tabela `SKU`, `Preço`, `Estoque`. A opção de piloto aplica R$ 999 e uma unidade por SKU; vem desmarcada.
3. As imagens são localizadas automaticamente por SKU pelo mesmo serviço de nomes usado no agente. Os links finais usam por padrão `http://wmr8group.dalla.srv.br:8081//fotos_web/`. A consulta de nomes lê o catálogo Cloudflare existente; não enumera o servidor nem comprova que cada foto esteja acessível nele. Em Opções de imagens, um TXT/JSON ou nomes de fotos locais substituem a consulta para casos especiais. Fotos novas exclusivas do servidor exigem atualização do cadastro de nomes ou inventário manual. Não há envio de fotos.
4. O título do grupo recebe a faixa real das variações e a marca ao final, como no padrão Zydon, removendo o SKU e avisos de substituição. Modelo e dados técnicos são preservados. Opcionalmente informe JSON de títulos aprovados por referência de grupo.
5. Valide e baixe o ZIP contendo até três XLSX, instruções e relatório JSON.

Importe na sequência produtos → variações → características. Cadastre previamente as características e vincule-as à categoria. Nenhum produto é ativado automaticamente. Configuração para itens já existentes ausentes do lote: **Nenhuma ação**.

## Contrato validado no piloto real

- Produto pela referência comercial do pai encontrado por ID igual ao agrupamento Signus; variação por SKU. O pai deve estar no lote. O agrupamento fica no relatório e não é a referência exibida. No piloto: 54423 → 11422529. IDs Signus não são IDs Tray.
- Modelos existentes: produtos **133457 — v2, Categorias por ID** (25 colunas), variações **24682** (18 colunas), características **14874** (5 colunas).
- O modelo técnico 14874 vale somente para Número de polos, Curva de Disparo, Tensão de Emprego e Frequência, na ordem exportada. Outros atributos exigem criar um modelo correspondente; os outros dois modelos mantêm a ordem.
- Apenas atributos com valores diferentes no grupo viram eixo. Atributos comuns viram ficha técnica.
- Estoque do pai soma os saldos dos SKUs. O preço do pai é o menor preço das variações. Estoque zero é válido, ausência não é zero.
- kg → gramas. As dimensões de envio são arredondadas para cima em centímetros inteiros, como observado na Tray (1,8 → 2; 6,5 → 7). Conferir dimensões da embalagem real.
- Até 100 variações e sete imagens por SKU. O perfil atual permite um eixo variável; grupos com mais eixos são bloqueados.
- Até 15.000 registros e 1 MB por arquivo, conforme importador da loja. O módulo bloqueia arquivos maiores para divisão do lote.
- Quatro níveis de categoria são bloqueados: é necessário de-para aprovado para a árvore Tray. Não usa IDs externos como IDs Tray.
- Inventário é evidência de nome, não de disponibilidade HTTP. O módulo não testa cada URL nem troca automaticamente R2 por servidor.
- Sem inventário, selecione explicitamente exportar sem fotos. Imagens com extensão/sufixos ausentes não são inventadas.

## Limites antes de publicar

A página reutiliza as bibliotecas XLSX e JSZip via CDN já usadas no projeto. Ela processa os dados localmente, mas requer conexão para carregar essas bibliotecas. Não grava configurações, preço ou estoque no banco e não importa diretamente na Tray. A geração usa XLSX somente para tabelas de valores; não há fórmulas.

Teste: `npm test` inclui os testes puros em `tests/tray.test.mjs`. Para integrar outros eixos ou layouts do Signus, altere o contrato e acrescente casos reais. Produtos simples usam a referência do agrupamento; o SKU original fica no relatório de rastreabilidade. Revise essa regra antes de usar para catálogo sem agrupamento.

## Categorias por ID — modelo v2 (29/10/2026)

Use **Top Click - Produtos Signus v2 - Categorias por ID (133457)** para `01_Produtos.xlsx` gerado nesta versão. Gere novamente os arquivos antigos. Não misture v1 e v2: o modelo 133271 espera nomes e pode recriar categorias.

A coluna E contém o ID da categoria principal na Tray; F/G ficam vazias e são ignoradas pelo modelo. Nenhum nome de categoria é enviado. Identificador do produto: referência do fornecedor. Linha inicial 2, coluna A; itens ausentes: Nenhuma ação.

| Signus | Tray | Categoria |
|---|---|---|
|22|5|1P Monopolar|
|23|19|2P Bipolar|
|24|15|3P Tripolar|
|25|17|4P Tetrapolar|
|603|25|1P Monopolar + Neutro|
|604|29|3P Tripolar + Neutro|

Uma categoria Signus fora dessa lista bloqueia a geração e informa o SKU e o código pendente. Confira a categoria existente na Tray e cadastre o vínculo em `CATEGORY_IDS` antes de exportar. Não deduza o vínculo pelo nome e não reutilize os IDs Signus como IDs Tray. Se uma categoria for excluída/recriada, reconfira seu ID.
