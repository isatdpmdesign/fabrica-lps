---
name: lp-com-movimento
description: >-
  Use ao criar ou incrementar QUALQUER landing page da Fábrica de LPs. O
  diferencial da Fábrica é a LP virar uma "timeline de filme": conforme a pessoa
  rola, imagens dão zoom, giram, trocam de quadro e o texto entra em cena,
  contando uma história. Esta skill ensina o alfabeto do movimento (peças
  reutilizáveis), a diferença entre GSAP e 3D, como fazer cenas com quadros-chave
  (ex.: personal virando "homem de ferro"), a receita de 3D de verdade (só quando
  vale) e um orçamento de peso obrigatório (a página tem que abrir em celular
  fraco). A pedido da Isadora, pra a Fábrica entregar na régua de mercado sem
  depender de curso e sem página pesada.
---

# LP com movimento — a timeline de filme da Fábrica

O diferencial de uma LP da Fábrica é o **movimento no scroll**: a página conta uma
história, como um filme. Isso tem que existir **sempre**, tenha ou não 3D.

Ideia central: não decore efeitos prontos. Todo efeito, por mais único que
pareça, se monta com um punhado pequeno de peças. Sabendo as peças, você monta
qualquer história a partir da descrição da Isadora.

## Regra nº 0 — PESO (a mais importante, nunca quebrar)
Página que não abre não vende. Uma LP tem que abrir rápido **em celular fraco**.
- **Sempre `webp` comprimido**, no tamanho exato que aparece na tela (nunca uma
  imagem de 4000px num espaço de 600px).
- **Poucas imagens** por efeito. Cross-fade de quadros: 3 a 6 imagens. Sequência
  cinematográfica longa: no máximo ~30–60 quadros pequenos, e só se valer muito.
- **Carregar o efeito só quando chega nele** (lazy-load abaixo da primeira dobra).
- **Meta prática:** primeira dobra leve (mire abaixo de ~2 MB somando tudo).
- **3D:** sempre comprimido (Draco), qualidade limitada no celular (ou trocado por
  uma imagem/versão simples), e **nunca travar o scroll no toque**.
- Se na dúvida entre "mais bonito" e "mais leve", escolha leve. Dá pra ser as duas
  com cuidado; peso demais não tem perdão.

## GSAP × Three.js (a distinção que resolve tudo)
- **GSAP = o coreógrafo.** Anima qualquer coisa no tempo e no scroll: zoom,
  girar, mover, trocar de quadro, aparecer/sumir. Vale pra imagem, texto, um
  `<canvas>`, qualquer elemento. É o motor do movimento em 99% dos casos.
- **ScrollTrigger** (plugin do GSAP) = liga a animação ao scroll (pin, scrub).
- **Three.js = o motor 3D.** Só entra quando existe um **modelo 3D de verdade**
  (um `.glb` que gira de qualquer ângulo, com câmera e luz). É o caso pesado.

Tradução rápida: quase tudo que parece "3D cabuloso" numa LP (produto que gira,
personagem que se transforma, cena que se monta) é feito com **imagens + GSAP**,
não com Three.js. Só use Three.js quando precisar mesmo girar um objeto em 360°
de verdade ou "andar" por dentro de uma cena.

## O alfabeto do movimento (as peças)
- **Pin (prender):** o elemento fica fixo na tela enquanto a pessoa rola.
- **Scrub (ligar ao scroll):** a animação anda amarrada ao scroll, pra frente e
  pra trás, no ritmo da pessoa.
- **Transformações:** `scale` (zoom), `x/y` (mover), `rotate` (girar),
  `opacity` (aparecer/sumir), `clip-path`/máscara (revelar por dentro).
- **Troca de quadro (o flip-book):** empilhar imagens e trocar qual aparece
  conforme o scroll. É o coração da "timeline de filme".
- **Profundidade / "entrar em algo":** `scale` grande + perspectiva + parallax
  entre camadas.
