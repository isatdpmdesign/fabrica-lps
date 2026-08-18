/**
 * editor.js — injetado dentro da landing page quando o preview abre em modo edição.
 * Conversa com o Estúdio (janela de fora) por postMessage.
 *
 * A lógica é a do Figma, traduzida para HTML: selecionar (com Shift para vários),
 * agrupar em autolayout (Shift+A), redimensionar pelas alças, girar, duplicar,
 * subir para o pai (Esc) e entrar no filho (Enter).
 */
(function () {
  const enviar = (m) => parent.postMessage(Object.assign({ fonte: "editor-lp" }, m), "*");
  const avisar = (t) => enviar({ tipo: "aviso", texto: t });
  let sels = [], modo = "off";
  const alvoPrincipal = () => sels[sels.length - 1] || null;

  const css = document.createElement("style");
  css.textContent = `
    [data-ed-hover]{outline:1.5px dashed rgba(234,88,12,.7)!important;outline-offset:1px!important}
    [data-ed-sel]{outline:1.5px solid rgba(234,88,12,.55)!important;outline-offset:1px!important}
    [data-ed-main]{outline:2px solid #ea580c!important}
    [contenteditable="true"]{cursor:text!important}
    [contenteditable="true"]:focus{outline:2px solid #ea580c!important;outline-offset:2px!important}
    #ed-ui{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
    #ed-ui .h{position:fixed;width:11px;height:11px;margin:-6px 0 0 -6px;border:1.5px solid #ea580c;
      background:#fff;border-radius:2px;pointer-events:auto;box-shadow:0 1px 2px rgba(0,0,0,.2)}
    #ed-ui .h[data-h="e"],#ed-ui .h[data-h="w"]{cursor:ew-resize}
    #ed-ui .h[data-h="s"],#ed-ui .h[data-h="n"]{cursor:ns-resize}
    #ed-ui .h[data-h="se"]{cursor:nwse-resize}
    #ed-ui .h[data-h="rot"]{border-radius:50%;cursor:grab;border-color:#0ea5e9}
    #ed-ui .tag{position:fixed;transform:translateY(-100%);background:#ea580c;color:#fff;font:600 10px/1.6 system-ui;
      padding:0 6px;border-radius:4px 4px 0 0;white-space:nowrap}
    #ed-ui .linha{position:fixed;display:none;background:#0ea5e9;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
    [data-ed-arrastando]{opacity:.4!important;cursor:grabbing!important}`;
  document.head.appendChild(css);

  const editavel = (el) => el && el.children.length === 0 && (el.textContent || "").trim().length > 0;
  const secao = (el) => (el && el.closest ? el.closest("[data-bloco]") : null);
  const doEditor = (el) => !!(el && el.closest && el.closest("#ed-ui"));
  // um SVG é tratado como um elemento só (não seleciona as formas de dentro)
  const normal = (el) => (el && el.closest && el.closest("svg")) || el;
  const raiz = (el) => !!(el && el.dataset && el.dataset.bloco !== undefined);

  /** Tira as marcas do editor antes de devolver o HTML da seção. */
  function limpar(node) {
    const c = node.cloneNode(true);
    ["contenteditable", "data-ed-hover", "data-ed-sel", "data-ed-main"].forEach((a) => {
      c.querySelectorAll("[" + a + "]").forEach((x) => x.removeAttribute(a));
      c.removeAttribute(a);
    });
    return c.outerHTML;
  }
  function salvarSecao(el) {
    const s = secao(el); if (!s) return;
    enviar({ tipo: "bloco-mudou", bloco: s.dataset.bloco, html: limpar(s) });
  }
  /* ajustes seguidos (arrastar a cor, por exemplo) viram uma versão só */
  let tSalvar;
  const salvarDepois = (fn) => { clearTimeout(tSalvar); tSalvar = setTimeout(fn, 700); };
  const salvarTudo = () => {
    const feitas = new Set();
    sels.forEach((e) => { const s = secao(e); if (s && !feitas.has(s)) { feitas.add(s); salvarSecao(e); } });
  };

  /* ---- desfazer / refazer (histórico das edições manuais) ---- */
  const pilhaUndo = [], pilhaRedo = [];
  let ultimoMarco = 0, ultimoTipo = "";
  const snapDe = (secs) => ({ itens: [...secs].map((s) => ({ bloco: s.dataset.bloco, html: limpar(s) })) });
  /** Guarda o estado das seções afetadas antes de uma mudança. */
  function marco(tipo, extraSecs) {
    const secs = new Set(extraSecs || []);
    sels.forEach((e) => { const s = secao(e); if (s) secs.add(s); });
    if (!secs.size) return;
    const agora = Date.now();
    // mudanças rápidas do mesmo tipo (arrastar a cor/slider) viram um marco só
    if (tipo && tipo === ultimoTipo && agora - ultimoMarco < 1000) { ultimoMarco = agora; return; }
    ultimoMarco = agora; ultimoTipo = tipo || "";
    pilhaUndo.push(snapDe(secs));
    if (pilhaUndo.length > 60) pilhaUndo.shift();
    pilhaRedo.length = 0;
  }
  function restaurar(snap) {
    snap.itens.forEach((it) => {
      const atual = document.querySelector(`[data-bloco="${it.bloco}"]`);
      if (!atual) return;
      const tmp = document.createElement("div"); tmp.innerHTML = it.html;
      const novo = tmp.firstElementChild; if (novo) atual.replaceWith(novo);
    });
    sels = []; pintar(); avisarSelecao();
    snap.itens.forEach((it) => { const s = document.querySelector(`[data-bloco="${it.bloco}"]`); if (s) salvarSecao(s); });
  }
  const estadoAtual = (snap) => ({ itens: snap.itens.map((it) => {
    const s = document.querySelector(`[data-bloco="${it.bloco}"]`); return { bloco: it.bloco, html: s ? limpar(s) : it.html };
  }) });
  function desfazer() {
    const e = pilhaUndo.pop(); if (!e) { avisar("nada para desfazer"); return; }
    ultimoTipo = ""; pilhaRedo.push(estadoAtual(e)); restaurar(e); avisar("desfeito ↩");
  }
  function refazer() {
    const e = pilhaRedo.pop(); if (!e) { avisar("nada para refazer"); return; }
    ultimoTipo = ""; pilhaUndo.push(estadoAtual(e)); restaurar(e); avisar("refeito ↪");
  }

  const hex = (c) => { const m = (c || "").match(/\d+/g); return m ? "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("") : ""; };
  const grausDe = (el) => {
    const t = el.style.transform || "";
    const m = /rotate\(([-\d.]+)deg\)/.exec(t);
    return m ? parseFloat(m[1]) : 0;
  };
  function propriedades(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      classe: typeof el.className === "string" ? el.className.split(" ").filter(Boolean)[0] || "" : "",
      bloco: (secao(el) || {}).dataset ? secao(el).dataset.bloco : null,
      texto: editavel(el), imagem: el.tagName === "IMG",
      w: Math.round(r.width), h: Math.round(r.height),
      largura: el.style.width || "", altura: el.style.height || "", giro: grausDe(el),
      fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight,
      fonte: (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim(),
      cor: hex(cs.color), fundo: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "" : hex(cs.backgroundColor),
      alinhamento: cs.textAlign, entrelinha: cs.lineHeight === "normal" ? "" : Math.round(parseFloat(cs.lineHeight)),
      padding: cs.padding, radius: parseFloat(cs.borderTopLeftRadius) || 0,
      padX: Math.round(parseFloat(cs.paddingLeft) || 0), padY: Math.round(parseFloat(cs.paddingTop) || 0),
      display: cs.display, direcao: cs.flexDirection, gap: parseFloat(cs.gap) || 0,
      alinhaItens: cs.alignItems, justifica: cs.justifyContent, clip: cs.overflow === "hidden",
      flex: cs.display === "flex" || cs.display === "inline-flex",
      grupo: el.dataset.auto !== undefined,
      filhos: el.children.length,
      vidro: lerVidro(el),
    };
  }

  /* ---- efeito vidro (glassmorphism) ---- */
  const VIDRO_PADRAO = { luzAng: 45, luzInt: 80, refr: 40, prof: 20, disp: 31, gelo: 44, splay: 21 };
  function lerVidro(el) {
    if (el.dataset.vidro === undefined) return null;
    try { return Object.assign({}, VIDRO_PADRAO, JSON.parse(el.dataset.vidro || "{}")); }
    catch { return Object.assign({}, VIDRO_PADRAO); }
  }
  function aplicarVidro(el, v) {
    if (!v) {
      delete el.dataset.vidro;
      ["background", "backdropFilter", "webkitBackdropFilter", "border", "boxShadow"].forEach((k) => (el.style[k] = ""));
      return;
    }
    const a = (v.luzAng * Math.PI) / 180, ix = Math.cos(a), iy = Math.sin(a);
    const luz = v.luzInt / 100;
    const bgA = (0.05 + luz * 0.22).toFixed(3);          // translucidez do fundo
    const bordaA = (0.25 + luz * 0.5).toFixed(3);         // brilho da borda
    const blur = (v.gelo * 0.4).toFixed(1);               // "gelo" = desfoque do fundo
    const sat = Math.round(100 + v.refr * 1.4);           // "refração" = saturação/vivacidade
    const bri = Math.round(100 + v.refr * 0.25);
    const sombra = `0 ${(v.prof * 0.6).toFixed(0)}px ${(v.prof * 1.4).toFixed(0)}px ${(v.splay * 0.2).toFixed(0)}px rgba(15,23,42,${(0.10 + v.prof / 300).toFixed(3)})`;
    const brilho = `inset ${(ix * 1.5).toFixed(1)}px ${(iy * 1.5).toFixed(1)}px ${(2 + v.disp * 0.12).toFixed(1)}px rgba(255,255,255,${(luz * 0.6).toFixed(2)})`;
    const contra = `inset ${(-ix * 1.5).toFixed(1)}px ${(-iy * 1.5).toFixed(1)}px ${(2 + v.disp * 0.12).toFixed(1)}px rgba(15,23,42,${(luz * 0.12).toFixed(2)})`;
    const anel = `inset 0 0 ${(v.disp * 0.25).toFixed(1)}px rgba(255,255,255,.18)`;
    const f = `blur(${blur}px) saturate(${sat}%) brightness(${bri}%)`;
    el.style.background = `rgba(255,255,255,${bgA})`;
    el.style.backdropFilter = f; el.style.webkitBackdropFilter = f;
    el.style.border = `1px solid rgba(255,255,255,${bordaA})`;
    el.style.boxShadow = [sombra, brilho, contra, anel].join(", ");
    el.dataset.vidro = JSON.stringify(v);
  }
  const contar = () => sels.length;
  function avisarSelecao() {
    const el = alvoPrincipal();
    enviar({ tipo: "selecionou", props: el ? propriedades(el) : null, quantos: contar() });
    desenharUI();
  }

  /* ---- seleção ---- */
  function pintar() {
    document.querySelectorAll("[data-ed-sel],[data-ed-main]").forEach((x) => { x.removeAttribute("data-ed-sel"); x.removeAttribute("data-ed-main"); });
    sels.forEach((e) => e.setAttribute("data-ed-sel", ""));
    const p = alvoPrincipal(); if (p) p.setAttribute("data-ed-main", "");
  }
  function selecionar(el, somar) {
    if (!el || doEditor(el) || el === document.body || el === document.documentElement) return;
    const antigo = alvoPrincipal();
    if (antigo && antigo !== el && antigo.getAttribute("contenteditable")) desligarTexto(antigo);
    if (somar) {
      const i = sels.indexOf(el);
      if (i > -1) sels.splice(i, 1); else sels.push(el);
    } else sels = [el];
    pintar(); avisarSelecao();
  }
  function limparSelecao() { sels = []; pintar(); avisarSelecao(); }

  document.addEventListener("mouseover", (e) => {
    if (modo === "off" || doEditor(e.target)) return;
    document.querySelectorAll("[data-ed-hover]").forEach((x) => x.removeAttribute("data-ed-hover"));
    const alvo = modo === "secao" ? secao(e.target) : normal(e.target);
    if (alvo && !sels.includes(alvo)) alvo.setAttribute("data-ed-hover", "");
  });
  let arrastou = false;
  document.addEventListener("click", (e) => {
    if (modo === "off" || doEditor(e.target)) return;
    const p = alvoPrincipal();
    if (p && p.getAttribute("contenteditable") === "true" && p.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (arrastou) { arrastou = false; return; }   // acabou de mover: não troca a seleção
    selecionar(modo === "secao" ? secao(e.target) : normal(e.target), e.shiftKey || e.metaKey || e.ctrlKey);
  }, true);
  // duplo clique num texto edita direto (mesmo com <em>/<strong> dentro)
  const INLINE = /^(EM|STRONG|B|I|SPAN|A|U|MARK|SMALL|SUP|SUB)$/;
  const TEXTOISH = /^(H[1-6]|P|A|LI|BUTTON|BLOCKQUOTE|FIGCAPTION|LABEL|SPAN|EM|STRONG|SMALL|TD|TH)$/;
  document.addEventListener("dblclick", (e) => {
    if (modo === "off" || doEditor(e.target)) return;
    let t = normal(e.target);
    // clicou num trecho inline? sobe para o título/parágrafo que o contém
    while (t.parentElement && !raiz(t) && INLINE.test(t.tagName) && TEXTOISH.test(t.parentElement.tagName)) t = t.parentElement;
    if ((t.textContent || "").trim() && TEXTOISH.test(t.tagName)) {
      e.preventDefault(); e.stopPropagation(); selecionar(t); marco("texto", [secao(t)]); ligarTexto(t);
    }
  }, true);

  function ligarTexto(el) {
    el.setAttribute("contenteditable", "true"); el.focus();
    el.addEventListener("blur", () => { desligarTexto(el); salvarSecao(el); }, { once: true });
  }
  const desligarTexto = (el) => el.removeAttribute("contenteditable");

  /* ---- alças de tamanho e giro (overlay) ---- */
  const ui = document.createElement("div");
  ui.id = "ed-ui";
  ui.innerHTML = ["n", "s", "e", "w", "se", "rot"].map((h) => `<div class="h" data-h="${h}"></div>`).join("") + '<div class="tag"></div>';
  const pegarUI = () => { if (!ui.isConnected) document.body.appendChild(ui); };

  function desenharUI() {
    pegarUI();
    const el = alvoPrincipal();
    const partes = ui.querySelectorAll(".h,.tag");
    if (!el || modo === "off" || !el.isConnected) { partes.forEach((h) => (h.style.display = "none")); return; }
    const r = el.getBoundingClientRect();
    const pos = { n: [r.left + r.width / 2, r.top], s: [r.left + r.width / 2, r.bottom],
      e: [r.right, r.top + r.height / 2], w: [r.left, r.top + r.height / 2],
      se: [r.right, r.bottom], rot: [r.right + 16, r.top - 16] };
    ui.querySelectorAll(".h").forEach((h) => {
      const [x, y] = pos[h.dataset.h];
      h.style.display = "block"; h.style.left = x + "px"; h.style.top = y + "px";
    });
    const tag = ui.querySelector(".tag");
    tag.style.display = "block"; tag.style.left = r.left + "px"; tag.style.top = Math.max(12, r.top) + "px";
    const g = grausDe(el);
    tag.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}${g ? " · " + Math.round(g) + "°" : ""}${sels.length > 1 ? " · " + sels.length + " selecionados" : ""}`;
  }
  addEventListener("scroll", desenharUI, true);
  addEventListener("resize", desenharUI);

  ui.addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest(".h"); if (!h) return;
    const el = alvoPrincipal(); if (!el) return;
    ev.preventDefault(); ev.stopPropagation();
    marco("tamanho");
    h.setPointerCapture(ev.pointerId);
    const r0 = el.getBoundingClientRect();
    const larguraPai = (el.parentElement || document.body).getBoundingClientRect().width || 1;
    const centro = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    const giro0 = grausDe(el);
    const ang0 = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x) * 180 / Math.PI;
    const tipo = h.dataset.h;

    const mover = (e) => {
      if (tipo === "rot") {
        const ang = Math.atan2(e.clientY - centro.y, e.clientX - centro.x) * 180 / Math.PI;
        let g = giro0 + (ang - ang0);
        if (e.shiftKey) g = Math.round(g / 15) * 15;
        el.style.transform = (el.style.transform || "").replace(/rotate\([-\d.]+deg\)/, "").trim() + ` rotate(${g.toFixed(1)}deg)`;
      } else {
        if (tipo === "e" || tipo === "se" || tipo === "w") {
          const larg = tipo === "w" ? r0.right - e.clientX : e.clientX - r0.left;
          let pc = Math.max(4, Math.min(100, (larg / larguraPai) * 100));
          if (e.shiftKey) pc = Math.round(pc / 5) * 5;
          el.style.width = pc.toFixed(1) + "%";
        }
        if (tipo === "s" || tipo === "se" || tipo === "n") {
          const alt = tipo === "n" ? r0.bottom - e.clientY : e.clientY - r0.top;
          let px = Math.max(8, alt);
          if (e.shiftKey) px = Math.round(px / 8) * 8;
          el.style.height = Math.round(px) + "px";
        }
      }
      desenharUI();
    };
    const soltar = () => {
      h.removeEventListener("pointermove", mover);
      h.removeEventListener("pointerup", soltar);
      avisarSelecao(); salvarSecao(el);
    };
    h.addEventListener("pointermove", mover);
    h.addEventListener("pointerup", soltar);
  });

  /* ---- arrastar o elemento na própria página para mudar a ordem ---- */
  const linha = document.createElement("div");
  linha.className = "linha";
  let arraste = null;

  const emFila = (cont) => {
    const cs = getComputedStyle(cont);
    return (cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection.startsWith("row");
  };

  /** Onde o elemento arrastado cairia: um irmão de referência e antes/depois dele. */
  function destino(x, y) {
    const el = arraste.el, sec = secao(el);
    el.style.pointerEvents = "none";
    let sob = document.elementFromPoint(x, y);
    el.style.pointerEvents = "";
    if (!sob || doEditor(sob) || el.contains(sob) || !sec || secao(sob) !== sec) return null;

    // caiu no vazio de um container: pega o filho mais perto do ponteiro
    if (sob.children.length && ![...sob.children].some((c) => c === el)) {
      const filhos = [...sob.children].filter((c) => c !== el && !c.contains(el) && !doEditor(c));
      if (filhos.length && !filhos.includes(sob)) {
        let perto = null, dist = Infinity;
        filhos.forEach((c) => {
          const r = c.getBoundingClientRect();
          const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
          if (d < dist) { dist = d; perto = c; }
        });
        if (perto && !perto.contains(sob)) sob = perto;
      }
    }

    let ref = sob;
    while (ref && ref !== sec && ref.parentElement && (el.contains(ref) || ref === el)) ref = ref.parentElement;
    if (!ref || ref === el || el.contains(ref) || ref === sec || raiz(ref)) return null;
    const cont = ref.parentElement;
    if (!cont || el.contains(cont)) return null;

    const r = ref.getBoundingClientRect();
    const antes = emFila(cont) ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
    return { ref, cont, antes, fila: emFila(cont) };
  }

  function marcarDestino(d) {
    pegarUI();
    if (!ui.contains(linha)) ui.appendChild(linha);
    ui.querySelectorAll(".h,.tag").forEach((h) => (h.style.display = "none"));
    if (!d) { linha.style.display = "none"; return; }
    const r = d.ref.getBoundingClientRect();
    linha.style.display = "block";
    if (d.fila) {
      linha.style.left = (d.antes ? r.left - 2 : r.right) + "px";
      linha.style.top = r.top + "px";
      linha.style.width = "3px"; linha.style.height = r.height + "px";
    } else {
      linha.style.left = r.left + "px";
      linha.style.top = (d.antes ? r.top - 2 : r.bottom) + "px";
      linha.style.width = r.width + "px"; linha.style.height = "3px";
    }
  }

  document.addEventListener("pointerdown", (e) => {
    if (modo === "off" || doEditor(e.target) || e.button !== 0) return;
    const alvo = modo === "secao" ? secao(e.target) : normal(e.target);
    if (!alvo || raiz(alvo) || alvo === document.body || alvo.getAttribute("contenteditable") === "true") return;
    if (!alvo.parentElement || alvo.parentElement.children.length < 2) return;
    // seleciona já no apertar, como no Figma (sem desfazer uma seleção múltipla)
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !sels.includes(alvo)) selecionar(alvo);
    arraste = { el: alvo, x0: e.clientX, y0: e.clientY, ativo: false, destino: null };
  }, true);

  document.addEventListener("pointermove", (e) => {
    if (!arraste) return;
    if (!arraste.ativo) {
      if (Math.hypot(e.clientX - arraste.x0, e.clientY - arraste.y0) < 6) return;
      arraste.ativo = true;
      arraste.el.setAttribute("data-ed-arrastando", "");
      document.body.style.userSelect = "none";
    }
    arraste.destino = destino(e.clientX, e.clientY);
    marcarDestino(arraste.destino);
  }, true);

  const soltarArraste = () => {
    if (!arraste) return;
    const a = arraste; arraste = null;
    linha.style.display = "none";
    document.body.style.userSelect = "";
    a.el.removeAttribute("data-ed-arrastando");
    if (!a.ativo) return;
    arrastou = true;
    const d = a.destino;
    if (!d) { avisar("solte sobre outro elemento da mesma seção"); desenharUI(); return; }
    marco("mover", [secao(a.el)]);
    if (d.antes) d.cont.insertBefore(a.el, d.ref); else d.ref.after(a.el);
    sels = [a.el]; pintar(); avisarSelecao(); salvarSecao(a.el);
    avisar("elemento movido");
  };
  document.addEventListener("pointerup", soltarArraste, true);
  document.addEventListener("pointercancel", soltarArraste, true);

  /* ---- comandos de estrutura ---- */
  function agrupar() {
    const itens = sels.filter((e) => e.isConnected);
    if (!itens.length) return avisar("selecione um ou mais elementos primeiro");
    if (itens.some(raiz)) return avisar("a seção inteira não pode virar grupo — selecione o que está dentro dela");
    const pai = itens[0].parentElement;
    if (!itens.every((e) => e.parentElement === pai)) return avisar("os elementos precisam estar no mesmo nível para virar um grupo");
    marco("estrutura");
    const ordenados = [...pai.children].filter((c) => itens.includes(c));
    const g = document.createElement("div");
    g.setAttribute("data-auto", "");
    g.style.cssText = "display:flex;flex-direction:column;gap:12px;align-items:stretch";
    pai.insertBefore(g, ordenados[0]);
    ordenados.forEach((c) => g.appendChild(c));
    sels = [g]; pintar(); avisarSelecao(); salvarSecao(g);
    avisar("agrupado em autolayout — ajuste direção, espaço e alinhamento no painel");
  }
  function desagrupar() {
    const el = alvoPrincipal(); if (!el) return;
    const g = el.dataset.auto !== undefined ? el : el.closest("[data-auto]");
    if (!g || raiz(g)) return avisar("selecione um grupo para desfazer");
    marco("estrutura");
    const pai = g.parentElement, filhos = [...g.children];
    filhos.forEach((c) => pai.insertBefore(c, g));
    g.remove();
    sels = filhos; pintar(); avisarSelecao();
    salvarSecao(pai); avisar("grupo desfeito");
  }
  function duplicar() {
    marco("estrutura");
    const novos = [];
    sels.forEach((el) => {
      if (raiz(el)) return;
      const c = el.cloneNode(true);
      ["data-ed-sel", "data-ed-main", "data-ed-hover"].forEach((a) => c.removeAttribute(a));
      el.after(c); novos.push(c);
    });
    if (!novos.length) return avisar("nada para duplicar");
    sels = novos; pintar(); avisarSelecao(); salvarTudo();
  }
  function apagar() {
    marco("estrutura");
    const pais = new Set();
    sels.forEach((el) => { const s = secao(el); if (raiz(el) || !s) return; pais.add(s); el.remove(); });
    sels = []; pintar(); avisarSelecao();
    pais.forEach((s) => enviar({ tipo: "bloco-mudou", bloco: s.dataset.bloco, html: limpar(s) }));
  }
  const subir = () => { const el = alvoPrincipal(); if (el && el.parentElement && !raiz(el)) selecionar(el.parentElement); };
  const entrar = () => { const el = alvoPrincipal(); if (el && el.children[0]) selecionar(el.children[0]); };

  /* ---- teclado (dentro da página) ---- */
  document.addEventListener("keydown", (e) => {
    if (modo === "off") return;
    const p = alvoPrincipal();
    if (p && p.getAttribute("contenteditable") === "true") { if (e.key === "Escape") { desligarTexto(p); salvarSecao(p); } return; }
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? refazer() : desfazer(); return; }
    if (cmd && e.key.toLowerCase() === "y") { e.preventDefault(); refazer(); return; }
    if (e.shiftKey && !cmd && e.key.toLowerCase() === "a") { e.preventDefault(); agrupar(); return; }
    if (cmd && e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); desagrupar(); return; }
    if (cmd && e.key.toLowerCase() === "d") { e.preventDefault(); duplicar(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { if (sels.length) { e.preventDefault(); apagar(); } return; }
    if (e.key === "Escape") { e.preventDefault(); sels.length > 1 ? limparSelecao() : subir(); return; }
    if (e.key === "Enter") { e.preventDefault(); p && editavel(p) ? ligarTexto(p) : entrar(); return; }
  });

  /* ---- comandos vindos do Estúdio ---- */
  window.addEventListener("message", (ev) => {
    const m = ev.data || {}; if (m.fonte !== "estudio") return;
    if (m.tipo === "modo") {
      modo = m.modo;
      document.querySelectorAll("[data-ed-hover]").forEach((x) => x.removeAttribute("data-ed-hover"));
      if (modo === "off") { const p = alvoPrincipal(); if (p) desligarTexto(p); sels = []; pintar(); }
      desenharUI();
      return;
    }
    if (m.tipo === "ir-bloco") {
      const s = document.querySelector(`[data-bloco="${m.bloco}"]`);
      if (s) { s.scrollIntoView({ behavior: "smooth", block: "start" }); selecionar(s); }
      return;
    }
    if (m.tipo === "desfazer") return desfazer();
    if (m.tipo === "refazer") return refazer();
    if (m.tipo === "inserir") {
      const tmp = document.createElement("div"); tmp.innerHTML = m.html;
      const node = tmp.firstElementChild; if (!node) return avisar("não consegui ler o arquivo");
      const onde = alvoPrincipal() || document.querySelector("[data-bloco]");
      if (!onde) return avisar("gere a página antes de inserir");
      marco("estrutura", [secao(onde)]);
      if (raiz(onde) || onde.children.length > 0 || m.modo === "dentro") onde.appendChild(node);
      else onde.after(node);
      selecionar(node); salvarSecao(node);
      avisar("inserido — arraste na página para posicionar");
      return;
    }
    if (m.tipo === "agrupar") return agrupar();
    if (m.tipo === "desagrupar") return desagrupar();
    if (m.tipo === "duplicar") return duplicar();
    if (m.tipo === "subir") return subir();
    if (m.tipo === "limpar-selecao") return limparSelecao();

    const alvo = alvoPrincipal(); if (!alvo) return;
    if (m.tipo === "editar-texto") { marco("texto", [secao(alvo)]); ligarTexto(alvo); return; }
    if (m.tipo === "estilo") {
      marco("estilo");
      sels.forEach((el) => Object.entries(m.estilo).forEach(([k, v]) => {
        if (v === "" || v == null) el.style.removeProperty(k); else el.style.setProperty(k, v);
      }));
      avisarSelecao(); salvarDepois(salvarTudo); return;
    }
    if (m.tipo === "fonte") {
      marco("estilo");
      sels.forEach((el) => {
        const sec = secao(el);
        if (m.familia && sec) {
          const id = "gf-" + m.familia.replace(/\W+/g, "");
          if (!sec.querySelector(`style[data-gf="${id}"]`)) {
            const st = document.createElement("style"); st.setAttribute("data-gf", id);
            st.textContent = `@import url("https://fonts.googleapis.com/css2?family=${m.familia.replace(/ /g, "+")}:wght@400;500;600;700&display=swap");`;
            sec.insertBefore(st, sec.firstChild);
          }
        }
        el.style.fontFamily = m.css || "";
      });
      avisarSelecao(); salvarDepois(salvarTudo); return;
    }
    if (m.tipo === "vidro") {
      marco("vidro");
      sels.forEach((el) => aplicarVidro(el, m.valor));
      avisarSelecao(); salvarDepois(salvarTudo); return;
    }
    if (m.tipo === "girar") {
      marco("girar");
      const base = (alvo.style.transform || "").replace(/rotate\([-\d.]+deg\)/, "").trim();
      alvo.style.transform = m.graus ? `${base} rotate(${m.graus}deg)` : base;
      avisarSelecao(); salvarDepois(()=>salvarSecao(alvo)); return;
    }
    if (m.tipo === "imagem") {
      marco("estilo");
      if (alvo.tagName === "IMG") alvo.src = m.src;
      else alvo.style.backgroundImage = `url("${m.src}")`;
      salvarSecao(alvo); return;
    }
    if (m.tipo === "remover") return apagar();
  });

  enviar({ tipo: "pronto", blocos: [...document.querySelectorAll("[data-bloco]")].map((x) => x.dataset.bloco) });
})();
