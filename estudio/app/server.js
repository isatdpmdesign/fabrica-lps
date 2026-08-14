#!/usr/bin/env node
/**
 * Estúdio · servidor local do app da Fábrica de LPs
 * ---------------------------------------------------
 * Roda 100% na máquina da Isadora. Sem dependências (só Node puro).
 * A geração usa o Claude Code CLI da assinatura (custo de API: R$ 0).
 *
 * Uso:
 *   node estudio/app/server.js
 *   → abre http://localhost:4321
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");          // estudio/
const BRIEFINGS = path.join(ROOT, "briefings");
const TEMPLATES = path.join(ROOT, "templates");
const EXEMPLOS = path.join(ROOT, "exemplos");        // saída das LPs geradas
const PUBLIC = path.join(__dirname, "public");
const PORT = process.env.PORT || 4321;

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
  ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml" };

function send(res, code, body, type="application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type }); res.end(body);
}
function readJSON(p){ try { return JSON.parse(fs.readFileSync(p,"utf8")); } catch(e){ return null; } }

/* ---- monta o prompt que o Claude Code recebe ---- */
function buildPrompt(briefingFile, templateId) {
  const tplDir = path.join(TEMPLATES, templateId);
  const outFile = path.join(EXEMPLOS, path.basename(briefingFile).replace(/\.json$/, "") + ".html");
  return `Você é o motor de geração da Fábrica de LPs.

1. Leia o template-base em: ${path.join(tplDir, "template.html")}
2. Leia o manifesto (regras + slots) em: ${path.join(tplDir, "template.json")}
3. Leia o briefing do cliente em: ${briefingFile}

Gere a landing page final seguindo as regras_ia do manifesto:
- Troque os DESIGN TOKENS para refletir a marca do cliente (cores/fontes).
- Preencha TODOS os slots {{...}} com conteúdo real do briefing (nunca deixe {{...}}).
- Mantenha a ordem das seções; remova só seções não-obrigatórias sem material.
- Nunca invente prova social, números ou depoimentos falsos.
- Copy no tom de voz da marca; foco no benefício.

Escreva o HTML final completo no arquivo: ${outFile}
Não escreva mais nada além de criar/atualizar esse arquivo.`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: lista de briefings
  if (url.pathname === "/api/briefings") {
    const files = fs.existsSync(BRIEFINGS) ? fs.readdirSync(BRIEFINGS).filter(f=>f.endsWith(".json")) : [];
    const list = files.map(f => {
      const b = readJSON(path.join(BRIEFINGS, f)) || {};
      const out = f.replace(/\.json$/, "") + ".html";
      return { file:f, id:b.cliente_id||f, nome:(b.negocio&&b.negocio.nome)||f,
        nicho:(b.negocio&&b.negocio.nicho)||"", template:b.template||"servico-premium",
        gerado: fs.existsSync(path.join(EXEMPLOS, out)), out };
    });
    return send(res, 200, JSON.stringify(list));
  }

  // API: templates disponíveis
  if (url.pathname === "/api/templates") {
    const dirs = fs.existsSync(TEMPLATES) ? fs.readdirSync(TEMPLATES).filter(d=>fs.existsSync(path.join(TEMPLATES,d,"template.json"))) : [];
    const list = dirs.map(d => { const m = readJSON(path.join(TEMPLATES,d,"template.json"))||{}; return { id:d, nome:m.nome||d, melhor_para:m.melhor_para||[] }; });
    return send(res, 200, JSON.stringify(list));
  }

  // API: gerar (chama o Claude Code CLI)
  if (url.pathname === "/api/generate" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const { briefingFile, templateId } = JSON.parse(body || "{}");
      const bPath = path.join(BRIEFINGS, path.basename(briefingFile||""));
      if (!fs.existsSync(bPath)) return send(res, 400, JSON.stringify({ ok:false, erro:"briefing não encontrado" }));
      const prompt = buildPrompt(bPath, templateId || "servico-premium");

      // roda: claude -p "<prompt>"  (headless, sob a assinatura)
      const child = spawn("claude", ["-p", prompt], { cwd: ROOT });
      let out = "", err = "";
      child.stdout.on("data", d => out += d);
      child.stderr.on("data", d => err += d);
      child.on("error", e => send(res, 200, JSON.stringify({ ok:false,
        erro:"não encontrei o comando 'claude'. Instale o Claude Code e faça login.", detalhe:e.message })));
      child.on("close", code => {
        const outFile = path.basename(briefingFile).replace(/\.json$/, "") + ".html";
        const exists = fs.existsSync(path.join(EXEMPLOS, outFile));
        send(res, 200, JSON.stringify({ ok: code===0 && exists, code, out: out.slice(-2000), err: err.slice(-1000), preview: exists ? "/preview/"+outFile : null }));
      });
    });
    return;
  }

  // serve LPs geradas
  if (url.pathname.startsWith("/preview/")) {
    const f = path.join(EXEMPLOS, path.basename(url.pathname));
    if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), "text/html; charset=utf-8");
    return send(res, 404, "não gerado ainda", "text/plain");
  }

  // arquivos estáticos do app
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  const fp = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (fp.startsWith(PUBLIC) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    return send(res, 200, fs.readFileSync(fp), MIME[path.extname(fp)] || "application/octet-stream");
  }
  send(res, 404, "não encontrado", "text/plain");
});

server.listen(PORT, () => {
  console.log(`\n  🏭  Estúdio da Fábrica de LPs rodando`);
  console.log(`     → abra  http://localhost:${PORT}\n`);
});