- **Timeline (coreografia):** encadear várias transformações no tempo do scroll.
- **Parallax:** camadas em velocidades diferentes = profundidade.
- **Reveal:** elementos que sobem/aparecem ao entrar na tela (o mais barato).

## NÍVEL 1 — Timeline de filme (o padrão, leve, sempre presente)
Feito com **imagens + GSAP + ScrollTrigger**. Nenhum 3D. Abre em qualquer lugar.

### Receita: cena de quadros-chave (ex.: personal virando "homem de ferro")
1. **Gere os quadros-chave** com IA de imagem (Nano Banana / geração de imagem):
   poucas imagens que contam a transformação. Ex.: (1) o personal normal,
   (2) a armadura chegando, (3) a armadura nele. 3 a 6 imagens bastam.
   Exporte em `webp`, no tamanho da tela.
2. **Empilhe as imagens** no mesmo lugar (position absolute), todas com opacity 0
   menos a primeira.
3. **Prenda a cena (pin)** e, com **scrub**, faça o cross-fade: conforme rola, a
   imagem 1 some e a 2 aparece, depois a 2 some e a 3 aparece. Um leve `scale`
   junto dá peso cinematográfico. O texto entra na frente com reveal.
4. Pronto: é um flip-book que conta a transformação no scroll. Leve (só imagens),
   funciona em qualquer aparelho.

> Variante "cinema" (produto girando 360°, passear por um cenário sem 3D): mesma
> ideia, porém com muitos quadros desenhados num `<canvas>` conforme o scroll
> (técnica da Apple). Só use se 3–6 imagens não bastarem; pré-carregue os quadros
> e mantenha cada um pequeno (regra nº 0).

Outras cenas do Nível 1: objeto herói que dá zoom no scroll (ver
`exemplos/loja-moveis.html`), seções que se revelam, parallax entre camadas,
storytelling com pin.

## NÍVEL 2 — 3D de verdade (a exceção, pesado, só quando vale)
Use **Three.js** (ou react-three-fiber num projeto à parte) só quando precisar
girar um objeto real em 360° ou "andar" por uma cena. Regra nº 0 vale em dobro.

### Receita (dentro do HTML único, sem build)
1. **Consiga o modelo `.glb`:**
   - **Sketchfab** — milhares de modelos prontos e gratuitos; filtre por
     "downloadable" e baixe em **GLB**.
   - **Tripo AI** — manda uma imagem, ele gera o 3D. Use o modelo gratuito
     (v2.5 "clássico"), exporte **GLB**. Bom pra criar um objeto que não existe pronto.
2. **Comprima com Draco** (reduz ~70% do peso sem perder qualidade visível). Isso
   é obrigatório, não opcional.
3. **Carregue via CDN** (sem Astro/React): Three.js + `GLTFLoader` + `DRACOLoader`
   por `import map` no HTML. Monte cena + câmera + luz.
4. **Câmera no scroll (o "entrar no imóvel"):** a câmera percorre uma lista de
   **posições (keyframes)** conforme o scroll (scrub + pin). Cada keyframe é uma
   posição/ângulo salvos. No fluxo do curso, uma página-rascunho deixa girar e
   salvar cada posição (vira um JSON). No Estúdio, isso deve virar um painel
   **"Modo Cena"** (ver nota abaixo); enquanto não existe, ajuste os keyframes
   descrevendo ("começa vendo a casa de cima, entra pela sala, vira pro corredor…").
5. **Mobile:** limite o `devicePixelRatio` (~1.5), carregue o 3D só quando visível,
   e **nunca deixe o toque travar no modelo** (o gesto tem que rolar a página).
   Se pesar, troque o 3D por uma imagem/vídeo leve no celular.

### Nota: o "Modo Cena" no Estúdio (recurso a construir)
O que o curso resolve com uma página-rascunho (girar o 3D e salvar keyframes de
câmera) deve virar, no Estúdio, um **painel focado**: abre o modelo, você gira/dá
zoom, clica pra salvar cada posição, e ele grava o JSON no projeto. É um artefato
novo sob demanda — não é transformar o Estúdio numa IDE. Só entra quando a Fábrica
for fazer a primeira LP com 3D real.

