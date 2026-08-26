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
 */
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PORT = 4321;
const BASE = path.join(__dirname, ".."); // pasta estudio/ dentro do pacote
let servidor = null;
let janela = null;

/** Copia uma pasta (recursivo) só se o destino ainda não existir. */
function semear(origem, destino) {
  if (fs.existsSync(destino)) return;
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    const o = path.join(origem, nome), d = path.join(destino, nome);
    const st = fs.statSync(o);
    if (st.isDirectory()) semear(o, d);
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(o, d); }
  }
}

function iniciarServidor() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const tplDir = path.join(userData, "templates");
  // primeira execução: leva os dados e templates de exemplo pra pasta gravável
  try { semear(path.join(BASE, "app", "data"), dataDir); } catch (e) {}
  try { semear(path.join(BASE, "templates"), tplDir); } catch (e) {}

  servidor = spawn(process.execPath, [path.join(BASE, "app", "server.js")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ESTUDIO_NO_OPEN: "1",
      ESTUDIO_DATA: dataDir, ESTUDIO_TEMPLATES: tplDir, PORT: String(PORT) },
    stdio: "ignore",
  });
  servidor.on("error", (e) => dialog.showErrorBox("Erro ao iniciar", String(e.message || e)));
}

/** Espera o servidor responder antes de abrir a janela. */
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
    backgroundColor: "#ffffff",
    title: "Fábrica de LPs",
    icon: path.join(BASE, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null); // sem barra de menu — cara de app, não de navegador
  janela.loadURL("http://localhost:" + PORT + "/");
  // links externos (abrir site publicado, baixar HTML) abrem no navegador do sistema
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith("http://localhost:" + PORT)) {
      shell.openExternal(url); return { action: "deny" };
    }
    return { action: "allow" };
  });
  janela.on("closed", () => (janela = null));
}

app.whenReady().then(() => {
  iniciarServidor();
  esperarServidor(criarJanela);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("quit", () => { if (servidor) try { servidor.kill(); } catch (e) {} });
