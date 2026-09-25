/**
 * main.js — processo principal do Electron.
 *
 * Liga o servidor local (o mesmo app/server.js) numa pasta gravável e abre
 * uma janela apontando pra ele. Assim o Estúdio vira um app de desktop de
 * verdade: ícone, janela própria, sem terminal e sem navegador.
 *
 * O Node vem embutido no Electron (ELECTRON_RUN_AS_NODE), então a Isadora
 * não precisa instalar Node. Só o `claude` (pra gerar) e o `curl` (pra
 * publicar) continuam vindo do sistema.
 *
 * A pasta onde os arquivos ficam pode ser escolhida (ex.: dentro do Google
 * Drive), pra sincronizar entre computadores.
 */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");

// A porta é DINÂMICA: em vez de fixar 4321 (que um processo fantasma de uma
// instalação anterior pode estar segurando, travando o "servidor não respondeu"),
// pedimos ao sistema uma porta livre a cada abertura.
let PORT = 4321;
const BASE = path.join(__dirname, ".."); // pasta estudio/ dentro do pacote
let servidor = null;

/** Descobre uma porta livre no próprio computador. */
function acharPorta(cb) {
  const s = net.createServer();
  s.on("error", () => cb(0));
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => cb(p)); });
}
let janela = null;
let dataDirAtual = null;

/** Copia uma pasta inteira (recursivo). */
function copiar(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    const o = path.join(origem, nome), d = path.join(destino, nome);
    if (fs.statSync(o).isDirectory()) copiar(o, d);
    else fs.copyFileSync(o, d);
  }
}
const vazia = (dir) => { try { return fs.readdirSync(dir).length === 0; } catch { return true; } };

const cfgAppFile = () => path.join(app.getPath("userData"), "app-config.json");
function lerCfgApp() { try { return JSON.parse(fs.readFileSync(cfgAppFile(), "utf8")); } catch { return {}; } }
function salvarCfgApp(c) { fs.writeFileSync(cfgAppFile(), JSON.stringify(c, null, 2)); }

/** Testa se dá pra GRAVAR numa pasta (ex.: o Google Drive pode não estar
 * montado/sincronizado nesta máquina). */
function gravavel(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const t = path.join(dir, ".w_" + Date.now());
    fs.writeFileSync(t, "x"); fs.unlinkSync(t); return true; } catch (e) { return false; }
}

let driveIndisponivel = null; // caminho do Drive que falhou (pra avisar depois)

/** Descobre a pasta de dados: a escolhida pela pessoa, ou a padrão no userData.
 * Se a escolhida (ex.: uma pasta do Google Drive) NÃO estiver acessível nesta
 * máquina, não trava o app: cai na pasta local padrão e avisa. Os projetos
 * seguem seguros no Drive — quando ele voltar, reabrir usa o Drive de novo. */
function resolverDataDir() {
  const escolhida = lerCfgApp().dataDir;
  const padrao = path.join(app.getPath("userData"), "data");
  let alvo = escolhida || padrao;
  if (escolhida && !gravavel(escolhida)) { driveIndisponivel = escolhida; alvo = padrao; }
  // primeira vez (ou pasta nova vazia): leva os dados de exemplo pra lá
  if (vazia(alvo)) { try { copiar(path.join(BASE, "app", "data"), alvo); } catch (e) {} }
  return alvo;
}

/** Avisa (sem travar) que os projetos estão no Drive e ele não está disponível. */
function avisarDrive() {
  if (!driveIndisponivel) return;
  dialog.showMessageBox(janela, {
    type: "warning", buttons: ["Entendi"], defaultId: 0, title: "Google Drive indisponível",
    message: "Não consegui abrir sua pasta de projetos no Google Drive.",
    detail: "Abri a Fábrica com uma pasta local desta máquina pra você não ficar travada. " +
      "Seus projetos continuam seguros no Drive.\n\nPasta esperada:\n" + driveIndisponivel +
      "\n\nAbra e sincronize o Google Drive nesta máquina e reinicie a Fábrica pra ver seus projetos.",
  }).catch(() => {});
}

/** A partir da pasta que a pessoa escolheu, descobre a pasta de dados certa SEM
 * criar aninhamento. Reaproveita uma pasta de dados que já exista (evita virar
 * "Fábrica de LPs/data/Fábrica de LPs/data..." a cada clique em "Mudar onde salvar"). */
