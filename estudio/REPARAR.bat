@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Rodando o reparo do Cloudflare... aguarde (acha o config.json sozinho).
echo.
node "%~dp0reparar-cloudflare.mjs" %1
echo.
echo ================================================================
echo  Pronto. Copie TODO o texto acima e mande pra Claude.
echo ================================================================
pause
