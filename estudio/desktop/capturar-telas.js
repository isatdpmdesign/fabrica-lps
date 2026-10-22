/**
 * capturar-telas.js — fotografa as telas de um post (Instagram) em PNG.
 *
 * O post é UMA prancheta (<div data-prancheta>) com N telas lado a lado, cortada a
 * cada w px (os "slices" do Figma). Posts antigos têm N <section class="tela">
 * empilhadas. Abrimos numa janela INVISÍVEL e OFFSCREEN do tamanho exato de uma
 * tela e fotografamos corte por corte (empurrando a prancheta pro lado). Offscreen = renderiza no
 * tamanho pedido mesmo maior que o monitor e sem a escala do Windows (125%,
 * 150%), então o PNG sai com os pixels exatos do Instagram (ex.: 1080×1350).
 *
 * Só que o Windows ainda limita a janela à altura do monitor (1350 > ~1040 num
 * notebook 1080p): a página renderizava mais baixa e o resize final ESTICAVA a
 * foto. Por isso a foto principal sai pelo DevTools (CDP): fixa a área da página
 * em w×h (escala 1) e fotografa exatamente esse recorte, não importa o tamanho
 * real da janela. O capturePage antigo fica só de reserva.
 */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const limitar = (v, min, max, padrao) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao; };

// próxima imagem pintada (reserva, se o capturePage vier vazio no offscreen)
function proximaPintura(win, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    win.webContents.once("paint", (_e, _dirty, image) => { clearTimeout(t); resolve(image); });
    try { win.webContents.invalidate(); } catch (e) {}
  });
}

async function capturarTelas(BrowserWindow, args) {
  const a = args || {};
  const url = String(a.url || "");
  // só o servidor local do próprio Estúdio
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url)) return [];
  const w = limitar(a.w, 200, 2160, 1080), h = limitar(a.h, 200, 3840, 1350), n = limitar(a.n, 1, 20, 1);
  const out = [];
  let win = null;
  try {
    win = new BrowserWindow({
      width: w, height: h, useContentSize: true, show: false, frame: false, skipTaskbar: true,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    win.webContents.setFrameRate(30);
    await win.loadURL(url);
    // a barra de rolagem não pode aparecer na foto (a rolagem continua funcionando)
    try { await win.webContents.insertCSS("::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}html{scrollbar-width:none!important}"); } catch (e) {}
    // fontes do Google Fonts e imagens precisam assentar antes da foto
    try { await win.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true", true); } catch (e) {}
    await espera(1200);
    // tamanho de página fixo, independente do monitor
    let cdp = null;
    try {
      win.webContents.debugger.attach("1.3"); cdp = win.webContents.debugger;
      await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await espera(300);
    } catch (e) { cdp = null; }
    for (let i = 0; i < n; i++) {
      await win.webContents.executeJavaScript(
        "(function(){var p=document.querySelector('[data-prancheta]');" +
        "if(p){document.body.style.margin='0';p.style.position='relative';p.style.left='0';p.style.top='0';p.style.transform='translateX(-" + (i * w) + "px)';return;}" +
        "var t=document.querySelectorAll('.tela')[" + i + "];window.scrollTo(0,t?t.offsetTop:" + (i * h) + ");})()", true);
      await espera(400);
      if (cdp) {
        try {
          const r = await cdp.sendCommand("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true });
          if (r && r.data) { out.push("data:image/png;base64," + r.data); continue; }
        } catch (e) {}
      }
      let img = await win.webContents.capturePage();
      if (!img || img.isEmpty()) img = await proximaPintura(win, 3000);
      if (!img || img.isEmpty()) continue;
      const sz = img.getSize();
      if (sz.width !== w || sz.height !== h) img = img.resize({ width: w, height: h, quality: "best" });
      out.push("data:image/png;base64," + img.toPNG().toString("base64"));
    }
  } catch (e) {
    return out;
  } finally {
    try { if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch (e) {}
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
  }
  return out;
}

module.exports = { capturarTelas };
