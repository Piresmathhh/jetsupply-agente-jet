# Agente Jet — Jet Supply

> Curadoria de produtos · Signus → Zydon · v3.0

Ferramenta de curadoria e importação de produtos do ERP Signus para a plataforma Zydon B2B da Jet Supply.

---

## Como usar

1. Acesse o link do agente
2. Cole o **GitHub Token** e a **Chave API Claude** na primeira vez (ficam salvos no browser)
3. Coloque seu **nome** no campo de histórico
4. Configure a **URL base das imagens** (Cloudflare R2)
5. Faça o **upload da planilha** exportada do Signus — o agente valida automaticamente se as colunas obrigatórias existem
6. Responda as **pendências** na barra lateral (marcas e categorias novas)
7. Clique em **"Gerar 3 planilhas Zydon"** — acompanhe a barra de progresso
8. Revise o **relatório de avisos** (EAN duplicado, marca/categoria sem código)
9. Baixe os **3 arquivos** e importe na Zydon na ordem correta

---

## Ordem de importação na Zydon

| Ordem | Arquivo | Onde importar |
|---|---|---|
| 1º | `JetSupply_Produto_[data].xlsx` | Zydon → Importar Produto |
| 2º | `JetSupply_Variacoes_[data].xlsx` | Zydon → Importar Variações |
| 3º | `JetSupply_Variacoes_Valores_[data].xlsx` | Zydon → Importar Variações Valores |

No mapeamento da aba **Imagens**, configure: `Produto (Código)` → **Produto**, `Imagem` → **Imagem**.

---

## Mapeamento de campos (Signus → Zydon)

| Campo Zydon | Origem Signus | Observação |
|---|---|---|
| Código | ID | Identificador único imutável |
| SKU | Código | Referência comercial (ex: 10076405) |
| Ativo | Situação | ATIVO → true (booleano) |
| Categoria (Código) | Grupo setorial | Nível mais específico da hierarquia |
| Marca (Código) | Marca | Buscado automaticamente (94 marcas) |
| Peso (g) | Peso (kg) × 1000 | Conversão automática |
| EAN_VARIACAO | Código barras do agrupamento | Concatenação com ; |
| Unidade Padrão (Código) | — | Fixo: 1 (UN) — configurável no conhecimento.json |
| CD (Código) | — | Fixo: 3 (CD - Espírito Santo - Serra) |

---

## Motor de ordenação de variações

Suporta 4 tipos, identificados automaticamente pelo nome do produto:

| Tipo | Exemplo | Ordenação |
|---|---|---|
| Corrente elétrica | 2A, 4A, 10A | Numérica |
| Medida decimal | 0.5, 1.5, 2.5 | Numérica |
| Tamanho numérico | 2, 4, 6 | Numérica |
| Vestuário | PP, P, M, G, GG, XGG | Ordem fixa |

Novos tipos podem ser adicionados enviando exemplos para o Matheus incluir na função `extrairValorVariacao`.

---

## Funcionalidades v3.0

- ✅ Validação do arquivo na entrada (colunas obrigatórias do Signus)
- ✅ Tratamento de token GitHub expirado (limpa e avisa)
- ✅ Retry automático em conflito de escrita no GitHub (SHA desatualizado)
- ✅ Barra de progresso durante a geração
- ✅ Relatório de erros: marca sem código, categoria sem código, EAN duplicado
- ✅ 3 arquivos gerados com botões de download individuais
- ✅ Motor de ordenação para múltiplos tipos de variação
- ✅ Versão da base de conhecimento incrementada automaticamente
- ✅ Histórico de alterações registrado no `conhecimento.json`

---

## Base de conhecimento (`conhecimento.json`)

| O que contém | Quantidade |
|---|---|
| Marcas Zydon com código | 94 marcas |
| Categorias com hierarquia | 112 categorias |
| Regras aprendidas pela equipe | crescem com uso |
| Códigos fixos | CD, Unidade padrão |

---

## Pendente (depende de decisão futura)

- **Produto pai único por agrupamento** — hoje cada variação vira uma linha na aba Produtos; o documento de arquitetura original previa um único produto "pai" por agrupamento. Como a Zydon aceitou o formato atual sem erro, mantivemos — revisar se causar problema na prática.
- **Ficha Técnica** — deixada em branco por decisão do time (fase futura)
- **Parametrização de CD/Unidade via interface** — hoje só editável no `conhecimento.json`

---

## Configuração inicial (primeira vez)

- **GitHub Token** — solicitar com o Matheus
- **Chave API Claude** — solicitar com o Matheus (opcional, só para chat livre)
- **URL base imagens** — `https://pub-cf3871f2a73948b4a2d96d40202b4148.r2.dev`

---

## Histórico de versões

| Versão | O que mudou |
|---|---|
| v3.0 | Reescrita completa: validação, retry GitHub, progresso, relatório de erros, motor de ordenação multi-tipo |
| v2.0 | SEO/Tags restaurados, templates alinhados com Zydon |
| v1.9 | 3 arquivos separados, Ativo=true, Variações com Valores=1 |
| v1.5 | Mapa de categorias embutido no HTML |
| v1.4 | Variações com ORDER, 94 marcas, 112 categorias |
| v1.0 | Versão inicial |

---

*Jet Supply · Distribuidora B2B de MRO · jetsupply.com.br*
