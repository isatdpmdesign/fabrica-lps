@echo off
rem  Atalho pra ligar o Estudio da Fabrica de LPs (Windows).
rem  Da dois cliques neste arquivo. Ele abre o navegador sozinho.
title Estudio - Fabrica de LPs
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node nao encontrado. Instale em https://nodejs.org (versao LTS) e tente de novo.
  echo.
  pause
  exit /b
)
echo.
echo   Ligando o Estudio... o navegador vai abrir em instantes.
echo   Para desligar, feche esta janela.
echo.
node app\server.js
pause
