/**
 * post-editor.js — o editor de Posts do Estúdio.
 *
 * Chat (Codex/Claude) à esquerda, prancheta no centro, ferramentas flutuantes:
 * barra contextual em cima da seleção, popover de cor/degradê e de fonte, dock
 * de ferramentas embaixo, zoom e prévia do Instagram nos cantos. Sem painel lateral.
 *
 * A prancheta em si roda dentro do iframe (post-canvas.js, que expõe window.ED);
 * ela avisa tudo o que acontece por window.postCanvasEvento.
 */
(function () {
  "use strict";
  Object.assign(P, {
    redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    frame: '<path d="M22 6H2M22 18H2M6 2v20M18 2v20"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    mask: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    lasso: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/>',
    autolayout: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="18" height="7" x="3" y="14" rx="1"/>',
    "al-esq": '<path d="M4 2v20"/><rect x="8" y="5" width="12" height="5" rx="1"/><rect x="8" y="14" width="7" height="5" rx="1"/>',
    "al-cen": '<path d="M12 2v20"/><rect x="5" y="5" width="14" height="5" rx="1"/><rect x="8" y="14" width="8" height="5" rx="1"/>',
    "al-dir": '<path d="M20 2v20"/><rect x="4" y="5" width="12" height="5" rx="1"/><rect x="9" y="14" width="7" height="5" rx="1"/>',
    "al-topo": '<path d="M2 4h20"/><rect x="5" y="8" width="5" height="12" rx="1"/><rect x="14" y="8" width="5" height="7" rx="1"/>',
    "al-meio": '<path d="M2 12h20"/><rect x="5" y="5" width="5" height="14" rx="1"/><rect x="14" y="8" width="5" height="8" rx="1"/>',
    "al-base": '<path d="M2 20h20"/><rect x="5" y="4" width="5" height="12" rx="1"/><rect x="14" y="9" width="5" height="7" rx="1"/>',
    "dist-h": '<rect x="4" y="6" width="4" height="12" rx="1"/><rect x="16" y="6" width="4" height="12" rx="1"/><path d="M12 4v16"/>',
    "dist-v": '<rect x="6" y="4" width="12" height="4" rx="1"/><rect x="6" y="16" width="12" height="4" rx="1"/><path d="M4 12h16"/>',
    "txt-esq": '<path d="M15 12H3M17 18H3M21 6H3"/>', "txt-cen": '<path d="M17 12H7M19 18H5M21 6H3"/>', "txt-dir": '<path d="M21 12H9M21 18H7M21 6H3"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
    "eye-off": '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
    "chev-l": '<path d="m15 18-6-6 6-6"/>', "chev-r": '<path d="m9 18 6-6-6-6"/>',
    rounded: '<path d="M4 20V10a6 6 0 0 1 6-6h10"/>',
  });

  // os ícones novos chegaram depois da primeira pintura: repinta os que ficaram vazios
  $$("#postEdView [data-icon]").forEach((el) => { const sv = el.querySelector("svg.ic"); if (sv && !sv.innerHTML) { sv.remove(); delete el.dataset.done; } });
  paintIcons();

  /* fontes que dá pra escolher (Google Fonts, com os pesos certos de cada uma) */
  const FONTES = [
    ["Bricolage Grotesque", "Bricolage+Grotesque:wght@200..800", "sans-serif"],
    ["Playfair Display", "Playfair+Display:ital,wght@0,400..900;1,400..900", "serif"],
    ["Raleway", "Raleway:ital,wght@0,100..900;1,100..900", "sans-serif"],
    ["Inter", "Inter:wght@100..900", "sans-serif"],
    ["Montserrat", "Montserrat:ital,wght@0,100..900;1,100..900", "sans-serif"],
    ["Poppins", "Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,700", "sans-serif"],
    ["Manrope", "Manrope:wght@200..800", "sans-serif"],
    ["Space Grotesk", "Space+Grotesk:wght@300..700", "sans-serif"],
    ["Syne", "Syne:wght@400..800", "sans-serif"],
    ["Archivo Black", "Archivo+Black", "sans-serif"],
    ["Anton", "Anton", "sans-serif"],
    ["Bebas Neue", "Bebas+Neue", "sans-serif"],
    ["Fraunces", "Fraunces:ital,wght@0,100..900;1,100..900", "serif"],
    ["DM Serif Display", "DM+Serif+Display:ital@0;1", "serif"],
    ["Instrument Serif", "Instrument+Serif:ital@0;1", "serif"],
    ["Cormorant Garamond", "Cormorant+Garamond:ital,wght@0,300..700;1,300..700", "serif"],
    ["Caveat", "Caveat:wght@400..700", "cursive"],
  ].map(([n, q, f]) => ({ n, q, f, url: "https://fonts.googleapis.com/css2?family=" + q + "&display=swap" }));

  const MOTORES = { codex: "Codex (GPT)", claude: "Claude", gemini: "Gemini" };
  const PE = { post: null, pronto: false, sel: [], editando: false, ferramenta: "mover", mexendo: false, sujo: false,
    gerando: false, aba: "ia", prevI: 0, vistaGuardada: null, n: 1, pop: null, grad: null, alvoCor: "fundo" };
  const F = () => $("#peFrame");
  const ED = () => { try { return (PE.pronto && F().contentWindow.ED) || null; } catch (e) { return null; } };
  const POST = (url, dados) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
  const aberto = () => $("#postEdView").classList.contains("on");

  /* ---------- abrir / fechar ---------- */
  async function abrirEditorPost(p) {
    if (typeof p === "string") { await carregarPosts(); p = posts.find((x) => x.id === p); }
    if (!p) return toast("não achei o post");
    if (!designSystems || !designSystems.length) { try { await carregarDS(); } catch (e) {} }
    PE.post = p; PE.n = p.telas || 1; PE.prevI = 0; PE.sel = []; PE.pronto = false; PE.vistaGuardada = null;
    ["#listing", "#editor", "#tplView", "#skView", "#cfgView", "#dsView", "#postView"].forEach((s) => $(s) && $(s).classList.remove("on"));
    $("#postEdView").classList.add("on");
    $("#peTit").textContent = p.titulo || "Post sem nome";
    $("#peMotor").innerHTML = Object.entries(MOTORES).map(([k, v]) => `<option value="${k}" ${p.motor === k ? "selected" : ""}>${v}</option>`).join("");
    const ds = (designSystems || []).find((d) => d.id === p.marca);
    $("#peEstilo").textContent = "Estilo: " + ((ds && ds.nome) || "—").replace(/\s*\(.*\)\s*$/, "");
    $("#peLegenda").value = p.legenda || "";
    let mostrarPrev = p.formato === "carrossel"; try { const v = localStorage.getItem("pe-previa"); if (v !== null) mostrarPrev = v === "1"; } catch (e) {}
    $("#pePrev").hidden = !mostrarPrev; $("#pePrevBtn").classList.toggle("on", mostrarPrev);
    trocarAba("ia"); renderChat(); atualizarTopo(); esconderCtx(); fecharPop();
    carregarFrame(); renderPrevia(true); renderDock();
    paintIcons();
  }
  async function fecharEditorPost() {
    await salvarAgora(); fecharPop();
    $("#postEdView").classList.remove("on"); PE.pronto = false; F().src = "about:blank";
    $("#postView").classList.add("on"); await carregarPosts(); renderPosts(); paintIcons();
  }
  function carregarFrame() {
    PE.pronto = false;
    F().src = postArq(PE.post, "post.html") + "?editar=1&v=" + Date.now();
  }

  /* ---------- eventos que vêm da prancheta ---------- */
  window.postCanvasEvento = (m) => {
    if (!aberto()) return;
    switch (m.tipo) {
      case "pronto": {
        PE.pronto = true; PE.n = m.n;
        const ed = ED(); if (!ed) return;
        const ds = (designSystems || []).find((d) => d.id === PE.post.marca);
        ed.config({ cores: (ds && ds.cores) || [], tema: temaEscuro() ? "escuro" : "claro" });
        if (PE.vistaGuardada) { ed.setVista(PE.vistaGuardada); PE.vistaGuardada = null; }
        atualizarTopo(); renderCamadas(); return;
      }
      case "selecao": PE.sel = m.itens || []; PE.editando = !!m.editando; PE.mexendo = false; renderCtx(); renderRefs(); marcarCamadas(); return;
      case "mexendo": PE.mexendo = true; esconderCtx(); fecharPop(); return;
      case "clique": fecharPop(); return;
      case "mudou": agendarSalvar(); clearTimeout(PE.tCam); PE.tCam = setTimeout(renderCamadas, 250); return;
      case "vista": $("#peZoomPct").innerHTML = "<b>" + Math.round(m.z * 100) + "%</b>"; return;
      case "ferramenta": PE.ferramenta = m.f; renderDock(); return;
      case "telas": PE.n = m.n; atualizarTopo(); renderPrevia(); return;
      case "pedir-imagem": escolherImagem(); return;
      case "em-breve": toast("Essa ferramenta chega na fase 2 do editor"); return;
      case "arquivos": (m.arquivos || []).filter((f) => /^image\//.test(f.type)).slice(0, 6).forEach((f, i) => subirImagem(f, m.x + i * 30, m.y + i * 30)); return;
      case "erro": toast("⚠️ " + (m.texto || "erro na prancheta")); return;
    }
  };
  function temaEscuro() {
    const t = document.documentElement.getAttribute("data-theme");
    return t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  /* ---------- topo ---------- */
  function atualizarTopo() {
    const p = PE.post; if (!p) return;
    const nomeF = FORMATO_POST_NOME[p.formato] || "Post";
    $("#peChip").innerHTML = `${esc(nomeF)}${p.formato === "carrossel" ? ` · ${PE.n} telas` : ""} · ${p.w}×${p.h}`;
    $("#pePng").innerHTML = `${icon("download", 15)} Baixar ${PE.n > 1 ? PE.n + " PNG" : "PNG"}`;
  }
  function setSalvo(t) { $("#peSalvo").textContent = t; }
  $("#peVoltar").onclick = fecharEditorPost;
  $("#peTit").onclick = () => {
    const el = $("#peTit"); if (el.isContentEditable) return;
    el.contentEditable = "true"; el.focus(); document.execCommand("selectAll", false, null);
  };
  $("#peTit").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } if (e.key === "Escape") { e.target.textContent = PE.post.titulo; e.target.blur(); } };
  $("#peTit").onblur = async () => {
    const el = $("#peTit"); el.contentEditable = "false";
    const t = el.textContent.trim(); if (!t || t === PE.post.titulo) { el.textContent = PE.post.titulo; return; }
    PE.post.titulo = t; await POST("/api/posts/renomear", { id: PE.post.id, titulo: t });
  };
  $("#peChip").onclick = (e) => {
    const p = PE.post;
    if (p.formato !== "carrossel") { abrirPop(`<h5>Formato</h5><p style="font-size:12px;color:var(--muted-foreground);margin:0;line-height:1.5">${esc(FORMATO_POST_NOME[p.formato])}: 1 tela de ${p.w}×${p.h} px.</p>`, e.currentTarget, "telas"); return; }
    abrirPop(`<h5>Telas do carrossel</h5>
      <div class="pe-prow" style="margin-top:0"><span class="pe-num"><button data-d="-1">−</button><input id="peNTelas" type="number" min="2" max="20" value="${PE.n}"/><button data-d="1">+</button></span>
      <span>cada uma ${p.w}×${p.h}</span></div>
      <p style="font-size:11.5px;color:var(--muted-foreground);margin:10px 0 0;line-height:1.5">A prancheta cresce ou encolhe pela direita. Um elemento que fica além da última tela continua guardado, só não aparece.</p>`, e.currentTarget, "telas");
    const aplicar = (n) => { n = Math.max(2, Math.min(20, n)); $("#peNTelas").value = n; ED() && ED().setTelas(n); };
    $$("#pePop [data-d]").forEach((b) => (b.onclick = () => aplicar((+$("#peNTelas").value || PE.n) + +b.dataset.d)));
    $("#peNTelas").onchange = () => aplicar(+$("#peNTelas").value || PE.n);
  };
  $("#peDesfazer").onclick = () => ED() && ED().desfazer();
  $("#peRefazer").onclick = () => ED() && ED().refazer();
  $("#pePrevBtn").onclick = () => {
    const v = $("#pePrev").hidden; $("#pePrev").hidden = !v; $("#pePrevBtn").classList.toggle("on", v);
    try { localStorage.setItem("pe-previa", v ? "1" : "0"); } catch (e) {}
    if (v) renderPrevia(true);
  };
  $("#pePasta").onclick = () => { const p = PE.post; if (window.estudio && window.estudio.abrirCaminho) window.estudio.abrirCaminho(p.pasta); else toast("A pasta fica em: " + p.pasta); };

  /* ---------- salvar ---------- */
  function agendarSalvar() { PE.sujo = true; setSalvo("Salvando…"); clearTimeout(PE.tS); PE.tS = setTimeout(salvarAgora, 700); }
  async function salvarAgora() {
    clearTimeout(PE.tS); const ed = ED();
    if (!PE.sujo || !ed || !PE.post) return;
    PE.sujo = false;
    try {
      const r = await POST("/api/posts/salvar-html", { id: PE.post.id, html: ed.html(), telas: ed.medidas().n });
      if (r && r.ok) { PE.post = { ...PE.post, ...r.post }; setSalvo("Salvo"); renderPrevia(true); }
      else { PE.sujo = true; setSalvo("Não salvou"); toast("⚠️ " + ((r && r.erro) || "não consegui salvar o post")); }
    } catch (e) { PE.sujo = true; setSalvo("Não salvou"); }
  }

  /* ---------- abas da esquerda ---------- */
  function trocarAba(a) {
    PE.aba = a;
    $$("#peTabs [data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === a));
    $$("#postEdView .pe-pane").forEach((p) => p.classList.toggle("on", p.dataset.p === a));
    if (a === "camadas") renderCamadas();
  }
  $$("#peTabs [data-t]").forEach((b) => (b.onclick = () => trocarAba(b.dataset.t)));

  /* ---------- chat com a IA ---------- */
  const nomeMotor = (m) => (m === "codex" ? "Codex" : m === "gemini" ? "Gemini" : "Claude");
  function bolhaMe(txt, refs) {
    return `<div class="pe-m me">${(refs || []).map((r) => `<span class="pe-ref">✎ ${esc(r)}</span> `).join("")}${esc(txt)}</div>`;
  }
  function bolhaIa(txt, motor, extra) {
    return `<div class="pe-m ai"><div class="quem">✦ ${esc(nomeMotor(motor))}</div>${txt}${extra || ""}</div>`;
  }
  function renderChat() {
    const p = PE.post, h = p.historico || [];
    let html = h.map((x, i) => bolhaMe(x.pedido, x.refs) + (x.fala ? bolhaIa(esc(x.fala), p.motor, i === h.length - 1 ? `<div class="acoes"><button data-voltar="1">Voltar como estava antes</button></div>` : "") : "")).join("");
    if (!h.length) html = bolhaIa(esc("Me conta sobre o que é o post. Eu desenho as telas na prancheta e você ajusta na mão: arrasta, troca fonte, cor e degradê.\n\nDepois, se quiser mudar só uma parte, selecione o elemento e me peça aqui."), p.motor);
    $("#peMsgs").innerHTML = html; ligarVoltar(); rolarChat();
  }
  function ligarVoltar() {
    $$("#peMsgs [data-voltar]").forEach((b) => (b.onclick = async () => {
      if (!(await confirmar("Voltar como estava?", "A prancheta volta pra versão de antes da última mudança da IA. As mexidas manuais feitas depois dela se perdem.", "Voltar"))) return;
      await salvarAgora();
      const r = await POST("/api/posts/voltar-versao", { id: PE.post.id });
      if (r && r.ok) { PE.vistaGuardada = ED() && ED().vista(); PE.post = { ...PE.post, ...r.post }; carregarFrame(); b.remove(); toast("Voltou pra versão anterior"); }
      else toast("⚠️ " + ((r && r.erro) || "não consegui voltar"));
    }));
  }
  function rolarChat() { const m = $("#peMsgs"); m.scrollTop = m.scrollHeight; }
  new MutationObserver(rolarChat).observe($("#peMsgs"), { childList: true, subtree: true });
  function refsAtuais() { return PE.sel.filter((s) => !s.prancheta).map((s) => ({ id: s.id, nome: s.nome })); }
  function renderRefs() {
    const refs = refsAtuais();
    $("#peRefs").innerHTML = refs.slice(0, 6).map((r) => `<span class="pe-ref" title="${esc(r.nome)}">✎ ${esc(r.nome)}<button data-tira="${esc(r.id)}" title="Tirar da seleção">×</button></span>`).join("")
      + (refs.length > 6 ? `<span class="pe-ref">+${refs.length - 6}</span>` : "");
    $$("#peRefs [data-tira]").forEach((b) => (b.onclick = () => ED() && ED().selecionar(PE.sel.filter((s) => s.id !== b.dataset.tira && !s.prancheta).map((s) => s.id))));
    $("#peTxt").placeholder = refs.length ? "O que mudar " + (refs.length > 1 ? "nesses elementos" : "nesse elemento") + "?" : "Peça pra IA… ou selecione algo na prancheta e diga o que mudar";
  }
  async function enviarPedido(txt) {
    const pedido = (txt != null ? txt : $("#peTxt").value).trim();
    if (!pedido) { $("#peTxt").focus(); return; }
    if (PE.gerando) return toast("A IA ainda está trabalhando nesse post");
    await salvarAgora();
    PE.gerando = true; $("#peEnviar").disabled = true; $("#peTxt").value = "";
    const refs = refsAtuais(), motor = $("#peMotor").value; PE.post.motor = motor;
    const msgs = $("#peMsgs");
    msgs.querySelectorAll("[data-voltar]").forEach((b) => b.parentElement.remove());
    msgs.insertAdjacentHTML("beforeend", bolhaMe(pedido, refs.map((r) => r.nome)) + bolhaIa('<div class="pe-fluxo"></div>', motor));
    const box = msgs.querySelector(".pe-m.ai:last-child .pe-fluxo");
    const fx = criarFluxo(box, "post", PE.post.id, "/api/posts/stream?id=" + encodeURIComponent(PE.post.id));
    $("#peTrava").hidden = false; $("#peTravaTxt").textContent = nomeMotor(motor) + " está desenhando na prancheta…";
    esconderCtx(); fecharPop();
    try {
      const r = await POST("/api/posts/gerar", { id: PE.post.id, pedido, motor, refs });
      const seg = fx.stop();
      if (r && r.ok) {
        PE.vistaGuardada = ED() && ED().vista();
        PE.post = { ...PE.post, ...r.post }; $("#peLegenda").value = PE.post.legenda || "";
        box.parentElement.innerHTML = `<div class="quem">✦ ${esc(nomeMotor(motor))} · ${fmtDur(seg)}</div>${esc(r.fala || "Pronto.")}<div class="acoes"><button data-voltar="1">Voltar como estava antes</button></div>`;
        ligarVoltar(); carregarFrame(); renderPrevia(true); notificar("Post pronto", PE.post.titulo || "");
      } else {
        box.innerHTML = "⚠️ " + esc((r && r.erro) || "não consegui mexer no post") + (r && r.detalhe ? `<br><span class="cli-erro">motor disse: …${esc(String(r.detalhe).slice(-600))}</span>` : "");
      }
    } catch (e) { fx.stop(); box.textContent = "A geração demorou ou caiu a conexão. Tenta de novo."; }
    PE.gerando = false; $("#peEnviar").disabled = false; $("#peTrava").hidden = true;
  }
  $("#peEnviar").onclick = () => enviarPedido();
  $("#peTxt").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarPedido(); } };
  $("#peTxt").oninput = (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(160, e.target.scrollHeight) + "px"; };

  /* ---------- legenda ---------- */
  $("#peLegenda").oninput = () => { clearTimeout(PE.tLeg); PE.tLeg = setTimeout(async () => { PE.post.legenda = $("#peLegenda").value; await POST("/api/posts/legenda", { id: PE.post.id, legenda: PE.post.legenda }); $("#peLegSalvo").textContent = "Salva"; }, 600); $("#peLegSalvo").textContent = "…"; };
  $("#peLegCopiar").onclick = () => { try { navigator.clipboard.writeText($("#peLegenda").value); toast("Legenda copiada"); } catch (e) { toast("não consegui copiar"); } };

  /* ---------- camadas ---------- */
  const ICONE_CAMADA = { texto: "type", imagem: "image", grupo: "frame", forma: "square" };
  function renderCamadas() {
    if (PE.aba !== "camadas") return;
    const ed = ED(); const box = $("#peCamadas");
    if (!ed) { box.innerHTML = '<div class="pe-cam-vazio">Carregando a prancheta…</div>'; return; }
    const arv = ed.camadas();
    if (!arv.length) { box.innerHTML = '<div class="pe-cam-vazio">A prancheta está vazia. Peça pra IA criar o post, ou use as ferramentas de baixo (T pra texto, R pra retângulo, I pra imagem).</div>'; return; }
    const linhas = []; const andar = (lista, prof) => lista.forEach((c) => { linhas.push({ ...c, prof }); if (c.filhos && c.filhos.length) andar(c.filhos, prof + 1); });
    andar(arv, 0);
    box.innerHTML = linhas.map((c) => `<div class="pe-cam${c.sel ? " sel" : ""}${c.oculto ? " oculto" : ""}" data-id="${esc(c.id)}" draggable="true" style="padding-left:${6 + c.prof * 16}px">
        <span class="tp">${icon(ICONE_CAMADA[c.tipo] || "square", 14)}</span><span class="nm">${esc(c.nome)}</span>
        <button class="ac${c.travado ? " fixo" : ""}" data-ac="travado" title="${c.travado ? "Destravar" : "Travar"}">${icon(c.travado ? "lock" : "unlock", 13)}</button>
        <button class="ac${c.oculto ? " fixo" : ""}" data-ac="oculto" title="${c.oculto ? "Mostrar" : "Ocultar"}">${icon(c.oculto ? "eye-off" : "eye", 13)}</button></div>`).join("");
    let arrastado = null;
    $$("#peCamadas .pe-cam").forEach((row) => {
      const id = row.dataset.id;
      row.onclick = (e) => {
        if (e.target.closest(".ac") || e.target.isContentEditable) return;
        const atuais = PE.sel.filter((s) => !s.prancheta).map((s) => s.id);
        ED() && ED().selecionar(e.shiftKey ? (atuais.includes(id) ? atuais.filter((x) => x !== id) : atuais.concat([id])) : [id]);
      };
      row.querySelectorAll("[data-ac]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); ED() && ED().alternar(id, b.dataset.ac); }));
      const nm = row.querySelector(".nm");
      nm.ondblclick = () => { nm.contentEditable = "true"; nm.focus(); document.execCommand("selectAll", false, null); };
      nm.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); nm.blur(); } if (e.key === "Escape") { nm.textContent = nm.dataset.v || nm.textContent; nm.blur(); } e.stopPropagation(); };
      nm.onblur = () => { if (nm.isContentEditable) { nm.contentEditable = "false"; ED() && ED().renomear(id, nm.textContent.trim()); } };
      row.ondragstart = (e) => { arrastado = id; e.dataTransfer.effectAllowed = "move"; };
      row.ondragover = (e) => { if (!arrastado || arrastado === id) return; e.preventDefault(); const r = row.getBoundingClientRect(), cima = e.clientY < r.top + r.height / 2;
        row.classList.toggle("drop-cima", cima); row.classList.toggle("drop-baixo", !cima); };
      row.ondragleave = () => row.classList.remove("drop-cima", "drop-baixo");
      row.ondrop = (e) => { e.preventDefault(); const cima = row.classList.contains("drop-cima"); row.classList.remove("drop-cima", "drop-baixo");
        // a lista mostra o topo primeiro: soltar "em cima" = ficar na frente (depois no HTML)
        if (arrastado && arrastado !== id) ED() && ED().moverCamada(arrastado, id, cima); arrastado = null; };
    });
    paintIcons();
  }
  function marcarCamadas() {
    if (PE.aba !== "camadas") return;
    const ids = PE.sel.map((s) => s.id);
    $$("#peCamadas .pe-cam").forEach((r) => r.classList.toggle("sel", ids.includes(r.dataset.id)));
  }

  /* ---------- barra contextual (em cima da seleção) ---------- */
  function esconderCtx() { $("#peCtx").hidden = true; }
  const nomeFonte = (ff) => String(ff || "").split(",")[0].replace(/["']/g, "").trim();
  const dotCor = (s) => {
    const css = s.clipTexto || (s.backgroundImage && s.backgroundImage !== "none" && PE.alvoCor === "fundo") ? s.backgroundImage : null;
    return `<span class="pe-dot"><i style="background:${esc(css || (PE.alvoCor === "texto" ? s.color : s.backgroundColor))}"></i></span>`;
  };
  function renderCtx() {
    const box = $("#peCtx");
    if (!PE.sel.length || PE.mexendo || PE.gerando) { box.hidden = true; return; }
    const s0 = PE.sel[0], st = s0.estilo, um = PE.sel.length === 1;
    const todosTexto = PE.sel.every((s) => s.texto);
    let h = "";
    const ia = `<span class="sep"></span><button class="c ia" data-a="ia">${icon("sparkles", 14)} Pedir à IA</button>`;
    const mais = `<button class="c" data-a="mais" title="Mais">${icon("more", 16)}</button>`;
    if (s0.prancheta && um) {
      PE.alvoCor = "fundo";
      h = `<span class="nome">Prancheta · ${PE.n} ${PE.n > 1 ? "telas" : "tela"}</span><button class="c" data-a="cor" title="Fundo da prancheta">${dotCor(st)} Fundo</button>${ia}`;
    } else if (todosTexto) {
      PE.alvoCor = "texto";
      const al = st.textAlign === "center" ? "txt-cen" : st.textAlign === "right" || st.textAlign === "end" ? "txt-dir" : "txt-esq";
      const negrito = +st.fontWeight >= 600, italico = st.fontStyle === "italic";
      h = `<button class="c fonte" data-a="fonte" title="Fonte">${esc(nomeFonte(st.fontFamily))} ▾</button>
        <span class="pe-num" title="Tamanho (px)"><button data-a="tam" data-d="-1">−</button><input data-a="tam-in" type="number" value="${Math.round(st.fontSize)}"/><button data-a="tam" data-d="1">+</button></span>
        <button class="c${negrito ? " on" : ""}" data-a="negrito" title="Negrito">${icon("bold", 15)}</button>
        <button class="c${italico ? " on" : ""}" data-a="italico" title="Itálico">${icon("italic", 15)}</button>
        <span class="sep"></span>
        <button class="c" data-a="cor" title="Cor ou degradê do texto">${dotCor(st)}</button>
        <button class="c" data-a="alinhar-txt" title="Alinhamento do texto">${icon(al, 16)}</button>
        ${um ? "" : alinhamentos()}${ia}${mais}`;
    } else if (um) {
      PE.alvoCor = "fundo";
      const r = Math.round(st.borderRadius);
      h = `<span class="nome">${esc(s0.nome)}</span>
        ${s0.img ? "" : `<button class="c" data-a="cor" title="Preenchimento">${dotCor(st)}</button>`}
        <span class="pe-num" title="Arredondar cantos"><small>${icon("rounded", 12)}</small><button data-a="raio" data-d="-1">−</button><input data-a="raio-in" type="number" min="0" value="${r}"/><button data-a="raio" data-d="1">+</button></span>
        <span class="pe-num" title="Opacidade"><small>%</small><input data-a="opa-in" type="number" min="0" max="100" value="${Math.round(st.opacity * 100)}"/></span>
        ${s0.temFilhos ? `<button class="c" data-a="entrar" title="Mexer no que está dentro (Enter)">Abrir grupo</button>` : ""}
        ${ia}${mais}`;
    } else {
      PE.alvoCor = "fundo";
      h = `<span class="nome">${PE.sel.length} selecionados</span>${alinhamentos()}
        ${PE.sel.length >= 3 ? `<button class="c" data-a="dist" data-v="h" title="Distribuir na horizontal">${icon("dist-h", 16)}</button><button class="c" data-a="dist" data-v="v" title="Distribuir na vertical">${icon("dist-v", 16)}</button>` : ""}
        ${ia}${mais}`;
    }
    box.innerHTML = h; box.hidden = false;
    ligarCtx(); posicionarCtx();
  }
  function alinhamentos() {
    const um = PE.sel.length === 1;
    return `<span class="sep"></span>` + [["esquerda", "al-esq", "Alinhar à esquerda"], ["centro", "al-cen", "Centralizar na horizontal"], ["direita", "al-dir", "Alinhar à direita"],
      ["topo", "al-topo", "Alinhar no topo"], ["meio", "al-meio", "Centralizar na vertical"], ["base", "al-base", "Alinhar na base"]]
      .map(([v, ic, t]) => `<button class="c" data-a="alinhar" data-v="${v}" title="${t}${um ? " da tela" : ""}">${icon(ic, 16)}</button>`).join("");
  }
  function posicionarCtx() {
    const box = $("#peCtx"); if (box.hidden || !PE.sel.length) return;
    const cv = $("#peCanvas"), cw = cv.clientWidth, ch = cv.clientHeight;
    const xs = PE.sel.map((s) => s.rect), x0 = Math.min(...xs.map((r) => r.x)), y0 = Math.min(...xs.map((r) => r.y)),
      x1 = Math.max(...xs.map((r) => r.x + r.w)), y1 = Math.max(...xs.map((r) => r.y + r.h));
    const w = box.offsetWidth, h = box.offsetHeight;
    let x = (x0 + x1) / 2 - w / 2; x = Math.max(10, Math.min(cw - w - 10, x));
    const folga = PE.sel[0].prancheta ? 34 : 16;
    let y = y0 - h - folga;
    if (y < 8) y = Math.min(y1 + 40, ch - h - 84);
    if (y < 8) y = 8;
    box.style.left = Math.round(x) + "px"; box.style.top = Math.round(y) + "px";
  }
  function ligarCtx() {
    const box = $("#peCtx"), st = PE.sel[0].estilo;
    box.querySelectorAll("[data-a]").forEach((b) => {
      const a = b.dataset.a;
      if (a === "tam") b.onclick = (e) => { const v = Math.max(1, Math.round(st.fontSize) + +b.dataset.d * (e.shiftKey ? 10 : 2)); ED().estilo({ "font-size": v + "px" }); };
      if (a === "tam-in") { b.onchange = () => { const v = +b.value; if (v > 0) ED().estilo({ "font-size": v + "px" }); }; b.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") b.blur(); }; }
      if (a === "negrito") b.onclick = () => ED().estilo({ "font-weight": +st.fontWeight >= 600 ? "400" : "800" });
      if (a === "italico") b.onclick = () => ED().estilo({ "font-style": st.fontStyle === "italic" ? "normal" : "italic" });
      if (a === "alinhar-txt") b.onclick = () => { const ord = ["left", "center", "right"]; const at = st.textAlign === "start" ? "left" : st.textAlign === "end" ? "right" : st.textAlign; ED().estilo({ "text-align": ord[(ord.indexOf(at) + 1) % 3] }); };
      if (a === "raio") b.onclick = (e) => { const v = Math.max(0, Math.round(st.borderRadius) + +b.dataset.d * (e.shiftKey ? 20 : 4)); ED().estilo({ "border-radius": v + "px", overflow: "hidden" }); };
      if (a === "raio-in") { b.onchange = () => ED().estilo({ "border-radius": Math.max(0, +b.value || 0) + "px", overflow: "hidden" }); b.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") b.blur(); }; }
      if (a === "opa-in") { b.onchange = () => ED().estilo({ opacity: String(Math.max(0, Math.min(100, +b.value || 0)) / 100) }); b.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") b.blur(); }; }
      if (a === "alinhar") b.onclick = () => ED().alinhar(b.dataset.v);
      if (a === "dist") b.onclick = () => ED().distribuir(b.dataset.v);
      if (a === "entrar") b.onclick = () => ED().tecla({ key: "Enter", preventDefault() {} });
      if (a === "ia") b.onclick = () => { trocarAba("ia"); $("#peTxt").focus(); };
      if (a === "fonte") b.onclick = () => abrirFontes(b);
      if (a === "cor") b.onclick = () => abrirCor(b);
      if (a === "mais") b.onclick = () => abrirMais(b);
    });
  }

  /* ---------- popovers ---------- */
  function abrirPop(html, ancora, modo, classe) {
    const pop = $("#pePop"); pop.className = "pe-pop pe-flutua " + (classe || ""); pop.innerHTML = html; pop.hidden = false; PE.pop = modo;
    const r = ancora.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = r.bottom + 8; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
    pop.style.left = x + "px"; pop.style.top = y + "px";
    paintIcons();
  }
  function fecharPop() { const pop = $("#pePop"); if (!pop.hidden) { pop.hidden = true; pop.innerHTML = ""; PE.pop = null; } }
  document.addEventListener("mousedown", (e) => { if (PE.pop && !e.target.closest("#pePop") && !e.target.closest("[data-a='cor'],[data-a='fonte'],[data-a='mais'],#peChip")) fecharPop(); });

  // fonte
  const fontesCarregadas = new Set();
  function carregarFonteAqui(f) { if (fontesCarregadas.has(f.n)) return; fontesCarregadas.add(f.n); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = f.url; document.head.appendChild(l); }
  function abrirFontes(ancora) {
    const atual = nomeFonte(PE.sel[0].estilo.fontFamily), ed = ED();
    const doPost = (ed ? ed.fontesDoPost() : []).filter((n) => !FONTES.some((f) => f.n === n));
    const lista = (filtro) => {
      const ok = (n) => !filtro || n.toLowerCase().includes(filtro.toLowerCase());
      const marca = FONTES.filter((f) => (ed ? ed.fontesDoPost() : []).includes(f.n));
      const outras = FONTES.filter((f) => !marca.includes(f));
      const bt = (n, fam) => `<button class="pe-fnt${n === atual ? " on" : ""}" data-f="${esc(n)}" style="font-family:'${esc(n)}',${fam}">${esc(n)}</button>`;
      let h = "";
      const noPost = marca.map((f) => [f.n, f.f]).concat(doPost.map((n) => [n, "sans-serif"])).filter(([n]) => ok(n));
      if (noPost.length) h += `<h5>No post</h5>` + noPost.map(([n, fam]) => bt(n, fam)).join("");
      const resto = outras.filter((f) => ok(f.n));
      if (resto.length) h += `<h5 style="margin-top:10px">Google Fonts</h5>` + resto.map((f) => bt(f.n, f.f)).join("");
      return h || '<p style="font-size:12px;color:var(--muted-foreground)">Nenhuma fonte com esse nome.</p>';
    };
    FONTES.forEach(carregarFonteAqui);
    abrirPop(`<input id="peFBusca" placeholder="Buscar fonte" autocomplete="off"/><div id="peFLista">${lista("")}</div>`, ancora, "fonte", "pe-fontes");
    const ligar = () => $$("#peFLista [data-f]").forEach((b) => (b.onclick = async () => {
      const n = b.dataset.f, f = FONTES.find((x) => x.n === n);
      if (f && ED()) await ED().garantirFonte(f.url);
      ED() && ED().estilo({ "font-family": `'${n}', ${f ? f.f : "sans-serif"}` }); fecharPop();
    }));
    ligar(); const bus = $("#peFBusca"); bus.focus();
    bus.oninput = () => { $("#peFLista").innerHTML = lista(bus.value); ligar(); };
    bus.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") fecharPop(); };
  }

  // cor e degradê
  function hexDe(c) {
    if (!c) return "#000000"; if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase(); if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("").toLowerCase();
    const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return "#000000";
    const [r, g, b] = m[1].split(/[ ,/]+/).map(Number); return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, "0")).join("");
  }
  function lerDegrade(css) {
    const m = String(css || "").match(/(linear|radial)-gradient\((.*)\)\s*$/); if (!m) return null;
    const corpo = m[2]; let ang = 90; const am = corpo.match(/^\s*(-?\d+(\.\d+)?)deg/); if (am) ang = +am[1];
    const cores = [...corpo.matchAll(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s*(\d+(\.\d+)?%)?/g)];
    if (cores.length < 2) return null;
    const stops = cores.map((c, i) => ({ c: hexDe(c[1]), p: c[2] ? parseFloat(c[2]) : Math.round((i / (cores.length - 1)) * 100) }));
    return { tipo: m[1], ang, stops, ativo: 0 };
  }
  const cssDegrade = (g) => { const st = g.stops.slice().sort((a, b) => a.p - b.p).map((s) => `${s.c} ${Math.round(s.p)}%`).join(", ");
    return g.tipo === "radial" ? `radial-gradient(circle, ${st})` : `linear-gradient(${Math.round(g.ang)}deg, ${st})`; };
  function aplicarCor(valor, ehGrad, vivo) {
    const ed = ED(); if (!ed) return;
    if (PE.alvoCor === "texto") {
      ed.estilo(ehGrad
        ? { "background-image": valor, "-webkit-background-clip": "text", "background-clip": "text", "-webkit-text-fill-color": "transparent" }
        : { color: valor, "background-image": "none", "-webkit-background-clip": "", "background-clip": "", "-webkit-text-fill-color": valor }, vivo);
    } else ed.estilo({ background: valor }, vivo);
  }
  function abrirCor(ancora) {
    const st = PE.sel[0].estilo, txt = PE.alvoCor === "texto";
    const gAtual = lerDegrade(txt ? (st.clipTexto ? st.backgroundImage : "") : st.backgroundImage);
    const solida = hexDe(txt ? st.color : st.backgroundColor);
    const ds = (designSystems || []).find((d) => d.id === PE.post.marca);
    const marca = ((ds && ds.cores) || []).concat(["#ffffff", "#000000"]);
    PE.grad = gAtual || { tipo: "linear", ang: 90, stops: [{ c: marca[1] || "#d12b6d", p: 0 }, { c: marca[2] || "#f9a8d4", p: 100 }], ativo: 0 };
    let modo = gAtual ? "grad" : "solida";
    const desenhar = () => {
      const g = PE.grad;
      const sw = `<div class="pe-sws">${marca.map((c) => `<button class="pe-sw" data-sw="${esc(c)}" style="background:${esc(c)}" title="${esc(c)}"></button>`).join("")}</div>`;
      const corpoSol = `<label class="pe-big" style="background:${solida}"><input type="color" id="peCorSol" value="${solida}" style="opacity:0;width:100%;height:100%;cursor:pointer"/></label>
        <div class="pe-prow"><span>Hex</span><input class="hex" id="peHex" value="${solida}"/>${txt ? "" : `<button class="pe-btn" id="peSemFundo" style="padding:4px 9px;font-size:11px">Sem fundo</button>`}</div>
        <h5 style="margin-top:12px">Marca</h5>${sw}`;
      const s = g.stops[g.ativo] || g.stops[0];
      const corpoGrad = `<div class="pe-gbar" id="peGBar" style="background:linear-gradient(90deg, ${g.stops.slice().sort((a, b) => a.p - b.p).map((x) => x.c + " " + x.p + "%").join(", ")})">
          ${g.stops.map((x, i) => `<span class="pe-stop${i === g.ativo ? " on" : ""}" data-st="${i}" style="left:${x.p}%;background:${x.c}"></span>`).join("")}</div>
        <div class="pe-prow"><input type="color" id="peStopCor" value="${s.c}"/><input class="hex" id="peStopHex" value="${s.c}"/>${g.stops.length > 2 ? `<button class="pe-icb" id="peStopDel" title="Tirar esta cor">${icon("trash", 14)}</button>` : ""}</div>
        <div class="pe-prow"><select id="peGTipo"><option value="linear" ${g.tipo === "linear" ? "selected" : ""}>Linear</option><option value="radial" ${g.tipo === "radial" ? "selected" : ""}>Radial</option></select>
          ${g.tipo === "linear" ? `<span style="margin-left:auto">Ângulo</span><input class="ang" id="peGAng" type="number" value="${Math.round(g.ang)}"/>` : ""}</div>
        <h5 style="margin-top:12px">Marca <span style="text-transform:none;letter-spacing:0;font-weight:500">(vai na cor marcada)</span></h5>${sw}
        <p style="font-size:11px;color:var(--muted-foreground);margin:10px 0 0">Clique na barra pra pôr mais uma cor. Arraste as cores pra mudar o degradê.</p>`;
      $("#pePop").innerHTML = `<div class="pe-seg"><button data-m="solida" class="${modo === "solida" ? "on" : ""}">Sólida</button><button data-m="grad" class="${modo === "grad" ? "on" : ""}">Degradê</button></div>${modo === "solida" ? corpoSol : corpoGrad}`;
      paintIcons(); ligar();
    };
    const ligar = () => {
      $$("#pePop [data-m]").forEach((b) => (b.onclick = () => { modo = b.dataset.m; if (modo === "grad") aplicarCor(cssDegrade(PE.grad), true); desenhar(); }));
      $$("#pePop input").forEach((i) => i.addEventListener("keydown", (e) => e.stopPropagation()));
      if (modo === "solida") {
        const ci = $("#peCorSol");
        ci.oninput = () => { ci.parentElement.style.background = ci.value; $("#peHex").value = ci.value; aplicarCor(ci.value, false, true); };
        ci.onchange = () => aplicarCor(ci.value, false);
        $("#peHex").onchange = () => { const v = $("#peHex").value.trim(); if (/^#?[0-9a-f]{3,8}$/i.test(v)) aplicarCor(v.startsWith("#") ? v : "#" + v, false); };
        if ($("#peSemFundo")) $("#peSemFundo").onclick = () => ED().estilo({ background: "transparent" });
        $$("#pePop [data-sw]").forEach((b) => (b.onclick = () => { aplicarCor(b.dataset.sw, false); ci.value = hexDe(b.dataset.sw); ci.parentElement.style.background = b.dataset.sw; $("#peHex").value = b.dataset.sw; }));
        return;
      }
      const g = PE.grad, aplicaG = (vivo) => aplicarCor(cssDegrade(g), true, vivo);
      const bar = $("#peGBar");
      bar.onmousedown = (e) => {
        const st = e.target.closest("[data-st]"), r = bar.getBoundingClientRect();
        if (st) {
          g.ativo = +st.dataset.st; e.preventDefault();
          const mover = (ev) => { g.stops[g.ativo].p = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)); st.style.left = g.stops[g.ativo].p + "%";
            bar.style.background = "linear-gradient(90deg, " + g.stops.slice().sort((a, b) => a.p - b.p).map((x) => x.c + " " + x.p + "%").join(", ") + ")"; aplicaG(true); };
          const soltar = () => { document.removeEventListener("mousemove", mover); document.removeEventListener("mouseup", soltar); aplicaG(false); desenhar(); };
          document.addEventListener("mousemove", mover); document.addEventListener("mouseup", soltar);
          $$("#peGBar .pe-stop").forEach((x, i) => x.classList.toggle("on", i === g.ativo)); $("#peStopCor").value = g.stops[g.ativo].c; $("#peStopHex").value = g.stops[g.ativo].c;
          return;
        }
        const p = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
        g.stops.push({ c: g.stops[g.ativo].c, p }); g.ativo = g.stops.length - 1; aplicaG(false); desenhar();
      };
      const ci = $("#peStopCor");
      ci.oninput = () => { g.stops[g.ativo].c = ci.value; $("#peStopHex").value = ci.value; aplicaG(true);
        bar.style.background = "linear-gradient(90deg, " + g.stops.slice().sort((a, b) => a.p - b.p).map((x) => x.c + " " + x.p + "%").join(", ") + ")";
        const sp = bar.querySelector(`[data-st="${g.ativo}"]`); if (sp) sp.style.background = ci.value; };
      ci.onchange = () => { aplicaG(false); desenhar(); };
      $("#peStopHex").onchange = () => { const v = $("#peStopHex").value.trim(); if (/^#?[0-9a-f]{3,8}$/i.test(v)) { g.stops[g.ativo].c = hexDe(v.startsWith("#") ? v : "#" + v); aplicaG(false); desenhar(); } };
      if ($("#peStopDel")) $("#peStopDel").onclick = () => { g.stops.splice(g.ativo, 1); g.ativo = 0; aplicaG(false); desenhar(); };
      $("#peGTipo").onchange = () => { g.tipo = $("#peGTipo").value; aplicaG(false); desenhar(); };
      if ($("#peGAng")) $("#peGAng").onchange = () => { g.ang = +$("#peGAng").value || 0; aplicaG(false); };
      $$("#pePop [data-sw]").forEach((b) => (b.onclick = () => { g.stops[g.ativo].c = hexDe(b.dataset.sw); aplicaG(false); desenhar(); }));
    };
    abrirPop("", ancora, "cor"); $("#pePop").style.width = "268px"; desenhar();
    // reposiciona depois de desenhar (a altura mudou)
    const pop = $("#pePop"), r = ancora.getBoundingClientRect(); let y = r.bottom + 8; if (y + pop.offsetHeight > innerHeight - 8) y = Math.max(8, r.top - pop.offsetHeight - 8); pop.style.top = y + "px";
  }
  // mais ações
  function abrirMais(ancora) {
    const um = PE.sel.length === 1, s0 = PE.sel[0];
    abrirPop(`<div class="pe-menu">
      ${um && s0.texto ? `<button data-m="editar">${icon("type", 14)} Editar texto <kbd>Enter</kbd></button>` : ""}
      <button data-m="duplicar">${icon("copy", 14)} Duplicar <kbd>Ctrl+D</kbd></button>
      <hr><button data-m="topo">${icon("chevrons-up", 14)} Trazer pro topo <kbd>Ctrl+Shift+]</kbd></button>
      <button data-m="frente">${icon("chevron-up", 14)} Trazer pra frente <kbd>Ctrl+]</kbd></button>
      <button data-m="tras">${icon("chevron-down", 14)} Mandar pra trás <kbd>Ctrl+[</kbd></button>
      <button data-m="fundo">${icon("chevrons-down", 14)} Mandar pro fundo <kbd>Ctrl+Shift+[</kbd></button>
      ${um ? `<hr><button data-m="ocultar">${icon("eye-off", 14)} Ocultar</button><button data-m="travar">${icon("lock", 14)} Travar</button>` : ""}
      <hr><button data-m="excluir" class="perigo">${icon("trash", 14)} Excluir <kbd>Del</kbd></button></div>`, ancora, "mais");
    $$("#pePop [data-m]").forEach((b) => (b.onclick = () => {
      const ed = ED(); if (!ed) return; const m = b.dataset.m; fecharPop();
      if (m === "editar") ed.editarTexto(s0.id);
      else if (m === "duplicar") ed.duplicar();
      else if (["topo", "frente", "tras", "fundo"].includes(m)) ed.ordem(m);
      else if (m === "ocultar") ed.alternar(s0.id, "oculto");
      else if (m === "travar") ed.alternar(s0.id, "travado");
      else if (m === "excluir") ed.excluir();
    }));
  }

  /* ---------- dock de ferramentas ---------- */
  const FERR = [
    ["mover", "mouse", "V", "Mover e selecionar"], ["mao", "hand", "H", "Mão (ou segure Espaço)"], "|",
    ["frame", "frame", "F", "Frame com auto layout · fase 2", 1], ["retangulo", "square", "R", "Retângulo"], ["elipse", "circle", "O", "Elipse"],
    ["pen", "pen-tool", "P", "Caneta (pen tool) · fase 2", 1], ["texto", "type", "T", "Texto"], ["imagem", "image", "I", "Imagem"], "|",
    ["cortar", "crop", "C", "Cortar imagem · fase 2", 1], ["mascara", "mask", "M", "Máscara · fase 2", 1], ["fundo", "eraser", "", "Remover fundo · fase 2", 1], ["area", "lasso", "L", "Selecionar área · fase 2", 1],
  ];
  function renderDock() {
    $("#peDock").innerHTML = FERR.map((f) => f === "|" ? '<span class="sep"></span>'
      : `<button class="pe-tool${PE.ferramenta === f[0] ? " on" : ""}${f[4] ? " breve" : ""}" data-f="${f[0]}" data-tip="${esc(f[3])}${f[2] ? " (" + f[2] + ")" : ""}">${icon(f[1], 17)}${f[2] ? `<b class="k">${f[2]}</b>` : ""}</button>`).join("");
    $$("#peDock [data-f]").forEach((b) => (b.onclick = () => {
      const f = FERR.find((x) => x[0] === b.dataset.f);
      if (f[4]) return toast(f[3].replace(" · fase 2", "") + " chega na fase 2 do editor");
      if (f[0] === "imagem") return escolherImagem();
      ED() && ED().ferramenta(f[0]);
    }));
    paintIcons();
  }

  /* ---------- imagens ---------- */
  function escolherImagem() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) subirImagem(f); }; inp.click();
  }
  function subirImagem(file, x, y) {
    if (file.size > 25e6) return toast("Imagem grande demais (máx. 25 MB)");
    const rd = new FileReader();
    rd.onload = async () => {
      const r = await POST("/api/posts/asset", { id: PE.post.id, dataUrl: rd.result, nome: file.name });
      if (!r || !r.ok) return toast("⚠️ " + ((r && r.erro) || "não consegui guardar a imagem"));
      const img = new Image(); img.onload = () => ED() && ED().inserirImagem(r.src, img.naturalWidth, img.naturalHeight, x, y); img.onerror = () => ED() && ED().inserirImagem(r.src, 0, 0, x, y);
      img.src = postArq(PE.post, r.src);
    };
    rd.readAsDataURL(file);
  }

  /* ---------- zoom ---------- */
  $("#peZoomMenos").onclick = () => ED() && ED().zoom("menos");
  $("#peZoomMais").onclick = () => ED() && ED().zoom("mais");
  $("#peZoomPct").onclick = () => ED() && ED().zoom("100");
  $("#peZoomAjustar").onclick = () => ED() && ED().zoom("ajustar");

  /* ---------- prévia do Instagram ---------- */
  function renderPrevia(recarregar) {
    const p = PE.post; if (!p || $("#pePrev").hidden) return;
    const larg = 186, s = larg / p.w, alt = Math.round(p.h * s);
    PE.prevI = Math.max(0, Math.min(PE.n - 1, PE.prevI));
    const ig = $("#peIg"); ig.style.height = alt + "px";
    let fr = ig.querySelector("iframe");
    if (!fr || recarregar) {
      clearTimeout(PE.tPrev);
      PE.tPrev = setTimeout(() => {
        const novo = document.createElement("iframe"); novo.setAttribute("scrolling", "no"); novo.tabIndex = -1; novo.title = "Prévia";
        novo.src = postArq(p, "post.html") + "?v=" + Date.now();
        novo.style.cssText = `width:${p.w * PE.n}px;height:${p.h}px;transform:scale(${s}) translateX(-${PE.prevI * p.w}px)`;
        novo.onload = () => { const velho = ig.querySelector("iframe:not(:last-of-type)"); if (velho) velho.remove(); };
        ig.insertBefore(novo, ig.querySelector(".seta"));
      }, fr ? 300 : 0);
    } else fr.style.transform = `scale(${s}) translateX(-${PE.prevI * p.w}px)`;
    $("#pePrevN").textContent = `${PE.prevI + 1}/${PE.n}`;
    $("#peDots").innerHTML = Array.from({ length: PE.n }, (_, i) => `<i class="${i === PE.prevI ? "on" : ""}"></i>`).join("");
    ig.querySelector(".seta.e").style.display = PE.prevI > 0 ? "" : "none";
    ig.querySelector(".seta.d").style.display = PE.prevI < PE.n - 1 ? "" : "none";
  }
  $("#peIg").querySelector(".seta.e").onclick = (e) => { e.stopPropagation(); PE.prevI--; renderPrevia(); };
  $("#peIg").querySelector(".seta.d").onclick = (e) => { e.stopPropagation(); PE.prevI++; renderPrevia(); };
  $("#peIg").onclick = () => ED() && ED().irParaTela(PE.prevI);
  $("#pePrevX").onclick = () => $("#pePrevBtn").click();

  /* ---------- baixar PNG ---------- */
  $("#pePng").onclick = async () => {
    const p = PE.post; if (!p) return;
    if (!(window.estudio && window.estudio.capturarTelas)) return toast("Baixar PNG funciona no app instalado (Open Design)");
    await salvarAgora();
    const btn = $("#pePng"), h0 = btn.innerHTML; btn.disabled = true; btn.textContent = "Fotografando as telas…";
    try {
      const imgs = await window.estudio.capturarTelas(location.origin + postArq(p, "post.html") + "?v=" + Date.now(), p.w, p.h, PE.n);
      if (!imgs || !imgs.length) toast("⚠️ não consegui fotografar as telas");
      else {
        btn.textContent = "Salvando…";
        const r = await POST("/api/posts/png", { id: p.id, imagens: imgs });
        if (r && r.ok) { toast("✅ " + r.salvos + " PNG(s) salvos na pasta do post"); try { window.estudio.abrirCaminho && window.estudio.abrirCaminho(r.pasta); } catch (e) {} }
        else toast("⚠️ " + ((r && r.erro) || "não consegui salvar os PNGs"));
      }
    } catch (e) { toast("⚠️ erro ao gerar os PNGs"); }
    btn.disabled = false; btn.innerHTML = h0; paintIcons();
  };

  /* ---------- teclado com o foco fora da prancheta ---------- */
  document.addEventListener("keydown", (e) => {
    if (!aberto()) return;
    if (e.key === "Escape" && PE.pop) { fecharPop(); return; }
    const t = e.target; if (t && t.closest && t.closest("input,textarea,select,[contenteditable='true']")) return;
    if (document.querySelector(".modal.on")) return; // um "tem certeza?" aberto: as teclas são dele
    const ed = ED(); if (ed) ed.tecla(e);
  });
  window.addEventListener("resize", () => { if (aberto()) posicionarCtx(); });

  /* ---------- novo post (na galeria) ---------- */
  async function criarPostNovo(comIA) {
    const pedido = $("#pf-pedido").value.trim();
    if (comIA && !pedido) { toast("Conte sobre o que é o post"); $("#pf-pedido").focus(); return; }
    const r = await POST("/api/posts/criar", { titulo: pedido ? pedido.split(/[.\n!?]/)[0].slice(0, 70) : "Post sem nome", formato: postFormato,
      slides: +$("#pf-telas").value || 5, marca: $("#pf-estilo").value, motor: $("#pf-motor").value });
    if (!r || !r.ok) return toast("⚠️ " + ((r && r.erro) || "não consegui criar o post"));
    $("#postForm").style.display = "none"; $("#pf-pedido").value = "";
    await abrirEditorPost(r.post);
    if (comIA) enviarPedido(pedido);
  }
  $("#pf-criar").onclick = () => criarPostNovo(true);
  $("#pf-branco").onclick = () => criarPostNovo(false);

  window.abrirEditorPost = abrirEditorPost;
})();
