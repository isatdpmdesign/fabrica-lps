/**
 * post-canvas.js — a prancheta do editor de Posts (injetado no post.html quando abre com ?editar=1).
 *
 * O post é UMA prancheta (<div data-prancheta>) com N telas lado a lado, cortada a cada
 * data-w px (como os slices do Figma). Os elementos ficam soltos dentro dela (position:absolute)
 * e podem atravessar o corte entre duas telas.
 *
 * Aqui mora o que é "do canvas": zoom e pan, os cortes, selecionar (clique, Shift, laço),
 * arrastar/redimensionar/girar com guias inteligentes (Moveable), editar texto no lugar,
 * desenhar texto e formas, desfazer/refazer. Toda a interface (barra flutuante, degradê,
 * camadas, chat) fica no Estúdio, do lado de fora: ele chama window.ED e ouve postCanvasEvento.
 */
(function () {
  "use strict";
  const doc = document, win = window;
  const P = (() => { try { return win.parent !== win ? win.parent : null; } catch (e) { return null; } })();
  const avisar = (m) => { try { P && P.postCanvasEvento && P.postCanvasEvento(m); } catch (e) {} };

  /* ---------- 1. normaliza o documento numa prancheta ---------- */
  let pr = doc.querySelector("[data-prancheta]");
  if (!pr) {
    // posts antigos: telas empilhadas (<section class="tela">) viram uma prancheta horizontal
    const telas = Array.from(doc.querySelectorAll(".tela"));
    pr = doc.createElement("div");
    pr.setAttribute("data-prancheta", "");
    const w0 = (telas[0] && telas[0].offsetWidth) || 1080, h0 = (telas[0] && telas[0].offsetHeight) || 1350;
    pr.dataset.w = w0; pr.dataset.h = h0; pr.dataset.telas = Math.max(1, telas.length);
    (telas[0] ? telas[0].parentNode : doc.body).insertBefore(pr, telas[0] || null);
    telas.forEach((t, i) => {
      t.style.position = "absolute"; t.style.left = i * w0 + "px"; t.style.top = "0px"; t.style.margin = "0";
      if (!t.dataset.camada) t.dataset.camada = "Tela " + (i + 1);
      pr.appendChild(t);
    });
  }
  let W = +pr.dataset.w || 1080, H = +pr.dataset.h || 1350;
  let N = Math.max(1, +pr.dataset.telas || Math.round(pr.offsetWidth / W) || 1);
  function medidasPrancheta() {
    pr.style.position = "relative"; pr.style.width = N * W + "px"; pr.style.height = H + "px"; pr.style.overflow = "hidden";
    pr.dataset.w = W; pr.dataset.h = H; pr.dataset.telas = N;
  }
  medidasPrancheta();

  /* ---------- 2. a "mesa": viewport com zoom/pan, guias dos cortes e camada de interface ---------- */
  // o que o PNG mostra onde a prancheta não tem fundo: o fundo do <body> (a mesa do editor não pode aparecer ali)
  const fundoCorpo = (() => { const c = getComputedStyle(doc.body).backgroundColor; return !c || /rgba\(0, 0, 0, 0\)|transparent/.test(c) ? "#ffffff" : c; })();
  const css = doc.createElement("style");
  css.setAttribute("data-pc", "");
  css.textContent = `
    html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;
      background:var(--pc-mesa) radial-gradient(circle,var(--pc-ponto) 1px,transparent 1.3px) 0 0/22px 22px!important}
    html{--pc-mesa:#120a11;--pc-ponto:rgba(255,255,255,.06);--pc-acento:#ff3d9a;--pc-txt:#a98498;--pc-txt-on:#ffb3d6}
    html[data-pc-tema="claro"]{--pc-mesa:#efeaee;--pc-ponto:rgba(0,0,0,.09);--pc-acento:#d12b6d;--pc-txt:#8a6b7e;--pc-txt-on:#b0205c}
    #pc-vp{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
    #pc-vp>[data-prancheta]{box-shadow:0 30px 90px rgba(0,0,0,.45)}
    .pc-fatia{position:absolute;top:0;pointer-events:none;visibility:hidden}
    #pc-over{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:700 11px/1 Raleway,system-ui,sans-serif}
    #pc-over .corte{position:absolute;width:0;border-left:1.5px dashed var(--pc-txt-on);opacity:.75}
    #pc-over .rot{position:absolute;color:var(--pc-txt);letter-spacing:.06em;white-space:nowrap;display:flex;gap:6px;align-items:center}
    #pc-over .rot.on{color:var(--pc-txt-on)}
    #pc-over .rot i{font-style:normal;opacity:.8}
    #pc-over .hover{position:absolute;border:1.5px solid var(--pc-acento);opacity:.75;border-radius:1px}
    #pc-over .laco{position:absolute;border:1px solid var(--pc-acento);background:color-mix(in srgb,var(--pc-acento) 12%,transparent)}
    #pc-over .escopo{position:absolute;border:1px dashed var(--pc-acento);opacity:.5}
    #pc-over .editando{position:absolute;border:2px solid var(--pc-acento);border-radius:2px}
    #pc-over .desenho{position:absolute;border:1.5px solid var(--pc-acento);background:color-mix(in srgb,var(--pc-acento) 14%,transparent)}
    .moveable-control-box{--moveable-color:var(--pc-acento)!important;z-index:2147482000!important}
    .moveable-control-box .moveable-control{width:10px!important;height:10px!important;margin-top:-5px!important;margin-left:-5px!important;
      border-radius:2px!important;background:#fff!important;border:1.5px solid var(--pc-acento)!important;box-shadow:0 1px 3px rgba(0,0,0,.35)}
    .moveable-control-box .moveable-line{background:var(--pc-acento)!important}
    .moveable-control-box .moveable-guideline{background:var(--pc-acento)!important}
    .moveable-control-box .moveable-size-value,.moveable-control-box .moveable-gap{color:var(--pc-acento)!important}
    .pc-dim{position:absolute;white-space:nowrap;background:var(--pc-acento);color:#1b0e1a;font:700 11px/1 Raleway,system-ui,sans-serif;
      padding:4px 7px;border-radius:5px;transform:translate(-50%,0);pointer-events:none}
    [data-pc-editando]{outline:none!important;cursor:text!important}
    [data-pc-oculto]{visibility:hidden!important}
    body.pc-mao,body.pc-mao *{cursor:grab!important} body.pc-arrastando-vista,body.pc-arrastando-vista *{cursor:grabbing!important}
    body.pc-cruz,body.pc-cruz *{cursor:crosshair!important}
    body.pc-cursor-texto,body.pc-cursor-texto *{cursor:text!important}`;
  doc.head.appendChild(css);

  const vp = doc.createElement("div"); vp.id = "pc-vp"; vp.setAttribute("data-pc", ""); vp.style.background = fundoCorpo;
  pr.parentNode.insertBefore(vp, pr); vp.appendChild(pr);
  const guiasBox = doc.createElement("div"); guiasBox.setAttribute("data-pc", ""); vp.appendChild(guiasBox);
  const over = doc.createElement("div"); over.id = "pc-over"; over.setAttribute("data-pc", ""); doc.body.appendChild(over);
  const hoverBox = doc.createElement("div"); hoverBox.className = "hover"; hoverBox.style.display = "none"; over.appendChild(hoverBox);
  const escopoBox = doc.createElement("div"); escopoBox.className = "escopo"; escopoBox.style.display = "none"; over.appendChild(escopoBox);
  const editBox = doc.createElement("div"); editBox.className = "editando"; editBox.style.display = "none"; over.appendChild(editBox);
  const cortesBox = doc.createElement("div"); over.appendChild(cortesBox);

  function montarGuias() {
    // uma "fatia" invisível por tela: o Moveable gruda nas bordas e no centro de cada tela
    guiasBox.innerHTML = "";
    for (let i = 0; i < N; i++) {
      const f = doc.createElement("div"); f.className = "pc-fatia";
      f.style.cssText = `left:${i * W}px;width:${W}px;height:${H}px`;
      guiasBox.appendChild(f);
    }
  }
  montarGuias();

  /* ---------- 3. vista: zoom e pan ---------- */
  const vista = { x: 0, y: 0, z: 0.3 };
  function aplicarVista() {
    vp.style.transform = `translate(${vista.x}px,${vista.y}px) scale(${vista.z})`;
    desenharCortes();
    if (mv) { try { mv.updateRect(); } catch (e) {} }
    atualizarHover(null); posicionarEscopo(); posicionarEdicao(); desenharCaneta(); desenharCorte();
    avisarSelecao(); avisar({ tipo: "vista", z: vista.z, tela: telaNoCentro() });
  }
  function ajustar() {
    const vw = win.innerWidth, vh = win.innerHeight;
    const z = Math.min((vw - 120) / (N * W), (vh - 190) / H, 1);
    vista.z = Math.max(0.04, z);
    vista.x = Math.round((vw - N * W * vista.z) / 2);
    vista.y = Math.round(Math.max(60, (vh - H * vista.z) / 2 - 30));
    aplicarVista();
  }
  function zoomEm(z, cx, cy) {
    z = Math.max(0.04, Math.min(4, z));
    if (cx == null) { cx = win.innerWidth / 2; cy = win.innerHeight / 2; }
    const ax = (cx - vista.x) / vista.z, ay = (cy - vista.y) / vista.z;
    vista.z = z; vista.x = cx - ax * z; vista.y = cy - ay * z; aplicarVista();
  }
  function irParaTela(i) {
    i = Math.max(0, Math.min(N - 1, i));
    const vw = win.innerWidth, vh = win.innerHeight;
    const z = Math.min((vw - 160) / W, (vh - 200) / H, 1);
    vista.z = z; vista.x = vw / 2 - (i * W + W / 2) * z; vista.y = Math.max(60, (vh - H * z) / 2 - 30); aplicarVista();
  }
  function telaNoCentro() {
    const ax = (win.innerWidth / 2 - vista.x) / vista.z;
    return Math.max(0, Math.min(N - 1, Math.floor(ax / W)));
  }
  function desenharCortes() {
    const z = vista.z, x0 = vista.x, y0 = vista.y, ativa = telaNoCentro();
    let h = "";
    for (let i = 1; i < N; i++)
      h += `<div class="corte" style="left:${x0 + i * W * z}px;top:${y0 - 8}px;height:${H * z + 16}px"></div>`;
    for (let i = 0; i < N; i++)
      h += `<div class="rot${i === ativa ? " on" : ""}" style="left:${x0 + i * W * z + (i ? 6 : 0)}px;top:${y0 - 22}px">${i ? "<i>✂</i>" : ""}${String(i + 1).padStart(2, "0")}${i === 0 && N > 1 ? " · CAPA" : ""}</div>`;
    cortesBox.innerHTML = h;
  }

  /* ---------- 4. o que é selecionável ---------- */
  const INLINE = /^(EM|B|STRONG|I|SPAN|BR|A|SMALL|SUP|SUB|U|S|MARK|FONT|DEL|INS|CODE)$/;
  const ehTexto = (el) => !!el && el.nodeType === 1 && !/^(IMG|SVG|VIDEO|CANVAS|IFRAME|INPUT)$/i.test(el.tagName) && (el.textContent || "").trim().length > 0
    && Array.from(el.querySelectorAll("*")).every((c) => INLINE.test(c.tagName));
  // interface do editor (o #pc-vp também é data-pc, mas é só o "trilho" da prancheta)
  const ehDoEditor = (el) => { const c = el && el.closest && el.closest("[data-pc],.moveable-control-box"); return !!c && c.id !== "pc-vp"; };
  let escopo = pr; // os filhos diretos dele são as "camadas" clicáveis
  const novoId = () => "e" + Math.random().toString(36).slice(2, 7);
  function garantirId(el) { if (el && el !== pr && !el.dataset.id) el.dataset.id = novoId(); return el && el.dataset.id; }
  function nomeDe(el) {
    if (!el) return "";
    if (el === pr) return "Prancheta";
    if (el.dataset.camada) return el.dataset.camada;
    const tag = el.tagName.toUpperCase();
    if (tag === "IMG") return "Imagem";
    if (tag === "SVG") return "Vetor";
    const t = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (t && ehTexto(el)) return t.slice(0, 30);
    if (el.children.length) return "Grupo";
    return "Forma";
  }
  const travado = (el) => !!(el && el.closest && el.closest("[data-pc-travado]") && el.closest("[data-pc-travado]") !== pr);
  // sobe a partir do alvo do clique até o filho direto do escopo atual
  function camadaDe(t, trocarEscopo) {
    if (!t || ehDoEditor(t)) return null;
    if (t.nodeType !== 1) t = t.parentElement;
    if (t && t.closest && t.closest("svg") && t.tagName.toLowerCase() !== "svg") t = t.closest("svg");
    let el = t;
    while (el && el.parentElement !== escopo) { if (el === pr || el === doc.body) return null; el = el.parentElement; }
    if (!el) {
      // clicou fora do escopo atual: volta pra prancheta e tenta de novo
      if (trocarEscopo && escopo !== pr && pr.contains(t)) { escopo = pr; posicionarEscopo(); return camadaDe(t); }
      return null;
    }
    return travado(el) ? null : el;
  }

  /* ---------- 5. Moveable (arrastar, redimensionar, girar, guias) ---------- */
  const Dimensao = {
    name: "dimensao", props: [], events: [],
    render(moveable, React) {
      const r = moveable.getRect();
      return React.createElement("div", { key: "pc-dim", className: "pc-dim", style: { left: r.width / 2 + "px", top: r.height + 14 + "px" } },
        Math.round(r.offsetWidth) + " × " + Math.round(r.offsetHeight));
    },
  };
  let sel = [], mv = null, ferramenta = "mover", editando = null, textoAntes = "";
  const elementosGuia = () => {
    const outros = Array.from(escopo.children).filter((c) => !sel.includes(c) && !c.hasAttribute("data-pc-oculto"));
    return outros.concat(Array.from(guiasBox.children), [pr]);
  };
  function posBase(el) {
    // tudo que se move usa left/top; quem estava no fluxo vira position:relative (não desloca os vizinhos)
    const cs = getComputedStyle(el);
    if (cs.position === "static") el.style.position = "relative";
    if (cs.position === "absolute" || cs.position === "fixed") {
      // ancorado pela direita/baixo: congela o tamanho antes de trocar pra left/top
      // (o computed de um absoluto sempre vem em px, então só olhamos o estilo escrito)
      const r = el.getBoundingClientRect();
      if (el.style.right && el.style.right !== "auto" && !el.style.width) el.style.width = Math.ceil(r.width / vista.z) + "px";
      if (el.style.bottom && el.style.bottom !== "auto" && !el.style.height && !ehTexto(el)) el.style.height = Math.ceil(r.height / vista.z) + "px";
      el.style.left = el.offsetLeft + "px"; el.style.top = el.offsetTop + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
    }
    return [parseFloat(el.style.left || cs.left) || 0, parseFloat(el.style.top || cs.top) || 0];
  }
  function criarMoveable() {
    mv = new win.Moveable(doc.body, {
      target: [], ables: [Dimensao], props: { dimensao: true },
      draggable: true, resizable: true, rotatable: true, snappable: true,
      rotationPosition: "none", rotateAroundControls: true, origin: false,
      throttleDrag: 0, throttleResize: 0, throttleRotate: 0, keepRatio: false,
      snapThreshold: 6, isDisplaySnapDigit: true, snapGap: true, snapDigit: 0,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      maxSnapElementGuidelineDistance: null,
    });
    let fonte0 = 0, larg0 = 0;
    mv.on("dragStart", (e) => { e.set(posBase(e.target)); avisar({ tipo: "mexendo" }); })
      .on("drag", (e) => { e.target.style.left = e.beforeTranslate[0] + "px"; e.target.style.top = e.beforeTranslate[1] + "px"; })
      .on("dragEnd", (e) => { if (e.isDrag) { soltar(e.target); aplicarSelecao(); mudou(); } else avisarSelecao(); })
      .on("dragGroupStart", (e) => { e.events.forEach((ev) => ev.set(posBase(ev.target))); avisar({ tipo: "mexendo" }); })
      .on("dragGroup", (e) => e.events.forEach((ev) => { ev.target.style.left = ev.beforeTranslate[0] + "px"; ev.target.style.top = ev.beforeTranslate[1] + "px"; }))
      .on("dragGroupEnd", (e) => { if (e.isDrag) mudou(); else avisarSelecao(); })
      .on("resizeStart", (e) => {
        const p = posBase(e.target); e.target.style.boxSizing = "border-box";
        e.setOrigin(["%", "%"]); e.dragStart && e.dragStart.set(p);
        fonte0 = parseFloat(getComputedStyle(e.target).fontSize) || 16; larg0 = e.target.offsetWidth;
        avisar({ tipo: "mexendo" });
      })
      .on("resize", (e) => {
        const t = e.target, txt = ehTexto(t);
        t.style.width = e.width + "px";
        // texto: as quinas mudam o tamanho da letra (como a ferramenta Escala do Figma); as laterais só a largura
        if (txt && e.direction[0] && e.direction[1]) t.style.fontSize = Math.max(4, Math.round(fonte0 * e.width / larg0 * 10) / 10) + "px";
        if (!txt) t.style.height = e.height + "px";
        t.style.left = e.drag.beforeTranslate[0] + "px"; t.style.top = e.drag.beforeTranslate[1] + "px";
      })
      .on("resizeEnd", (e) => {
        // dentro do auto layout quem manda na posição é o fluxo
        if (ehAuto(e.target.parentElement)) Object.assign(e.target.style, { left: "", top: "", position: "static" });
        if (e.isDrag) mudou();
      })
      .on("resizeGroupStart", (e) => { e.events.forEach((ev) => { const p = posBase(ev.target); ev.target.style.boxSizing = "border-box"; ev.dragStart && ev.dragStart.set(p); }); avisar({ tipo: "mexendo" }); })
      .on("resizeGroup", (e) => e.events.forEach((ev) => {
        ev.target.style.width = ev.width + "px"; if (!ehTexto(ev.target)) ev.target.style.height = ev.height + "px";
        ev.target.style.left = ev.drag.beforeTranslate[0] + "px"; ev.target.style.top = ev.drag.beforeTranslate[1] + "px";
      }))
      .on("resizeGroupEnd", (e) => { if (e.isDrag) mudou(); })
      .on("rotateStart", () => avisar({ tipo: "mexendo" }))
      .on("rotate", (e) => { e.target.style.transform = e.drag.transform; })
      .on("rotateEnd", (e) => { if (e.isDrag) mudou(); })
      .on("rotateGroupStart", () => avisar({ tipo: "mexendo" }))
      .on("rotateGroup", (e) => e.events.forEach((ev) => { ev.target.style.transform = ev.drag.transform; ev.target.style.left = (parseFloat(ev.target.style.left) || 0) + "px"; }))
      .on("rotateGroupEnd", (e) => { if (e.isDrag) mudou(); });
  }

  function aplicarSelecao() {
    sel = sel.filter((el) => el && el.isConnected && el !== pr || el === pr);
    sel.forEach(garantirId);
    if (!mv) return;
    const alvos = sel.filter((el) => el !== pr && el !== editando);
    const soTexto = alvos.length === 1 && ehTexto(alvos[0]);
    const img = alvos.length === 1 && alvos[0].tagName === "IMG";
    mv.keepRatio = soTexto || img || shift;
    mv.renderDirections = soTexto ? ["nw", "ne", "sw", "se", "w", "e"] : ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
    mv.elementGuidelines = elementosGuia();
    mv.target = alvos;
    try { mv.updateRect(); } catch (e) {}
    avisarSelecao();
  }
  function selecionar(lista) { if (editando) pararEdicao(); sel = lista.filter(Boolean); aplicarSelecao(); }

  /* ---------- 6. o que o Estúdio precisa saber da seleção ---------- */
  function info(el) {
    const r = el.getBoundingClientRect(), pr0 = pr.getBoundingClientRect(), cs = getComputedStyle(el), z = vista.z;
    return {
      id: el === pr ? "prancheta" : el.dataset.id, nome: nomeDe(el), tag: el.tagName.toLowerCase(),
      texto: el !== pr && ehTexto(el), img: el.tagName === "IMG", prancheta: el === pr,
      temFilhos: el !== pr && !ehTexto(el) && el.children.length > 0,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      caixa: { x: Math.round((r.left - pr0.left) / z), y: Math.round((r.top - pr0.top) / z), w: Math.round(r.width / z), h: Math.round(r.height / z) },
      estilo: {
        fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize) || 16, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
        color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
        backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage,
        clipTexto: (cs.webkitBackgroundClip || cs.backgroundClip) === "text",
        borderRadius: parseFloat(cs.borderTopLeftRadius) || 0, opacity: +cs.opacity,
      },
      oculto: el.hasAttribute("data-pc-oculto"), travado: el.hasAttribute("data-pc-travado"),
      grupo: ehGrupo(el), mascara: el !== pr && el.hasAttribute("data-mascara"), frame: el !== pr && el.hasAttribute("data-frame"),
      naAuto: ehAuto(el.parentElement),
      auto: ehAuto(el) ? { dir: cs.flexDirection.startsWith("row") ? "h" : "v", gap: parseFloat(cs.flexDirection.startsWith("row") ? cs.columnGap : cs.rowGap) || 0,
        pad: parseFloat(cs.paddingTop) || 0, align: cs.alignItems, distribuir: cs.justifyContent === "space-between" } : null,
      vetor: ehVetor(el) ? (() => { const p = el.querySelector("path,rect,circle,ellipse,polygon,polyline,line"); return p ? { fill: p.getAttribute("fill") || "#000000", stroke: p.getAttribute("stroke") || "none", sw: parseFloat(p.getAttribute("stroke-width")) || 0 } : null; })() : null,
    };
  }
  let avisoPendente = false;
  function avisarSelecao() {
    if (avisoPendente) return; avisoPendente = true;
    requestAnimationFrame(() => {
      avisoPendente = false;
      avisar({ tipo: "selecao", itens: sel.filter((e) => e.isConnected).map(info), editando: !!editando, escopo: escopo === pr ? null : nomeDe(escopo) });
    });
  }

  /* ---------- 7. histórico (desfazer/refazer) ---------- */
  const pilha = [], refazer = [];
  // no <head>, o que é do editor: o nosso CSS (data-pc) e o CSS que o Moveable injeta (data-styled-id)
  const doEditorNoHead = (n) => n.hasAttribute("data-pc") || n.hasAttribute("data-styled-id");
  function cabecaLimpa() {
    return Array.from(doc.head.children).filter((n) => !doEditorNoHead(n)).map((n) => n.outerHTML).join("\n");
  }
  function pranchetaLimpa() { return limparNo(pr).outerHTML; }
  function foto() { return { head: cabecaLimpa(), pr: pranchetaLimpa() }; }
  function limparNo(no) {
    const c = no.cloneNode(true);
    const tira = (e) => { ["contenteditable", "data-pc-editando", "data-pc-sel", "spellcheck"].forEach((a) => e.removeAttribute(a)); };
    tira(c); c.querySelectorAll("*").forEach(tira);
    c.querySelectorAll("[data-pc],.moveable-control-box").forEach((e) => e.remove());
    return c;
  }
  function empilhar() {
    const f = foto(); const topo = pilha[pilha.length - 1];
    if (topo && topo.head === f.head && topo.pr === f.pr) return false;
    pilha.push(f); if (pilha.length > 120) pilha.shift(); refazer.length = 0; return true;
  }
  function restaurar(f) {
    const ids = sel.map((e) => (e === pr ? "prancheta" : e.dataset.id));
    if (f.head !== cabecaLimpa()) {
      Array.from(doc.head.children).filter((n) => !doEditorNoHead(n)).forEach((n) => n.remove());
      const t = doc.createElement("template"); t.innerHTML = f.head;
      doc.head.insertBefore(t.content, doc.head.firstChild);
    }
    const t = doc.createElement("template"); t.innerHTML = f.pr;
    const novo = t.content.firstElementChild;
    pr.replaceWith(novo); pr = novo; escopo = pr;
    lerMedidas(); medidasPrancheta(); montarGuias(); desenharCortes(); posicionarEscopo();
    sel = ids.map((id) => (id === "prancheta" ? pr : pr.querySelector(`[data-id="${CSS.escape(id)}"]`))).filter(Boolean);
    aplicarSelecao(); avisar({ tipo: "mudou" }); avisar({ tipo: "telas", n: N });
  }
  function lerMedidas() { W = +pr.dataset.w || W; H = +pr.dataset.h || H; N = Math.max(1, +pr.dataset.telas || N); }
  function desfazer() { if (editando) pararEdicao(); if (pilha.length < 2) return; refazer.push(pilha.pop()); restaurar(pilha[pilha.length - 1]); }
  function refazerUm() { if (editando) pararEdicao(); const f = refazer.pop(); if (!f) return; pilha.push(f); restaurar(f); }
  function mudou() {
    if (empilhar()) avisar({ tipo: "mudou" });
    try { mv && mv.updateRect(); } catch (e) {}
    avisarSelecao();
  }

  /* ---------- 8. editar texto no lugar ---------- */
  function editarTexto(el, pos) {
    if (!el || !ehTexto(el)) return;
    if (editando && editando !== el) pararEdicao();
    sel = [el]; editando = el; textoAntes = el.innerHTML;
    el.setAttribute("contenteditable", "true"); el.setAttribute("spellcheck", "false"); el.setAttribute("data-pc-editando", "");
    mv && (mv.target = []);
    el.focus();
    const s = win.getSelection();
    if (pos === "tudo") { const r = doc.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
    else if (pos && doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(pos.x, pos.y); if (r && el.contains(r.startContainer)) { s.removeAllRanges(); s.addRange(r); } }
    posicionarEdicao(); avisarSelecao();
  }
  function pararEdicao() {
    const el = editando; if (!el) return;
    editando = null;
    el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck"); el.removeAttribute("data-pc-editando");
    try { win.getSelection().removeAllRanges(); } catch (e) {}
    editBox.style.display = "none";
    if (!(el.textContent || "").trim()) { el.remove(); sel = []; } // texto vazio some, como no Figma
    if (el.innerHTML !== textoAntes || !el.isConnected) mudou();
    aplicarSelecao();
  }
  function posicionarEdicao() {
    if (!editando) { editBox.style.display = "none"; return; }
    const r = editando.getBoundingClientRect();
    Object.assign(editBox.style, { display: "", left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px" });
  }
  doc.addEventListener("input", () => { if (editando) { posicionarEdicao(); avisarSelecao(); } });
  doc.addEventListener("paste", (e) => {
    if (!editando) return;
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    doc.execCommand("insertText", false, t);
  });

  /* ---------- 9. mouse: selecionar, laço, desenhar, pan ---------- */
  let shift = false, espaco = false, panInfo = null, laco = null, desenho = null, apertado = false;
  doc.addEventListener("mousedown", (e) => { if (e.button === 0) apertado = true; }, true);
  win.addEventListener("mouseup", () => { apertado = false; }, true);
  function atualizarHover(t) {
    if (!t || panInfo || laco || desenho || ferramenta !== "mover") { hoverBox.style.display = "none"; return; }
    const el = camadaDe(t);
    if (!el || sel.includes(el) || el === editando) { hoverBox.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, { display: "", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  }
  function posicionarEscopo() {
    if (escopo === pr) { escopoBox.style.display = "none"; return; }
    const r = escopo.getBoundingClientRect();
    Object.assign(escopoBox.style, { display: "", left: r.left - 2 + "px", top: r.top - 2 + "px", width: r.width + 4 + "px", height: r.height + 4 + "px" });
  }
  const pontoNaPrancheta = (cx, cy) => ({ x: (cx - vista.x) / vista.z, y: (cy - vista.y) / vista.z });

  doc.addEventListener("mousedown", (e) => {
    avisar({ tipo: "clique" });
    if (e.target.closest && e.target.closest(".moveable-control-box")) return;
    if (corte) { if (!corteBox.contains(e.target)) concluirCorte(); return; } // clicar fora aplica o corte (como no Figma)
    if (editando && editando.contains(e.target)) return; // clicando dentro do texto em edição
    if (e.button === 1 || espaco || ferramenta === "mao") { // pan
      e.preventDefault(); panInfo = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y };
      doc.body.classList.add("pc-arrastando-vista"); return;
    }
    if (e.button !== 0) return;
    if (editando) pararEdicao();
    if (ferramenta === "texto") { e.preventDefault(); criarTexto(e.clientX, e.clientY); return; }
    if (ferramenta === "pen") { e.preventDefault(); canetaDown(e); return; }
    if (ferramenta === "retangulo" || ferramenta === "elipse" || ferramenta === "frame") {
      e.preventDefault();
      const box = doc.createElement("div"); box.className = "desenho"; over.appendChild(box);
      desenho = { x: e.clientX, y: e.clientY, box }; return;
    }
    const el = camadaDe(e.target, true);
    if (el) {
      if (shift) { sel = sel.includes(el) ? sel.filter((x) => x !== el) : sel.filter((x) => x !== pr).concat([el]); aplicarSelecao(); }
      else if (!sel.includes(el)) {
        sel = [el]; aplicarSelecao();
        // já deixa o Moveable arrastar no mesmo gesto (quem já estava selecionado ele arrasta sozinho)
        // (só se o botão ainda estiver apertado: um dragStart depois do mouseup deixa o Moveable num estado quebrado)
        if (mv) mv.waitToChangeTarget().then(() => { if (apertado) try { mv.dragStart(e); } catch (er) {} });
      }
      return;
    }
    // clique no vazio: laço de seleção (e, sem arrastar, seleciona a prancheta ou limpa)
    const dentro = pr.contains(e.target) || e.target === pr;
    if (!shift) { sel = []; aplicarSelecao(); }
    const box = doc.createElement("div"); box.className = "laco"; box.style.display = "none"; over.appendChild(box);
    laco = { x: e.clientX, y: e.clientY, box, dentro, base: sel.slice(), moveu: false };
  });
  doc.addEventListener("mousemove", (e) => {
    if (panInfo) { vista.x = panInfo.vx + e.clientX - panInfo.x; vista.y = panInfo.vy + e.clientY - panInfo.y; aplicarVista(); return; }
    if (caneta) { canetaMove(e); return; }
    if (desenho) {
      const x = Math.min(e.clientX, desenho.x), y = Math.min(e.clientY, desenho.y);
      let w = Math.abs(e.clientX - desenho.x), h = Math.abs(e.clientY - desenho.y);
      if (shift) w = h = Math.max(w, h);
      Object.assign(desenho.box.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px", borderRadius: ferramenta === "elipse" ? "50%" : "2px" });
      return;
    }
    if (laco) {
      const x = Math.min(e.clientX, laco.x), y = Math.min(e.clientY, laco.y), w = Math.abs(e.clientX - laco.x), h = Math.abs(e.clientY - laco.y);
      if (w + h > 4) laco.moveu = true;
      Object.assign(laco.box.style, { display: laco.moveu ? "" : "none", left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      if (laco.moveu) {
        const pegos = Array.from(escopo.children).filter((c) => {
          if (c.hasAttribute("data-pc-oculto") || c.hasAttribute("data-pc-travado")) return false;
          const r = c.getBoundingClientRect(); return r.right > x && r.left < x + w && r.bottom > y && r.top < y + h;
        });
        sel = laco.base.concat(pegos.filter((p) => !laco.base.includes(p))); aplicarSelecao();
      }
      return;
    }
    atualizarHover(e.target);
  });
  doc.addEventListener("mouseup", (e) => {
    if (panInfo) { panInfo = null; doc.body.classList.remove("pc-arrastando-vista"); return; }
    if (caneta) { caneta.arrastando = false; desenharCaneta(); return; }
    if (desenho) {
      const d = desenho; desenho = null; d.box.remove();
      const a = pontoNaPrancheta(Math.min(e.clientX, d.x), Math.min(e.clientY, d.y));
      let w = Math.abs(e.clientX - d.x) / vista.z, h = Math.abs(e.clientY - d.y) / vista.z;
      if (shift) w = h = Math.max(w, h);
      if (w < 8 && h < 8) { w = h = 400; a.x -= 200; a.y -= 200; }
      criarForma(a.x, a.y, w, h, ferramenta); return;
    }
    if (laco) {
      const l = laco; laco = null; l.box.remove();
      if (!l.moveu && l.dentro && !shift) { sel = [pr]; aplicarSelecao(); }
    }
  });
  doc.addEventListener("dblclick", (e) => {
    if (caneta) { caneta.pts.pop(); concluirCaneta(false); return; } // o 2º clique do duplo já tinha virado ponto
    if (corte) return;
    const el = camadaDe(e.target, true);
    if (!el) return;
    if (el.tagName === "IMG") { sel = [el]; cortar(el); return; }
    if (ehTexto(el)) { editarTexto(el, { x: e.clientX, y: e.clientY }); return; }
    // entra no grupo e seleciona o filho embaixo do mouse (como no Figma)
    if (el.children.length) {
      escopo = el; posicionarEscopo();
      const filho = camadaDe(e.target);
      sel = filho ? [filho] : []; aplicarSelecao();
      if (filho && ehTexto(filho)) editarTexto(filho, { x: e.clientX, y: e.clientY });
    }
  });
  doc.addEventListener("mouseleave", () => { hoverBox.style.display = "none"; });
  win.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { zoomEm(vista.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); return; }
    const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
    vista.x -= dx; vista.y -= dy; aplicarVista();
  }, { passive: false });
  // arrastar uma imagem do computador pra prancheta
  doc.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault(); });
  doc.addEventListener("drop", (e) => {
    const fs = e.dataTransfer && e.dataTransfer.files; if (!fs || !fs.length) return;
    e.preventDefault(); const a = pontoNaPrancheta(e.clientX, e.clientY);
    avisar({ tipo: "arquivos", arquivos: Array.from(fs), x: a.x, y: a.y });
  });
  win.addEventListener("resize", () => { desenharCortes(); try { mv && mv.updateRect(); } catch (e) {} avisarSelecao(); });

  /* ---------- 10. criar coisas ---------- */
  let cfg = { cores: ["#050505", "#d12b6d", "#f9a8d4", "#fce7f3"], fonteTitulo: "" };
  function fontePadrao() {
    if (cfg.fonteTitulo) return cfg.fonteTitulo;
    const t = pr.querySelector("h1,h2,[data-camada*='ítulo']");
    return t ? getComputedStyle(t).fontFamily : getComputedStyle(pr).fontFamily;
  }
  function corContraste(x, y) {
    // texto claro em fundo escuro e vice-versa (olha o que está embaixo do ponto)
    const el = doc.elementFromPoint(x, y);
    const fundo = el ? getComputedStyle(el).backgroundColor : "rgb(255,255,255)";
    const m = fundo.match(/\d+(\.\d+)?/g) || [255, 255, 255, 0];
    if (m[3] !== undefined && +m[3] === 0) return "#ffffff";
    const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    return lum < 0.55 ? "#ffffff" : "#111111";
  }
  function inserir(el) {
    escopo = pr; posicionarEscopo();
    el.dataset.id = novoId(); pr.appendChild(el); return el;
  }
  function criarTexto(cx, cy) {
    const a = pontoNaPrancheta(cx, cy);
    const el = doc.createElement("div");
    el.dataset.camada = "Texto";
    el.style.cssText = `position:absolute;left:${Math.round(a.x)}px;top:${Math.round(a.y - 40)}px;font-family:${fontePadrao()};font-size:72px;font-weight:800;line-height:1.05;color:${corContraste(cx, cy)};white-space:pre-wrap`;
    el.textContent = "Digite aqui";
    inserir(el); usarFerramenta("mover");
    editarTexto(el, "tudo");
  }
  function criarForma(x, y, w, h, tipo) {
    const el = doc.createElement("div"), elipse = tipo === "elipse", frame = tipo === "frame";
    el.dataset.camada = frame ? "Frame" : elipse ? "Elipse" : "Retângulo";
    if (frame) el.setAttribute("data-frame", "");
    const fundo = frame ? (cfg.cores[3] || "#ffffff") : (cfg.cores[1] || "#d12b6d");
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px;height:${Math.round(h)}px;background:${fundo};border-radius:${elipse ? "50%" : "0px"}${frame ? ";overflow:hidden" : ""}`;
    inserir(el); usarFerramenta("mover"); sel = [el]; aplicarSelecao(); mudou();
  }
  function inserirImagem(src, nw, nh, px, py) {
    const i = telaNoCentro();
    const w = Math.min(nw || W * 0.6, W * 0.7), h = nw ? w * (nh / nw) : w;
    const el = doc.createElement("img"); el.src = src; el.alt = "";
    el.dataset.camada = "Imagem";
    const x = px != null ? px - w / 2 : i * W + (W - w) / 2, y = py != null ? py - h / 2 : (H - h) / 2;
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px;height:${Math.round(h)}px;object-fit:cover`;
    inserir(el); sel = [el];
    el.onload = () => { aplicarSelecao(); };
    aplicarSelecao(); mudou();
  }

  /* ---------- 11. ações vindas da barra flutuante ---------- */
  function alvosDeEstilo() { return sel.filter((e) => e.isConnected); }
  // com um trecho do texto selecionado (editando), o estilo vale só pra ele
  function estiloNoTrecho(props) {
    const s = win.getSelection(); if (!editando || !s.rangeCount || s.isCollapsed) return false;
    const r = s.getRangeAt(0); if (!editando.contains(r.commonAncestorContainer)) return false;
    const span = doc.createElement("span");
    Object.entries(props).forEach(([k, v]) => span.style.setProperty(k, v));
    span.appendChild(r.extractContents()); r.insertNode(span);
    s.removeAllRanges(); const r2 = doc.createRange(); r2.selectNodeContents(span); s.addRange(r2);
    posicionarEdicao(); return true;
  }
  // vivo = prévia enquanto arrasta a cor/o degradê (não entra no histórico; o "change" final entra)
  function estilo(props, vivo) {
    if (vivo && editando) return;
    if (!vivo && estiloNoTrecho(props)) { mudou(); return; }
    alvosDeEstilo().forEach((el) => {
      Object.entries(props).forEach(([k, v]) => {
        if (v === null || v === "") el.style.removeProperty(k); else el.style.setProperty(k, v);
        // o estilo novo vale pro bloco todo: tira o mesmo estilo dos trechos de dentro
        if (ehTexto(el) && /^(font-family|font-size|color|background-image|-webkit-background-clip|background-clip|-webkit-text-fill-color)$/.test(k))
          el.querySelectorAll("[style]").forEach((c) => { c.style.removeProperty(k); if (!c.getAttribute("style")) c.removeAttribute("style"); });
      });
    });
    try { mv && mv.updateRect(); } catch (e) {}
    if (vivo) avisarSelecao(); else mudou();
  }
  function moverPor(el, dx, dy) {
    const p = posBase(el); el.style.left = p[0] + dx + "px"; el.style.top = p[1] + dy + "px";
  }
  function alinhar(tipo) {
    const alvos = sel.filter((e) => e !== pr); if (!alvos.length) return;
    const z = vista.z, p0 = pr.getBoundingClientRect();
    const rs = alvos.map((e) => e.getBoundingClientRect());
    let ref;
    if (alvos.length === 1) {
      // um elemento só: alinha na tela (corte) onde está o centro dele
      const cx = (rs[0].left + rs[0].width / 2 - p0.left) / z, i = Math.max(0, Math.min(N - 1, Math.floor(cx / W)));
      ref = { left: p0.left + i * W * z, top: p0.top, right: p0.left + (i + 1) * W * z, bottom: p0.top + H * z };
    } else {
      ref = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    }
    alvos.forEach((el, k) => {
      const r = rs[k]; let dx = 0, dy = 0;
      if (tipo === "esquerda") dx = ref.left - r.left;
      if (tipo === "direita") dx = ref.right - r.right;
      if (tipo === "centro") dx = (ref.left + ref.right) / 2 - (r.left + r.width / 2);
      if (tipo === "topo") dy = ref.top - r.top;
      if (tipo === "base") dy = ref.bottom - r.bottom;
      if (tipo === "meio") dy = (ref.top + ref.bottom) / 2 - (r.top + r.height / 2);
      moverPor(el, dx / z, dy / z);
    });
    mudou();
  }
  function distribuir(eixo) {
    const alvos = sel.filter((e) => e !== pr); if (alvos.length < 3) return;
    const z = vista.z, it = alvos.map((el) => ({ el, r: el.getBoundingClientRect() }));
    const a = eixo === "h" ? "left" : "top", t = eixo === "h" ? "width" : "height";
    it.sort((p, q) => p.r[a] - q.r[a]);
    const ini = it[0].r[a], fim = it[it.length - 1].r[a] + it[it.length - 1].r[t];
    const soma = it.reduce((s, x) => s + x.r[t], 0), gap = (fim - ini - soma) / (it.length - 1);
    let cur = ini;
    it.forEach((x) => { const d = (cur - x.r[a]) / z; moverPor(x.el, eixo === "h" ? d : 0, eixo === "h" ? 0 : d); cur += x.r[t] + gap; });
    mudou();
  }
  function ordem(dir) {
    const alvos = sel.filter((e) => e !== pr); if (!alvos.length) return;
    alvos.forEach((el) => {
      const pai = el.parentElement;
      if (dir === "topo") pai.appendChild(el);
      else if (dir === "fundo") pai.insertBefore(el, pai.firstElementChild);
      else if (dir === "frente") { const prox = el.nextElementSibling; if (prox) pai.insertBefore(prox, el); }
      else if (dir === "tras") { const ant = el.previousElementSibling; if (ant) pai.insertBefore(el, ant); }
    });
    mudou();
  }
  function excluir() {
    const alvos = sel.filter((e) => e !== pr); if (!alvos.length) return;
    alvos.forEach((el) => el.remove()); sel = []; aplicarSelecao(); mudou();
  }
  function duplicar() {
    const alvos = sel.filter((e) => e !== pr); if (!alvos.length) return;
    const novos = alvos.map((el) => {
      const c = limparNo(el); c.dataset.id = novoId(); c.querySelectorAll("[data-id]").forEach((x) => (x.dataset.id = novoId()));
      if (c.dataset.camada) c.dataset.camada = c.dataset.camada.replace(/( cópia)*$/, "") + " cópia";
      el.after(c); moverPor(c, 24, 24); return c;
    });
    sel = novos; aplicarSelecao(); mudou();
  }
  let prancheta_clip = [];
  function copiar() { prancheta_clip = sel.filter((e) => e !== pr).map((el) => limparNo(el).outerHTML); }
  function colar() {
    if (!prancheta_clip.length) return;
    const t = doc.createElement("template"); t.innerHTML = prancheta_clip.join("");
    const novos = Array.from(t.content.children);
    novos.forEach((c) => { c.dataset.id = novoId(); c.querySelectorAll("[data-id]").forEach((x) => (x.dataset.id = novoId())); escopo.appendChild(c); moverPor(c, 24, 24); });
    prancheta_clip = novos.map((c) => limparNo(c).outerHTML);
    sel = novos; aplicarSelecao(); mudou();
  }
  function agruparSel() { if (editando) pararEdicao(); const g = agrupar(sel.filter((e) => e !== pr)); if (g) { sel = [g]; aplicarSelecao(); mudou(); } }
  function desagruparSel() {
    if (editando) pararEdicao();
    const m = sel.find((e) => e.hasAttribute && e.hasAttribute("data-mascara")); if (m) { tirarMascara(m); return; }
    let novos = []; sel.filter((e) => e !== pr).forEach((g) => { if (ehGrupo(g)) novos = novos.concat(desagrupar(g)); });
    if (novos.length) { sel = novos; aplicarSelecao(); mudou(); }
  }
  function usarFerramenta(f) {
    if (caneta && f !== "pen") concluirCaneta(false);
    if (corte && f !== "mover") concluirCorte();
    ferramenta = f;
    doc.body.classList.toggle("pc-mao", f === "mao");
    doc.body.classList.toggle("pc-cruz", f === "retangulo" || f === "elipse" || f === "frame" || f === "pen");
    doc.body.classList.toggle("pc-cursor-texto", f === "texto");
    hoverBox.style.display = "none";
    avisar({ tipo: "ferramenta", f });
  }
  function setTelas(n) {
    n = Math.max(1, Math.min(20, Math.round(n))); if (n === N) return;
    N = n; medidasPrancheta(); montarGuias(); desenharCortes(); aplicarSelecao(); mudou(); avisar({ tipo: "telas", n: N });
  }

  /* ---------- 12. camadas ---------- */
  function arvore(no, prof) {
    return Array.from(no.children).filter((c) => !c.hasAttribute("data-pc")).reverse().map((c) => {
      garantirId(c);
      const texto = ehTexto(c), filhos = !texto && prof < 3 && c.children.length && !/^(svg|SVG)$/.test(c.tagName) ? arvore(c, prof + 1) : [];
      return { id: c.dataset.id, nome: nomeDe(c), tipo: c.tagName === "IMG" ? "imagem" : ehVetor(c) ? "vetor" : texto ? "texto" : c.hasAttribute("data-mascara") ? "mascara" : ehAuto(c) ? "auto" : filhos.length ? "grupo" : "forma",
        oculto: c.hasAttribute("data-pc-oculto"), travado: c.hasAttribute("data-pc-travado"), sel: sel.includes(c), filhos };
    });
  }
  const porId = (id) => (id === "prancheta" ? pr : pr.querySelector(`[data-id="${CSS.escape(String(id))}"]`));

  /* ---------- 12b. agrupar, auto layout e frame ---------- */
  const ehAuto = (el) => !!(el && el !== pr && el.nodeType === 1 && el.hasAttribute("data-auto"));
  const ehFrame = (el) => !!(el && el !== pr && el.nodeType === 1 && (el.hasAttribute("data-frame") || el.hasAttribute("data-auto")));
  const ehVetor = (el) => !!(el && el.tagName && el.tagName.toLowerCase() === "svg");
  const ehGrupo = (el) => !!(el && el !== pr && !ehTexto(el) && !ehVetor(el) && el.tagName !== "IMG" && el.children.length > 0);
  const naOrdem = (els) => els.slice().sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const irmaos = (els) => { const p = els[0] && els[0].parentElement; return p && els.every((e) => e.parentElement === p) ? p : null; };
  // posição de um elemento em px da prancheta (soma dos offsets até ela; transform não entra, como no Figma)
  function noPr(el) {
    if (!el || el === pr) return { x: 0, y: 0, w: el ? el.offsetWidth : 0, h: el ? el.offsetHeight : 0 };
    let x = 0, y = 0, e = el;
    while (e && e !== pr) { x += e.offsetLeft; y += e.offsetTop; const op = e.offsetParent; if (!op || !(op === pr || pr.contains(op))) break; if (op !== pr) { x += op.clientLeft; y += op.clientTop; } e = op; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  // texto que vai mudar de "dono" não pode quebrar linha: congela a largura que ele tem agora
  const congelarTexto = (k) => { if (ehTexto(k) && !k.style.width) k.style.width = Math.ceil(k.getBoundingClientRect().width / vista.z) + 1 + "px"; };
  const aviso = (texto) => avisar({ tipo: "aviso", texto });

  function agrupar(els, nome) {
    els = naOrdem(els.filter((e) => e && e !== pr && e.isConnected)); if (!els.length) return null;
    const pai = irmaos(els); if (!pai) { aviso("Só dá pra agrupar elementos do mesmo nível"); return null; }
    els.forEach(congelarTexto);
    const cx = els.map((e) => ({ e, x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }));
    const x0 = Math.min(...cx.map((c) => c.x)), y0 = Math.min(...cx.map((c) => c.y));
    const x1 = Math.max(...cx.map((c) => c.x + c.w)), y1 = Math.max(...cx.map((c) => c.y + c.h));
    const g = doc.createElement("div"); g.dataset.id = novoId(); g.dataset.camada = nome || "Grupo";
    g.style.cssText = (ehAuto(pai) ? "position:relative;flex:none;" : `position:absolute;left:${x0}px;top:${y0}px;`) + `width:${x1 - x0}px;height:${y1 - y0}px`;
    els[els.length - 1].after(g);
    cx.forEach((c) => {
      const s = c.e.style; s.position = "absolute"; s.left = c.x - x0 + "px"; s.top = c.y - y0 + "px"; s.right = "auto"; s.bottom = "auto"; s.margin = "0"; s.flex = "";
      g.appendChild(c.e);
    });
    return g;
  }
  function desagrupar(g) {
    if (!ehGrupo(g)) return [];
    const pai = g.parentElement, auto = ehAuto(pai), gx = g.offsetLeft, gy = g.offsetTop;
    const kids = Array.from(g.children).filter((c) => !c.hasAttribute("data-pc"));
    kids.forEach(congelarTexto);
    const cx = kids.map((k) => ({ k, x: k.offsetLeft + g.clientLeft, y: k.offsetTop + g.clientTop }));
    cx.forEach(({ k, x, y }) => {
      const s = k.style;
      if (auto) { s.position = "static"; s.left = ""; s.top = ""; s.flex = "none"; }
      else { s.position = "absolute"; s.left = gx + x + "px"; s.top = gy + y + "px"; s.right = "auto"; s.bottom = "auto"; s.margin = "0"; s.flex = ""; }
      g.before(k);
    });
    g.remove(); return kids;
  }
  function virarAuto(g) {
    const kids = Array.from(g.children).filter((c) => !c.hasAttribute("data-pc"));
    kids.forEach(congelarTexto);
    const cx = kids.map((k) => ({ k, x: k.offsetLeft, y: k.offsetTop, w: k.offsetWidth, h: k.offsetHeight }));
    let horiz = false, gap = 24, pad = [0, 0, 0, 0];
    if (cx.length) {
      const mx = cx.map((c) => c.x + c.w / 2), my = cx.map((c) => c.y + c.h / 2);
      horiz = Math.max(...mx) - Math.min(...mx) > Math.max(...my) - Math.min(...my);
      cx.sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
      const gaps = []; for (let i = 0; i < cx.length - 1; i++) gaps.push(horiz ? cx[i + 1].x - (cx[i].x + cx[i].w) : cx[i + 1].y - (cx[i].y + cx[i].h));
      gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : 0;
      const minX = Math.min(...cx.map((c) => c.x)), minY = Math.min(...cx.map((c) => c.y));
      const maxX = Math.max(...cx.map((c) => c.x + c.w)), maxY = Math.max(...cx.map((c) => c.y + c.h));
      pad = [minY, g.clientWidth - maxX, g.clientHeight - maxY, minX].map((v) => Math.max(0, Math.round(v)));
    } else pad = [40, 40, 40, 40];
    const s = g.style;
    Object.assign(s, { display: "flex", flexDirection: horiz ? "row" : "column", gap: gap + "px", padding: pad.map((v) => v + "px").join(" "),
      alignItems: "flex-start", boxSizing: "border-box", width: cx.length ? "" : s.width, height: cx.length ? "" : s.height });
    cx.forEach(({ k }) => { const q = k.style; q.position = "static"; q.left = ""; q.top = ""; q.right = ""; q.bottom = ""; q.margin = "0"; q.flex = "none"; g.appendChild(k); });
    g.dataset.auto = horiz ? "h" : "v";
    if (!g.dataset.camada || /^(Grupo|Frame)$/.test(g.dataset.camada)) g.dataset.camada = "Auto layout";
  }
  function desfazerAuto(g) {
    if (!ehAuto(g)) return;
    const kids = Array.from(g.children).filter((c) => !c.hasAttribute("data-pc"));
    kids.forEach(congelarTexto);
    const w = g.offsetWidth, h = g.offsetHeight;
    const cx = kids.map((k) => ({ k, x: k.offsetLeft, y: k.offsetTop }));
    ["display", "flex-direction", "gap", "padding", "align-items", "justify-content"].forEach((p) => g.style.removeProperty(p));
    g.style.width = w + "px"; g.style.height = h + "px";
    cx.forEach(({ k, x, y }) => Object.assign(k.style, { position: "absolute", left: x + "px", top: y + "px", margin: "0", flex: "" }));
    delete g.dataset.auto; if (g.dataset.camada === "Auto layout") g.dataset.camada = "Grupo";
  }
  function autoLayout() {
    if (editando) pararEdicao();
    const alvos = sel.filter((e) => e !== pr);
    if (!alvos.length) return;
    let g;
    if (alvos.length === 1 && ehGrupo(alvos[0]) && !ehAuto(alvos[0])) g = alvos[0];
    else if (alvos.length === 1 && ehAuto(alvos[0])) return;
    else g = agrupar(alvos, "Auto layout");
    if (!g) return;
    virarAuto(g); sel = [g]; aplicarSelecao(); mudou();
  }
  function auto(props) {
    sel.filter(ehAuto).forEach((g) => {
      const s = g.style;
      if (props.dir) { s.flexDirection = props.dir === "h" ? "row" : "column"; g.dataset.auto = props.dir; }
      if (props.gap != null) s.gap = Math.max(0, props.gap) + "px";
      if (props.pad != null) s.padding = Math.max(0, props.pad) + "px";
      if (props.align) s.alignItems = { inicio: "flex-start", centro: "center", fim: "flex-end" }[props.align] || props.align;
      if (props.distribuir != null) s.justifyContent = props.distribuir ? "space-between" : "";
    });
    try { mv && mv.updateRect(); } catch (e) {}
    mudou();
  }
  // arrastar pra dentro/fora de frames e reordenar dentro do auto layout (como no Figma)
  const dentroDe = (q, x, y) => x >= q.left && x <= q.right && y >= q.top && y <= q.bottom;
  function reordenar(el, pai, cx, cy) {
    const horiz = getComputedStyle(pai).flexDirection.startsWith("row");
    const outros = Array.from(pai.children).filter((c) => c !== el && !c.hasAttribute("data-pc"));
    const antes = outros.find((o) => { const q = o.getBoundingClientRect(); return (horiz ? cx : cy) < (horiz ? q.left + q.width / 2 : q.top + q.height / 2); });
    antes ? pai.insertBefore(el, antes) : pai.appendChild(el);
    Object.assign(el.style, { position: "static", left: "", top: "", margin: "0", flex: "none" });
  }
  function moverPara(el, novoPai, cx, cy) {
    congelarTexto(el);
    if (ehAuto(novoPai)) { novoPai.appendChild(el); reordenar(el, novoPai, cx, cy); return; }
    const p = noPr(el), q = noPr(novoPai);
    const x = p.x - q.x - (novoPai === pr ? 0 : novoPai.clientLeft), y = p.y - q.y - (novoPai === pr ? 0 : novoPai.clientTop);
    novoPai.appendChild(el);
    Object.assign(el.style, { position: "absolute", left: Math.round(x) + "px", top: Math.round(y) + "px", right: "auto", bottom: "auto", margin: "0", flex: "" });
  }
  function soltar(el) {
    if (!el || el === pr || !el.isConnected) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pai = el.parentElement;
    if (pai !== pr && ehFrame(pai) && !dentroDe(pai.getBoundingClientRect(), cx, cy)) {
      // saiu do frame: vai pro nível de cima, na mesma posição
      moverPara(el, pai.parentElement, cx, cy); escopo = pai.parentElement === pr || !pr.contains(pai.parentElement) ? pr : pai.parentElement; posicionarEscopo(); return;
    }
    if (ehAuto(pai)) { reordenar(el, pai, cx, cy); return; }
    const alvo = Array.from(pai.children).reverse().find((c) => c !== el && ehFrame(c) && !c.hasAttribute("data-pc-oculto") && dentroDe(c.getBoundingClientRect(), cx, cy));
    if (alvo) { moverPara(el, alvo, cx, cy); escopo = alvo; posicionarEscopo(); }
  }

  /* ---------- 12c. máscara ---------- */
  function raioPx(v, tam) { const t = String(v || "0").split(" ")[0]; return t.endsWith("%") ? (parseFloat(t) / 100) * tam : parseFloat(t) || 0; }
  function urlDaMascara(m) {
    const w = m.offsetWidth, h = m.offsetHeight;
    if (m.tagName === "IMG") return `url("${m.getAttribute("src")}")`;
    let svg;
    if (ehVetor(m)) {
      const c = m.cloneNode(true); c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); c.removeAttribute("style");
      c.setAttribute("width", w); c.setAttribute("height", h); svg = c.outerHTML;
    } else {
      const cs = getComputedStyle(m);
      const rx = Math.min(w / 2, raioPx(cs.borderTopLeftRadius, w)), ry = Math.min(h / 2, raioPx(cs.borderTopLeftRadius.split(" ")[1] || cs.borderTopLeftRadius, h));
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><rect width="${w}" height="${h}" rx="${rx}" ry="${ry}"/></svg>`;
    }
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }
  const PROPS_MASCARA = ["mask-image", "mask-size", "mask-position", "mask-repeat", "-webkit-mask-image", "-webkit-mask-size", "-webkit-mask-position", "-webkit-mask-repeat"];
  function mascarar() {
    if (editando) pararEdicao();
    const els = naOrdem(sel.filter((e) => e !== pr));
    if (els.length < 2) { aviso("Pra máscara, selecione a forma (a de baixo) e o que vai aparecer dentro dela"); return; }
    if (!irmaos(els)) { aviso("Só dá pra mascarar elementos do mesmo nível"); return; }
    const m = els[0];
    if (ehTexto(m)) { aviso("A máscara funciona com forma, elipse, vetor ou imagem. Texto como máscara ainda não."); return; }
    const g = agrupar(els, "Máscara"); if (!g) return;
    const url = urlDaMascara(m), tam = `${m.offsetWidth}px ${m.offsetHeight}px`, pos = `${m.offsetLeft}px ${m.offsetTop}px`;
    [["", url, tam, pos], ["-webkit-", url, tam, pos]].forEach(([pf]) => {
      g.style.setProperty(pf + "mask-image", url); g.style.setProperty(pf + "mask-size", tam);
      g.style.setProperty(pf + "mask-position", pos); g.style.setProperty(pf + "mask-repeat", "no-repeat");
    });
    m.style.visibility = "hidden"; m.dataset.mascaraForma = "1"; g.dataset.mascara = "1";
    sel = [g]; aplicarSelecao(); mudou();
  }
  function tirarMascara(g) {
    g = g || sel.find((e) => e.hasAttribute && e.hasAttribute("data-mascara")); if (!g) return;
    PROPS_MASCARA.forEach((p) => g.style.removeProperty(p));
    g.querySelectorAll("[data-mascara-forma]").forEach((m) => { m.style.visibility = ""; delete m.dataset.mascaraForma; });
    delete g.dataset.mascara;
    sel = desagrupar(g); aplicarSelecao(); mudou();
  }

  /* ---------- 12d. caneta (pen tool) ---------- */
  let caneta = null; // { pts:[{x,y,cin,cout}], arrastando, mouse }
  const canetaSvg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  canetaSvg.setAttribute("style", "position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none");
  over.appendChild(canetaSvg);
  const tela = (p) => ({ x: vista.x + p.x * vista.z, y: vista.y + p.y * vista.z });
  function caminho(pts, fechado, conv) {
    if (!pts.length) return "";
    const c = conv || ((p) => p), f = (p) => { const q = c(p); return Math.round(q.x * 100) / 100 + " " + Math.round(q.y * 100) / 100; };
    let d = "M" + f(pts[0]);
    const seg = (a, b) => { d += a.cout || b.cin ? " C" + f(a.cout || a) + " " + f(b.cin || b) + " " + f(b) : " L" + f(b); };
    for (let i = 0; i < pts.length - 1; i++) seg(pts[i], pts[i + 1]);
    if (fechado && pts.length > 2) { seg(pts[pts.length - 1], pts[0]); d += " Z"; }
    return d;
  }
  function desenharCaneta() {
    if (!caneta) { canetaSvg.innerHTML = ""; return; }
    const { pts, mouse } = caneta, ac = getComputedStyle(doc.documentElement).getPropertyValue("--pc-acento").trim() || "#ff3d9a";
    let h = `<path d="${caminho(pts, false, tela)}" fill="none" stroke="${ac}" stroke-width="2"/>`;
    if (mouse && pts.length && !caneta.arrastando) {
      const a = pts[pts.length - 1], ta = tela(a.cout || a), tm = tela(mouse), tb = tela(a);
      h += `<path d="M${tb.x} ${tb.y} C${ta.x} ${ta.y} ${tm.x} ${tm.y} ${tm.x} ${tm.y}" fill="none" stroke="${ac}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".8"/>`;
    }
    pts.forEach((p, i) => {
      const t = tela(p);
      [p.cin, p.cout].filter(Boolean).forEach((c) => { const tc = tela(c); h += `<line x1="${t.x}" y1="${t.y}" x2="${tc.x}" y2="${tc.y}" stroke="${ac}" stroke-width="1"/><circle cx="${tc.x}" cy="${tc.y}" r="3.5" fill="#fff" stroke="${ac}"/>`; });
      h += `<rect x="${t.x - 4.5}" y="${t.y - 4.5}" width="9" height="9" fill="${i === 0 && pts.length > 2 ? ac : "#fff"}" stroke="${ac}" stroke-width="1.5"/>`;
    });
    canetaSvg.innerHTML = h;
  }
  function angulo45(base, p) {
    // Shift: trava em 0°, 45° e 90°
    const dx = p.x - base.x, dy = p.y - base.y, d = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: base.x + Math.cos(a) * d, y: base.y + Math.sin(a) * d };
  }
  function canetaDown(e) {
    let p = pontoNaPrancheta(e.clientX, e.clientY);
    if (!caneta) caneta = { pts: [], arrastando: false, mouse: p };
    const { pts } = caneta;
    if (pts.length > 2) { const t0 = tela(pts[0]); if (Math.hypot(t0.x - e.clientX, t0.y - e.clientY) < 9) { concluirCaneta(true); return; } }
    if (shift && pts.length) p = angulo45(pts[pts.length - 1], p);
    pts.push({ x: p.x, y: p.y, cin: null, cout: null }); caneta.arrastando = true; desenharCaneta();
  }
  function canetaMove(e) {
    const p = pontoNaPrancheta(e.clientX, e.clientY); caneta.mouse = p;
    if (caneta.arrastando) {
      const a = caneta.pts[caneta.pts.length - 1];
      if (Math.hypot(p.x - a.x, p.y - a.y) * vista.z > 3) { a.cout = { x: p.x, y: p.y }; a.cin = { x: 2 * a.x - p.x, y: 2 * a.y - p.y }; }
    }
    desenharCaneta();
  }
  function concluirCaneta(fechado) {
    const c = caneta; caneta = null; desenharCaneta();
    if (!c || c.pts.length < 2) { usarFerramenta("mover"); return; }
    // caixa do desenho (com as curvas) em px da prancheta
    const tmp = doc.createElementNS("http://www.w3.org/2000/svg", "path"); tmp.setAttribute("d", caminho(c.pts, fechado));
    canetaSvg.appendChild(tmp); const bb = tmp.getBBox(); tmp.remove();
    const w = Math.max(1, Math.ceil(bb.width)), h = Math.max(1, Math.ceil(bb.height));
    const d = caminho(c.pts, fechado, (p) => ({ x: p.x - bb.x, y: p.y - bb.y }));
    const cor = cfg.cores[1] || "#d12b6d";
    const el = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", `0 0 ${w} ${h}`); el.setAttribute("preserveAspectRatio", "none"); el.setAttribute("data-camada", "Vetor");
    el.setAttribute("style", `position:absolute;left:${Math.round(bb.x)}px;top:${Math.round(bb.y)}px;width:${w}px;height:${h}px;overflow:visible`);
    el.innerHTML = fechado
      ? `<path d="${d}" fill="${cor}" stroke="none" vector-effect="non-scaling-stroke"/>`
      : `<path d="${d}" fill="none" stroke="${cor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    inserir(el); usarFerramenta("mover"); sel = [el]; aplicarSelecao(); mudou();
  }
  function vetor(props, vivo) {
    sel.filter(ehVetor).forEach((s) => s.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line").forEach((p) => {
      if (props.fill !== undefined) p.setAttribute("fill", props.fill || "none");
      if (props.stroke !== undefined) p.setAttribute("stroke", props.stroke || "none");
      if (props.sw !== undefined) { p.setAttribute("stroke-width", Math.max(0, props.sw)); if (!p.getAttribute("vector-effect")) p.setAttribute("vector-effect", "non-scaling-stroke"); }
    }));
    if (vivo) avisarSelecao(); else mudou();
  }

  /* ---------- 12e. cortar imagem ---------- */
  let corte = null; // { el, B, F, C } em px da prancheta
  const corteBox = doc.createElement("div"); corteBox.style.cssText = "position:fixed;inset:0;display:none;pointer-events:none"; over.appendChild(corteBox);
  function lerInset(el) {
    const v = getComputedStyle(el).objectViewBox || el.style.objectViewBox || "";
    const m = String(v).match(/inset\(([^)]*)\)/); if (!m) return null;
    const n = m[1].trim().split(/\s+/).map((x) => parseFloat(x) / 100);
    const [t, r = t, b = t, l = r] = n; return { t, r, b, l };
  }
  function cortar(el) {
    el = el || (sel.length === 1 ? sel[0] : null);
    if (!el || el.tagName !== "IMG") { aviso("Selecione uma imagem pra cortar"); return; }
    if (!el.naturalWidth) { aviso("A imagem ainda está carregando"); return; }
    if (editando) pararEdicao();
    const B = noPr(el), nw = el.naturalWidth, nh = el.naturalHeight, ins = lerInset(el);
    let F;
    if (ins) { const fw = B.w / Math.max(0.01, 1 - ins.l - ins.r), fh = B.h / Math.max(0.01, 1 - ins.t - ins.b); F = { x: B.x - ins.l * fw, y: B.y - ins.t * fh, w: fw, h: fh }; }
    else {
      const fit = getComputedStyle(el).objectFit;
      if (fit === "fill") F = { ...B };
      else { const s = fit === "contain" ? Math.min(B.w / nw, B.h / nh) : Math.max(B.w / nw, B.h / nh); F = { w: nw * s, h: nh * s }; F.x = B.x + (B.w - F.w) / 2; F.y = B.y + (B.h - F.h) / 2; }
    }
    const C = { x: Math.max(B.x, F.x), y: Math.max(B.y, F.y) }; C.w = Math.min(B.x + B.w, F.x + F.w) - C.x; C.h = Math.min(B.y + B.h, F.y + F.h) - C.y;
    corte = { el, B, F, C };
    mv && (mv.target = []); hoverBox.style.display = "none";
    const src = el.currentSrc || el.src;
    corteBox.innerHTML = `<img data-g style="position:fixed;opacity:.3;pointer-events:auto;cursor:move;max-width:none" src="${src}">
      <img data-v style="position:fixed;pointer-events:none;max-width:none" src="${src}">
      <div data-c style="position:fixed;pointer-events:auto;cursor:move;border:1.5px solid var(--pc-acento);box-shadow:0 0 0 1px rgba(0,0,0,.25)">
        ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => `<i data-h="${d}" style="position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;background:#fff;border:1.5px solid var(--pc-acento);border-radius:2px;cursor:${d}-resize;${{ nw: "left:0;top:0", n: "left:50%;top:0", ne: "left:100%;top:0", e: "left:100%;top:50%", se: "left:100%;top:100%", s: "left:50%;top:100%", sw: "left:0;top:100%", w: "left:0;top:50%" }[d]}"></i>`).join("")}
      </div>
      <div data-b style="position:fixed;display:flex;gap:6px;pointer-events:auto">
        <button data-ok style="border:0;border-radius:999px;padding:7px 14px;font:700 12px Raleway,system-ui;background:var(--pc-acento);color:#fff;cursor:pointer">✓ Concluir</button>
        <button data-x style="border:0;border-radius:999px;padding:7px 14px;font:700 12px Raleway,system-ui;background:#fff;color:#1b0e1a;cursor:pointer">Cancelar</button>
      </div>`;
    corteBox.style.display = "";
    el.style.visibility = "hidden"; // a imagem "de verdade" some enquanto corta (a prévia mostra o resultado)
    corteBox.querySelector("[data-ok]").onclick = concluirCorte;
    corteBox.querySelector("[data-x]").onclick = cancelarCorte;
    const arrastar = (e, modo) => {
      e.preventDefault(); e.stopPropagation();
      const z = vista.z, x0 = e.clientX, y0 = e.clientY, C0 = { ...corte.C }, F0 = { ...corte.F };
      const mover = (ev) => {
        const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z, F = corte.F, C = corte.C;
        if (modo === "img") { // arrasta a imagem por baixo do corte
          F.x = Math.min(C.x, Math.max(C.x + C.w - F.w, F0.x + dx)); F.y = Math.min(C.y, Math.max(C.y + C.h - F.h, F0.y + dy));
        } else {
          let { x, y, w, h } = C0;
          if (modo.includes("w")) { const nx = Math.max(F.x, Math.min(x + w - 4, x + dx)); w += x - nx; x = nx; }
          if (modo.includes("e")) w = Math.max(4, Math.min(F.x + F.w - x, w + dx));
          if (modo.includes("n")) { const ny = Math.max(F.y, Math.min(y + h - 4, y + dy)); h += y - ny; y = ny; }
          if (modo.includes("s")) h = Math.max(4, Math.min(F.y + F.h - y, h + dy));
          Object.assign(C, { x, y, w, h });
        }
        desenharCorte();
      };
      const soltar_ = () => { doc.removeEventListener("mousemove", mover); doc.removeEventListener("mouseup", soltar_); };
      doc.addEventListener("mousemove", mover); doc.addEventListener("mouseup", soltar_);
    };
    corteBox.querySelector("[data-g]").onmousedown = (e) => arrastar(e, "img");
    corteBox.querySelector("[data-c]").onmousedown = (e) => { const h = e.target.dataset.h; arrastar(e, h || "img"); };
    desenharCorte(); avisar({ tipo: "cortando", ativo: true });
  }
  function desenharCorte() {
    if (!corte) { corteBox.style.display = "none"; corteBox.innerHTML = ""; return; }
    const { F, C } = corte, z = vista.z, tF = tela(F), tC = tela(C);
    const g = corteBox.querySelector("[data-g]"), v = corteBox.querySelector("[data-v]"), c = corteBox.querySelector("[data-c]"), b = corteBox.querySelector("[data-b]");
    Object.assign(g.style, { left: tF.x + "px", top: tF.y + "px", width: F.w * z + "px", height: F.h * z + "px" });
    Object.assign(v.style, { left: tF.x + "px", top: tF.y + "px", width: F.w * z + "px", height: F.h * z + "px",
      clipPath: `inset(${(C.y - F.y) * z}px ${(F.x + F.w - C.x - C.w) * z}px ${(F.y + F.h - C.y - C.h) * z}px ${(C.x - F.x) * z}px)` });
    Object.assign(c.style, { left: tC.x + "px", top: tC.y + "px", width: C.w * z + "px", height: C.h * z + "px" });
    Object.assign(b.style, { left: tC.x + "px", top: tC.y + C.h * z + 14 + "px" });
  }
  function concluirCorte() {
    const k = corte; if (!k) return; corte = null; desenharCorte();
    const { el, B, F, C } = k, pc = (v) => Math.max(0, Math.round(v * 10000) / 100) + "%";
    el.style.visibility = "";
    el.style.objectViewBox = `inset(${pc((C.y - F.y) / F.h)} ${pc((F.x + F.w - C.x - C.w) / F.w)} ${pc((F.y + F.h - C.y - C.h) / F.h)} ${pc((C.x - F.x) / F.w)})`;
    el.style.objectFit = "fill"; el.style.boxSizing = "border-box";
    el.style.width = Math.round(C.w) + "px"; el.style.height = Math.round(C.h) + "px";
    if (!ehAuto(el.parentElement)) moverPor(el, Math.round(C.x - B.x), Math.round(C.y - B.y));
    sel = [el]; aplicarSelecao(); mudou(); avisar({ tipo: "cortando", ativo: false });
  }
  function cancelarCorte() {
    const k = corte; if (!k) return; corte = null; desenharCorte();
    k.el.style.visibility = ""; sel = [k.el]; aplicarSelecao(); avisar({ tipo: "cortando", ativo: false });
  }
  function trocarSrc(id, src) {
    const el = porId(id); if (!el || el.tagName !== "IMG") return;
    el.setAttribute("src", src); el.onload = () => { try { mv && mv.updateRect(); } catch (e) {} avisarSelecao(); }; mudou();
  }

  /* ---------- 13. teclado ---------- */
  function tecla(e) {
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === "Shift") { shift = true; if (mv) mv.keepRatio = true; }
    if (caneta) {
      if (k === "Enter" || k === "Escape") { e.preventDefault(); concluirCaneta(false); }
      if (k === "Backspace" || k === "Delete") { e.preventDefault(); caneta.pts.pop(); if (!caneta.pts.length) caneta = null; desenharCaneta(); }
      return;
    }
    if (corte) {
      if (k === "Enter") { e.preventDefault(); concluirCorte(); }
      if (k === "Escape") { e.preventDefault(); cancelarCorte(); }
      return;
    }
    if (editando) {
      if (k === "Escape") { e.preventDefault(); const el = editando; pararEdicao(); sel = [el]; aplicarSelecao(); }
      return;
    }
    if (k === " " && !espaco) { espaco = true; doc.body.classList.add("pc-mao"); e.preventDefault(); return; }
    if (mod && (k === "z" || k === "Z")) { e.preventDefault(); e.shiftKey ? refazerUm() : desfazer(); return; }
    if (mod && (k === "y" || k === "Y")) { e.preventDefault(); refazerUm(); return; }
    if (mod && (k === "d" || k === "D")) { e.preventDefault(); duplicar(); return; }
    if (mod && (k === "c" || k === "C")) { copiar(); return; }
    if (mod && (k === "v" || k === "V")) { e.preventDefault(); colar(); return; }
    if (mod && (k === "g" || k === "G")) { e.preventDefault(); e.shiftKey ? desagruparSel() : agruparSel(); return; }
    if (!mod && e.shiftKey && (k === "a" || k === "A")) { e.preventDefault(); autoLayout(); return; }
    if (mod && (k === "a" || k === "A")) { e.preventDefault(); sel = Array.from(escopo.children).filter((c) => !c.hasAttribute("data-pc") && !c.hasAttribute("data-pc-travado")); aplicarSelecao(); return; }
    if (mod && k === "]") { e.preventDefault(); ordem(e.shiftKey ? "topo" : "frente"); return; }
    if (mod && k === "[") { e.preventDefault(); ordem(e.shiftKey ? "fundo" : "tras"); return; }
    if (mod && (k === "0")) { e.preventDefault(); ajustar(); return; }
    if (mod && (k === "1")) { e.preventDefault(); zoomEm(1); return; }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomEm(vista.z * 1.25); return; }
    if (mod && k === "-") { e.preventDefault(); zoomEm(vista.z / 1.25); return; }
    if (e.shiftKey && (k === "!" || k === "1")) { e.preventDefault(); ajustar(); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); excluir(); return; }
    if (k === "Escape") {
      e.preventDefault();
      if (ferramenta !== "mover") { usarFerramenta("mover"); return; }
      if (escopo !== pr) { const g = escopo; escopo = g.parentElement && pr.contains(g.parentElement) && g.parentElement !== pr ? g.parentElement : pr; posicionarEscopo(); sel = [g]; aplicarSelecao(); return; }
      sel = []; aplicarSelecao(); return;
    }
    if (k === "Enter") {
      e.preventDefault(); const el = sel.length === 1 ? sel[0] : null; if (!el || el === pr) return;
      if (ehTexto(el)) { editarTexto(el, "tudo"); return; }
      if (el.children.length) { escopo = el; posicionarEscopo(); sel = [el.firstElementChild]; aplicarSelecao(); }
      return;
    }
    if (k.startsWith("Arrow") && sel.length && !sel.includes(pr)) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1;
      sel.forEach((el) => moverPor(el, k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0));
      try { mv.updateRect(); } catch (er) {}
      clearTimeout(tecla.t); tecla.t = setTimeout(mudou, 350); avisarSelecao(); return;
    }
    if (mod || e.altKey) return;
    const atalhos = { v: "mover", t: "texto", r: "retangulo", o: "elipse", h: "mao", p: "pen", f: "frame" };
    const f = atalhos[k.toLowerCase()]; if (f) { usarFerramenta(f); return; }
    if (k.toLowerCase() === "i") { avisar({ tipo: "pedir-imagem" }); return; }
    if (k.toLowerCase() === "c") { cortar(); return; }
    if (k.toLowerCase() === "m") { mascarar(); return; }
    // seleção de área (pixels) ainda vai chegar: o Estúdio mostra o aviso
    if (k.toLowerCase() === "l") avisar({ tipo: "em-breve", tecla: "l" });
  }
  doc.addEventListener("keydown", tecla);
  doc.addEventListener("keyup", (e) => {
    if (e.key === "Shift") { shift = false; aplicarSelecao(); }
    if (e.key === " ") { espaco = false; if (ferramenta !== "mao") doc.body.classList.remove("pc-mao"); }
  });
  win.addEventListener("blur", () => { shift = false; espaco = false; if (ferramenta !== "mao") doc.body.classList.remove("pc-mao"); });

  /* ---------- 14. HTML limpo (o que vai pro arquivo) ---------- */
  function htmlLimpo() {
    const c = doc.documentElement.cloneNode(true);
    const cvp = c.querySelector("#pc-vp");
    if (cvp) { const cpr = cvp.querySelector("[data-prancheta]"); if (cpr) cvp.replaceWith(cpr); }
    c.querySelectorAll("[data-pc],[data-styled-id],.moveable-control-box").forEach((e) => e.remove());
    c.removeAttribute("data-pc-tema");
    const tira = (e) => ["contenteditable", "data-pc-editando", "spellcheck"].forEach((a) => e.removeAttribute(a));
    c.querySelectorAll("*").forEach(tira);
    const b = c.querySelector("body"); if (b) { b.classList.remove("pc-mao", "pc-cruz", "pc-cursor-texto", "pc-arrastando-vista"); if (!b.getAttribute("class")) b.removeAttribute("class"); }
    return "<!DOCTYPE html>\n" + c.outerHTML;
  }

  /* ---------- 15. API pro Estúdio ---------- */
  win.ED = {
    html: htmlLimpo, foto, desfazer, refazer: refazerUm, estilo, alinhar, distribuir, ordem, excluir, duplicar,
    ferramenta: usarFerramenta, inserirImagem, setTelas, irParaTela,
    zoom(acao) { if (acao === "ajustar") ajustar(); else if (acao === "100") zoomEm(1); else if (acao === "mais") zoomEm(vista.z * 1.25); else if (acao === "menos") zoomEm(vista.z / 1.25); },
    vista: () => ({ ...vista }), setVista(v) { if (v && v.z) { Object.assign(vista, v); aplicarVista(); } },
    selecionar(ids) {
      const els = (ids || []).map(porId).filter(Boolean);
      // a seleção pode estar dentro de um grupo: o escopo vira o pai dela
      escopo = els[0] && els[0] !== pr && els[0].parentElement ? els[0].parentElement : pr; posicionarEscopo();
      selecionar(els);
    },
    camadas: () => arvore(pr, 0),
    renomear(id, nome) { const el = porId(id); if (!el || el === pr) return; if (nome) el.dataset.camada = nome; else delete el.dataset.camada; mudou(); },
    alternar(id, attr) {
      const el = porId(id); if (!el || el === pr) return;
      const a = attr === "oculto" ? "data-pc-oculto" : "data-pc-travado"; el.toggleAttribute(a);
      // oculto vale também no PNG: o visibility vai no próprio elemento
      if (attr === "oculto") el.style.visibility = el.hasAttribute(a) ? "hidden" : "";
      if (el.hasAttribute(a)) sel = sel.filter((x) => x !== el);
      aplicarSelecao(); mudou();
    },
    moverCamada(id, paraId, depois) { const el = porId(id), alvo = porId(paraId); if (!el || !alvo || el === alvo || el.contains(alvo)) return; depois ? alvo.after(el) : alvo.before(el); mudou(); },
    medidas: () => ({ w: W, h: H, n: N }),
    agrupar: agruparSel, desagrupar: desagruparSel, autoLayout, auto, desfazerAuto() { sel.filter(ehAuto).forEach(desfazerAuto); aplicarSelecao(); mudou(); },
    mascara: mascarar, tirarMascara: () => tirarMascara(), cortar: () => cortar(), concluirCorte, cancelarCorte, vetor, trocarSrc,
    srcDe(id) { const el = porId(id); return el && el.tagName === "IMG" ? el.getAttribute("src") : null; },
    config(c) { cfg = Object.assign(cfg, c || {}); if (c && c.tema) doc.documentElement.setAttribute("data-pc-tema", c.tema); },
    editarTexto(id) { const el = porId(id); if (el) editarTexto(el, "tudo"); },
    pararEdicao,
    tecla,
    // fonte do Google que ainda não está no post: entra um <link> no <head> (e vai junto no arquivo)
    garantirFonte(url) {
      if (!url || Array.from(doc.head.querySelectorAll("link[href]")).some((l) => l.getAttribute("href") === url)) return Promise.resolve();
      const l = doc.createElement("link"); l.rel = "stylesheet"; l.href = url;
      const pronto = new Promise((ok) => { l.onload = ok; l.onerror = ok; setTimeout(ok, 4000); });
      doc.head.insertBefore(l, doc.head.querySelector("style:not([data-pc])") || null); return pronto;
    },
    fontesDoPost() {
      const fam = new Set();
      Array.from(doc.head.querySelectorAll("link[href*='fonts.googleapis']")).forEach((l) => {
        (l.getAttribute("href").match(/family=([^&:]+)/g) || []).forEach((m) => fam.add(decodeURIComponent(m.slice(7).replace(/\+/g, " "))));
      });
      return Array.from(fam);
    },
  };

  /* ---------- 16. começa ---------- */
  function iniciar() {
    if (!win.Moveable) { avisar({ tipo: "erro", texto: "não carreguei o Moveable" }); return; }
    criarMoveable(); ajustar(); empilhar();
    avisar({ tipo: "pronto", w: W, h: H, n: N });
  }
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(iniciar); else iniciar();
})();
