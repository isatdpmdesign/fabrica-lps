/**
 * gravar-rolagem.js — grava um vídeo da landing page rolando, no formato do
 * Reels (1080×1920), pra virar base dos vídeos de demonstração.
 *
 * Abre a página numa janela invisível com a tela de um celular (414×736 com
 * escala 1080/414, o que dá 1080×1920 exatos), rola do topo até o fim com
 * aceleração suave (para um pouco no começo e no fim) e fotografa quadro a
 * quadro pelo DevTools (CDP). Os quadros vão direto pro ffmpeg (ffmpeg-static,
 * que vem junto com o app) e sai um MP4 H.264 pronto pro Instagram.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const LARG = 414, ALT = 736, ESCALA = 1080 / LARG; // 414×736 × 2,6087 = 1080×1920

function caminhoFfmpeg() {
  if (process.env.FABRICA_FFMPEG && fs.existsSync(process.env.FABRICA_FFMPEG)) return process.env.FABRICA_FFMPEG;
  try {
    let p = require("ffmpeg-static");
    // dentro do app instalado o binário fica fora do .asar (asar está desligado, mas por garantia)
    if (p && p.includes("app.asar")) p = p.replace("app.asar", "app.asar.unpacked");
    return p && fs.existsSync(p) ? p : null;
  } catch (e) { return null; }
}

// sobe devagar, acelera no meio e desacelera no fim
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function gravarRolagem(BrowserWindow, args, aoProgresso) {
  const a = args || {};
  const url = String(a.url || "");
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url)) return { ok: false, erro: "endereço inválido" };
  const saida = String(a.saida || "");
  if (!saida.endsWith(".mp4")) return { ok: false, erro: "arquivo de saída inválido" };
  const ffmpeg = caminhoFfmpeg();
  if (!ffmpeg) return { ok: false, erro: "o gravador de vídeo (ffmpeg) não veio nesta versão do app" };
  const fps = 30;
  const progresso = (pct, etapa) => { try { aoProgresso && aoProgresso({ pct: Math.round(pct), etapa }); } catch (e) {} };

  let win = null, proc = null;
  try {
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    win = new BrowserWindow({
      width: LARG, height: ALT, useContentSize: true, show: false, frame: false, skipTaskbar: true,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    win.webContents.setFrameRate(60);
    progresso(2, "abrindo a página");
    // a emulação do celular só pode entrar depois que já existe uma página (antes, o Electron cai);
    // então carrega, liga a tela de celular e carrega de novo, pra página já nascer no tamanho certo
    await win.loadURL("about:blank");
    const cdp = win.webContents.debugger; cdp.attach("1.3");
    await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width: LARG, height: ALT, deviceScaleFactor: ESCALA, mobile: true });
    await cdp.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true });
    await win.loadURL(url);
    try { await win.webContents.insertCSS("::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}html{scrollbar-width:none!important;scroll-behavior:auto!important}"); } catch (e) {}
    // imagens "preguiçosas" já carregam (senão aparecem pela metade durante a rolagem)
    try { await win.webContents.executeJavaScript("document.querySelectorAll('img[loading=lazy]').forEach(function(i){i.loading='eager'});document.fonts?document.fonts.ready.then(function(){return true}):true", true); } catch (e) {}
    await espera(1500);
    const altura = await win.webContents.executeJavaScript("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)", true);
    const distancia = Math.max(0, (altura || ALT) - ALT);

    // tempo: 1s parada no topo, a rolagem (uns 520px de tela por segundo, entre 6 e 45s) e 1,5s parada no fim
    const segRolagem = Math.max(6, Math.min(45, distancia / 520));
    const qTopo = Math.round(fps * 1), qRola = Math.round(fps * segRolagem), qFim = Math.round(fps * 1.5);
    const total = qTopo + qRola + qFim;

    proc = spawn(ffmpeg, ["-y", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
      "-vf", "scale=1080:1920:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
      "-r", String(fps), "-movflags", "+faststart", saida], { windowsHide: true });
    let errFf = ""; proc.stderr.on("data", (d) => { errFf = (errFf + d).slice(-2000); });
    const terminou = new Promise((r) => proc.on("close", (code) => r(code)));
    const escrever = (buf) => new Promise((r) => { if (!proc.stdin.write(buf)) proc.stdin.once("drain", r); else r(); });

    for (let i = 0; i < total; i++) {
      let y = 0;
      if (i >= qTopo + qRola) y = distancia;
      else if (i >= qTopo) y = distancia * suave((i - qTopo) / Math.max(1, qRola - 1));
      // rola e espera dois quadros de pintura (animações de rolagem reagem)
      await win.webContents.executeJavaScript(
        "new Promise(function(r){window.scrollTo({top:" + Math.round(y) + ",left:0,behavior:'instant'});requestAnimationFrame(function(){requestAnimationFrame(function(){r(1)})})})", true);
      const shot = await cdp.sendCommand("Page.captureScreenshot", { format: "jpeg", quality: 92, captureBeyondViewport: false });
      await escrever(Buffer.from(shot.data, "base64"));
      if (i % 6 === 0) progresso(5 + (i / total) * 90, "gravando");
    }
    proc.stdin.end();
    progresso(97, "finalizando o vídeo");
    const code = await terminou;
    if (code !== 0 || !fs.existsSync(saida)) return { ok: false, erro: "o ffmpeg não conseguiu montar o vídeo", detalhe: errFf.slice(-600) };
    progresso(100, "pronto");
    return { ok: true, arquivo: saida, segundos: Math.round(total / fps) };
  } catch (e) {
    try { proc && proc.stdin.end(); } catch (er) {}
    return { ok: false, erro: String((e && e.message) || e) };
  } finally {
    try { if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch (e) {}
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
  }
}

module.exports = { gravarRolagem };
