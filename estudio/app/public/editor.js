/**
 * editor.js — injetado dentro da landing page quando o preview abre em modo edição.
 * Conversa com o Estúdio (janela de fora) por postMessage.
 */
(function () {
  const enviar = (m) => parent.postMessage(Object.assign({ fonte: "editor-lp" }, m), "*");
  let sel = null, modo = "off";

  const css = document.createElement("style");
  css.textContent = `
    [data-ed-hover]{outline:1.5px dashed rgba(234,88,12,.7)!important;outline-offset:1px!important}
    [data-ed-sel]{outline:2px solid #ea580c!important;outline-offset:1px!important}
    [contenteditable="true"]{cursor:text!important}
    [contenteditable="true"]:focus{outline:2px solid #ea580c!important;outline-offset:2px!important}`;
  document.head.appendChild(css);

  const editavel = (el) => el && el.children.length === 0 && (el.textContent || "").trim().length > 0;
  const secao = (el) => (el && el.closest ? el.closest("[data-bloco]") : null);

  /** Tira as marcas do editor antes de devolver o HTML da seção. */
  function limpar(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll("[contenteditable]").forEach((x) => x.removeAttribute("contenteditable"));
    c.querySelectorAll("[data-ed-hover]").forEach((x) => x.removeAttribute("data-ed-hover"));
    c.querySelectorAll("[data-ed-sel]").forEach((x) => x.removeAttribute("data-ed-sel"));
    c.removeAttribute("data-ed-hover"); c.removeAttribute("data-ed-sel"); c.removeAttribute("contenteditable");
    return c.outerHTML;
  }
  function salvarSecao(el) {
    const s = secao(el); if (!s) return;
    enviar({ tipo: "bloco-mudou", bloco: s.dataset.bloco, html: limpar(s) });
  }

  const hex = (c) => { const m = (c || "").match(/\d+/g); return m ? "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("") : ""; };
  function propriedades(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      classe: typeof el.className === "string" ? el.className.split(" ").filter(Boolean)[0] || "" : "",
      bloco: (secao(el) || {}).dataset ? secao(el).dataset.bloco : null,
      texto: editavel(el), imagem: el.tagName === "IMG",
      w: Math.round(r.width), h: Math.round(r.height),
      fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight,
      cor: hex(cs.color), fundo: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "" : hex(cs.backgroundColor),
      alinhamento: cs.textAlign, entrelinha: cs.lineHeight === "normal" ? "" : Math.round(parseFloat(cs.lineHeight)),
      padding: cs.padding, radius: parseFloat(cs.borderTopLeftRadius) || 0,
      display: cs.display, direcao: cs.flexDirection, gap: parseFloat(cs.gap) || 0,
      alinhaItens: cs.alignItems, justifica: cs.justifyContent,
      flex: cs.display === "flex" || cs.display === "inline-flex",
    };
  }

  /* ---- interação ---- */
  document.addEventListener("mouseover", (e) => {
    if (modo === "off") return;
    document.querySelectorAll("[data-ed-hover]").forEach((x) => x.removeAttribute("data-ed-hover"));
    const alvo = modo === "secao" ? secao(e.target) : e.target;
    if (alvo && alvo !== sel) alvo.setAttribute("data-ed-hover", "");
  });
  document.addEventListener("click", (e) => {
    if (modo === "off") return;
    if (sel && sel.getAttribute("contenteditable") === "true" && sel.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    selecionar(modo === "secao" ? secao(e.target) : e.target);
  }, true);

  function selecionar(el) {
    if (!el) return;
    if (sel) { sel.removeAttribute("data-ed-sel"); if (sel.getAttribute("contenteditable")) desligarTexto(sel); }
    sel = el; sel.setAttribute("data-ed-sel", "");
    sel.removeAttribute("data-ed-hover");
    enviar({ tipo: "selecionou", props: propriedades(el) });
  }
  function ligarTexto(el) {
    el.setAttribute("contenteditable", "true"); el.focus();
    el.addEventListener("blur", () => { desligarTexto(el); salvarSecao(el); }, { once: true });
  }
  const desligarTexto = (el) => el.removeAttribute("contenteditable");

  /* ---- comandos vindos do Estúdio ---- */
  window.addEventListener("message", (ev) => {
    const m = ev.data || {}; if (m.fonte !== "estudio") return;
    if (m.tipo === "modo") {
      modo = m.modo;
      document.querySelectorAll("[data-ed-hover]").forEach((x) => x.removeAttribute("data-ed-hover"));
      if (modo === "off" && sel) { sel.removeAttribute("data-ed-sel"); desligarTexto(sel); sel = null; }
      return;
    }
    if (m.tipo === "ir-bloco") {
      const s = document.querySelector(`[data-bloco="${m.bloco}"]`);
      if (s) { s.scrollIntoView({ behavior: "smooth", block: "start" }); selecionar(s); }
      return;
    }
    if (!sel) return;
    if (m.tipo === "editar-texto") { ligarTexto(sel); return; }
    if (m.tipo === "estilo") {
      Object.entries(m.estilo).forEach(([k, v]) => { if (v === "" || v == null) sel.style.removeProperty(k); else sel.style.setProperty(k, v); });
      enviar({ tipo: "selecionou", props: propriedades(sel) });
      salvarSecao(sel); return;
    }
    if (m.tipo === "imagem") {
      if (sel.tagName === "IMG") sel.src = m.src;
      else sel.style.backgroundImage = `url("${m.src}")`;
      salvarSecao(sel); return;
    }
    if (m.tipo === "remover") { const s = secao(sel); sel.remove(); sel = null;
      if (s) enviar({ tipo: "bloco-mudou", bloco: s.dataset.bloco, html: limpar(s) }); return; }
  });

  enviar({ tipo: "pronto", blocos: [...document.querySelectorAll("[data-bloco]")].map((x) => x.dataset.bloco) });
})();
