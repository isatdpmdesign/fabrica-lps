#!/usr/bin/env node
/**
 * Estúdio · servidor local do app da Fábrica de LPs
 * --------------------------------------------------
 * Roda 100% na máquina da Isadora. Sem dependências (só Node puro).
 * A geração/edição usa o Claude Code CLI da assinatura (custo de API: R$ 0).
 *
 *   node estudio/app/server.js   →   http://localhost:4321
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");            // estudio/
const APP = __dirname;                                 // estudio/app/
const PUBLIC = path.join(APP, "public");
const DATA = path.join(APP, "data");
const DB_FILE = path.join(DATA, "db.json");
const SITES = path.join(DATA, "sites");                // LPs geradas: sites/<id>/index.html
const TEMPLATES = path.join(ROOT, "templates");
const PORT = process.env.PORT || 4321;

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
  ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon" };

fs.mkdirSync(SITES, { recursive: true });

/* ---------------- helpers ---------------- */
const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { solicitacoes: [] }; } };
const writeDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const slug = (s) => (s || "cliente").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
function body(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); }); }

function listTemplates() {
  if (!fs.existsSync(TEMPLATES)) return [];
  return fs.readdirSync(TEMPLATES)
    .filter((d) => fs.existsSync(path.join(TEMPLATES, d, "template.json")))
    .map((d) => { try { const m = JSON.parse(fs.readFileSync(path.join(TEMPLATES, d, "template.json"), "utf8"));
      return { id: d, nome: m.nome || d, melhor_para: m.melhor_para || [] }; } catch { return { id: d, nome: d }; } });
}

/* ---- roda o Claude Code (headless) e resolve com o resultado ---- */
function runClaude(prompt) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt], { cwd: ROOT });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ ok: false, missing: true, err: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, out: out.slice(-2000), err: err.slice(-1000) }));
  });
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // listar
  if (p === "/api/solicitacoes" && req.method === "GET") return json(res, 200, readDB().solicitacoes);

  // criar (botão "+ Nova solicitação" — clientes de fora do funil / indicação)
  if (p === "/api/solicitacoes" && req.method === "POST") {
    const b = await body(req);
    if (!b.nome) return json(res, 400, { ok: false, erro: "informe o nome do cliente" });
    const db = readDB();
    let id = slug(b.proj || b.nome), n = 1; while (db.solicitacoes.some((s) => s.id === id)) id = slug(b.proj || b.nome) + "-" + ++n;
    const cores = ["#2563eb","#db2777","#16a34a","#d97706","#7c3aed","#0891b2"];
    const nova = { id, nome: b.nome, proj: b.proj || b.nome, area: b.area || "Geral",
      cor: cores[db.solicitacoes.length % cores.length], email: b.email || "", phone: b.phone || "",
      tpl: b.tpl || "servico-premium", origem: b.origem || "indicação", status: "new",
      createdAt: new Date().toISOString(), generated: false, briefing: b.briefing || {} };
    db.solicitacoes.unshift(nova); writeDB(db); return json(res, 200, { ok: true, solicitacao: nova });
  }

  // atualizar status (kanban / fluxo)
  if (p === "/api/solicitacoes/status" && req.method === "POST") {
    const b = await body(req); const db = readDB();
    const s = db.solicitacoes.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    s.status = b.status; writeDB(db); return json(res, 200, { ok: true });
  }

  // templates
  if (p === "/api/templates" && req.method === "GET") return json(res, 200, listTemplates());

  // GERAR a LP (Claude Code lê template + briefing e escreve o site)
  if (p === "/api/generate" && req.method === "POST") {
    const b = await body(req); const db = readDB();
    const s = db.solicitacoes.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false, erro: "solicitação não encontrada" });
    const tplDir = path.join(TEMPLATES, s.tpl);
    const outDir = path.join(SITES, s.id); fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "index.html");
    const prompt = `Você é o motor de geração da Fábrica de LPs.
Leia o template em ${path.join(tplDir, "template.html")} e o manifesto em ${path.join(tplDir, "template.json")}.
Dados do cliente (briefing): ${JSON.stringify(s, null, 2)}
Gere a landing page final seguindo as regras_ia do manifesto: troque os DESIGN TOKENS para a marca do cliente,
preencha TODOS os slots {{...}} com conteúdo real (nunca deixe {{...}}), mantenha a ordem das seções,
nunca invente prova social falsa. Escreva o HTML final completo em: ${outFile}
Não escreva mais nada além de criar/atualizar esse arquivo.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado. Instale o Claude Code e faça login." });
    const exists = fs.existsSync(outFile);
    if (r.ok && exists) { s.generated = true; s.status = "rev"; writeDB(db); return json(res, 200, { ok: true, preview: "/preview/" + s.id }); }
    return json(res, 200, { ok: false, erro: "a geração não concluiu — veja o terminal.", detalhe: r.err });
  }

  // EDITAR a LP (aplica os comentários/marcações via Claude Code)
  if (p === "/api/edit" && req.method === "POST") {
    const b = await body(req); const db = readDB();
    const s = db.solicitacoes.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    const outFile = path.join(SITES, s.id, "index.html");
    if (!fs.existsSync(outFile)) return json(res, 400, { ok: false, erro: "gere a página antes de editar." });
    const itens = (b.instrucoes || []).map((i, n) => `${n + 1}. [${i.alvo || "geral"}] ${i.texto}`).join("\n");
    const prompt = `Edite a landing page em ${outFile} aplicando as mudanças pedidas pelo cliente abaixo.
Altere apenas o necessário, preservando o resto do design intacto e mantendo a página auto-suficiente.
Mudanças:\n${itens}\nSalve no mesmo arquivo.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    return json(res, 200, { ok: r.ok, preview: "/preview/" + s.id + "?t=" + Date.now(), detalhe: r.err });
  }

  // servir a LP gerada
  if (p.startsWith("/preview/")) {
    const id = p.split("/")[2]; const f = path.join(SITES, id, "index.html");
    if (fs.existsSync(f)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync(f)); }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada");
  }

  // estáticos do app
  let file = p === "/" ? "/index.html" : p;
  const fp = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (fp.startsWith(PUBLIC) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("não encontrado");
});

server.listen(PORT, () => {
  console.log(`\n  🏭  Estúdio da Fábrica de LPs`);
  console.log(`      → abra  http://localhost:${PORT}\n`);
  const has = () => { const r = spawn("claude", ["--version"]); r.on("error", () => console.log("  ⚠️  'claude' não encontrado — instale o Claude Code p/ gerar/editar. O preview das já geradas funciona.\n"));
    r.on("close", (c) => { if (c === 0) console.log("  ✓ Claude Code detectado — geração e edição prontas.\n"); }); };
  has();
});