## De onde vêm os ativos
- **Imagens / quadros-chave:** geração de IA (Nano Banana etc.), foto do cliente
  (vem no briefing), banco de imagens. Sempre webp comprimido.
- **Modelos 3D:** Sketchfab (prontos) ou Tripo AI (gerar dos seus). Formato GLB + Draco.
- **Ilustração animada leve:** Lottie (`.json` do LottieFiles/After Effects).
- **Templates do Aura Design (da Isadora):** referência de estilo; o movimento
  entra por cima com as peças acima.

## Bibliotecas (por CDN — cdnjs / jsdelivr)
- GSAP: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`
- ScrollTrigger: `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js`
- Lenis (scroll suave, opcional): `https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js`
- Three.js + loaders: por `import map` (`three`, `three/addons/loaders/GLTFLoader.js`,
  `.../DRACOLoader.js`) do jsdelivr, só no Nível 2.
- Lottie: `https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js`

## O método: da descrição da Isadora → técnica
1. **Qual é a história do scroll?** O que a pessoa sente/entende naquele trecho.
2. **É Nível 1 ou 2?** Precisa girar um objeto real em 360° / andar numa cena? →
   Nível 2 (3D). Senão → Nível 1 (imagens + GSAP). Na dúvida, é Nível 1.
3. **Quebre em peças do alfabeto.**
4. **Cheque a regra nº 0** (peso) antes de escolher quantas imagens/quadros.
5. **Monte com o starter** e ajuste os números.

## Starter — Nível 1 (cole e ajuste)
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<script>
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('[data-reveal]').forEach(function(el){ el.style.opacity = 1; });
  } else {
    gsap.registerPlugin(ScrollTrigger);

    // CENA DE QUADROS-CHAVE (flip-book no scroll): #cena tem imagens .quadro empilhadas
    var tl = gsap.timeline({
      scrollTrigger: { trigger: '#cena', start: 'top top', end: '+=2000', scrub: true, pin: true }
    });
    // troca 1->2->3 com um leve zoom; ease:'none' porque o ritmo é o scroll
    tl.to('.quadro-1', { opacity: 0, scale: 1.06, ease: 'none' }, 0.15)
      .to('.quadro-2', { opacity: 1, ease: 'none' }, 0.15)
      .to('.quadro-2', { opacity: 0, scale: 1.06, ease: 'none' }, 0.55)
      .to('.quadro-3', { opacity: 1, ease: 'none' }, 0.55)
      .fromTo('#cena-texto', { opacity: 0, y: 30 }, { opacity: 1, y: 0, ease: 'none' }, 0.7);

    // REVEAL do resto
    gsap.utils.toArray('[data-reveal]').forEach(function (el) {
      gsap.from(el, { scrollTrigger: { trigger: el, start: 'top 85%' }, y: 50, opacity: 0, duration: 0.7, ease: 'power2.out' });
    });
  }
</script>
```
Regras do starter:
- `.quadro` são `<img>` `webp` empilhados (position absolute), opacity 0 menos o primeiro.
- Dentro de timeline com `scrub`, use `ease: 'none'`.
- `end: '+=2000'` controla quanto de scroll a cena dura.
- Só anime `transform` e `opacity` (nunca width/height/top/left).

## Guardrails (além da regra nº 0)
- Movimento serve à história, nunca é enfeite.
- Respeite `prefers-reduced-motion` (mostre tudo parado).
- Teste no celular e num aparelho fraco antes de entregar.
- 3D é exceção; imagem + GSAP é o padrão.

## Onde isto se encaixa na Fábrica
Padrão de qualidade da geração. Junto com a skill de escrita humanizada: uma cuida
do texto que vende, a outra do movimento que prende. As duas = a régua nova.
