# Cinematográfico — design system

**Resumo:** a LP vira uma timeline de filme. Cenas em tela cheia, imagens que dão zoom e giram no scroll, texto que entra em cena. Alto padrão com movimento.
**Melhor para:** alto padrão, imóveis e arquitetura, produtos-herói, moda e automotivo.
> Combine com a skill **lp-com-movimento** — este estilo é a linguagem visual; a skill é a técnica do movimento.

## Paleta
- Fundo: `#050505` (preto cinema) — imersivo, escuro.
- Texto: `#f5f5f5`; legendas `#9a9a9a`.
- Destaque: `#c0a062` (dourado sóbrio) para fios, CTA e detalhes.
- Apoio: `#1a1a1a` para camadas e overlays.

## Tipografia
- Títulos: display forte — `Cormorant Garamond` (luxo) OU `Archivo`/`Anton` (impacto), escolha conforme a marca.
- Corpo: sans limpa — `Inter` (400), em pouca quantidade — aqui a imagem fala.
- Escala grande de cena: h1 `clamp(44px, 8vw, 110px)`, line-height 1; texto de apoio pequeno e espaçado.

## Layout & espaçamento
- Seções em **tela cheia** (100vh) que se sucedem como quadros de um filme.
- Imagem/vídeo cobre o fundo (`object-fit:cover`); overlay escuro para o texto respirar.
- Texto ancorado num canto, entra conforme a cena.

## Componentes
- Botão: outline fino dourado ou texto com fio embaixo; discreto, elegante.
- Sem cards coloridos — o conteúdo mora sobre as cenas.
- Indicador de scroll sutil ("role para continuar").

## Movimento (o coração deste estilo)
- Pin + scrub: a cena fixa enquanto a imagem dá **zoom lento**, gira levemente ou troca de quadro (cross-fade de webp).
- Texto entra por linha (mask reveal) sincronizado ao scroll.
- Parallax de camadas (fundo mais lento que o texto).
- **Peso obrigatório:** webp comprimido, poucas imagens, lazy-load; no mobile simplifique (menos parallax, sem travar o scroll no toque). Nunca vídeo pesado que trave celular fraco.

## Faça / Não faça
- ✅ Uma cena = uma ideia; movimento a serviço da história.
- ✅ Fotografia/arte de altíssima qualidade; preto + dourado + branco.
- ❌ Não encha de texto; não use degradê colorido nem cards de vidro.
- ❌ Não sacrifique o peso: se travar no celular, simplifique o movimento.
