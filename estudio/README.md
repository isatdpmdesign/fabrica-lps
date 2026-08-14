# 🏭 Estúdio — o motor de geração da Fábrica de LPs

O Estúdio é a metade **local** do produto (roda na máquina da Isadora, usando o
**Claude Code CLI da assinatura** — sem conta de API). Ele pega um briefing,
gera a landing page a partir de um template-base e entrega pra revisão humana.

## Fluxo

```
briefing.json  ─┐
                ├─►  Claude Code (CLI)  ─►  LP gerada (HTML)  ─►  Isadora revisa  ─►  publica
template-base  ─┘        (o motor)                                  (o crivo)
```

1. **Briefing** — vem do SaaS (formulário do cliente), em JSON. Ex.: `briefings/exemplo-advocacia.json`.
2. **Template-base** — esqueleto comprovado em conversão. A IA preenche os slots
   `{{...}}` e re-skiniza as cores/fontes por marca. Ex.: `templates/servico-premium/`.
3. **Geração** — o Claude Code lê o `template.json` (manifesto), aplica as regras
   e produz o HTML final.
4. **Revisão** — a Isadora abre, ajusta o que quiser (o diferencial da Fábrica) e aprova.
5. **Publicação** — a LP vai pro SaaS e é hospedada no subdomínio do cliente.

## Estrutura

```
estudio/
├── templates/
│   └── servico-premium/
│       ├── template.html   # esqueleto com slots {{...}} e DESIGN TOKENS no topo
│       └── template.json   # manifesto: nicho, seções, slots e regras pra IA
├── briefings/
│   └── exemplo-advocacia.json
├── exemplos/
│   └── mariana-costa.html  # PROVA: o mesmo esqueleto re-skinizado p/ advocacia
└── README.md
```

## Templates

| Template | Bom para | Origem |
|----------|----------|--------|
| `servico-premium` | clínicas, advogados, consultores, coaches, marcas pessoais | LP da Dra. Sofia |

> Próximos templates virão dos outros modelos que a Isadora curou
> (Payrot → fintech/produto; Conscellence → consultoria B2B; Creatix → agência).

## Princípio

O template é **trilho, não gaiola**: garante estrutura boa; a IA adapta; a Isadora
refina. Nunca sai nada sem o crivo humano.
