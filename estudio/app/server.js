#!/usr/bin/env node
/**
 * Estúdio · servidor local do app da Fábrica de LPs
 * --------------------------------------------------
 * Roda 100% na máquina da Isadora. Sem dependências (só Node puro).
 * Geração e edição usam o Claude Code CLI da assinatura (custo de API: R$ 0).
 *
 *   node estudio/app/server.js   →   http://localhost:4321
 *
 * Dados:
 *   data/db.json            índice dos projetos (o CRM)
 *   data/projetos/<id>.json blocos, versões e comentários de cada projeto
 *   data/sites/<id>/        o HTML publicado, montado a partir dos blocos
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const B = require("./lib/blocos.js");

const ROOT = path.resolve(__dirname, "..");
const APP = __dirname;
const PUBLIC = path.join(APP, "public");
const DATA = path.join(APP, "data");
const DB_FILE = path.join(DATA, "db.json");
const PROJ = path.join(DATA, "projetos");
const SITES = path.join(DATA, "sites");
const TEMPLATES = path.join(ROOT, "templates");
const PORT = process.env.PORT || 4321;

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
  ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon" };

[PROJ, SITES].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* ------------------------- dados ------------------------- */
const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { projetos: [] }; } };
const writeDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2) + "\n");
const projFile = (id) => path.join(PROJ, id + ".json");
const readProj = (id) => { try { return JSON.parse(fs.readFileSync(projFile(id), "utf8")); } catch { return { shell: null, blocos: [], versoes: [], comentarios: [] }; } };
const writeProj = (id, p) => fs.writeFileSync(projFile(id), JSON.stringify(p, null, 2) + "\n");
const siteFile = (id) => path.join(SITES, id, "index.html");

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const slug = (s) => (s || "cliente").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

/** Grava uma nova versão (guardamos todas) e republica o site. */
function salvarVersao(id, motivo, autor = "designer") {
  const p = readProj(id);
  const v = (p.versoes.length ? p.versoes[p.versoes.length - 1].v : 0) + 1;
  p.versoes.push({ v, ts: new Date().toISOString(), motivo, autor, blocos: JSON.parse(JSON.stringify(p.blocos)) });
  writeProj(id, p);
  publicar(id, p);
  return v;
}
function publicar(id, p) {
  const pr = p || readProj(id);
  if (!pr.blocos || !pr.blocos.length) return;
  fs.mkdirSync(path.join(SITES, id), { recursive: true });
  fs.writeFileSync(siteFile(id), B.render(pr));
}
/** Lê o HTML do site e regrava como blocos (usado depois que a IA edita o arquivo). */
function sincronizarDoHTML(id, motivo) {
  if (!fs.existsSync(siteFile(id))) return null;
  const parsed = B.parse(fs.readFileSync(siteFile(id), "utf8"));
  const p = readProj(id);
  p.shell = parsed.shell; p.blocos = parsed.blocos;
  writeProj(id, p);
  return salvarVersao(id, motivo);
}

function listTemplates() {
  if (!fs.existsSync(TEMPLATES)) return [];
  return fs.readdirSync(TEMPLATES)
    .filter((d) => fs.existsSync(path.join(TEMPLATES, d, "template.json")))
    .map((d) => { try { const m = JSON.parse(fs.readFileSync(path.join(TEMPLATES, d, "template.json"), "utf8"));
      return { id: d, nome: m.nome || d, melhor_para: m.melhor_para || [] }; } catch { return { id: d, nome: d }; } });
}

/* ---- Claude Code (headless) ---- */
function runClaude(prompt) {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt], { cwd: ROOT });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ ok: false, missing: true, err: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, out: out.trim(), err: err.slice(-1200) }));
  });
}

/* ---- migração: site antigo sem blocos vira blocos ---- */
(function migrar() {
  const db = readDB();
  let mudou = false;
  for (const s of db.projetos || []) {
    if (s.arquivado === undefined) { s.arquivado = false; mudou = true; }
    if (s.status === "done") { s.status = "entregue"; mudou = true; }
    if (!fs.existsSync(projFile(s.id)) && fs.existsSync(siteFile(s.id))) {
      const parsed = B.parse(fs.readFileSync(siteFile(s.id), "utf8"));
      writeProj(s.id, { shell: parsed.shell, blocos: parsed.blocos, versoes: [], comentarios: [] });
      salvarVersao(s.id, "importada da página existente");
      console.log(`  ↻ ${s.id}: ${parsed.blocos.length} blocos importados`);
    }
  }
  if (mudou) writeDB(db);
})();

