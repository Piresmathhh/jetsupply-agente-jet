# Perfil Tray — Top Click

Abra `tray.html` pelo mesmo servidor do Agente Jet. O link **Tray** no menu leva à nova tela. Este módulo não usa Supabase nem Claude e não altera o fluxo Zydon.

## Operação

1. Carregue Consulta Produtos, Consulta Características e TreeView Shopping de Preços (`.xls` ou `.xlsx`, cabeçalho na primeira linha).
2. Defina preço e estoque padrão ou envie uma tabela `SKU`, `Preço`, `Estoque`. A opção de piloto aplica R$ 999 e uma unidade por SKU; vem desmarcada.
3. As imagens são localizadas automaticamente por SKU pelo mesmo serviço de nomes usado no agente. Os links finais usam por padrão `http://wmr8group.dalla.srv.br:8081//fotos_web/`. A consulta automática verifica os arquivos no servidor, da principal até _7, em JPG/PNG. Em Opções de imagens, um TXT/JSON ou nomes de fotos locais substituem a consulta para casos especiais. Não há envio de fotos pelo navegador.
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
- Inventário manual é evidência de nome, não de disponibilidade HTTP. A consulta automática verifica o servidor; os links exportados continuam apontando para ele.
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


## Imagens do servidor (30/10/2026)

O importador consulta /imagens-servidor no Worker agente-jet-imagens, em lotes de dois SKUs. A consulta valida HEAD da imagem principal e _1 até _7, em jpg e png, sem parar em lacunas. Só 404 é ausência; timeout, redirecionamento ou resposta inesperada interrompem a consulta, sem cache de resultado parcial. Cache completo por SKU: 10 minutos. As rotas antigas /imagens e /tudo seguem consultando R2 para os demais recursos.

O código implantado está em tray/worker.mjs; tray/server-images.mjs contém a consulta isolada testável. No Cloudflare, preservar a associação IMAGENS ao bucket existente. O modelo atual Tray exporta sete imagens no total; mais imagens encontradas exigem revisão, sem truncamento silencioso.

## Sincronização diária servidor → R2

`tray/worker.mjs` inclui o handler agendado e usa a associação R2 `IMAGENS` existente. Configure um Cron Trigger `* * * * *` no Cloudflare. Esse gatilho avança um lote de um SKU por minuto, mas cada catálogo é percorrido apenas uma vez por dia, a partir das **03h de Brasília (06h UTC)**. Ao concluir, os demais disparos do dia não repetem a sincronização. O primeiro acionamento após ativação faz a carga do dia. Para os 367 SKUs iniciais, reserve aproximadamente seis horas, além de eventuais atrasos da plataforma.

- Catálogo inicial: `tray/sync-catalog.mjs`, 367 SKUs auditados na loja. Novos SKUs consultados com sucesso em `/imagens-servidor` são registrados automaticamente e entram no ciclo seguinte.
- Cada SKU verifica principal e `_1` até `_7`, nas extensões JPG e PNG, inclusive após lacunas. Um SKU por execução mantém no máximo 32 requisições externas, abaixo do limite de 50 do plano Free.
- A rotina compara SHA-256 do conteúdo e copia somente fotos novas ou alteradas. Antes de substituir uma foto existente, preserva a primeira versão daquele dia em `__agente_sync__/backups/AAAA-MM-DD/`.
- Não exclui fotos quando o servidor responde 404 ou falha. Falhas ficam registradas; o ciclo do dia seguinte tenta novamente. O prazo por lote é 45 segundos e três falhas consecutivas encerram aquele SKU.
- Progresso, lease contra concorrência e relatórios ficam em `__agente_sync__/`. Esses arquivos e backups são ignorados pelo catálogo público de imagens. Backups não têm exclusão automática.
- `GET /sincronizacao` informa estado, data, SKUs processados, fotos copiadas/inalteradas e quantidade de erros. `complete-with-errors` exige conferir o relatório do dia no bucket.
- O agendamento **não atualiza o cadastro nem as imagens hospedadas pela Tray**. Fotos novas/alteradas ainda exigem reimportação na Tray. Não altera categorias, preços, estoque ou ativação.

Testes: `npm test` inclui comparação de conteúdo, preservação de fotos ausentes, backup, continuidade entre lotes, novo ciclo diário e bloqueio de execuções simultâneas. A implementação isolada está em `tray/sync.mjs`.