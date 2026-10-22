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
    .moveable-control-box .moveable-rotation-control{width:16px!important;height:16px!important;margin-top:-8px!important;margin-left:-8px!important;border-radius:50%!important;
      background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23d12b6d' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M21 12a9 9 0 1 1-3-6.7L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E") center/10px no-repeat!important;
      cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4'%3E%3Cpath d='M21 12a9 9 0 1 1-3-6.7L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E") 11 11,crosshair!important}
    .moveable-control-box .moveable-guideline{background:var(--pc-acento)!important}
    .moveable-control-box .moveable-size-value,.moveable-control-box .moveable-gap{color:var(--pc-acento)!important}
    .pc-dim{position:absolute;white-space:nowrap;background:var(--pc-acento);color:#1b0e1a;font:700 11px/1 Raleway,system-ui,sans-serif;
      padding:4px 7px;border-radius:5px;transform:translate(-50%,0);pointer-events:none}
    [data-pc-editando]{outline:none!important;cursor:text!important}
    [data-pc-oculto]{visibility:hidden!important}
    body.pc-mao,body.pc-mao *{cursor:grab!important} body.pc-arrastando-vista,body.pc-arrastando-vista *{cursor:grabbing!important}
    body.pc-cruz,body.pc-cruz *{cursor:crosshair!important}
    body.pc-cursor-texto,body.pc-cursor-texto *{cursor:text!important}
    body.pc-zoom,body.pc-zoom *{cursor:zoom-in!important}
    body.pc-pintando,body.pc-pintando *{cursor:crosshair!important}
    .pc-formiga{animation:pcFormiga .6s linear infinite} @keyframes pcFormiga{to{stroke-dashoffset:-8}}`;
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
    atualizarHover(null); posicionarEscopo(); posicionarEdicao(); desenharCaneta(); desenharCorte(); desenharPontos(); desenharPintura();
    desenharMarcas();
    avisarSelecao(); avisar({ tipo: "vista", z: vista.z, tela: telaNoCentro() });
  }
  /* marcações (ferramenta N): a Isa marca uma área ou um ponto e comenta; vai pro chat da IA */
  let marcas = [];
  const marcasBox = doc.createElement("div"); marcasBox.setAttribute("data-pc", ""); marcasBox.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:6";
  doc.body.appendChild(marcasBox);
  function desenharMarcas() {
    marcasBox.innerHTML = marcas.map((m) => {
      const x = vista.x + m.x * vista.z, y = vista.y + m.y * vista.z, w = m.w * vista.z, h = m.h * vista.z;
      const area = m.w > 2 || m.h > 2 ? `<div style="position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:2px dashed #ff4d8d;background:rgba(255,77,141,.10);border-radius:4px"></div>` : "";
      return area + `<div style="position:fixed;left:${x - 13}px;top:${y - 13}px;width:26px;height:26px;border-radius:50% 50% 50% 4px;background:#ff4d8d;color:#fff;font:800 12px/26px Raleway,system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35)">${m.n}</div>`;
    }).join("");
  }
  function criarMarca(cx0, cy0, cx1, cy1) {
    const a = pontoNaPrancheta(Math.min(cx0, cx1), Math.min(cy0, cy1));
    let w = Math.abs(cx1 - cx0) / vista.z, h = Math.abs(cy1 - cy0) / vista.z;
    if (w < 10 && h < 10) w = h = 0;
    const m = { n: (marcas.reduce((k, x) => Math.max(k, x.n), 0) || 0) + 1, x: Math.round(a.x), y: Math.round(a.y), w: Math.round(w), h: Math.round(h) };
    m.tela = Math.min(N, Math.max(1, Math.floor((m.x + m.w / 2) / W) + 1));
    // camadas que a marcação pega (ou a que está embaixo do ponto)
    const r0 = { l: m.x, t: m.y, r: m.x + Math.max(m.w, 1), b: m.y + Math.max(m.h, 1) };
    const pr0 = pr.getBoundingClientRect();
    m.elementos = Array.from(pr.children).filter((c) => !c.hasAttribute("data-pc") && !c.hasAttribute("data-pc-oculto")).filter((c) => {
      const r = c.getBoundingClientRect(), l = (r.left - pr0.left) / vista.z, t = (r.top - pr0.top) / vista.z, rr = l + r.width / vista.z, bb = t + r.height / vista.z;
      if (!(rr > r0.l && l < r0.r && bb > r0.t && t < r0.b)) return false;
      // fundo de tela inteira não ajuda a IA a saber do que se trata
      return !(r.width / vista.z >= W * 0.95 && r.height / vista.z >= H * 0.95);
    }).slice(-6).map((c) => { garantirId(c); return { id: c.dataset.id, nome: nomeDe(c) }; });
    marcas.push(m); desenharMarcas();
    avisar({ tipo: "marca", marca: m, tela: { x: vista.x + (m.x + m.w) * vista.z, y: vista.y + m.y * vista.z } });
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
  function caixa(el) {
    if (!el) return { x: 0, y: 0, w: 0, h: 0 };
    if (el instanceof HTMLElement) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" && cs.left !== "auto") return { x: parseFloat(cs.left) || 0, y: parseFloat(cs.top) || 0, w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0 };
    const r = el.getBoundingClientRect(), p = el.parentElement, q = p.getBoundingClientRect(), z = vista.z;
    return { x: (r.left - q.left) / z - p.clientLeft, y: (r.top - q.top) / z - p.clientTop, w: r.width / z, h: r.height / z };
  }
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
      const cx = caixa(el); el.style.left = cx.x + "px"; el.style.top = cx.y + "px";
      el.style.right = "auto"; el.style.bottom = "auto";
    }
    return [parseFloat(el.style.left || cs.left) || 0, parseFloat(el.style.top || cs.top) || 0];
  }
  function criarMoveable() {
    mv = new win.Moveable(doc.body, {
      target: [], ables: [Dimensao], props: { dimensao: true },
      draggable: true, resizable: true, rotatable: true, snappable: true,
      rotationPosition: "bottom-right", rotateAroundControls: true, origin: false,
      throttleDrag: 0, throttleResize: 0, throttleRotate: 0, keepRatio: false,
      snapThreshold: 6, isDisplaySnapDigit: true, snapGap: true, snapDigit: 0,
      snapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      elementSnapDirections: { top: true, left: true, bottom: true, right: true, center: true, middle: true },
      maxSnapElementGuidelineDistance: null,
    });
    let fonte0 = 0, larg0 = 0;
    const duplicarNoLugar = (el) => { const c = limparNo(el); c.dataset.id = novoId(); c.querySelectorAll("[data-id]").forEach((x) => (x.dataset.id = novoId())); el.before(c); };
    mv.on("dragStart", (e) => { if (e.inputEvent && e.inputEvent.altKey) duplicarNoLugar(e.target); e.set(posBase(e.target)); avisar({ tipo: "mexendo" }); })
      .on("drag", (e) => { e.target.style.left = e.beforeTranslate[0] + "px"; e.target.style.top = e.beforeTranslate[1] + "px"; })
      .on("dragEnd", (e) => { if (e.isDrag) { soltar(e.target); aplicarSelecao(); mudou(); } else avisarSelecao(); })
      .on("dragGroupStart", (e) => { const alt = e.inputEvent && e.inputEvent.altKey; e.events.forEach((ev) => { if (alt) duplicarNoLugar(ev.target); ev.set(posBase(ev.target)); }); avisar({ tipo: "mexendo" }); })
      .on("dragGroup", (e) => e.events.forEach((ev) => { ev.target.style.left = ev.beforeTranslate[0] + "px"; ev.target.style.top = ev.beforeTranslate[1] + "px"; }))
      .on("dragGroupEnd", (e) => { if (e.isDrag) mudou(); else avisarSelecao(); })
      .on("resizeStart", (e) => {
        const p = posBase(e.target); e.target.style.boxSizing = "border-box";
        e.setOrigin(["%", "%"]); e.dragStart && e.dragStart.set(p);
        if (e.inputEvent && e.inputEvent.altKey && e.setFixedDirection) e.setFixedDirection([0, 0]); // Alt: a partir do centro
        fonte0 = parseFloat(getComputedStyle(e.target).fontSize) || 16; larg0 = caixa(e.target).w;
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
        if (e.target.hasAttribute("data-fx")) aplicarFx(e.target); // o vidro do vetor acompanha o tamanho novo
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
      naAuto: ehAuto(el.parentElement), fx: el !== pr ? lerFx(el) : {}, forma: ehForma(el), mascaraImg: !!(el.dataset && el.dataset.mascaraImg),
      pontos: !!(pontos && pontos.el === el),
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
    if (pint) { if (e.button === 0 && pintDown(e)) e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (editando) pararEdicao();
    if (ferramenta === "zoom") { e.preventDefault(); zoomEm(vista.z * (e.altKey ? 1 / 1.6 : 1.6), e.clientX, e.clientY); return; }
    if (FERR_PONTOS.includes(ferramenta)) {
      e.preventDefault();
      if (pontos) { pontosDown(e); return; }
      const el = camadaDe(e.target, true);
      if (el && !entrarPontos(el, e.target.closest && e.target.closest("path"))) { sel = [el]; aplicarSelecao(); }
      return;
    }
    if (ferramenta === "texto") {
      e.preventDefault();
      const t = camadaDe(e.target, true), alvo = t && (ehTexto(t) ? t : t.children.length && ehTexto(camadaDe(e.target)) ? camadaDe(e.target) : null);
      if (alvo) { editarTexto(alvo, { x: e.clientX, y: e.clientY }); return; }
      criarTexto(e.clientX, e.clientY); return;
    }
    if (ferramenta === "pen") { e.preventDefault(); canetaDown(e); return; }
    if (ferramenta === "marcar") {
      e.preventDefault();
      const box = doc.createElement("div"); box.className = "desenho"; box.style.borderStyle = "dashed"; over.appendChild(box);
      desenho = { x: e.clientX, y: e.clientY, box, marca: true }; return;
    }
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
    if (pint) { pintMove(e); return; }
    if (pontos && (pontos.arraste || pontos.laco)) { pontosMove(e); return; }
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
    if (pint) { pintUp(); return; }
    if (pontos && (pontos.arraste || pontos.laco)) { pontosUp(); return; }
    if (desenho && desenho.marca) { const d = desenho; desenho = null; d.box.remove(); criarMarca(d.x, d.y, e.clientX, e.clientY); return; }
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
    if (corte || pint || pontos) return;
    const el = camadaDe(e.target, true);
    if (!el) return;
    if (el.tagName === "IMG") { sel = [el]; cortar(el); return; }
    if (ehVetor(el)) { usarFerramenta("direta"); entrarPontos(el, e.target.closest && e.target.closest("path")); return; }
    if (ehTexto(el)) { avisar({ tipo: "aviso", texto: "Pra editar o texto, use o T (ou aperte Enter)" }); return; }
    // entra no grupo e seleciona o filho embaixo do mouse (como no Figma)
    if (el.children.length) {
      escopo = el; posicionarEscopo();
      const filho = camadaDe(e.target);
      sel = filho ? [filho] : []; aplicarSelecao();
    }
  });
  doc.addEventListener("mouseleave", () => { hoverBox.style.display = "none"; });
  win.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) { zoomEm(vista.z * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); return; } // Ctrl (Figma) ou Alt (Illustrator)
    const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
    vista.x -= dx; vista.y -= dy; aplicarVista();
  }, { passive: false });
  doc.addEventListener("dragstart", (e) => { if (!(editando && editando.contains(e.target))) e.preventDefault(); });
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
  function travarTudo(travar) {
    if (travar) { sel.filter((e) => e !== pr).forEach((el) => el.setAttribute("data-pc-travado", "")); sel = []; }
    else pr.querySelectorAll("[data-pc-travado]").forEach((el) => el.removeAttribute("data-pc-travado"));
    aplicarSelecao(); mudou();
  }
  function ocultarTudo(ocultar) {
    if (ocultar) { sel.filter((e) => e !== pr).forEach((el) => { el.setAttribute("data-pc-oculto", ""); el.style.visibility = "hidden"; }); sel = []; }
    else pr.querySelectorAll("[data-pc-oculto]").forEach((el) => { el.removeAttribute("data-pc-oculto"); el.style.visibility = ""; });
    aplicarSelecao(); mudou();
  }
  function tamanhoTexto(d) { const ts = sel.filter((e) => e !== pr && ehTexto(e)); if (!ts.length) return; ts.forEach((el) => (el.style.fontSize = Math.max(1, (parseFloat(getComputedStyle(el).fontSize) || 16) + d) + "px")); mudou(); }
  function trocarPreenchimento() {
    sel.filter((e) => ehVetor(e)).forEach((s) => s.querySelectorAll(FORMAS_SVG).forEach((p) => {
      const f = p.getAttribute("fill") || "none", st = p.getAttribute("stroke") || "none";
      p.setAttribute("fill", st); p.setAttribute("stroke", f); if (f !== "none" && !p.getAttribute("stroke-width")) p.setAttribute("stroke-width", 6);
    }));
    mudou();
  }
  function colar(noLugar) {
    if (!prancheta_clip.length) return;
    const t = doc.createElement("template"); t.innerHTML = prancheta_clip.join("");
    const novos = Array.from(t.content.children);
    novos.forEach((c) => { c.dataset.id = novoId(); c.querySelectorAll("[data-id]").forEach((x) => (x.dataset.id = novoId())); escopo.appendChild(c); if (!noLugar) moverPor(c, 24, 24); });
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
    if (pontos && !FERR_PONTOS.includes(f)) sairPontos();
    if (caneta && f !== "pen") concluirCaneta(false);
    if (corte && f !== "mover") concluirCorte();
    ferramenta = f;
    doc.body.classList.toggle("pc-mao", f === "mao");
    doc.body.classList.toggle("pc-cruz", f === "retangulo" || f === "elipse" || f === "frame" || f === "pen" || f === "marcar");
    doc.body.classList.toggle("pc-cursor-texto", f === "texto");
    hoverBox.style.display = "none";
    doc.body.classList.toggle("pc-zoom", f === "zoom");
    if (FERR_PONTOS.includes(f) && !pontos && sel.length === 1 && sel[0] !== pr) entrarPontos(sel[0]);
    // com ferramenta de desenho, as alças da seleção anterior saem do caminho (senão o 1º clique cai nelas)
    if (["texto", "retangulo", "elipse", "frame", "pen", "zoom", "marcar"].includes(f) && mv) mv.target = [];
    else if (f === "mover" && mv && !pontos) aplicarSelecao();
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
    if (!(el instanceof HTMLElement)) { // SVG: soma a caixa dele à posição do pai
      const c = caixa(el), pai = el.parentElement, q = noPr(pai);
      return { x: q.x + c.x + (pai === pr ? 0 : pai.clientLeft), y: q.y + c.y + (pai === pr ? 0 : pai.clientTop), w: c.w, h: c.h };
    }
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
    const cx = els.map((e) => ({ e, ...caixa(e) }));
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
    const pai = g.parentElement, auto = ehAuto(pai), gc = caixa(g), gx = gc.x, gy = gc.y;
    const kids = Array.from(g.children).filter((c) => !c.hasAttribute("data-pc"));
    kids.forEach(congelarTexto);
    const cx = kids.map((k) => { const c = caixa(k); return { k, x: c.x + g.clientLeft, y: c.y + g.clientTop }; });
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
    const cx = kids.map((k) => ({ k, ...caixa(k) }));
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
    const cx = kids.map((k) => ({ k, ...caixa(k) }));
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
    const { w, h } = caixa(m);
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
    // o grupo fica com a caixa da forma da máscara (a seleção mostra só a área que aparece, como no Figma)
    const cm = caixa(m), mx = cm.x, my = cm.y, mw0 = cm.w, mh0 = cm.h;
    Array.from(g.children).forEach((c) => { c.style.left = (parseFloat(c.style.left) || 0) - mx + "px"; c.style.top = (parseFloat(c.style.top) || 0) - my + "px"; });
    if (!ehAuto(g.parentElement)) moverPor(g, mx, my);
    g.style.width = mw0 + "px"; g.style.height = mh0 + "px";
    const url = urlDaMascara(m), tam = `${mw0}px ${mh0}px`, pos = "0px 0px";
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
    aplicarMascaraImg(el);
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

  /* ---------- 12f. geometria (paper.js, MIT): base dos pontos e do Pathfinder ---------- */
  let PS = null;
  function papel() {
    if (!PS) {
      if (!win.paper) throw new Error("a geometria (paper.js) não carregou");
      PS = new win.paper.PaperScope(); PS.setup(new PS.Size(1, 1)); PS.settings.insertItems = false;
    }
    return PS;
  }
  const NS = "http://www.w3.org/2000/svg";
  const FORMAS_SVG = "path,rect,circle,ellipse,polygon,polyline,line";
  // tela → px da prancheta
  function telaParaPr() { const r = pr.getBoundingClientRect(); return new DOMMatrix().scaleSelf(1 / vista.z).translateSelf(-r.left, -r.top); }
  const matrizPaper = (m) => new (papel().Matrix)(m.a, m.b, m.c, m.d, m.e, m.f);
  // div com fundo (retângulo/elipse, com ou sem cantos arredondados) vira um caminho, na coordenada da prancheta
  function itemDaDiv(el) {
    const P = papel(), w = el.offsetWidth, h = el.offsetHeight, cs = getComputedStyle(el);
    const rx = Math.min(w / 2, raioPx(cs.borderTopLeftRadius, w)), ry = Math.min(h / 2, raioPx(cs.borderTopLeftRadius.split(" ")[1] || cs.borderTopLeftRadius, h));
    const it = rx > 0 || ry > 0 ? new P.Path.Rectangle({ rectangle: new P.Rectangle(0, 0, w, h), radius: new P.Size(rx || ry, ry || rx) }) : new P.Path.Rectangle(new P.Rectangle(0, 0, w, h));
    const p = noPr(el), T = cs.transform && cs.transform !== "none" ? new DOMMatrix(cs.transform) : new DOMMatrix();
    const o = cs.transformOrigin.split(" ").map(parseFloat);
    it.transform(matrizPaper(new DOMMatrix().translateSelf(p.x + o[0], p.y + o[1]).multiplySelf(T).translateSelf(-o[0], -o[1])));
    return it;
  }
  // cada forma de dentro do <svg> vira um caminho na coordenada da prancheta (já com viewBox e giro)
  function itensDoSvg(svg) {
    const P = papel(), M = telaParaPr();
    return Array.from(svg.querySelectorAll(FORMAS_SVG)).map((n) => {
      const c = n.cloneNode(true); c.removeAttribute("transform");
      let it = P.project.importSVG(c, { insert: false, expandShapes: true });
      if (!it) return null;
      if (it.className === "Group" || it.className === "Layer") { const ps = it.getItems({ class: P.PathItem }); it = ps.length ? ps.reduce((a, b) => a.unite(b)) : null; if (!it) return null; }
      it.transform(matrizPaper(M.multiply(DOMMatrix.fromMatrix(n.getScreenCTM()))));
      return { it, fill: n.getAttribute("fill") || getComputedStyle(n).fill, stroke: n.getAttribute("stroke"), sw: n.getAttribute("stroke-width") };
    }).filter(Boolean);
  }
  const ehForma = (el) => !!el && el !== pr && el.tagName === "DIV" && !ehTexto(el) && !el.children.length && !el.hasAttribute("data-auto");
  function corSolida(el) {
    const cs = getComputedStyle(el), bg = cs.backgroundColor;
    if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
    const m = String(cs.backgroundImage).match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i); return m ? m[1] : (cfg.cores[1] || "#d12b6d");
  }
  function itemDe(el) {
    if (ehVetor(el)) { const its = itensDoSvg(el); if (!its.length) return null; return { it: its.slice(1).reduce((a, b) => a.unite(b.it), its[0].it), cor: its[its.length - 1].fill, contorno: its[0].stroke, sw: its[0].sw }; }
    if (ehForma(el)) return { it: itemDaDiv(el), cor: corSolida(el) };
    return null;
  }
  // um caminho (na coordenada da prancheta) vira um <svg> posicionado dentro de "pai"
  function svgDoItem(it, pai, estilo) {
    const b = it.bounds, q = pai === pr ? { x: 0, y: 0 } : noPr(pai);
    const w = Math.max(1, b.width), h = Math.max(1, b.height);
    const el = doc.createElementNS(NS, "svg");
    el.setAttribute("viewBox", `${b.x} ${b.y} ${w} ${h}`); el.setAttribute("preserveAspectRatio", "none");
    el.setAttribute("style", `position:absolute;left:${Math.round((b.x - q.x) * 100) / 100}px;top:${Math.round((b.y - q.y) * 100) / 100}px;width:${w}px;height:${h}px;overflow:visible`);
    const p = doc.createElementNS(NS, "path");
    p.setAttribute("d", it.pathData); p.setAttribute("fill", (estilo && estilo.cor) || cfg.cores[1] || "#d12b6d"); p.setAttribute("fill-rule", "evenodd");
    if (estilo && estilo.contorno && estilo.contorno !== "none") { p.setAttribute("stroke", estilo.contorno); p.setAttribute("stroke-width", estilo.sw || 2); p.setAttribute("vector-effect", "non-scaling-stroke"); }
    el.appendChild(p); el.dataset.id = novoId(); el.dataset.camada = (estilo && estilo.nome) || "Vetor";
    return el;
  }
  // retângulo/elipse vira vetor de verdade (pra editar os pontos ou usar no Pathfinder)
  function converterEmVetor(el) {
    if (!ehForma(el)) return el;
    const d = itemDe(el); if (!d) return el;
    const novo = svgDoItem(d.it, el.parentElement, { cor: d.cor, nome: el.dataset.camada && !/^(Retângulo|Elipse|Forma)$/.test(el.dataset.camada) ? el.dataset.camada : "Vetor" });
    const cs = getComputedStyle(el); if (cs.opacity !== "1") novo.style.opacity = cs.opacity;
    novo.dataset.id = el.dataset.id || novo.dataset.id; el.replaceWith(novo); return novo;
  }

  /* ---------- 12g. Pathfinder (como no Illustrator) ---------- */
  function pathfinder(op) {
    if (editando) pararEdicao();
    const els = naOrdem(sel.filter((e) => e !== pr));
    if (els.length < 2) { aviso("Selecione 2 ou mais formas pro Pathfinder"); return; }
    const pai = irmaos(els); if (!pai) { aviso("O Pathfinder funciona com formas do mesmo nível"); return; }
    let itens;
    try { itens = els.map((e) => ({ e, ...itemDe(e) })); } catch (e) { aviso("Não consegui ler as formas (" + e.message + ")"); return; }
    if (itens.some((x) => !x.it)) { aviso("O Pathfinder funciona com retângulos, elipses e vetores (texto e imagem não)"); return; }
    const base = itens[0], topo = itens[itens.length - 1];
    const uniao = (arr) => arr.slice(1).reduce((a, x) => a.unite(x.it), arr[0].it);
    let res = [];
    if (op === "unir") res = [{ it: uniao(itens), cor: topo.cor, nome: "Unir" }];
    else if (op === "menosFrente") res = [{ it: base.it.subtract(uniao(itens.slice(1))), cor: base.cor, nome: "Subtrair" }];
    else if (op === "menosTras") res = [{ it: topo.it.subtract(uniao(itens.slice(0, -1))), cor: topo.cor, nome: "Subtrair" }];
    else if (op === "intersecao") res = [{ it: itens.slice(1).reduce((a, x) => a.intersect(x.it), base.it), cor: topo.cor, nome: "Interseção" }];
    else if (op === "excluir") res = [{ it: itens.slice(1).reduce((a, x) => a.exclude(x.it), base.it), cor: topo.cor, nome: "Excluir" }];
    else if (op === "dividir") {
      let pecas = [];
      itens.forEach((x) => {
        const novas = []; let resto = x.it;
        pecas.forEach((p) => { novas.push({ it: p.it.subtract(x.it), cor: p.cor }); novas.push({ it: p.it.intersect(x.it), cor: x.cor }); resto = resto.subtract(p.it); });
        novas.push({ it: resto, cor: x.cor }); pecas = novas;
      });
      res = pecas.map((p, i) => ({ ...p, nome: "Pedaço " + (i + 1) }));
    }
    res = res.filter((r) => r.it && !r.it.isEmpty() && Math.abs(r.it.area || 0) > 0.5);
    if (!res.length) { aviso("Não sobrou nada: as formas não se encostam do jeito que essa operação precisa"); return; }
    const novos = res.map((r) => svgDoItem(r.it, pai, { cor: r.cor, nome: r.nome }));
    novos.forEach((n) => els[els.length - 1].before(n));
    els.forEach((e) => e.remove());
    let g = null; if (novos.length > 1) g = agrupar(novos, "Dividir");
    sel = g ? [g] : novos; aplicarSelecao(); mudou();
  }

  /* ---------- 12h. seleção direta (A): editar os pontos do vetor ---------- */
  let pontos = null; // { el, itens:[{node, it}], selec:Set<Segment>, arraste }
  const pontosSvg = doc.createElementNS(NS, "svg");
  pontosSvg.setAttribute("style", "position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none");
  over.appendChild(pontosSvg);
  const FERR_PONTOS = ["direta", "maisPonto", "menosPonto", "converter"];
  function entrarPontos(el, so) {
    if (!el) return false;
    if (ehForma(el)) { el = converterEmVetor(el); avisar({ tipo: "aviso", texto: "A forma virou vetor pra você editar os pontos" }); }
    if (!ehVetor(el)) return false;
    if (!el.getAttribute("viewBox")) { const w = el.width.baseVal.value || el.getBoundingClientRect().width / vista.z, h = el.height.baseVal.value || el.getBoundingClientRect().height / vista.z; el.setAttribute("viewBox", `0 0 ${w} ${h}`); }
    const P = papel();
    // formas básicas (rect, circle…) viram <path> pra ter pontos
    Array.from(el.querySelectorAll("rect,circle,ellipse,polygon,polyline,line")).forEach((n) => {
      const it = P.project.importSVG(n.cloneNode(true), { insert: false, expandShapes: true });
      const pth = it && (it.className === "Path" || it.className === "CompoundPath" ? it : it.getItems({ class: P.PathItem })[0]);
      if (!pth) return;
      const novo = doc.createElementNS(NS, "path");
      Array.from(n.attributes).forEach((a) => { if (!/^(x|y|width|height|rx|ry|cx|cy|r|points|x1|y1|x2|y2)$/.test(a.name)) novo.setAttribute(a.name, a.value); });
      novo.setAttribute("d", pth.pathData); n.replaceWith(novo);
    });
    // com muitas formas (ex.: texto em contornos), mostra só a que foi clicada
    const todos = Array.from(el.querySelectorAll("path")), alvo = so && so.tagName && so.tagName.toLowerCase() === "path" && el.contains(so) ? [so] : null;
    // muitas formas e nenhuma clicada: entra no modo e espera o clique na letra/forma (senão vira uma nuvem de pontos)
    const usar = alvo && todos.length > 1 ? alvo : todos.length > 8 ? [] : todos;
    const itens = usar.map((node) => ({ node, it: new P.CompoundPath({ pathData: node.getAttribute("d") || "" }) }));
    if (!itens.length && !todos.length) return false;
    pontos = { el, itens, selec: new Set(), arraste: null };
    if (!itens.length) avisar({ tipo: "aviso", texto: "Clique na letra ou forma que você quer editar (Shift+clique soma outra)" });
    sel = [el]; mv && (mv.target = []); hoverBox.style.display = "none";
    desenharPontos(); avisarSelecao(); return true;
  }
  function sairPontos() {
    if (!pontos) return;
    const el = pontos.el; pontos = null; pontosSvg.innerHTML = "";
    if (el.isConnected) { sel = [el]; aplicarSelecao(); }
  }
  const ctmDe = (node) => DOMMatrix.fromMatrix(node.getScreenCTM());
  const naTela = (m, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: q.x, y: q.y }; };
  const doMouse = (m, x, y) => { const q = new DOMPoint(x, y).matrixTransform(m.inverse()); return new (papel().Point)(q.x, q.y); };
  function segmentos() {
    const out = [];
    pontos.itens.forEach((d, i) => { const m = ctmDe(d.node); d.it.children.forEach((path) => path.segments.forEach((s) => out.push({ s, d, m, path }))); });
    return out;
  }
  function desenharPontos() {
    if (!pontos) { pontosSvg.innerHTML = ""; return; }
    const ac = getComputedStyle(doc.documentElement).getPropertyValue("--pc-acento").trim() || "#ff3d9a";
    let h = "";
    pontos.itens.forEach((d) => { const c = d.it.clone({ insert: false }); c.transform(matrizPaper(ctmDe(d.node))); h += `<path d="${c.pathData}" fill="none" stroke="${ac}" stroke-width="1.2"/>`; });
    const segs = segmentos(), selec = pontos.selec;
    segs.forEach(({ s, m }) => {
      // alças: do ponto selecionado e dos vizinhos (como no Illustrator)
      const mostra = selec.has(s) || (s.previous && selec.has(s.previous)) || (s.next && selec.has(s.next));
      if (!mostra) return;
      const a = naTela(m, s.point);
      [["in", s.handleIn], ["out", s.handleOut]].forEach(([k, hd]) => {
        if (hd.isZero()) return; const t = naTela(m, s.point.add(hd));
        h += `<line x1="${a.x}" y1="${a.y}" x2="${t.x}" y2="${t.y}" stroke="${ac}" stroke-width="1"/><circle cx="${t.x}" cy="${t.y}" r="4" fill="#fff" stroke="${ac}" stroke-width="1.5"/>`;
      });
    });
    segs.forEach(({ s, m }) => { const a = naTela(m, s.point), on = selec.has(s);
      h += `<rect x="${a.x - 4}" y="${a.y - 4}" width="8" height="8" fill="${on ? ac : "#fff"}" stroke="${ac}" stroke-width="1.5"/>`; });
    if (pontos.laco) { const l = pontos.laco; h += `<rect x="${Math.min(l.x0, l.x1)}" y="${Math.min(l.y0, l.y1)}" width="${Math.abs(l.x1 - l.x0)}" height="${Math.abs(l.y1 - l.y0)}" fill="${ac}" fill-opacity=".08" stroke="${ac}" stroke-dasharray="3 3"/>`; }
    pontosSvg.innerHTML = h;
  }
  function gravarPontos(final) {
    if (!pontos) return;
    const { el, itens } = pontos;
    itens.forEach((d) => d.node.setAttribute("d", d.it.pathData));
    if (!final || !itens.length) return;
    // a caixa do <svg> se ajusta aos pontos novos (o viewBox acompanha)
    const vb = el.viewBox.baseVal, cb = caixa(el), w0 = cb.w, h0 = cb.h;
    const sx = vb.width ? w0 / vb.width : 1, sy = vb.height ? h0 / vb.height : 1;
    // a caixa considera TODAS as formas do <svg> (as que não estão em edição também)
    let b = itens.map((d) => d.it.bounds).reduce((a, x) => a.unite(x));
    el.querySelectorAll(FORMAS_SVG).forEach((n) => { if (itens.some((d) => d.node === n)) return; try { const q = n.getBBox(); b = b.unite(new (papel().Rectangle)(q.x, q.y, q.width, q.height)); } catch (e) {} });
    const bw = Math.max(b.width, 1 / sx), bh = Math.max(b.height, 1 / sy);
    if (!ehAuto(el.parentElement)) moverPor(el, (b.x - vb.x) * sx, (b.y - vb.y) * sy);
    el.style.width = bw * sx + "px"; el.style.height = bh * sy + "px";
    el.setAttribute("viewBox", `${b.x} ${b.y} ${bw} ${bh}`);
    mudou(); desenharPontos();
  }
  function acharNoPonto(x, y) {
    const segs = segmentos(), selec = pontos.selec;
    for (const g of segs) { // alças primeiro (ficam por cima)
      const { s, m } = g, mostra = selec.has(s) || (s.previous && selec.has(s.previous)) || (s.next && selec.has(s.next));
      if (!mostra) continue;
      for (const k of ["handleIn", "handleOut"]) { if (s[k].isZero()) continue; const t = naTela(m, s.point.add(s[k])); if (Math.hypot(t.x - x, t.y - y) < 7) return { tipo: "alca", k, ...g }; }
    }
    for (const g of segs) { const a = naTela(g.m, g.s.point); if (Math.hypot(a.x - x, a.y - y) < 7) return { tipo: "ponto", ...g }; }
    for (const d of pontos.itens) { // no traço
      const m = ctmDe(d.node), p = doMouse(m, x, y), loc = d.it.getNearestLocation(p);
      if (loc) { const t = naTela(m, loc.point); if (Math.hypot(t.x - x, t.y - y) < 6) return { tipo: "traco", loc, d, m }; }
    }
    return null;
  }
  const lisa = (s) => !s.handleIn.isZero() && !s.handleOut.isZero() && Math.abs(Math.abs(s.handleIn.angle - s.handleOut.angle) - 180) < 4;
  function pontosDown(e) {
    const x = e.clientX, y = e.clientY, alvo = acharNoPonto(x, y);
    if (ferramenta === "maisPonto") {
      if (alvo && alvo.tipo === "traco") { const nv = alvo.loc.path.divideAt(alvo.loc); if (nv) { pontos.selec = new Set([nv.firstSegment || nv]); } gravarPontos(true); }
      return;
    }
    if (ferramenta === "menosPonto") {
      if (alvo && alvo.tipo === "ponto") { removerPontos([alvo.s]); }
      return;
    }
    if (ferramenta === "converter") {
      if (alvo && alvo.tipo === "ponto") {
        if (alvo.s.hasHandles()) { alvo.s.clearHandles(); gravarPontos(true); return; }
        pontos.selec = new Set([alvo.s]); pontos.arraste = { tipo: "puxarAlca", s: alvo.s, m: alvo.m }; return;
      }
      if (alvo && alvo.tipo === "alca") { pontos.arraste = { tipo: "alca", ...alvo, solta: true }; return; }
      return;
    }
    // seleção direta
    if (alvo && alvo.tipo === "alca") { pontos.arraste = { tipo: "alca", ...alvo, solta: e.altKey }; return; }
    if (alvo && alvo.tipo === "ponto") {
      if (shift) { pontos.selec.has(alvo.s) ? pontos.selec.delete(alvo.s) : pontos.selec.add(alvo.s); }
      else if (!pontos.selec.has(alvo.s)) pontos.selec = new Set([alvo.s]);
      const ini = new Map(Array.from(pontos.selec).map((s) => [s, s.point.clone()]));
      pontos.arraste = { tipo: "pontos", x0: x, y0: y, ini };
      desenharPontos(); return;
    }
    if (alvo && alvo.tipo === "traco") { // clicou no traço: seleciona as 2 pontas daquele trecho
      const c = alvo.loc.curve; pontos.selec = shift ? new Set([...pontos.selec, c.segment1, c.segment2]) : new Set([c.segment1, c.segment2]);
      const ini = new Map(Array.from(pontos.selec).map((s) => [s, s.point.clone()]));
      pontos.arraste = { tipo: "pontos", x0: x, y0: y, ini }; desenharPontos(); return;
    }
    // clique em outro elemento: troca o que está sendo editado (ou sai)
    const outro = camadaDe(e.target, true);
    if (outro && outro === pontos.el) { // outra letra/forma do mesmo vetor
      const pth = e.target.closest && e.target.closest("path");
      if (pth && !pontos.itens.some((d) => d.node === pth)) {
        gravarPontos(true);
        if (shift) { pontos.itens.push({ node: pth, it: new (papel().CompoundPath)({ pathData: pth.getAttribute("d") || "" }) }); desenharPontos(); }
        else entrarPontos(outro, pth);
        return;
      }
    }
    if (outro && outro !== pontos.el) { gravarPontos(true); const ok = entrarPontos(outro); if (!ok) { sairPontos(); usarFerramenta("mover"); sel = [outro]; aplicarSelecao(); } return; }
    if (!shift) pontos.selec = new Set();
    pontos.laco = { x0: x, y0: y, x1: x, y1: y }; desenharPontos();
  }
  function pontosMove(e) {
    const a = pontos.arraste, x = e.clientX, y = e.clientY;
    if (pontos.laco && !a) {
      pontos.laco.x1 = x; pontos.laco.y1 = y;
      const l = pontos.laco, x0 = Math.min(l.x0, x), x1 = Math.max(l.x0, x), y0 = Math.min(l.y0, y), y1 = Math.max(l.y0, y);
      pontos.selecLaco = new Set(segmentos().filter(({ s, m }) => { const p = naTela(m, s.point); return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; }).map((g) => g.s));
      desenharPontos(); return;
    }
    if (!a) return;
    if (a.tipo === "pontos") {
      a.ini.forEach((p0, s) => { const m = ctmDe(itemNode(s)); const d0 = doMouse(m, a.x0, a.y0), d1 = doMouse(m, x, y); let dv = d1.subtract(d0);
        if (shift) dv = Math.abs(dv.x) > Math.abs(dv.y) ? new (papel().Point)(dv.x, 0) : new (papel().Point)(0, dv.y);
        s.point = p0.add(dv); });
    } else if (a.tipo === "alca") {
      const s = a.s, p = doMouse(a.m, x, y).subtract(s.point), outra = a.k === "handleIn" ? "handleOut" : "handleIn";
      const eraLisa = !a.solta && lisa(s);
      s[a.k] = p;
      if (eraLisa) { const len = s[outra].length; s[outra] = p.normalize(-len); }
    } else if (a.tipo === "puxarAlca") {
      const s = a.s, p = doMouse(a.m, x, y).subtract(s.point); s.handleOut = p; s.handleIn = p.multiply(-1);
    }
    gravarPontos(false); desenharPontos();
  }
  // de qual <path> do DOM é este segmento
  function itemNode(s) { let it = s.path; while (it.parent && it.parent.className === "CompoundPath") it = it.parent; const d = pontos.itens.find((x) => x.it === it); return (d && d.node) || pontos.itens[0].node; }
  function pontosUp() {
    if (pontos.laco) { if (pontos.selecLaco) pontos.selec = new Set([...pontos.selec, ...pontos.selecLaco]); pontos.laco = null; pontos.selecLaco = null; desenharPontos(); return; }
    if (pontos.arraste) { pontos.arraste = null; gravarPontos(true); }
  }
  function removerPontos(lista) {
    lista.forEach((s) => { const path = s.path; s.remove(); if (path.segments.length < 2) path.remove(); });
    pontos.itens = pontos.itens.filter((d) => { if (!d.it.children.length) { d.node.remove(); return false; } return true; });
    pontos.selec = new Set();
    if (!pontos.itens.length) { const el = pontos.el; pontos = null; pontosSvg.innerHTML = ""; el.remove(); sel = []; aplicarSelecao(); mudou(); usarFerramenta("mover"); return; }
    gravarPontos(true);
  }
  function pontosTecla(e) {
    const k = e.key;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); if (pontos.selec.size) removerPontos(Array.from(pontos.selec)); return true; }
    if (k.startsWith("Arrow") && pontos.selec.size) {
      e.preventDefault(); const d = (e.shiftKey ? 10 : 1);
      pontos.selec.forEach((s) => { const m = ctmDe(itemNode(s)), z = Math.hypot(m.a, m.b) / vista.z || 1;
        s.point = s.point.add(new (papel().Point)(k === "ArrowLeft" ? -d / z : k === "ArrowRight" ? d / z : 0, k === "ArrowUp" ? -d / z : k === "ArrowDown" ? d / z : 0)); });
      gravarPontos(false); desenharPontos(); clearTimeout(pontosTecla.t); pontosTecla.t = setTimeout(() => gravarPontos(true), 350); return true;
    }
    if (k === "Escape" || k === "Enter") { e.preventDefault(); sairPontos(); usarFerramenta("mover"); return true; }
    if (k.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pontos.selec = new Set(segmentos().map((g) => g.s)); desenharPontos(); return true; }
    return false;
  }

  /* ---------- 12i. efeitos: vidro, desfoque e sombra ---------- */
  function lerFx(el) { try { return JSON.parse(el.getAttribute("data-fx") || "{}"); } catch (e) { return {}; } }
  function corComAlfa(c, a) {
    c = String(c || "").trim();
    let h = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (h) { let x = h[1]; if (x.length === 3) x = x.split("").map((q) => q + q).join(""); return `rgba(${parseInt(x.slice(0, 2), 16)},${parseInt(x.slice(2, 4), 16)},${parseInt(x.slice(4, 6), 16)},${a})`; }
    const m = c.match(/\d+(\.\d+)?/g); if (!m || m.length < 3) return `rgba(255,255,255,${a})`;
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  }
  function aplicarFx(el) {
    const fx = lerFx(el), s = el.style, vet = ehVetor(el);
    ["backdrop-filter", "-webkit-backdrop-filter", "filter", "clip-path"].forEach((p) => s.removeProperty(p));
    if (fx.vidro) {
      const v = fx.vidro, f = `blur(${v.blur}px) saturate(${v.sat}%)`;
      s.setProperty("backdrop-filter", f); s.setProperty("-webkit-backdrop-filter", f);
      if (vet) {
        // vetor: o desfoque fica recortado no formato do desenho
        const d = itemDe(el); if (d) { const p = noPr(el), c = d.it.clone({ insert: false }); c.translate(new (papel().Point)(-p.x, -p.y)); s.setProperty("clip-path", `path('${c.pathData}')`); }
        el.querySelectorAll(FORMAS_SVG).forEach((n) => n.setAttribute("fill-opacity", v.alfa));
      } else {
        s.background = corComAlfa(fx.cor || "rgb(255,255,255)", v.alfa);
        s.border = `1px solid rgba(255,255,255,${(v.brilho * 0.55).toFixed(2)})`;
        s.boxShadow = `inset 0 1px 1px rgba(255,255,255,${(v.brilho * 0.9).toFixed(2)}), inset 0 -1px 1px rgba(255,255,255,${(v.brilho * 0.25).toFixed(2)})`;
      }
    } else if (fx.corOriginal !== undefined) {
      if (!vet) { s.background = fx.corOriginal; s.removeProperty("border"); s.removeProperty("box-shadow"); }
      else el.querySelectorAll(FORMAS_SVG).forEach((n) => n.removeAttribute("fill-opacity"));
    }
    const filtros = [];
    if (fx.desfoque) filtros.push(`blur(${fx.desfoque}px)`);
    if (fx.sombra) { const o = fx.sombra; filtros.push(`drop-shadow(${o.x}px ${o.y}px ${o.blur}px ${corComAlfa(o.cor || "rgb(0,0,0)", o.alfa)})`); }
    if (filtros.length) s.filter = filtros.join(" ");
  }
  function efeitos(fx, vivo) {
    sel.filter((e) => e !== pr).forEach((el) => {
      const atual = lerFx(el), novo = { ...atual };
      Object.entries(fx).forEach(([k, v]) => { if (v === null || v === 0 || v === false) delete novo[k]; else novo[k] = v; });
      // o vidro guarda a cor de antes, pra voltar quando ele sai
      if (novo.vidro && !atual.vidro && !ehVetor(el)) { novo.cor = corSolida(el); novo.corOriginal = el.style.background || ""; }
      el.setAttribute("data-fx", JSON.stringify(novo)); aplicarFx(el);
      if (!novo.vidro) { delete novo.cor; delete novo.corOriginal; }
      if (Object.keys(novo).length) el.setAttribute("data-fx", JSON.stringify(novo)); else el.removeAttribute("data-fx");
    });
    if (vivo) avisarSelecao(); else mudou();
  }

  /* ---------- 12j. máscara de pintura na imagem (fase 3, como a máscara de camada do Photoshop) ---------- */
  // a máscara é um PNG com transparência (opaco = aparece), do tamanho da foto inteira; o CSS posiciona ela junto com o corte
  function normalizarImagem(el) {
    let ins = lerInset(el); if (ins) return ins;
    const B = noPr(el), nw = el.naturalWidth, nh = el.naturalHeight, fit = getComputedStyle(el).objectFit;
    let F;
    if (fit === "fill" || !nw) F = { ...B };
    else { const s = fit === "contain" ? Math.min(B.w / nw, B.h / nh) : Math.max(B.w / nw, B.h / nh); F = { w: nw * s, h: nh * s }; F.x = B.x + (B.w - F.w) / 2; F.y = B.y + (B.h - F.h) / 2; }
    const C = { x: Math.max(B.x, F.x), y: Math.max(B.y, F.y) }; C.w = Math.min(B.x + B.w, F.x + F.w) - C.x; C.h = Math.min(B.y + B.h, F.y + F.h) - C.y;
    ins = { l: (C.x - F.x) / F.w, t: (C.y - F.y) / F.h, r: (F.x + F.w - C.x - C.w) / F.w, b: (F.y + F.h - C.y - C.h) / F.h };
    const pc = (v) => Math.max(0, Math.round(v * 10000) / 100) + "%";
    el.style.objectViewBox = `inset(${pc(ins.t)} ${pc(ins.r)} ${pc(ins.b)} ${pc(ins.l)})`; el.style.objectFit = "fill"; el.style.boxSizing = "border-box";
    if (C.w !== B.w || C.h !== B.h) { el.style.width = C.w + "px"; el.style.height = C.h + "px"; if (!ehAuto(el.parentElement)) moverPor(el, C.x - B.x, C.y - B.y); }
    return ins;
  }
  const PROPS_MASC_IMG = ["mask-image", "mask-size", "mask-position", "mask-repeat", "-webkit-mask-image", "-webkit-mask-size", "-webkit-mask-position", "-webkit-mask-repeat"];
  function aplicarMascaraImg(el) {
    const src = el.dataset.mascaraImg;
    if (!src) { PROPS_MASC_IMG.forEach((p) => el.style.removeProperty(p)); return; }
    const i = lerInset(el) || { l: 0, t: 0, r: 0, b: 0 };
    const kx = 1 / Math.max(0.0001, 1 - i.l - i.r), ky = 1 / Math.max(0.0001, 1 - i.t - i.b);
    const px = i.l + i.r > 0.0001 ? (i.l / (i.l + i.r)) * 100 : 0, py = i.t + i.b > 0.0001 ? (i.t / (i.t + i.b)) * 100 : 0;
    ["", "-webkit-"].forEach((pf) => {
      el.style.setProperty(pf + "mask-image", `url("${src}")`); el.style.setProperty(pf + "mask-size", `${kx * 100}% ${ky * 100}%`);
      el.style.setProperty(pf + "mask-position", `${px}% ${py}%`); el.style.setProperty(pf + "mask-repeat", "no-repeat");
    });
  }
  function definirMascaraImg(id, src) {
    const el = porId(id); if (!el || el.tagName !== "IMG") return;
    normalizarImagem(el);
    if (src) el.dataset.mascaraImg = src; else delete el.dataset.mascaraImg;
    aplicarMascaraImg(el); sel = [el]; aplicarSelecao(); mudou();
  }

  let pint = null;
  const pintBox = doc.createElement("div"); pintBox.style.cssText = "position:fixed;inset:0;display:none;pointer-events:none"; over.appendChild(pintBox);
  const MAX_MASC = 1600;
  const novoCanvas = (w, h) => { const c = doc.createElement("canvas"); c.width = w; c.height = h; return c; };
  function carregarImagem(src) { return new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error("não consegui abrir a imagem")); i.src = src; }); }
  async function entrarPintura(el) {
    el = el || (sel.length === 1 ? sel[0] : null);
    if (!el || el.tagName !== "IMG") { aviso("Selecione uma imagem pra pintar a máscara"); return; }
    if (!el.naturalWidth) { aviso("A imagem ainda está carregando"); return; }
    const tf = getComputedStyle(el).transform; if (tf && tf !== "none" && !/^matrix\(1, 0, 0, 1,/.test(tf)) { aviso("Desgire a imagem pra pintar a máscara (a pintura ainda não funciona com a imagem girada)"); return; }
    if (editando) pararEdicao(); if (corte) concluirCorte();
    const ins = normalizarImagem(el);
    const nw = el.naturalWidth, nh = el.naturalHeight, k = Math.min(1, MAX_MASC / Math.max(nw, nh));
    const mw = Math.round(nw * k), mh = Math.round(nh * k);
    const mascara = novoCanvas(mw, mh), mx = mascara.getContext("2d");
    if (el.dataset.mascaraImg) { try { const m = await carregarImagem(el.dataset.mascaraImg); mx.drawImage(m, 0, 0, mw, mh); } catch (e) { mx.fillRect(0, 0, mw, mh); } }
    else mx.fillRect(0, 0, mw, mh);
    const img = await carregarImagem(el.currentSrc || el.src);
    const vis = doc.createElement("canvas"); vis.style.cssText = "position:fixed;pointer-events:none";
    const formigas = doc.createElementNS(NS, "svg"); formigas.setAttribute("style", "position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none");
    const cursor = doc.createElement("div"); cursor.style.cssText = "position:fixed;border:1.5px solid #fff;outline:1px solid rgba(0,0,0,.55);border-radius:50%;pointer-events:none;display:none;transform:translate(-50%,-50%)";
    pintBox.innerHTML = ""; pintBox.append(vis, formigas, cursor); pintBox.style.display = "";
    pint = { el, ins, nw, nh, mw, mh, k, mascara, mx, img, vis, formigas, cursor, traco: novoCanvas(mw, mh), selMask: null, selGeo: [], selInv: false,
      ferr: "pincel", cor: "preto", tam: 120, dureza: 0.6, forca: 1, esmaecer: 0, verMascara: false, desfazer: [], refazer: [], arraste: null };
    el.style.visibility = "hidden"; mv && (mv.target = []); hoverBox.style.display = "none";
    doc.body.classList.add("pc-pintando");
    desenharPintura(); avisarPintura();
  }
  function avisarPintura() {
    if (!pint) { avisar({ tipo: "pintura", ativo: false }); return; }
    const p = pint; avisar({ tipo: "pintura", ativo: true, ferr: p.ferr, cor: p.cor, tam: p.tam, dureza: p.dureza, forca: p.forca, esmaecer: p.esmaecer,
      temSelecao: !!p.selMask, verMascara: p.verMascara, podeDesfazer: p.desfazer.length > 0 });
  }
  function geoPint() {
    const R = pint.el.getBoundingClientRect(), { l, t, r, b } = pint.ins;
    const Fw = R.width / Math.max(0.0001, 1 - l - r), Fh = R.height / Math.max(0.0001, 1 - t - b);
    return { R, Fx: R.left - l * Fw, Fy: R.top - t * Fh, Fw, Fh };
  }
  const telaParaMasc = (g, x, y) => ({ x: ((x - g.Fx) / g.Fw) * pint.mw, y: ((y - g.Fy) / g.Fh) * pint.mh });
  const mascParaTela = (g, x, y) => ({ x: g.Fx + (x / pint.mw) * g.Fw, y: g.Fy + (y / pint.mh) * g.Fh });
  // a máscara "efetiva" = a salva + o traço em andamento (recortado pela seleção)
  function mascaraEfetiva() {
    const p = pint; if (!p.arraste || p.arraste.tipo !== "pincel") return p.mascara;
    const c = p.tmpEf || (p.tmpEf = novoCanvas(p.mw, p.mh)), x = c.getContext("2d");
    x.globalCompositeOperation = "copy"; x.globalAlpha = 1; x.drawImage(p.mascara, 0, 0);
    x.globalAlpha = p.forca; x.globalCompositeOperation = p.cor === "branco" ? "source-over" : "destination-out";
    x.drawImage(tracoRecortado(), 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    return c;
  }
  function tracoRecortado() {
    const p = pint; if (!p.selMask) return p.traco;
    const c = p.tmpTr || (p.tmpTr = novoCanvas(p.mw, p.mh)), x = c.getContext("2d");
    x.globalCompositeOperation = "copy"; x.drawImage(p.traco, 0, 0); x.globalCompositeOperation = "destination-in"; x.drawImage(p.selMask, 0, 0); x.globalCompositeOperation = "source-over";
    return c;
  }
  let pedidoPint = 0;
  function desenharPintura() {
    if (!pint || pedidoPint) return;
    pedidoPint = requestAnimationFrame(() => {
      pedidoPint = 0; if (!pint) return;
      const p = pint, g = geoPint(), R = g.R, { l, t, r, b } = p.ins;
      const dpr = Math.min(2, win.devicePixelRatio || 1), cw = Math.max(1, Math.min(2400, Math.round(R.width * dpr))), ch = Math.max(1, Math.round(cw * R.height / Math.max(1, R.width)));
      const v = p.vis; if (v.width !== cw || v.height !== ch) { v.width = cw; v.height = ch; }
      Object.assign(v.style, { left: R.left + "px", top: R.top + "px", width: R.width + "px", height: R.height + "px" });
      const x = v.getContext("2d"); x.clearRect(0, 0, cw, ch); x.globalCompositeOperation = "source-over";
      x.drawImage(p.img, l * p.nw, t * p.nh, (1 - l - r) * p.nw, (1 - t - b) * p.nh, 0, 0, cw, ch);
      const ef = mascaraEfetiva(), sx = l * p.mw, sy = t * p.mh, sw = (1 - l - r) * p.mw, sh = (1 - t - b) * p.mh;
      if (p.verMascara) {
        // "ver máscara" (\): a foto inteira + vermelho onde está escondido (como a máscara rápida do Photoshop)
        const red = p.tmpRed || (p.tmpRed = novoCanvas(p.mw, p.mh)), rx = red.getContext("2d");
        rx.globalCompositeOperation = "copy"; rx.fillStyle = "rgba(255,0,60,.55)"; rx.fillRect(0, 0, p.mw, p.mh);
        rx.globalCompositeOperation = "destination-out"; rx.drawImage(ef, 0, 0); rx.globalCompositeOperation = "source-over";
        x.drawImage(red, sx, sy, sw, sh, 0, 0, cw, ch);
      } else { x.globalCompositeOperation = "destination-in"; x.drawImage(ef, sx, sy, sw, sh, 0, 0, cw, ch); x.globalCompositeOperation = "source-over"; }
      desenharFormigas(g);
    });
  }
  function caminhoDaGeo(c, geo) {
    c.beginPath();
    if (geo.tipo === "ret") c.rect(geo.x, geo.y, geo.w, geo.h);
    else if (geo.tipo === "eli") c.ellipse(geo.x + geo.w / 2, geo.y + geo.h / 2, Math.abs(geo.w / 2), Math.abs(geo.h / 2), 0, 0, Math.PI * 2);
    else if (geo.tipo === "poli") { geo.pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); }
  }
  function refazerSelecao() {
    const p = pint; if (!p.selGeo.length && !p.selIA) { p.selMask = null; desenharPintura(); avisarPintura(); return; }
    const base = novoCanvas(p.mw, p.mh), bx = base.getContext("2d");
    if (p.selIA) bx.drawImage(p.selIA, 0, 0, p.mw, p.mh);
    p.selGeo.forEach((geo) => { bx.globalCompositeOperation = geo.modo === "sub" ? "destination-out" : "source-over"; bx.fillStyle = "#000"; caminhoDaGeo(bx, geo); bx.fill(); });
    bx.globalCompositeOperation = "source-over";
    let fin = base;
    if (p.selInv) { const c = novoCanvas(p.mw, p.mh), cx = c.getContext("2d"); cx.fillRect(0, 0, p.mw, p.mh); cx.globalCompositeOperation = "destination-out"; cx.drawImage(base, 0, 0); fin = c; }
    const esm = (p.esmaecer * vistaMascEscala());
    if (esm > 0.3) { const c = novoCanvas(p.mw, p.mh), cx = c.getContext("2d"); cx.filter = `blur(${esm}px)`; cx.drawImage(fin, 0, 0); fin = c; }
    p.selMask = fin; desenharPintura(); avisarPintura();
  }
  // 1px da prancheta = quantos px da máscara
  const vistaMascEscala = () => { const g = geoPint(); return (pint.mw / g.Fw) * vista.z; };
  function desenharFormigas(g) {
    const p = pint; let h = "";
    const linha = (d) => `<path d="${d}" fill="none" stroke="#000" stroke-width="1"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 4" class="pc-formiga"/>`;
    const geos = p.selGeo.concat(p.arraste && p.arraste.geo ? [p.arraste.geo] : []);
    geos.forEach((geo) => {
      if (geo.tipo === "poli") { if (geo.pts.length > 1) h += linha("M" + geo.pts.map((q) => { const s = mascParaTela(g, q.x, q.y); return s.x + " " + s.y; }).join(" L") + (geo === (p.arraste && p.arraste.geo) ? "" : " Z")); }
      else { const a = mascParaTela(g, geo.x, geo.y), b = mascParaTela(g, geo.x + geo.w, geo.y + geo.h), x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
        h += linha(geo.tipo === "ret" ? `M${x0} ${y0} h${w} v${hh} h${-w} Z` : `M${x0} ${y0 + hh / 2} a${w / 2} ${hh / 2} 0 1 0 ${w} 0 a${w / 2} ${hh / 2} 0 1 0 ${-w} 0`); }
    });
    if (p.selIA && !p.selGeo.length) h += `<text x="${g.R.left + 8}" y="${g.R.top + 18}" fill="#fff" stroke="#000" stroke-width=".5" font-size="12" font-family="Raleway,system-ui" font-weight="700">objeto selecionado pela IA</text>`;
    if (p.selInv) { const R = g.R; h += linha(`M${R.left} ${R.top} h${R.width} v${R.height} h${-R.width} Z`); }
    p.formigas.innerHTML = h;
  }
  function guardarDesfazer() {
    const p = pint, c = novoCanvas(p.mw, p.mh); c.getContext("2d").drawImage(p.mascara, 0, 0);
    p.desfazer.push(c); if (p.desfazer.length > 12) p.desfazer.shift(); p.refazer = [];
  }
  function pintDesfazer(refazer) {
    const p = pint, de = refazer ? p.refazer : p.desfazer, para = refazer ? p.desfazer : p.refazer;
    const c = de.pop(); if (!c) return;
    const atual = novoCanvas(p.mw, p.mh); atual.getContext("2d").drawImage(p.mascara, 0, 0); para.push(atual);
    p.mx.globalCompositeOperation = "copy"; p.mx.drawImage(c, 0, 0); p.mx.globalCompositeOperation = "source-over";
    desenharPintura(); avisarPintura();
  }
  function carimbo(x, y) {
    const p = pint, c = p.traco.getContext("2d"), r = Math.max(0.5, (p.tam / 2) * vistaMascEscala());
    const gr = c.createRadialGradient(x, y, r * Math.min(0.98, p.dureza), x, y, r);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = p.dureza >= 0.99 ? "#000" : gr; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  function pintDown(e) {
    const p = pint, g = geoPint(), m = telaParaMasc(g, e.clientX, e.clientY);
    if (e.button === 1 || espaco) return false; // deixa o pan acontecer
    if (p.ferr === "pincel") {
      p.traco.getContext("2d").clearRect(0, 0, p.mw, p.mh);
      p.arraste = { tipo: "pincel", ult: m }; carimbo(m.x, m.y); desenharPintura(); return true;
    }
    const modo = e.altKey ? "sub" : shift ? "add" : "novo";
    if (modo === "novo") { p.selGeo = []; p.selIA = null; p.selInv = false; }
    const geo = p.ferr === "laco" ? { tipo: "poli", pts: [m], modo } : { tipo: p.ferr === "eliSel" ? "eli" : "ret", x: m.x, y: m.y, w: 0, h: 0, modo };
    p.arraste = { tipo: "sel", geo, ini: m }; desenharPintura(); return true;
  }
  function pintMove(e) {
    const p = pint, g = geoPint(), m = telaParaMasc(g, e.clientX, e.clientY);
    const rTela = (p.tam / 2) * vista.z;
    Object.assign(p.cursor.style, { display: p.ferr === "pincel" ? "" : "none", left: e.clientX + "px", top: e.clientY + "px", width: rTela * 2 + "px", height: rTela * 2 + "px" });
    const a = p.arraste; if (!a) return;
    if (a.tipo === "pincel") {
      const r = Math.max(0.5, (p.tam / 2) * vistaMascEscala()), passo = Math.max(1, r * 0.18), dx = m.x - a.ult.x, dy = m.y - a.ult.y, dist = Math.hypot(dx, dy);
      for (let i = passo; i <= dist; i += passo) carimbo(a.ult.x + (dx * i) / dist, a.ult.y + (dy * i) / dist);
      if (dist >= passo) a.ult = m;
    } else if (a.geo.tipo === "poli") a.geo.pts.push(m);
    else { let w = m.x - a.ini.x, h = m.y - a.ini.y; if (shift && a.geo.modo !== "add") { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      Object.assign(a.geo, { x: w < 0 ? a.ini.x + w : a.ini.x, y: h < 0 ? a.ini.y + h : a.ini.y, w: Math.abs(w), h: Math.abs(h) }); }
    desenharPintura();
  }
  function pintUp() {
    const p = pint, a = p.arraste; if (!a) return;
    if (a.tipo === "pincel") {
      guardarDesfazer();
      p.mx.globalAlpha = p.forca; p.mx.globalCompositeOperation = p.cor === "branco" ? "source-over" : "destination-out";
      p.mx.drawImage(tracoRecortado(), 0, 0); p.mx.globalAlpha = 1; p.mx.globalCompositeOperation = "source-over";
      p.traco.getContext("2d").clearRect(0, 0, p.mw, p.mh);
    } else {
      const geo = a.geo, valido = geo.tipo === "poli" ? geo.pts.length > 2 : geo.w > 2 && geo.h > 2;
      if (valido) p.selGeo.push(geo);
      else if (a.geo.modo === "novo") { p.selGeo = []; p.selIA = null; p.selInv = false; }
      p.arraste = null; refazerSelecao(); return;
    }
    p.arraste = null; desenharPintura(); avisarPintura();
  }
  // ações da barra (e dos atalhos) no modo pintura
  function pintAcao(acao, arg) {
    const p = pint; if (!p) return;
    const mx = p.mx, todo = (fn) => { guardarDesfazer(); fn(); mx.globalCompositeOperation = "source-over"; mx.globalAlpha = 1; desenharPintura(); avisarPintura(); };
    switch (acao) {
      case "param": Object.assign(p, arg || {}); if (arg && arg.esmaecer !== undefined) refazerSelecao(); if (arg && arg.ferr) p.cursor.style.display = "none"; avisarPintura(); desenharPintura(); return;
      case "trocarCor": p.cor = p.cor === "preto" ? "branco" : "preto"; avisarPintura(); return;
      case "verMascara": p.verMascara = !p.verMascara; desenharPintura(); avisarPintura(); return;
      case "apagarSel": if (!p.selMask) return aviso("Faça uma seleção primeiro (L laço, M retângulo)"); todo(() => { mx.globalCompositeOperation = "destination-out"; mx.drawImage(p.selMask, 0, 0); }); return;
      case "mostrarSel": if (!p.selMask) return; todo(() => { mx.drawImage(p.selMask, 0, 0); }); return;
      case "manterSel": if (!p.selMask) return aviso("Faça uma seleção primeiro (L laço, M retângulo)"); todo(() => { mx.globalCompositeOperation = "destination-in"; mx.drawImage(p.selMask, 0, 0); }); return;
      case "inverterSel": if (!p.selGeo.length && !p.selIA) return; p.selInv = !p.selInv; refazerSelecao(); return;
      case "desmarcar": p.selGeo = []; p.selIA = null; p.selInv = false; refazerSelecao(); return;
      case "inverterMascara": todo(() => { const c = novoCanvas(p.mw, p.mh), cx = c.getContext("2d"); cx.fillRect(0, 0, p.mw, p.mh); cx.globalCompositeOperation = "destination-out"; cx.drawImage(p.mascara, 0, 0); mx.globalCompositeOperation = "copy"; mx.drawImage(c, 0, 0); }); return;
      case "mostrarTudo": todo(() => { mx.globalCompositeOperation = "copy"; mx.fillStyle = "#000"; mx.fillRect(0, 0, p.mw, p.mh); }); return;
      case "desfazer": pintDesfazer(false); return;
      case "refazer": pintDesfazer(true); return;
      case "mascaraIA": case "selecaoIA": {
        // vem do Estúdio: a máscara da IA (PNG com transparência, no tamanho da foto)
        carregarImagem(arg).then((m) => {
          if (acao === "mascaraIA") todo(() => { mx.globalCompositeOperation = "copy"; mx.drawImage(m, 0, 0, p.mw, p.mh); });
          else { p.selGeo = []; p.selInv = false; p.selIA = m; refazerSelecao(); }
        }).catch(() => aviso("não consegui ler a máscara da IA"));
        return;
      }
      case "concluir": concluirPintura(); return;
      case "cancelar": sairPintura(); return;
    }
  }
  function sairPintura() {
    const p = pint; if (!p) return; pint = null;
    pintBox.style.display = "none"; pintBox.innerHTML = ""; doc.body.classList.remove("pc-pintando");
    p.el.style.visibility = ""; sel = [p.el]; aplicarSelecao(); avisarPintura();
  }
  async function concluirPintura() {
    const p = pint; if (!p) return;
    const dados = p.mx.getImageData(0, 0, p.mw, p.mh).data; let tudo = true;
    for (let i = 3; i < dados.length; i += 4) if (dados[i] < 255) { tudo = false; break; }
    if (tudo) { delete p.el.dataset.mascaraImg; aplicarMascaraImg(p.el); sairPintura(); mudou(); return; }
    avisar({ tipo: "aviso", texto: "Salvando a máscara…" });
    try {
      const id = decodeURIComponent((location.pathname.match(/\/post-arq\/([^/]+)/) || [])[1] || "");
      const base = String(p.el.getAttribute("src") || "imagem").split("/").pop().replace(/\.[a-z0-9]+$/i, "").replace(/-mascara.*$/, "");
      const r = await fetch("/api/posts/asset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, dataUrl: p.mascara.toDataURL("image/png"), nome: base + "-mascara.png" }) }).then((x) => x.json());
      if (!r || !r.ok) throw new Error((r && r.erro) || "falhou");
      p.el.dataset.mascaraImg = r.src; aplicarMascaraImg(p.el);
      sairPintura(); mudou();
    } catch (e) { aviso("Não consegui salvar a máscara (" + e.message + ")"); }
  }
  function pintTecla(e) {
    const k = e.key, mod = e.ctrlKey || e.metaKey, p = pint;
    if (mod && (k === "z" || k === "Z")) { e.preventDefault(); pintDesfazer(e.shiftKey); return; }
    if (mod && (k === "d" || k === "D")) { e.preventDefault(); pintAcao("desmarcar"); return; }
    if (mod && e.shiftKey && (k === "i" || k === "I")) { e.preventDefault(); pintAcao("inverterSel"); return; }
    if (k === "Enter") { e.preventDefault(); pintAcao("concluir"); return; }
    if (k === "Escape") { e.preventDefault(); if (p.selMask) pintAcao("desmarcar"); else pintAcao("cancelar"); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); pintAcao("apagarSel"); return; }
    if (k === "\\") { e.preventDefault(); pintAcao("verMascara"); return; }
    if (mod) return;
    const lk = k.toLowerCase();
    if (lk === "x") return pintAcao("trocarCor");
    if (lk === "b") return pintAcao("param", { ferr: "pincel" });
    if (lk === "l") return pintAcao("param", { ferr: "laco" });
    if (lk === "m") return pintAcao("param", { ferr: e.shiftKey ? "eliSel" : (p.ferr === "retSel" ? "eliSel" : "retSel") });
    if (k === "]" || k === "}") { e.preventDefault(); return e.shiftKey ? pintAcao("param", { dureza: Math.min(1, p.dureza + 0.1) }) : pintAcao("param", { tam: Math.round(p.tam * 1.2 + 1) }); }
    if (k === "[" || k === "{") { e.preventDefault(); return e.shiftKey ? pintAcao("param", { dureza: Math.max(0, p.dureza - 0.1) }) : pintAcao("param", { tam: Math.max(2, Math.round(p.tam / 1.2)) }); }
    if (/^[0-9]$/.test(k)) return pintAcao("param", { forca: k === "0" ? 1 : +k / 10 }); // como no Photoshop: 1 = 10%, 0 = 100%
  }

  /* ---------- 12k. criar contornos (texto → vetor, como o Ctrl+Shift+O do Illustrator) ---------- */
  // a fonte vem do Google em TTF (o Estúdio guarda no computador) e o opentype.js (MIT) dá o desenho de cada letra;
  // a posição de cada letra é a que o navegador já calculou (quebra de linha, espaçamento, kerning, alinhamento)
  const fontesOT = new Map();
  const GENERICAS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|-apple-system|emoji)$/i;
  async function fonteOT(fam, peso, ital) {
    const k = fam + "|" + peso + "|" + ital; if (fontesOT.has(k)) return fontesOT.get(k);
    const pr0 = fetch(`/api/fonte?familia=${encodeURIComponent(fam)}&peso=${peso}&italico=${ital ? 1 : 0}`)
      .then(async (r) => { if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || `não achei a fonte "${fam}"`); } return r.arrayBuffer(); })
      .then((b) => win.opentype.parse(b));
    fontesOT.set(k, pr0); pr0.catch(() => fontesOT.delete(k)); return pr0;
  }
  function familiaDe(cs) {
    const fams = cs.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    const f = fams.find((x) => !GENERICAS.test(x)); if (!f) throw new Error("esse texto usa a fonte do sistema; troque por uma fonte do Google antes");
    return f;
  }
  function trocarCaixa(ch, tt, inicioPalavra) {
    if (tt === "uppercase") return ch.toUpperCase();
    if (tt === "lowercase") return ch.toLowerCase();
    if (tt === "capitalize" && inicioPalavra) return ch.toUpperCase();
    return ch;
  }
  // a "tinta" da letra: cor sólida ou o degradê de um background-clip:text (no próprio elemento ou num pai)
  function tintaDe(no, raizTexto) {
    for (let e = no; e && raizTexto.contains(e); e = e.parentElement) {
      const c = getComputedStyle(e);
      if (((c.webkitBackgroundClip || c.backgroundClip) === "text") && c.backgroundImage && c.backgroundImage !== "none") return { grad: c.backgroundImage };
      if (e === raizTexto) break;
    }
    const c = getComputedStyle(no), f = c.webkitTextFillColor;
    return { cor: f && !/rgba\(0, 0, 0, 0\)|transparent/.test(f) ? f : c.color };
  }
  function gradSvg(css, id, cx) {
    const m = String(css).match(/linear-gradient\((.*)\)\s*$/); if (!m) return null;
    let corpo = m[1], ang = 180;
    const am = corpo.match(/^\s*(-?\d+(\.\d+)?)deg\s*,/), kw = corpo.match(/^\s*to ([a-z ]+),/);
    if (am) ang = +am[1]; else if (kw) ang = { top: 0, right: 90, bottom: 180, left: 270, "top right": 45, "right top": 45, "bottom right": 135, "right bottom": 135, "bottom left": 225, "left bottom": 225, "top left": 315, "left top": 315 }[kw[1].trim()] ?? 180;
    const cores = [...corpo.matchAll(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s*(\d+(\.\d+)?%)?/g)];
    if (cores.length < 2) return null;
    // a linha do degradê como no CSS: passa pelo centro da caixa, com o comprimento que cobre os cantos
    const a = (ang * Math.PI) / 180, sn = Math.sin(a), cs = Math.cos(a);
    const L = Math.abs(cx.width * sn) + Math.abs(cx.height * cs), mx = cx.x + cx.width / 2, my = cx.y + cx.height / 2;
    const x1 = mx - (sn * L) / 2, y1 = my + (cs * L) / 2, x2 = mx + (sn * L) / 2, y2 = my - (cs * L) / 2;
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      cores.map((c, i) => `<stop offset="${c[2] ? parseFloat(c[2]) / 100 : i / (cores.length - 1)}" stop-color="${c[1]}"/>`).join("") + "</linearGradient>";
  }
  async function contornarTexto(el) {
    if (!el || !ehTexto(el)) return null;
    if (!win.opentype) throw new Error("a leitura de fontes (opentype.js) não carregou");
    if (editando) pararEdicao();
    // mede sem o giro (o giro volta depois, no vetor)
    const tf = el.style.transform; el.style.transform = "none";
    const z = vista.z, p0 = pr.getBoundingClientRect(), grupos = new Map(), faltaram = new Set();
    try {
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let tn; (tn = walker.nextNode()); ) {
        const pai = tn.parentElement, cs = getComputedStyle(pai);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const fam = familiaDe(cs), peso = parseInt(cs.fontWeight, 10) || 400, ital = /italic|oblique/.test(cs.fontStyle);
        const font = await fonteOT(fam, peso, ital), tam = parseFloat(cs.fontSize) || 16, upm = font.unitsPerEm;
        const os2 = font.tables.os2, hh = font.tables.hhea, typo = os2 && os2.fsSelection & 128;
        const desc = (typo ? -os2.sTypoDescender : -hh.descender) / upm * tam;
        const tinta = tintaDe(pai, el), chave = JSON.stringify(tinta);
        if (!grupos.has(chave)) grupos.set(chave, { tinta, letras: [], stroke: cs.webkitTextStrokeWidth && parseFloat(cs.webkitTextStrokeWidth) > 0 ? { cor: cs.webkitTextStrokeColor, w: parseFloat(cs.webkitTextStrokeWidth) } : null });
        const g = grupos.get(chave), txt = tn.data;
        for (let i = 0; i < txt.length; ) {
          const cp = txt.codePointAt(i), n = cp > 0xffff ? 2 : 1, ch = txt.slice(i, i + n);
          if (/\s/.test(ch)) { i += n; continue; }
          const r = doc.createRange(); r.setStart(tn, i); r.setEnd(tn, i + n);
          const rc = r.getClientRects()[0]; if (!rc) { i += n; continue; }
          const glifo = font.charToGlyph(trocarCaixa(ch, cs.textTransform, i === 0 || /\s/.test(txt[i - 1])));
          if (!glifo || glifo.index === 0) { faltaram.add(ch); i += n; continue; }
          const x = (rc.left - p0.left) / z, base = (rc.bottom - p0.top) / z - desc;
          const d = glifo.getPath(x, base, tam).toPathData(3); if (d) g.letras.push(d);
          i += n;
        }
      }
    } finally { el.style.transform = tf; }
    const lista = [...grupos.values()].filter((g) => g.letras.length);
    if (!lista.length) throw new Error("não sobrou nenhuma letra pra converter");
    // caixa do desenho
    const P = papel(); let b = null;
    lista.forEach((g) => { g.caixa = new P.CompoundPath({ pathData: g.letras.join(" ") }).bounds; b = b ? b.unite(g.caixa) : g.caixa; });
    const pai = el.parentElement, q = pai === pr ? { x: 0, y: 0 } : noPr(pai);
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.width} ${b.height}`); svg.setAttribute("preserveAspectRatio", "none");
    const csEl = getComputedStyle(el);
    svg.setAttribute("style", `position:absolute;left:${Math.round((b.x - q.x) * 100) / 100}px;top:${Math.round((b.y - q.y) * 100) / 100}px;width:${b.width}px;height:${b.height}px;overflow:visible` +
      (tf ? `;transform:${tf}` : "") + (csEl.opacity !== "1" ? `;opacity:${csEl.opacity}` : "") + (el.style.filter ? `;filter:${el.style.filter}` : ""));
    let defs = "";
    // cada letra é um <path> (dá pra editar uma letra só, como no Illustrator); o degradê corre pela palavra inteira
    const paths = lista.map((g) => {
      let fill = g.tinta.cor || "#000";
      if (g.tinta.grad) { const id = "g" + novoId(), gr = gradSvg(g.tinta.grad, id, g.caixa); if (gr) { defs += gr; fill = `url(#${id})`; } }
      const st = g.stroke ? ` stroke="${g.stroke.cor}" stroke-width="${g.stroke.w}" vector-effect="non-scaling-stroke"` : "";
      return g.letras.map((d) => `<path d="${d}" fill="${fill}"${st}/>`).join("");
    }).join("");
    svg.innerHTML = (defs ? `<defs>${defs}</defs>` : "") + paths;
    svg.dataset.id = novoId();
    svg.dataset.camada = (el.dataset.camada || (el.textContent || "").trim().slice(0, 24) || "Texto") + " (contornos)";
    if (el.hasAttribute("data-fx")) svg.setAttribute("data-fx", el.getAttribute("data-fx"));
    if (ehAuto(pai)) { svg.style.position = "static"; svg.style.left = ""; svg.style.top = ""; svg.style.flex = "none"; }
    el.replaceWith(svg);
    return { svg, faltaram: [...faltaram] };
  }
  async function criarContornos() {
    const textos = sel.filter((e) => e !== pr && ehTexto(e));
    if (!textos.length) { aviso("Selecione um texto pra criar os contornos (Ctrl+Shift+O)"); return; }
    avisar({ tipo: "aviso", texto: "Criando os contornos…" });
    const novos = [], faltas = new Set();
    for (const t of textos) {
      try { const r = await contornarTexto(t); if (r) { novos.push(r.svg); r.faltaram.forEach((c) => faltas.add(c)); } }
      catch (e) { aviso("Não consegui converter: " + e.message); }
    }
    if (!novos.length) return;
    sel = novos; aplicarSelecao(); mudou();
    aviso(faltas.size ? `Pronto. Estas letras não existem na fonte e ficaram de fora: ${[...faltas].join(" ")}` : "Pronto: o texto virou vetor. Use A pra mexer nos pontos ou ponha um contorno.");
  }

  /* ---------- 13. teclado ---------- */
  function tecla(e) {
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === "Shift") { shift = true; if (mv) { mv.keepRatio = true; mv.throttleDragRotate = 45; mv.throttleRotate = 15; } }
    if (pint && k !== " ") { pintTecla(e); return; }
    if (pontos && pontosTecla(e)) return;
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
    if (mod && (k === "v" || k === "V")) { e.preventDefault(); colar(false); return; }
    // atalhos do Illustrator
    if (mod && e.code === "Digit7") { e.preventDefault(); e.altKey ? tirarMascara() : mascarar(); return; }
    if (mod && e.code === "Digit2") { e.preventDefault(); travarTudo(!e.altKey); return; }
    if (mod && e.code === "Digit3") { e.preventDefault(); ocultarTudo(!e.altKey); return; }
    if (mod && e.shiftKey && (k === "v" || k === "V")) { e.preventDefault(); colar(true); return; }
    if (mod && e.shiftKey && (k === "o" || k === "O")) { e.preventDefault(); criarContornos(); return; }
    if (mod && e.shiftKey && (e.code === "Period" || e.code === "Comma")) { e.preventDefault(); tamanhoTexto(e.code === "Period" ? 2 : -2); return; }
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
    if (e.shiftKey && (k === "c" || k === "C")) { usarFerramenta("converter"); return; }
    if (e.shiftKey && (k === "x" || k === "X")) { trocarPreenchimento(); return; }
    if (k === "?") { avisar({ tipo: "atalhos" }); return; }
    if (k === "+" || k === "=") { usarFerramenta("maisPonto"); return; }
    if (k === "-" || k === "_") { usarFerramenta("menosPonto"); return; }
    const atalhos = { v: "mover", a: "direta", t: "texto", r: "retangulo", o: "elipse", h: "mao", p: "pen", f: "frame", z: "zoom", n: "marcar" };
    const f = atalhos[k.toLowerCase()]; if (f) { usarFerramenta(f); return; }
    if (k.toLowerCase() === "i") { avisar({ tipo: "pedir-imagem" }); return; }
    if (k.toLowerCase() === "c") { cortar(); return; }
    if (k.toLowerCase() === "m") { mascarar(); return; }
    if (k.toLowerCase() === "b" || k.toLowerCase() === "l") { entrarPintura(); return; } // pincel/laço: abre a máscara de pintura da imagem
  }
  doc.addEventListener("keydown", tecla);
  doc.addEventListener("keyup", (e) => {
    if (e.key === "Shift") { shift = false; if (mv) { mv.throttleDragRotate = 0; mv.throttleRotate = 0; } aplicarSelecao(); }
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
    pathfinder, efeitos, definirMascaraImg, contornos: criarContornos,
    vetorizar() { sel = sel.map((e) => (ehForma(e) ? converterEmVetor(e) : e)); aplicarSelecao(); mudou(); },
    pintura(acao, arg) { if (acao === "entrar") return entrarPintura(); pintAcao(acao, arg); },
    srcDe(id) { const el = porId(id); return el && el.tagName === "IMG" ? el.getAttribute("src") : null; },
    config(c) { cfg = Object.assign(cfg, c || {}); if (c && c.tema) doc.documentElement.setAttribute("data-pc-tema", c.tema); },
    editarTexto(id) { const el = porId(id); if (el) editarTexto(el, "tudo"); },
    marcas(lista) { if (lista) { marcas = lista.map((m) => ({ ...m })); desenharMarcas(); } return marcas.map((m) => ({ ...m })); },
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