/* ------------------------- rotas ------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const db = () => readDB();

  if (p === "/api/projetos" && req.method === "GET") return json(res, 200, db().projetos);

  if (p === "/api/projetos" && req.method === "POST") {
    const b = await body(req);
    if (!b.nome) return json(res, 400, { ok: false, erro: "informe o nome do cliente" });
    const d = db();
    let id = slug(b.proj || b.nome), n = 1;
    while (d.projetos.some((s) => s.id === id)) id = slug(b.proj || b.nome) + "-" + ++n;
    const cores = ["#2563eb","#db2777","#16a34a","#d97706","#7c3aed","#0891b2"];
    const novo = { id, nome: b.nome, proj: b.proj || b.nome, area: b.area || "Geral",
      cor: cores[d.projetos.length % cores.length], email: b.email || "", phone: b.phone || "",
      tpl: b.tpl || "servico-premium", origem: b.origem || "indicação", status: "new",
      arquivado: false, createdAt: new Date().toISOString(), generated: false, briefing: b.briefing || {} };
    d.projetos.unshift(novo); writeDB(d);
    writeProj(id, { shell: null, blocos: [], versoes: [], comentarios: [] });
    return json(res, 200, { ok: true, projeto: novo });
  }

  if (p === "/api/projetos/status" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    s.status = b.status; writeDB(d); return json(res, 200, { ok: true });
  }

  // arquivar / desarquivar — desarquivar volta como "Alteração solicitada" (A8)
  if (p === "/api/projetos/arquivar" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    s.arquivado = !!b.arquivado;
    if (!s.arquivado) s.status = "alt";
    writeDB(d); return json(res, 200, { ok: true, status: s.status });
  }

  if (p === "/api/projeto" && req.method === "GET") {
    const id = url.searchParams.get("id");
    const s = db().projetos.find((x) => x.id === id); if (!s) return json(res, 404, { ok: false });
    const pr = readProj(id);
    return json(res, 200, { ...s, blocos: pr.blocos, comentarios: pr.comentarios,
      versoes: pr.versoes.map(({ v, ts, motivo, autor }) => ({ v, ts, motivo, autor })) });
  }

  if (p === "/api/templates" && req.method === "GET") return json(res, 200, listTemplates());

  /* ---- gerar ---- */
  if (p === "/api/generate" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false, erro: "projeto não encontrado" });
    if (b.tpl) s.tpl = b.tpl;
    const tplDir = path.join(TEMPLATES, s.tpl);
    fs.mkdirSync(path.join(SITES, s.id), { recursive: true });
    const out = siteFile(s.id);
    const prompt = `Você é o motor de geração da Fábrica de LPs.
Leia o template em ${path.join(tplDir, "template.html")} e o manifesto em ${path.join(tplDir, "template.json")}.
Dados do cliente: ${JSON.stringify(s, null, 2)}
Gere a landing page final seguindo as regras_ia do manifesto: troque os DESIGN TOKENS para a marca do cliente,
preencha TODOS os slots {{...}} com conteúdo real (nunca deixe {{...}}), mantenha a ordem das seções,
nunca invente prova social falsa. A página deve ser auto-suficiente (CSS embutido, sem CDN).
Escreva o HTML final completo em: ${out}
Não escreva mais nada além de criar/atualizar esse arquivo.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado. Instale o Claude Code e faça login." });
    if (r.ok && fs.existsSync(out)) {
      sincronizarDoHTML(s.id, "página gerada");
      s.generated = true; s.status = "rev"; writeDB(d);
      return json(res, 200, { ok: true, preview: "/preview/" + s.id });
    }
    return json(res, 200, { ok: false, erro: "a geração não concluiu — veja o terminal.", detalhe: r.err });
  }

  /* ---- chat com modos (A5) ---- */
  if (p === "/api/chat" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    const arq = siteFile(s.id);
    const existe = fs.existsSync(arq);
    const modo = b.modo || "design";
    let prompt;
    if (modo === "perguntar") {
      prompt = `Responda em português, de forma curta e direta. NÃO modifique nenhum arquivo — apenas responda.
${existe ? `Contexto: a landing page do cliente está em ${arq}.` : ""}
Pergunta: ${b.texto}`;
    } else if (modo === "plan") {
      prompt = `Faça um PLANO em português, em tópicos curtos, do que você mudaria. NÃO modifique nenhum arquivo — apenas descreva o plano.
${existe ? `A landing page está em ${arq}.` : ""}
Pedido: ${b.texto}`;
    } else {
      if (!existe) return json(res, 200, { ok: false, erro: "gere a página antes de editar." });
      prompt = `Edite a landing page em ${arq} conforme o pedido abaixo.