function ehPastaDados(dir) {
  try { return ["config.json", "db.json", "sites"].some((n) => fs.existsSync(path.join(dir, n))); }
  catch (e) { return false; }
}
function resolverAlvoEscolhido(escolhida) {
  if (ehPastaDados(escolhida)) return escolhida;                 // escolheu a própria "data"
  const dentro = path.join(escolhida, "data");
  if (ehPastaDados(dentro)) return dentro;                       // pasta que já contém "data"
  const aninhada = path.join(escolhida, "Fábrica de LPs", "data");
  if (ehPastaDados(aninhada)) return aninhada;                   // estrutura antiga já existente
  return dentro;                                                 // nova: cria "<escolhida>/data" (sem wrapper extra)
}

function spawnServidor() {
  // Os templates moram DENTRO da pasta de dados. Assim, quando a pasta é do
  // Google Drive, eles sincronizam entre computadores igual aos projetos.
  const tplDir = path.join(dataDirAtual, "templates");
  if (vazia(tplDir)) {
    // primeira vez nesta pasta: traz os templates que já existiam neste PC
    // (versão antiga guardava em userData/templates); senão, os de exemplo.
    const antigo = path.join(app.getPath("userData"), "templates");
    const origem = !vazia(antigo) ? antigo : path.join(BASE, "templates");
    try { copiar(origem, tplDir); } catch (e) {}
  }
  servidor = spawn(process.execPath, [path.join(BASE, "app", "server.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ESTUDIO_NO_OPEN: "1",
      ESTUDIO_DATA: dataDirAtual, ESTUDIO_TEMPLATES: tplDir, PORT: String(PORT) },
    stdio: "ignore",
  });
  servidor.on("error", (e) => dialog.showErrorBox("Erro ao iniciar", String(e.message || e)));
}

/** Mata o motorzinho interno (server.js). Como ele roda com o MESMO executável
 * do app (ELECTRON_RUN_AS_NODE), pro Windows ele parece "outra Fábrica de LPs"
 * aberta — se ficar vivo na hora de atualizar, o instalador reclama que "não
 * consegue fechar". Por isso matamos ANTES de sair/atualizar. */
function pararServidor() {
  if (!servidor) return;
  try { servidor.kill(); } catch (e) {}
  try { if (process.platform === "win32" && servidor.pid) require("child_process").execSync("taskkill /pid " + servidor.pid + " /T /F", { stdio: "ignore" }); } catch (e) {}
  servidor = null;
}

function esperarServidor(pronto, tentativa = 0, onFail) {
  const req = http.get("http://localhost:" + PORT + "/", (res) => { res.destroy(); pronto(); });
  req.on("error", () => {
    if (tentativa > 160) { // ~24s
      if (onFail) return onFail();
      return dialog.showErrorBox("Não consegui iniciar", "O servidor interno não respondeu.");
    }
    setTimeout(() => esperarServidor(pronto, tentativa + 1, onFail), 150);
  });
}

/** Sobe o servidor numa porta livre; se não responder, tenta OUTRA porta uma
 * vez antes de desistir (blinda contra processo fantasma segurando a porta). */
function ligarServidor(tentativa = 0) {
  acharPorta((p) => {
    if (p) PORT = p;
    spawnServidor();
    esperarServidor(
      () => { if (!janela) criarJanela(); iniciarAutoUpdate(); avisarDrive(); },
      0,
      () => {
        try { if (servidor) servidor.kill(); } catch (e) {}
        if (tentativa < 1) return ligarServidor(tentativa + 1);
        dialog.showErrorBox("Não consegui iniciar",
          "O servidor interno não respondeu.\n\n" +
          "1) Reinicie o computador e abra a Fábrica de novo.\n" +
          "2) Se persistir, confira se o Google Drive (onde ficam os projetos) está instalado e sincronizado nesta máquina.");
      }
    );
  });
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 640,
    backgroundColor: "#0a0409",
    title: "Fábrica de LPs",
    icon: path.join(BASE, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.js") },
  });
  Menu.setApplicationMenu(null);
  janela.loadURL("http://localhost:" + PORT + "/");
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith("http://localhost:" + PORT)) {
      shell.openExternal(url); return { action: "deny" };
    }
    return { action: "allow" };
  });
  janela.on("closed", () => (janela = null));
}

