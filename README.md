# Agente Jet — Jet Supply

> Curadoria de produtos · Signus → Zydon · v1.8

Ferramenta de curadoria e importação de produtos do ERP Signus para a plataforma Zydon B2B da Jet Supply.

---

## Como usar

1. Acesse o link do agente
2. Cole o **GitHub Token** e a **Chave API Claude** na primeira vez (ficam salvos no browser)
3. Coloque seu **nome** no campo de histórico
4. Configure a **URL base das imagens** (Cloudflare R2)
5. Faça o **upload da planilha** exportada do Signus
6. Responda as **pendências** na barra lateral (marcas e categorias novas)
7. Clique em **"Gerar planilha Zydon"** ou digite no chat
8. Baixe os **3 arquivos** gerados e importe na Zydon

---

## Arquivos gerados

| Arquivo | Descrição | Importar em |
|---|---|---|
| `JetSupply_Produto_[data].xlsx` | Planilha principal com produtos, imagens e similares | Zydon → Importar Produto |
| `JetSupply_Variacoes_[data].xlsx` | Variações dos produtos com ORDER calculado | Zydon → Importar Variações |
| `JetSupply_Variacoes_Valores_[data].xlsx` | Valores de cada variação (ex: 2A, 4A, 6A...) | Zydon → Importar Variações Valores |

---

## Mapeamento de campos (Signus → Zydon)

| Campo Zydon | Origem Signus | Observação |
|---|---|---|
| Código | ID | Identificador único do produto no banco |
| SKU | Código | Referência comercial (ex: 10076405) |
| Categoria | Grupo setorial | Nível mais específico da hierarquia |
| Ativo | Situação | ATIVO → true |
| Peso (g) | Peso (kg) × 1000 | Conversão automática |
| EAN_VARIACAO | Código barras de todos do agrupamento | Concatenação automática com ; |

---

## Regras de negócio aplicadas

- Nomes formatados: palavras descritivas em Title Case, unidades elétricas em MAIÚSCULO (10A, 440VCA, 1P)
- Marcas sempre maiúsculas (WEG, MDW, ABB...)
- Variações ordenadas por ordenação natural (2A → 4A → 6A → 10A)
- Imagens: URL principal + variações _1 até _10 por produto
- Similares gerados automaticamente pelo Cód. agrupamento

---

## Base de conhecimento

O arquivo `conhecimento.json` contém:
- **94 marcas** da Zydon com código
- **112 categorias** com hierarquia completa
- **Códigos fixos:** CD = 3 (Espírito Santo - Serra), Unidade = 1 (UN)
- **Regras aprendidas** pela equipe durante a curadoria
- **Histórico** de todas as atualizações

---

## Configuração inicial (primeira vez)

1. **GitHub Token** — solicitar com o Matheus (salvo no browser após primeira vez)
2. **Chave API Claude** — solicitar com o Matheus (salvo no browser após primeira vez)
3. **URL base imagens** — `https://pub-cf3871f2a73948b4a2d96d40202b4148.r2.dev`

---

## Versões

| Versão | Data | O que mudou |
|---|---|---|
| v1.8 | 13/07/2026 | 3 arquivos separados, Ativo = true/false, correção encoding CD |
| v1.7 | 13/07/2026 | Mantém "Substituído por" no nome, correção CD encoding |
| v1.6 | 13/07/2026 | Remoção de "Substituído por", WEG maiúsculo |
| v1.5 | 13/07/2026 | Mapa de categorias embutido, sem pendências desnecessárias |
| v1.4 | 13/07/2026 | Variações com ORDER, 94 marcas, 112 categorias, EAN_VARIACAO |
| v1.3 | 20/06/2026 | Imagens com variações _1 até _10 |
| v1.2 | 20/06/2026 | GitHub API, base de conhecimento compartilhada |
| v1.1 | 20/06/2026 | Memória de conversa, markdown renderizado |
| v1.0 | 20/06/2026 | Versão inicial |

---

*Jet Supply · Distribuidora B2B de MRO · jetsupply.com.br*
