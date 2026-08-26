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

const PORT = 4321;
const BASE = path.join(__dirname, ".."); // pasta estudio/ dentro do pacote
let servidor = null;
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

/** Descobre a pasta de dados: a escolhida pela pessoa, ou a padrão no userData. */
function resolverDataDir() {
  const escolhida = lerCfgApp().dataDir;
  const padrao = path.join(app.getPath("userData"), "data");
  const alvo = escolhida || padrao;
  // primeira vez (ou pasta nova vazia): leva os dados de exemplo pra lá
  if (vazia(alvo)) { try { copiar(path.join(BASE, "app", "data"), alvo); } catch (e) {} }
  return alvo;
}

function spawnServidor() {
  const tplDir = path.join(app.getPath("userData"), "templates");
  if (vazia(tplDir)) { try { copiar(path.join(BASE, "templates"), tplDir); } catch (e) {} }
  servidor = spawn(process.execPath, [path.join(BASE, "app", "server.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ESTUDIO_NO_OPEN: "1",
      ESTUDIO_DATA: dataDirAtual, ESTUDIO_TEMPLATES: tplDir, PORT: String(PORT) },
    stdio: "ignore",
  });
  servidor.on("error", (e) => dialog.showErrorBox("Erro ao iniciar", String(e.message || e)));
}

function esperarServidor(pronto, tentativa = 0) {
  const req = http.get("http://localhost:" + PORT + "/", (res) => { res.destroy(); pronto(); });
  req.on("error", () => {
    if (tentativa > 120) return dialog.showErrorBox("Não consegui iniciar", "O servidor interno não respondeu.");
    setTimeout(() => esperarServidor(pronto, tentativa + 1), 150);
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

/* ---- comunicação com a página ---- */
ipcMain.handle("pasta-atual", () => dataDirAtual);
ipcMain.handle("abrir-pasta", () => shell.openPath(dataDirAtual));
ipcMain.handle("escolher-pasta", async () => {
  const r = await dialog.showOpenDialog(janela, {
    title: "Escolha onde salvar os arquivos da Fábrica (ex.: uma pasta do Google Drive)",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const alvo = path.join(r.filePaths[0], "Fábrica de LPs", "data");
  // se a pasta nova estiver vazia, leva o que já existe pra lá (não sobrescreve uma já cheia — é o caso do 2º PC)
  if (vazia(alvo)) { try { copiar(dataDirAtual, alvo); } catch (e) { dialog.showErrorBox("Erro ao copiar", String(e.message || e)); return null; } }
  salvarCfgApp({ ...lerCfgApp(), dataDir: alvo });
  // reinicia o servidor apontando pra pasta nova e recarrega a tela
  if (servidor) try { servidor.kill(); } catch (e) {}
  dataDirAtual = alvo;
  setTimeout(() => { spawnServidor(); esperarServidor(() => janela && janela.reload()); }, 500);
  return alvo;
});

app.whenReady().then(() => {
  dataDirAtual = resolverDataDir();
  spawnServidor();
  esperarServidor(criarJanela);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("quit", () => { if (servidor) try { servidor.kill(); } catch (e) {} });