/* ---- atualização automática ----
 * Só no app empacotado. Ele checa o GitHub Releases, baixa a versão nova em
 * segundo plano e avisa a página; quando termina, oferece reiniciar pra aplicar.
 * A pessoa não precisa mais baixar o instalador na mão. */
let autoUpdater = null;
function enviarUpd(estado, extra) {
  try { if (janela && !janela.isDestroyed()) janela.webContents.send("atualizacao", { estado, ...(extra || {}) }); } catch (e) {}
}
function iniciarAutoUpdate() {
  if (!app.isPackaged) return;                 // em desenvolvimento não faz sentido
  try { ({ autoUpdater } = require("electron-updater")); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => enviarUpd("checando"));
  autoUpdater.on("update-available", (i) => enviarUpd("baixando", { versao: i && i.version, percent: 0 }));
  autoUpdater.on("update-not-available", () => enviarUpd("atual"));
  autoUpdater.on("download-progress", (p) => enviarUpd("baixando", { percent: Math.round(p.percent || 0) }));
  autoUpdater.on("error", (err) => enviarUpd("erro", { msg: String((err && err.message) || err) }));
  autoUpdater.on("update-downloaded", (i) => {
    enviarUpd("pronta", { versao: i && i.version });
    dialog.showMessageBox(janela, {
      type: "info", buttons: ["Reiniciar agora", "Depois"], defaultId: 0, cancelId: 1,
      title: "Atualização pronta",
      message: "Uma versão nova da Fábrica de LPs foi baixada.",
      detail: "Quer reiniciar agora pra usar a versão " + ((i && i.version) || "nova") + "? Seus projetos continuam salvos.",
    }).then((r) => { if (r.response === 0) setImmediate(reiniciarParaAtualizar); }).catch(() => {});
  });
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

/** Mata o motorzinho ANTES de aplicar a atualização, pra o instalador não
 * reclamar que "não consegue fechar a Fábrica de LPs". */
function reiniciarParaAtualizar() {
  pararServidor();               // síncrono no Windows (taskkill /T /F)
  try { autoUpdater.quitAndInstall(); } catch (e) {}
}

/* ---- comunicação com a página ---- */
ipcMain.handle("versao-app", () => app.getVersion());
ipcMain.handle("checar-atualizacao", async () => {
  if (!autoUpdater) return { ok: false, motivo: "indisponivel" };
  try { const r = await autoUpdater.checkForUpdates(); return { ok: true, versao: r && r.updateInfo && r.updateInfo.version }; }
  catch (e) { return { ok: false, motivo: String((e && e.message) || e) }; }
});
ipcMain.handle("instalar-atualizacao", () => { if (autoUpdater) reiniciarParaAtualizar(); });
ipcMain.handle("pasta-atual", () => dataDirAtual);
ipcMain.handle("abrir-pasta", () => shell.openPath(dataDirAtual));
ipcMain.handle("escolher-pasta", async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: "Escolha onde salvar os arquivos da Fábrica (ex.: uma pasta do Google Drive)",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const alvo = resolverAlvoEscolhido(r.filePaths[0]);
  // se a pasta nova estiver vazia, leva o que já existe pra lá (não sobrescreve uma já cheia — é o caso do 2º PC)
  if (vazia(alvo)) { try { copiar(dataDirAtual, alvo); } catch (e) { dialog.showErrorBox("Erro ao copiar", String(e.message || e)); return null; } }
  salvarCfgApp({ ...lerCfgApp(), dataDir: alvo });
  // reinicia o servidor apontando pra pasta nova e recarrega a tela
  pararServidor();
  dataDirAtual = alvo;
  setTimeout(() => { spawnServidor(); esperarServidor(() => janela && janela.reload()); }, 500);
  return alvo;
});

app.whenReady().then(() => {
  dataDirAtual = resolverDataDir();
  ligarServidor();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
// Mata o motorzinho cedo (before-quit) E no quit — inclusive quando o
// electron-updater instala a atualização ao sair (autoInstallOnAppQuit),
// pra o instalador nunca ver a Fábrica "ainda aberta".
app.on("before-quit", pararServidor);
app.on("quit", pararServidor);
