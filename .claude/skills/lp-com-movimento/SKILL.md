---
name: lp-com-movimento
description: >-
  Use ao criar ou incrementar QUALQUER landing page da Fábrica de LPs que precise
  de movimento e alto padrão visual: animação no scroll, objeto que dá zoom,
  cena que se monta, parallax, storytelling com scroll, revelações, 3D e cenas
  cinematográficas (entrar num imóvel, peças que voam pras bordas, etc.).
  Ensina o alfabeto do movimento (peças reutilizáveis) e o método de traduzir a
  descrição da Isadora em técnica, em vez de um catálogo fixo de efeitos. A pedido
  da Isadora, pra a Fábrica entregar na régua de mercado sem depender de curso.
---

# LP com movimento — o alfabeto, não o catálogo

A régua do mercado subiu: as LPs boas têm movimento no scroll, 3D e cenas que
contam história. Esta skill existe pra a Fábrica entregar nessa régua **toda vez**,
sem depender de lembrar de pedir.

**A ideia central:** não decore efeitos prontos. Todo efeito "cabuloso", por mais
único que pareça, é feito de um punhado pequeno de peças. Sabendo as peças, você
monta qualquer coisa a partir da descrição da Isadora, inclusive o que ainda não
inventaram. É o oposto de um catálogo (que fica velho e limita).

## Regra de ouro (lê antes de tudo)
1. **O movimento serve à história, nunca é enfeite.** Se não ajuda a vender ou a
   entender, não entra.
2. **Leve e rápido.** Anime só `transform` (mover, girar, escala) e `opacity` —
   são as duas coisas que o navegador anima sem travar. Nunca anime `width`,
   `height`, `top`, `left`, `margin` no scroll.
3. **O celular manda.** Metade das visitas é mobile. Efeito pesado que engasga no
   celular espanta cliente. Teste no mobile; simplifique ou desligue o que pesar.
4. **Respeite quem pediu menos movimento.** Sempre inclua o guard
   `prefers-reduced-motion` (código no fim). Acessibilidade e enjoo importam.
5. **A primeira dobra carrega rápido.** Não trave o carregamento com biblioteca
   pesada antes do herói aparecer. Imagem principal entra primeiro, movimento depois.

## O alfabeto do movimento (as peças)
Toda cena se monta com estas peças. São poucas e não mudam:

- **Pin (prender):** o elemento fica fixo na tela enquanto a pessoa rola. É o que
  dá tempo pra uma cena acontecer "no lugar".
- **Scrub (ligar ao scroll):** a animação anda amarrada ao scroll, pra frente e
  pra trás, no ritmo da pessoa. Sem scrub, a animação só toca uma vez.
- **Transformações:** `scale` (zoom), `x/y` (mover), `rotate` (girar),
  `opacity` (aparecer/sumir), `clip-path`/máscara (revelar por dentro).
- **Profundidade / "entrar em algo":** sensação de avançar pra dentro = `scale`
  grande + perspectiva (`perspective`, movimento em Z) + parallax entre camadas.
- **Timeline (coreografia):** encadear várias transformações no tempo do scroll.
  É o que transforma peças soltas numa cena.
- **Sequência de quadros (frame scrubbing):** um vídeo ou uma sequência de imagens
  (quadro a quadro) que avança com o scroll. É a técnica "cinematográfica" da Apple.
  Serve pra "passear por um imóvel", "armadura montando", produto girando 360°.
- **Parallax:** camadas que se movem em velocidades diferentes, dando profundidade.
- **Reveal:** elementos que sobem/aparecem quando entram na tela (o mais barato e
  mais usado; use à vontade).

## As bibliotecas (e quando usar cada uma)
Ninguém faz isso na mão. Carregue por CDN (cdnjs ou jsdelivr):

| Precisa de… | Ferramenta | Observação |
|---|---|---|
| Animar no scroll, pin, scrub, timeline | **GSAP + ScrollTrigger** | O motor. Resolve 90% dos casos. |
| Scroll suave (aquele deslize) | **Lenis** | Liga no ScrollTrigger (ver starter). |
| Sequência de quadros / cena cinematográfica | GSAP + `<canvas>` desenhando a imagem do frame | Renderize os quadros antes (3D ou vídeo → frames). |
| 3D de verdade (objeto que gira, câmera anda) | **Spline** (fácil, visual) ou **Three.js** (poderoso) | Spline dá pra embutir com um `<script>`; é o caminho mais rápido. |
| Ilustração/ícone animado leve | **Lottie** (`lottie-web`) | Arquivo `.json` exportado do After Effects/LottieFiles. |
| Vídeo de fundo, imagem que troca | HTML/CSS puro | Sem biblioteca. `<video muted autoplay playsinline loop>`. |

CDNs (use estes domínios, funcionam em artifact e em produção):
- GSAP: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`
- ScrollTrigger: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js`
- Lenis: `https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js`
- Lottie: `https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js`

## O método: da descrição da Isadora → técnica
Quando a Isadora descreve uma cena, traduza assim:

1. **Qual é a história?** O que a pessoa deve sentir/entender naquele trecho.
2. **Quebre em peças do alfabeto.** "A cadeira dá zoom e os móveis flutuam" =
   pin + scrub + `scale` na cadeira + `x/y`+`opacity` nos móveis + reveal do texto.
