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
  // inspeção da página (DevTools de verdade, tipo F12)
  inspecionar: (rota) => ipcRenderer.invoke("inspecionar-pagina", rota),
  // chat discreto: abre a conversa do projeto numa janela neutra (sem a Fábrica)
  abrirChatDiscreto: (id) => ipcRenderer.invoke("abrir-chat-discreto", id),
  // arquivos: abrir a pasta/arquivo no gerenciador e revelar um arquivo
  abrirCaminho: (caminho) => ipcRenderer.invoke("abrir-caminho", caminho),
  revelarArquivo: (caminho) => ipcRenderer.invoke("revelar-arquivo", caminho),
  // revisão do cliente: tira o print de uma área da página publicada (Chromium interno)
  capturarArea: (url, geo) => ipcRenderer.invoke("capturar-area", { url, geo }),
  // atualização automática
  versaoApp: () => ipcRenderer.invoke("versao-app"),
  checarAtualizacao: () => ipcRenderer.invoke("checar-atualizacao"),
  instalarAtualizacao: () => ipcRenderer.invoke("instalar-atualizacao"),
  aoAtualizar: (cb) => ipcRenderer.on("atualizacao", (_e, dados) => cb(dados)),
});
