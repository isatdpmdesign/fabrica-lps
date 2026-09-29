# Bold Gradiente — design system

**Resumo:** energia e conversão. Degradês vivos, tipografia pesada, blocos de alto contraste e CTAs impossíveis de ignorar.
**Melhor para:** infoprodutos, lançamentos, cursos e mentorias, tech e apps.

## Paleta
- Fundo base: `#0b0618` (roxo quase preto) — a página é escura.
- Texto: `#ffffff` no escuro; `#0b0618` sobre blocos claros.
- Degradê-assinatura: de `#7c3aed` (roxo) a `#ec4899` (rosa). Aparece no CTA, em títulos-chave e em brilhos de fundo.
- Apoio: `#22d3ee` (ciano) só como acento pontual.
- Regra: o degradê é a marca — use no botão principal e em 1–2 destaques por dobra, não no fundo inteiro.

## Tipografia
- Títulos: sans pesada e condensada — `Sora`, `Space Grotesk` ou `Manrope` (peso 700–800).
- Corpo: `Inter` (peso 400–500).
- Escala impactante: h1 `clamp(44px, 7vw, 88px)`, line-height 1.02; corpo 16–18px.
- Títulos podem ter uma palavra-chave com o degradê aplicado no texto (background-clip:text).

## Layout & espaçamento
- Seções em blocos de alto contraste (alterna escuro/claro). Cada bloco = uma promessa.
- Brilhos radiais suaves de fundo (glow roxo/rosa) atrás do herói.
- Cards com borda `1px` translúcida e leve blur (glass) sobre o escuro.

## Componentes
- Botão: pílula (raio grande), fundo com o degradê, texto branco peso 600, sombra colorida difusa (`0 10px 30px rgba(124,58,237,.4)`). Hover: sobe e intensifica o glow.
- Cards: glass escuro (`rgba(255,255,255,.05)` + blur), borda `rgba(255,255,255,.12)`, cantos 16–20px.
- Selos/badges: pílulas pequenas com o acento ciano.

## Movimento
- Entradas com energia: fade + subida (translateY 24px) e leve escala. Números que sobem (count-up).
- Glow do fundo pulsa devagar. CTA com brilho que "respira".
- Peso: nada de vídeo pesado; use CSS. Mobile mantém o degradê mas corta os glows grandes.

## Faça / Não faça
- ✅ Contraste alto, CTA gigante e claro, prova social forte.
- ✅ Degradê como assinatura, não como poluição.
- ❌ Não use 5 cores; o degradê roxo→rosa manda.
- ❌ Nada de texto cinza sobre fundo escuro sem contraste.
