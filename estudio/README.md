# 🏭 Estúdio — o app da Fábrica de LPs

O Estúdio é a metade **local** do produto: roda na máquina da Isadora e usa o
**Claude Code CLI da assinatura** para gerar e editar as landing pages
(custo de API: R$ 0).

## Como rodar

Pré-requisito: **Node** instalado e o **Claude Code** logado (é ele que gera/edita).

```bash
node estudio/app/server.js
# abra http://localhost:4321
```

O servidor avisa no terminal se encontrou o comando `claude`. Sem ele, o app
abre e mostra as páginas já geradas — só a geração/edição fica indisponível.

## O que o app faz

**Solicitações** (Kanban + Tabela)
- Fila por status: **Nova → Em produção → Em revisão → Alteração solicitada → Entregue**.
  "Em revisão" é você revisando; "Alteração solicitada" é pedido do cliente.
- **Busca por nome**, filtro por status e ordenação (mais recentes / mais antigas / A–Z).
- **Arquivar** tira do Kanban; a aba **Arquivados** guarda os concluídos. Reabrir um
  arquivado o traz de volta como "Alteração solicitada" — mesmo projeto, histórico junto.
- **+ Nova solicitação** cadastra manualmente clientes de fora do funil (indicação).

**Editor** (chat à esquerda, preview à direita)
- **Gerar LP** — o Claude Code preenche o template com o briefing.
- **Chat com três modos**: **Plano** (descreve sem mexer), **Perguntar** (só responde)
  e **Design** (edita a página de verdade).
- **Preview** Mobile/Desktop, com botão de **recarregar**.
- **Comentar** — ative e clique num elemento: inspetor (tamanho, cor, fonte, entrelinha)
  e comentário ancorado ali.
- **Marcar** — ative e desenhe sobre a página (caneta, retângulo, texto).
- **Comentários** — separa **pedidos do cliente** das **suas anotações**. Cada um pode ser
  **resolvido**, **refutado** (com resposta que o cliente vê), mandado **pro chat** ou excluído.
  Selecione vários e **aplique com a IA** de uma vez.
- **Editar** — o editor visual, com a lógica do Figma traduzida para HTML: clique num elemento
  e ajuste no painel da direita (tamanho, peso, entrelinha, alinhamento, cor, fundo, espaçamento,
  cantos e **autolayout** — direção, espaço entre itens, alinhamento, distribuição, **espaçamento
  interno (padding) horizontal e vertical** e recortar o que passa da borda). **Shift + clique** soma
  elementos; **Shift + A** junta a seleção num **autolayout** (é o "criar botão" do Figma);
  **Ctrl/Cmd + Shift + G** desfaz o grupo. **Arrastar o elemento na própria página** muda a ordem
  dele: uma linha azul mostra onde vai cair (vertical quando o autolayout é em linha, horizontal
  quando é em coluna) e ele só pode ser solto dentro da mesma seção. O elemento selecionado ganha **alças** para redimensionar
  (largura em %, altura em px) e uma alça azul para **girar** — segurando Shift trava em passos de
  5% / 15°. **Enter** entra no filho (ou edita o texto), **Esc** sobe pro pai, **Ctrl/Cmd + D**
  duplica e **Delete** apaga. Imagens podem ser trocadas por um arquivo do computador. A lista de
  **seções** permite **arrastar para reordenar**, remover e inserir uma seção salva; clicar numa
  seção rola o preview até ela. Cada mudança vira uma versão.
- **Histórico** — todas as versões ficam guardadas; dá pra **restaurar** qualquer uma.

**Atalhos**
- `Shift + clique` soma elementos à seleção · `Shift + A` agrupa em autolayout
- `Ctrl/Cmd + Shift + G` desagrupa · `Ctrl/Cmd + D` duplica · `Delete` apaga
- `Esc` sobe pro elemento pai · `Enter` entra no filho ou edita o texto
- `F5` recarrega o app (funciona mesmo com o foco no preview)
- `Ctrl/Cmd + Shift + R` recarrega só o preview
- `Ctrl/Cmd + B` recolhe e abre o chat, deixando o preview em tela cheia
- `Esc` fecha painéis e modais

## Como a página é guardada

A LP não é um HTML solto: ela é uma **lista de seções** (`nav`, `hero`, `prova-social`,
`diferenciais`, `sobre`, `galeria`, `cta`, `footer`). O HTML final é montado a partir
delas — auto-suficiente e leve. Isso é o que permite histórico, templates por seção e,
mais pra frente, reordenar arrastando.

## Estrutura

```
estudio/
├── app/
│   ├── server.js              # servidor local (Node puro, sem dependências)
│   ├── lib/blocos.js          # quebra a página em seções e monta de volta
│   ├── public/index.html      # interface do app
│   ├── public/editor.js       # editor visual injetado no preview
│   └── data/
│       ├── db.json            # índice dos projetos (seu CRM local)
│       ├── projetos/<id>.json # blocos, versões e comentários de cada projeto
│       ├── sites/<id>/        # o HTML publicado
│       ├── secoes/<id>.json   # templates de seção
│       └── pastas.json        # pastas da biblioteca
├── templates/
│   └── servico-premium/
│       ├── template.html      # esqueleto com slots {{...}} e DESIGN TOKENS
│       └── template.json      # manifesto: nicho, seções, slots, regras pra IA
├── briefings/                 # briefings de exemplo (JSON)
├── exemplos/                  # LPs de referência
└── README.md
```

## Templates

| Template | Bom para | Origem |
|----------|----------|--------|
| `servico-premium` | clínicas, advogados, consultores, coaches, marcas pessoais | LP da Dra. Sofia |

> Próximos templates virão dos outros modelos curados
> (Payrot → fintech/produto; Conscellence → consultoria B2B; Creatix → agência).

## Princípio

O template é **trilho, não gaiola**: garante estrutura boa; a IA adapta;
a Isadora refina. Nada sai sem o crivo humano.

## Próximos passos

- **Fase 2** — cobrança das edições do cliente.
- **Fase 3** — publicação em subdomínio por cliente (`cliente.fabricadelps.com.br`).
- Área do cliente (mobile) com briefing, status e preview.
