---
name: referencia-para-lp
description: >-
  Use quando for criar uma LP a partir de uma REFERÊNCIA VISUAL (uma imagem/print
  de uma página que a Isadora quer usar como base de estrutura e estilo) OU quando
  for criar um design novo do zero com alto padrão. Resolve o problema de "image to
  code": a IA solta é viciada em padrão (primeira dobra, texto em cima, linha
  embaixo, três cards, degradê) e cospe página genérica com cara de IA. Esta skill
  força o caminho prompt → imagem → código, com wireframe primeiro, construção em
  camadas e um checklist de fidelidade. A pedido da Isadora (método do vídeo da
  Assimov + o que ela comprovou na prática).
---

# Referência visual → LP (image to code, sem frankenstein)

> **REGRA DE OURO (o erro nº 1):** a imagem de referência é um MOCKUP pra você
> OLHAR e REPRODUZIR com HTML/CSS de verdade. **NUNCA** coloque a imagem de
> referência dentro de um `<img>` ocupando a tela — isso não é recriação, é
> trapaça, e quebra no responsivo (a "página" vira uma foto esticada). Recrie
> cada bloco (card, sombra, recorte, tipografia, cores). As fotos/ilustrações
> que aparecem DENTRO da referência (ex.: um pulmão) são geradas à parte depois
> ou viram placeholder com as proporções certas — os elementos são trocáveis.

O problema: a IA moderna é boa em design, mas **viciada em padrões**. Se você
manda "vira essa imagem em HTML" de uma vez, ela reinterpreta e devolve a página
genérica (degradê roxo, header centralizado, três cards). A causa é pedir
**prompt → código direto**: trabalhar em HTML/CSS de cara engessa a criatividade
e ela cai no padrão.

A virada: **prompt → imagem → código**. E, ao copiar uma referência, seguir um
processo com etapas e revisão no meio, em vez de fazer tudo de uma tacada.

## Duas entradas
- **Tenho uma referência** (um print de página que quero usar de base): a imagem
  já existe → pule direto pro Passo 1 (wireframe).
- **Quero criar do zero, com alto padrão:** primeiro **gere uma imagem** da tela
  (Nano Banana / GPT Image), explorando composição livre, sem se prender a HTML.
  Isso destrava a criatividade e foge do padrão. Depois trate essa imagem gerada
  como a referência e siga o Passo 1.

## O processo (revise a cada etapa, não faça tudo de uma vez)

**Passo 1 — Wireframe em SVG.**
Olhe a imagem e gere um **wireframe de baixa fidelidade em SVG**: o esqueleto da
tela, marcando os textos, os blocos e as posições dos componentes que vão virar
HTML. Nada de estilo ainda, só a estrutura. **Peça revisão antes de avançar.**

**Passo 2 — Extraia o design system da imagem.**
Antes de codar, leia da imagem: **paleta de cores** (fundo, cards, acento),
**estilo da fonte** (geométrica? redonda? serifada? peso?) e a Google Font mais
próxima, **arredondamento** dos cantos, **espaçamentos**, e o **material** de cada
elemento (sólido, gradiente ou vidro/glass). Anote como tokens.

**Passo 3 — Construa em camadas, de baixo pra cima** (revise entre elas):
1. **Fundo** da página (a cor/estrutura de trás).
2. **Cards e containers** (com o material certo: sólido, gradiente ou glass).
3. **Imagens**: gere as fotos que faltam (Nano Banana / GPT Image) e coloque.
   Nunca deixe espaço de imagem vazio.
4. **Tipografia**: por último, ajuste fonte, pesos, tamanhos e hierarquia.

**Passo 4 — Movimento.** Só depois que a página estática estiver fiel, aplique a
skill `lp-com-movimento` (animações no scroll).

## ✅ Checklist de fidelidade (o que separa "próximo" de "igual")
Antes de dar por pronto, confira cada item. Foram os erros reais que fizeram a
designer rejeitar versões anteriores:

- [ ] **Full-width.** A borda arredondada em volta da referência costuma ser só a
  moldura do mockup (o fundo cinza do Figma/Dribbble). A página real é
  **full-width**: o branco (ou a cor de fundo) É a tela, e o conteúdo se distribui
  na largura. Nunca boxear tudo num cartão central.
- [ ] **Detalhes geométricos.** Recortes, curvas, notches, sobreposições, cantos
  côncavos. Reproduza a forma (ex.: um "inverse radius" pra carvar um canto), não
  ache tudo em retângulo.
- [ ] **Imagens de verdade.** Gere e coloque as fotos (Nano Banana). Placeholder
  vazio nunca. Fotos são conteúdo: na versão do cliente, troca pelas dele.
- [ ] **Material certo.** Card de vidro é vidro (translúcido + `backdrop-filter:
  blur` + borda clara). Não faça sólido o que é glass, nem chapado o que é gradiente.
- [ ] **Fonte e espaçamento.** Fonte próxima da referência (não a "segura" da IA)
  e o mesmo respiro entre os blocos.
- [ ] **Sem reinterpretar.** Copie a estrutura que está na imagem, não a que a IA
  "acha bonita".

## Limites honestos (e ética)
- É uma **recriação**, não um clone pixel a pixel. A fonte exata proprietária vira
  aproximação; as fotos são trocadas pelas do cliente.
- **Referência = inspiração de estrutura e estilo**, pra virar **design system de
  um novo cliente** (conteúdo, cores e marca dele). Copiar a página de uma marca
  real igualzinha e publicar como dela é plágio; usar a estrutura pra outro cliente
  não é. Cada cliente é diferente, então isso acontece naturalmente.

## Onde isto se encaixa na Fábrica
Junto com `lp-com-movimento` (movimento) e `humanizar-escrita` (texto). Fluxo
completo: referência → wireframe → camadas → LP fiel → movimento no scroll → texto
humano. Exemplo pronto: `../lp-com-movimento/exemplos/referencia-para-html.html`
(a LP do IBNESINA recriada full-width, com fotos, recorte geométrico e cards de vidro).