Altere apenas o necessário, preservando o resto do design e mantendo a página auto-suficiente (CSS embutido, sem CDN).
Pedido: ${b.texto}
Salve no mesmo arquivo. Ao terminar, responda em uma frase curta o que você mudou.`;
    }
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    let versao = null;
    if (modo === "design" && r.ok) versao = sincronizarDoHTML(s.id, "chat: " + String(b.texto).slice(0, 60));
    return json(res, 200, { ok: r.ok, resposta: r.out || "(sem resposta)", modo, versao,
      preview: modo === "design" ? "/preview/" + s.id + "?t=" + Date.now() : null, detalhe: r.err });
  }

  /* ---- aplicar comentários selecionados ---- */
  if (p === "/api/edit" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    const arq = siteFile(s.id);
    if (!fs.existsSync(arq)) return json(res, 200, { ok: false, erro: "gere a página antes de editar." });
    const itens = (b.instrucoes || []).map((i, n) => `${n + 1}. [${i.alvo || "geral"}] ${i.texto}`).join("\n");
    const prompt = `Edite a landing page em ${arq} aplicando as mudanças abaixo.
Altere apenas o necessário, preservando o resto do design e mantendo a página auto-suficiente.
Mudanças:\n${itens}\nSalve no mesmo arquivo. Ao terminar, responda em uma frase curta o que mudou.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    let versao = null;
    if (r.ok) {
      versao = sincronizarDoHTML(s.id, `aplicou ${(b.instrucoes || []).length} marcação(ões)`);
      // marca os comentários aplicados como resolvidos
      const pr = readProj(s.id);
      (b.ids || []).forEach((cid) => { const c = pr.comentarios.find((x) => x.id === cid); if (c) c.estado = "resolvido"; });
      writeProj(s.id, pr);
    }
    return json(res, 200, { ok: r.ok, resposta: r.out, versao, preview: "/preview/" + s.id + "?t=" + Date.now(), detalhe: r.err });
  }

  /* ---- versões (A4) ---- */
  if (p === "/api/versoes/restaurar" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const alvo = pr.versoes.find((x) => x.v === Number(b.v));
    if (!alvo) return json(res, 404, { ok: false, erro: "versão não encontrada" });
    pr.blocos = JSON.parse(JSON.stringify(alvo.blocos));
    writeProj(b.id, pr);
    const nova = salvarVersao(b.id, `restaurou a versão ${alvo.v}`);
    return json(res, 200, { ok: true, versao: nova, preview: "/preview/" + b.id + "?t=" + Date.now() });
  }

  /* ---- comentários (A9) ---- */
  if (p === "/api/comentarios" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const n = (pr.comentarios.length ? Math.max(...pr.comentarios.map((c) => c.n)) : 0) + 1;
    const c = { id: "c" + Date.now().toString(36), n, origem: b.origem || "designer",
      alvo: b.alvo || "geral", bloco: b.bloco || null, texto: b.texto || "",
      ts: new Date().toISOString(), estado: "aberto", resposta: null };
    pr.comentarios.push(c); writeProj(b.id, pr);
    return json(res, 200, { ok: true, comentario: c });
  }
  if (p === "/api/comentarios/estado" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const c = pr.comentarios.find((x) => x.id === b.cid); if (!c) return json(res, 404, { ok: false });
    c.estado = b.estado;                       // aberto | resolvido | refutado
    if (b.resposta !== undefined) c.resposta = b.resposta;
    writeProj(b.id, pr); return json(res, 200, { ok: true, comentario: c });
  }
  if (p === "/api/comentarios/excluir" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    pr.comentarios = pr.comentarios.filter((x) => x.id !== b.cid);
    writeProj(b.id, pr); return json(res, 200, { ok: true });
  }

  /* ---- preview ---- */
  if (p.startsWith("/preview/")) {
    const id = p.split("/")[2];
    if (fs.existsSync(siteFile(id))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(siteFile(id)));
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada");
  }

  /* ---- estáticos ---- */
  const fp = path.join(PUBLIC, path.normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, ""));
  if (fp.startsWith(PUBLIC) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("não encontrado");
});

server.listen(PORT, () => {
  console.log(`\n  🏭  Estúdio da Fábrica de LPs`);
  console.log(`      → abra  http://localhost:${PORT}\n`);
  const c = spawn("claude", ["--version"]);
  c.on("error", () => console.log("  ⚠️  'claude' não encontrado — instale o Claude Code p/ gerar e editar.\n"));
  c.on("close", (code) => { if (code === 0) console.log("  ✓ Claude Code detectado — geração e edição prontas.\n"); });
});
