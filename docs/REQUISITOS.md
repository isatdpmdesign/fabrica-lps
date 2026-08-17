# Requisitos da Fábrica de LPs — Estúdio

Documento vivo. Levantado em conversa; é o combinado antes do código.
Ordem de construção: **A → B → C → D**.

## Decisões fechadas

1. **"Em revisão"** = a Isadora revisando (crivo humano antes de entregar).
   Pedido do cliente vira status separado: **Alteração solicitada**.
2. **Cliente pede alteração depois de meses** → o *mesmo projeto* volta pra fila,
   mantendo histórico, versões e comentários. Não nasce projeto novo.
3. **Marcações do cliente** aparecem no editor com pins na tela e listadas em
   Comentários. Ações: aceitar, **refutar** (resposta explicando o porquê),
   **enviar pro chat** (a designer complementa pra IA entender) e **resolver**
   (sai da lista ativa, fica no histórico).
4. **Arquivar** → sai do Kanban, vai pra tela de arquivados (acessível pelo Kanban),
   com busca por nome.
5. **Templates por seção** → não o design em si, mas a estrutura (arranjo de cards,
   posição dos textos), com fontes, cores e imagens personalizáveis.
6. **Clonar sites** → extrair estrutura/gramática como referência e gerar algo novo.
   Nunca republicar cópia.
7. **Página guardada em blocos** (aprovado) — decisão estrutural, ver abaixo.
8. **Filtros** → busca por nome, filtro por status, ordenar por mais recente.

## A decisão que destrava tudo: página = blocos

Hoje cada LP é um HTML solto. Passa a ser uma lista de **seções identificadas**
(`nav`, `hero`, `prova-social`, `diferenciais`, `sobre`, `galeria`, `cta`, `footer`),
com ordem e conteúdo separados da estrutura. O HTML final continua sendo gerado a
partir delas — auto-suficiente e leve.

Destrava: templates por seção · reordenar arrastando · histórico por seção ·
comentário ancorado numa seção · importar HTML externo e quebrar em blocos.

## Fase A — Base e gestão

| ID | Requisito | Status |
|----|-----------|--------|
| A1 | Migrar as páginas para blocos | decidido |
| A2 | Botão de recarregar o preview | decidido |
| A3 | Atalho de teclado pra recarregar o app | decidido |
| A4 | Histórico de versões com restaurar (modal) | a definir |
| A5 | Modos do chat: Plan · Perguntar · Design | decidido |
| A6 | Status: Nova · Em produção · Em revisão · Alteração solicitada · Entregue | a definir |
| A7 | Arquivar projeto + tela de arquivados | decidido |
| A8 | Reabrir projeto arquivado como "Alteração solicitada" | decidido |
| A9 | Comentários do cliente no editor (aceitar/refutar/chat/resolver) | decidido |
| A10 | Filtros e ordenação na fila | decidido |
| A11 | Guardar projetos, versões, comentários e status em disco | decidido |

## Fase B — Templates

| ID | Requisito | Status |
|----|-----------|--------|
| B1 | Pastas nomeáveis | decidido |
| B2 | Renomear e excluir template | decidido |
| B3 | Preview do template em modal | decidido |
| B4 | Templates por seção | decidido |
| B5 | Escolher template dentro do chat | decidido |
| B6 | Importar HTML externo como modelo | decidido |
| B7 | A IA organiza a biblioteca pelo chat | decidido |

## Fase C — Editor visual

| ID | Requisito | Status |
|----|-----------|--------|
| C1 | Editar texto clicando na página | decidido |
| C2 | Painel de propriedades (fonte, cor, tamanho, espaçamento) | decidido |
| C3 | Reordenar seções arrastando | decidido |
| C4 | Adicionar e remover seções | decidido |
| C5 | Autolayout (direção, gap, alinhamento) | decidido |
| C6 | Trocar imagem direto na tela | decidido |
| C7 | IA e edição manual convivendo | decidido |

## Fase D — Skills

| ID | Requisito | Status |
|----|-----------|--------|
| D1 | Menu de skills | decidido |
| D2 | Skill "importar site como referência" | decidido |
| D3 | Criar skills próprias | a definir |

## Fora de escopo por enquanto

- **Canvas livre (arrastar qualquer coisa)** — exigiria motor de layout próprio
  (como o Framer). Em HTML normal quebra no mobile, e o produto é mobile-first.
  O ganho real vem de C3 + C5.
- **Publicação em subdomínio** — Fase 3 do produto maior.
- **Cobrança das edições** — depende da área do cliente estar no ar.

## Perguntas em aberto

- **A4** — guardar todas as versões ou as últimas N por projeto?
- **A6** — o status final chama "Gerada" ou "Entregue"?
- **D3** — o que é uma skill sua na prática, além de "importar site"?
