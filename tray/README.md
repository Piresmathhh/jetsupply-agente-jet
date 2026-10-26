# Perfil Tray — Top Click

Abra `tray.html` pelo mesmo servidor do Agente Jet. O link **Tray** no menu leva à nova tela. Este módulo não usa Supabase nem Claude e não altera o fluxo Zydon.

## Operação

1. Carregue Consulta Produtos, Consulta Características e TreeView Shopping de Preços (`.xls` ou `.xlsx`, cabeçalho na primeira linha).
2. Defina preço e estoque padrão ou envie uma tabela `SKU`, `Preço`, `Estoque`. A opção de piloto aplica R$ 999 e uma unidade por SKU; vem desmarcada.
3. Informe a URL pública do servidor ou R2. Envie um TXT com um nome de imagem por linha, um JSON de nomes/objetos `{name}`, ou selecione arquivos locais para ler apenas seus nomes. Não há envio de fotos.
4. O título do grupo recebe a faixa real das variações e a marca ao final, como no padrão Zydon, removendo o SKU e avisos de substituição. Modelo e dados técnicos são preservados. Opcionalmente informe JSON de títulos aprovados por referência de grupo.
5. Valide e baixe o ZIP contendo até três XLSX, instruções e relatório JSON.

Importe na sequência produtos → variações → características. Cadastre previamente as características e vincule-as à categoria. Nenhum produto é ativado automaticamente. Configuração para itens já existentes ausentes do lote: **Nenhuma ação**.

## Contrato validado no piloto real

- Produto por referência do grupo Signus; variação por SKU. IDs Signus não são IDs Tray.
- Modelos existentes: produtos **133271** (25 colunas), variações **24682** (18 colunas), características **14874** (5 colunas).
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
