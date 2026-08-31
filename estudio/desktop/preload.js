/**
 * preload.js — ponte segura entre a página (o Estúdio) e o Electron.
 * Expõe só o necessário pra escolher/abrir a pasta onde os arquivos ficam.
 */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("estudio", {
  desktop: true,
  pastaAtual: () => ipcRenderer.invoke("pasta-atual"),
  abrirPasta: () => ipcRenderer.invoke("abrir-pasta"),
  escolherPasta: () => ipcRenderer.invoke("escolher-pasta"),
  // atualização automática
  versaoApp: () => ipcRenderer.invoke("versao-app"),
  checarAtualizacao: () => ipcRenderer.invoke("checar-atualizacao"),
  instalarAtualizacao: () => ipcRenderer.invoke("instalar-atualizacao"),
  aoAtualizar: (cb) => ipcRenderer.on("atualizacao", (_e, dados) => cb(dados)),
});
