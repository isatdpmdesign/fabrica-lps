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
- A fila de demandas, por status: Nova → Em produção → Em revisão → Gerada.
- **+ Nova solicitação** cadastra manualmente clientes que vieram por fora do
  funil (indicação, WhatsApp direto). Os do funil chegam sozinhos pelo SaaS.

**Editor** (chat à esquerda, preview à direita)
- **Gerar LP** — o Claude Code preenche o template com o briefing do cliente.
- **Preview** em Mobile (padrão) e Desktop.
- **Comentar** — ative e clique num elemento: abre o inspetor (tamanho, cor,
  fonte, entrelinha) e permite comentar naquele ponto (vira um pin numerado).
- **Marcar** — ative e desenhe sobre a página (caneta, retângulo, texto).
- **Comentários** — todas as marcações ficam listadas. Selecione as que quiser
  e mande **pro chat** (o Claude Code aplica) ou **pra fila**.
- **Templates** — gaveta com miniaturas dos templates disponíveis.
- O chat também aceita pedidos livres ("deixa o título menor") e edita a página.

## Estrutura

```
estudio/
├── app/
│   ├── server.js              # servidor local (Node puro, sem dependências)
│   ├── public/index.html      # interface do app
│   └── data/
│       ├── db.json            # solicitações (seu CRM local)
│       └── sites/<id>/        # as LPs geradas
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