3. **Precisa de conteúdo que não é código?** (um 3D, quadros de um vídeo, um
   Lottie) → veja "De onde vêm os ativos".
4. **Escolha a biblioteca** pela tabela acima.
5. **Monte com o starter** (fim do arquivo) e ajuste os números.
6. **Passe pelas regras de ouro** (mobile, reduced-motion, performance).

Descrever em palavras **resolve o movimento**. O que a descrição não cria é o
*conteúdo que se move* — esse precisa ser produzido (ver abaixo).

## Exemplos desmontados (receita pra adaptar, não copiar)
- **Cadeira que dá zoom, móveis flutuando (loja de móveis)** → pin + scrub;
  `scale` na cadeira; cada móvel com `x/y`+`opacity`+`rotate`; texto com reveal.
  Demo pronta em `exemplos/loja-moveis.html`. É o esqueleto base pra qualquer
  "objeto herói que cresce no scroll".
- **Passear por dentro de um imóvel (sala, corredor, banheiro)** → sequência de
  quadros com scrub: renderize um passeio (3D no Blender/Spline, ou grave um
  vídeo andando) → exporte os quadros → desenhe o quadro certo no `<canvas>`
  conforme o scroll. A sensação de "entrar" vem da câmera avançando nos quadros.
  Alternativa mais interativa: cena 3D no Spline com a câmera amarrada ao scroll.
- **Armadura fechando no corpo (personal/Homem de Ferro)** → duas opções:
  (a) sequência de quadros (mesma técnica do imóvel), ou (b) peças em PNG
  transparente voando das bordas pro centro com `x/y`+`rotate`+`opacity` numa
  timeline, revelando por máscara. (a) é mais fotográfico, (b) é mais leve.
- **Produto girando 360°** → sequência de quadros do produto em volta (frame
  scrubbing). Mesmo motor.

Repare: imóvel, armadura e produto 360° são **a mesma peça** (sequência de quadros).
Aprendeu uma, fez as três.

## De onde vêm os ativos (o conteúdo que se move)
O código faz mover; o que se move precisa existir. Caminhos:
- **3D interativo:** modele/monte no **Spline** (exporta embed pronto) ou use um
  modelo `.glb` no Three.js. Dá pra **gerar modelos 3D com as ferramentas de IA
  conectadas** (ver Magnific/Higgsfield: geração de 3D) e refinar.
- **Sequência de quadros:** renderize um passeio de câmera (Blender/Spline) e
  exporte PNGs, ou grave um vídeo e extraia os quadros. Ferramentas de vídeo com
  IA também geram esse tipo de clipe.
- **Ilustração animada:** LottieFiles (prontos) ou export do After Effects.
- **Foto/vídeo:** banco de imagens, foto do cliente (vem no briefing) ou geração
  com IA de imagem.
- **Templates do Aura Design (da Isadora):** entram como referência de estilo e
  base visual; o movimento a gente adiciona por cima com as peças acima.

Regra prática: peça leve (poucos quadros, 3D otimizado, vídeo comprimido). Ativo
pesado é o que mais trava LP.

## Starter — cole isto e ajuste
Base mínima e correta pra qualquer LP com movimento (GSAP + ScrollTrigger + Lenis
+ guard de reduced-motion):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js"></script>
<script>
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // acessibilidade: mostra tudo parado, sem animação
    document.querySelectorAll('[data-reveal]').forEach(function(el){ el.style.opacity = 1; });
  } else {
    gsap.registerPlugin(ScrollTrigger);

    // scroll suave ligado ao ScrollTrigger
    var lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);

    // CENA COM PIN + SCRUB (o "objeto herói que cresce")
    var tl = gsap.timeline({
      scrollTrigger: { trigger: '#hero', start: 'top top', end: '+=1600', scrub: true, pin: true, anticipatePin: 1 }
    });
    tl.to('#heroi', { scale: 1.9, ease: 'none' }, 0);
    // ...adicione mais transformações na mesma timeline, todas com ease:'none'

    // REVEAL: qualquer coisa que deva subir e aparecer ao entrar na tela
    gsap.utils.toArray('[data-reveal]').forEach(function (el) {
      gsap.from(el, { scrollTrigger: { trigger: el, start: 'top 85%' }, y: 50, opacity: 0, duration: 0.7, ease: 'power2.out' });
    });
  }
</script>
```

Regras do starter:
- Dentro de uma timeline com `scrub`, use sempre `ease: 'none'` (o "ease" vira o
  próprio ritmo do scroll da pessoa).
- `end: '+=1600'` controla quanto de scroll a cena dura; ajuste ao gosto.
- Ative `will-change: transform` (ou `opacity`) só nos elementos animados.
- Em telas estreitas, reduza distâncias/zoom ou troque a cena por uma versão
  simples: `if (window.innerWidth < 768) { ... }`.

## Onde isto se encaixa na Fábrica
Esta skill é o padrão de qualidade visual da geração. Quando o Estúdio for gerar
ou incrementar uma LP, esta skill entra junto com a de escrita humanizada: uma
cuida do texto que vende, a outra do movimento que impressiona. As duas juntas =
a régua nova.
