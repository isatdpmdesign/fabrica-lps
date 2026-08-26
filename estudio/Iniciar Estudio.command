#!/bin/bash
#  Atalho pra ligar o Estúdio da Fábrica de LPs (macOS/Linux).
#  Dê dois cliques neste arquivo. Ele abre o navegador sozinho.
#  (No macOS, na 1ª vez: clique com o botão direito → Abrir, pra liberar.)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node não encontrado. Instale em https://nodejs.org (versão LTS) e tente de novo."
  echo
  read -n 1 -s -r -p "  Aperte qualquer tecla para fechar."
  exit 1
fi
echo
echo "  Ligando o Estúdio... o navegador vai abrir em instantes."
echo "  Para desligar, feche esta janela (ou Ctrl+C)."
echo
node app/server.js
