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

/* ---- achar/rodar os CLIs de IA mesmo com PATH enxuto (app gráfico no Windows) ----
 * Um app aberto pelo atalho recebe do Windows um PATH mais curto que o do terminal,
 * e os CLIs instalados via npm (claude/codex) ficam de fora -> "não encontrado".
 * Além disso, no Windows esses CLIs são atalhos .cmd, que o spawn direto não executa.
 * Aqui a gente (1) acrescenta as pastas prováveis ao PATH e (2) roda via cmd.exe. */
const ehWin = process.platform === "win32";
function dirsProvaveis() {
  const env = process.env, dirs = [], add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  if (ehWin) {
    if (env.APPDATA) add(path.join(env.APPDATA, "npm"));                 // npm global (claude.cmd)
    if (env.USERPROFILE) {
      add(path.join(env.USERPROFILE, "AppData", "Roaming", "npm"));
      add(path.join(env.USERPROFILE, ".bun", "bin"));
      add(path.join(env.USERPROFILE, "scoop", "shims"));
      add(path.join(env.USERPROFILE, ".local", "bin"));
    }
    if (env.LOCALAPPDATA) { add(path.join(env.LOCALAPPDATA, "pnpm")); add(path.join(env.LOCALAPPDATA, "Yarn", "bin")); }
    if (env.ProgramFiles) add(path.join(env.ProgramFiles, "nodejs"));
  } else {
    ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"].forEach(add);
    if (env.HOME) [".npm-global/bin", ".local/bin", ".bun/bin", ".volta/bin", "node_modules/.bin"]
      .forEach((s) => add(path.join(env.HOME, s)));
  }
  return dirs;
}
(function reforcarPATH() {
  const sep = ehWin ? ";" : ":";
  const atual = (process.env.PATH || "").split(sep);
  const novos = dirsProvaveis().filter((d) => { try { return fs.existsSync(d) && !atual.includes(d); } catch { return false; } });
  if (novos.length) process.env.PATH = atual.concat(novos).join(sep);
})();
/** Acha o executável de verdade (no Windows resolve o .cmd/.exe do atalho). */
function resolverExe(base) {
  if (base && (base.includes("/") || base.includes("\\"))) return fs.existsSync(base) ? base : base; // já é caminho
  const sep = ehWin ? ";" : ":", exts = ehWin ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of (process.env.PATH || "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const alvo = path.join(dir, base + ext);
      try { if (fs.existsSync(alvo) && fs.statSync(alvo).isFile()) return alvo; } catch {}
    }
  }
  return null;
}
const aspasWin = (s) => (/[\s"&|<>^()%!]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
/** Roda um CLI de forma confiável em qualquer SO (padrão do npm/cross-spawn no Windows). */
function spawnCLI(base, args, opts = {}) {
  const exe = resolverExe(base) || base;
  if (ehWin) {
    const linha = '"' + [exe, ...args].map(aspasWin).join(" ") + '"';
    return spawn("cmd.exe", ["/d", "/s", "/c", linha], { ...opts, windowsVerbatimArguments: true });
  }
  return spawn(exe, args, opts);
}

const ROOT = path.resolve(__dirname, "..");
const APP = __dirname;
const PUBLIC = path.join(APP, "public");
// no app de desktop, dados e templates ficam numa pasta gravável (passada por env)
const DATA = process.env.ESTUDIO_DATA || path.join(APP, "data");
const DB_FILE = path.join(DATA, "db.json");
const PROJ = path.join(DATA, "projetos");
const SITES = path.join(DATA, "sites");
const SECOES = path.join(DATA, "secoes");        // templates de seção
const PASTAS_FILE = path.join(DATA, "pastas.json");
const SKILLS = path.join(DATA, "skills");        // jeitos de trabalhar salvos
const PUBLICADOS = path.join(DATA, "publicados"); // cópias congeladas do que está no ar
const TEMPLATES = process.env.ESTUDIO_TEMPLATES || path.join(ROOT, "templates");
const PORT = process.env.PORT || 4321;
// domínio-base dos subdomínios (troque quando comprar o domínio: FABRICA_DOMINIO=seudominio.com.br)
const DOMINIO = process.env.FABRICA_DOMINIO || "fabricadelps.com.br";

const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript",
  ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon" };

[PROJ, SITES, SECOES, SKILLS, PUBLICADOS].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* ------------------------- dados ------------------------- */
const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { projetos: [] }; } };
const writeDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2) + "\n");
const projFile = (id) => path.join(PROJ, id + ".json");
const readProj = (id) => { try { return JSON.parse(fs.readFileSync(projFile(id), "utf8")); } catch { return { shell: null, blocos: [], versoes: [], comentarios: [] }; } };
const writeProj = (id, p) => fs.writeFileSync(projFile(id), JSON.stringify(p, null, 2) + "\n");
/** Guarda a conversa do chat no arquivo do projeto (sobrevive a fechar o app). */
function registrarChat(id, itens) {
  try {
    const pr = readProj(id);
    if (!Array.isArray(pr.chat)) pr.chat = [];
    const ts = new Date().toISOString();
    for (const it of itens) if (it && it.html) pr.chat.push({ who: it.who || "ai", html: String(it.html), ts });
    if (pr.chat.length > 400) pr.chat = pr.chat.slice(-400); // não deixa crescer sem limite
    writeProj(id, pr);
  } catch (e) {}
}
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

/* ---- publicação em subdomínio ---- */
const pubDir = (s) => path.join(PUBLICADOS, s);
const pubFile = (s) => path.join(pubDir(s), "index.html");
const endereco = (pr) => pr.dominio || (pr.slug ? pr.slug + "." + DOMINIO : "");
/** HTML final, limpo e auto-suficiente (sem marcas do editor). */
function htmlFinal(pr) {
  return B.render(pr)
    .replace(/\s+data-(auto|vidro|gf|ed-[\w-]+)="[^"]*"/g, "")
    .replace(/\s+data-(auto|ed-[\w-]+)(?=[\s>])/g, "")
    .replace(/^\s*<!--\s*bloco:[\w-]+\s*-->\s*\n?/gm, "");
}
/** Congela a versão atual no endereço público (slug). */
function publicarSite(id, novoSlug) {
  const pr = readProj(id);
  if (!pr.blocos || !pr.blocos.length) return { ok: false, erro: "gere a página antes de publicar" };
  const d = readDB(); const meta = d.projetos.find((x) => x.id === id);
  let s = slug(novoSlug || pr.slug || meta.proj || meta.nome || id);
  // slug único entre os projetos
  const dono = (sl) => d.projetos.find((x) => x.slug === sl && x.id !== id);
  let base = s, n = 1; while (dono(s)) s = base + "-" + ++n;
  // se mudou de slug, remove a pasta antiga
  if (pr.slug && pr.slug !== s && fs.existsSync(pubDir(pr.slug))) fs.rmSync(pubDir(pr.slug), { recursive: true, force: true });
  fs.mkdirSync(pubDir(s), { recursive: true });
  fs.writeFileSync(pubFile(s), htmlFinal(pr));
  const versao = pr.versoes.length ? pr.versoes[pr.versoes.length - 1].v : 1;
  const quando = new Date().toISOString();
  pr.slug = s; pr.publicado = true; pr.publicadoEm = quando; pr.publicadoVersao = versao;
  writeProj(id, pr);
  if (meta) { meta.slug = s; meta.publicado = true; meta.publicadoEm = quando; meta.publicadoVersao = versao;
    if (pr.dominio !== undefined) meta.dominio = pr.dominio; writeDB(d); }
  return { ok: true, slug: s, endereco: endereco(pr), url: "/s/" + s, versao, publicadoEm: quando };
}
function despublicarSite(id) {
  const pr = readProj(id);
  if (pr.slug && fs.existsSync(pubDir(pr.slug))) fs.rmSync(pubDir(pr.slug), { recursive: true, force: true });
  pr.publicado = false; writeProj(id, pr);
  const d = readDB(); const meta = d.projetos.find((x) => x.id === id);
  if (meta) { meta.publicado = false; writeDB(d); }
  return { ok: true };
}

/* ---- envio automático pra Hostinger (FTP via curl) ---- */
const CONFIG_FILE = path.join(DATA, "config.json");
const FTP_PADRAO = { host: "", port: 21, user: "", senha: "", caminho: "public_html/{slug}", ssl: true, ativo: false };
function lerConfig() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); return { ftp: { ...FTP_PADRAO, ...(c.ftp || {}) } }; }
  catch { return { ftp: { ...FTP_PADRAO } }; }
}
function escreverConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + "\n"); }

/** Sobe um arquivo pro servidor por FTP(S) usando o curl do sistema. */
function enviarFTP(slug, arquivoLocal) {
  return new Promise((resolve) => {
    const f = lerConfig().ftp;
    if (!f.host || !f.user || !f.senha) return resolve({ ok: false, erro: "configure o envio automático primeiro" });
    const dir = (f.caminho || "public_html/{slug}").replace(/\{slug\}/g, slug).replace(/^\/+|\/+$/g, "");
    const alvo = `ftp://${f.host}:${f.port || 21}/${dir}/index.html`;
    const args = ["-T", arquivoLocal, "--ftp-create-dirs", "--user", `${f.user}:${f.senha}`,
      "-sS", "--connect-timeout", "20", "--max-time", "90"];
    if (f.ssl) args.push("--ssl-reqd");
    args.push(alvo);
    const c = spawn("curl", args);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", () => resolve({ ok: false, erro: "curl não encontrado no sistema" }));
    c.on("close", (code) => resolve({ ok: code === 0, erro: code === 0 ? "" : (err.trim() || "falha no envio (código " + code + ")") }));
  });
}
/** Testa se dá pra logar no FTP (lista a raiz). */
function testarFTP(f) {
  return new Promise((resolve) => {
    if (!f.host || !f.user || !f.senha) return resolve({ ok: false, erro: "preencha host, usuário e senha" });
    const args = ["--user", `${f.user}:${f.senha}`, "-sS", "--connect-timeout", "15", "--max-time", "30", "-l"];
    if (f.ssl) args.push("--ssl-reqd");
    args.push(`ftp://${f.host}:${f.port || 21}/`);
    const c = spawn("curl", args);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", () => resolve({ ok: false, erro: "curl não encontrado no sistema" }));
    c.on("close", (code) => resolve({ ok: code === 0, erro: code === 0 ? "" : (err.trim() || "não consegui conectar") }));
  });
}

const tplJson = (id) => path.join(TEMPLATES, id, "template.json");
const lerTpl = (id) => { try { return JSON.parse(fs.readFileSync(tplJson(id), "utf8")); } catch { return null; } };
const salvarTpl = (id, m) => fs.writeFileSync(tplJson(id), JSON.stringify(m, null, 2) + "\n");

function listTemplates() {
  if (!fs.existsSync(TEMPLATES)) return [];
  return fs.readdirSync(TEMPLATES)
    .filter((d) => fs.existsSync(tplJson(d)))
    .map((d) => { const m = lerTpl(d) || {};
      return { id: d, nome: m.nome || d, melhor_para: m.melhor_para || [],
        pasta: m.pasta || "Geral", origem: m.origem || "nativo", criadoEm: m.criadoEm || null }; });
}
function listSecoes() {
  if (!fs.existsSync(SECOES)) return [];
  return fs.readdirSync(SECOES).filter((f) => f.endsWith(".json"))
    .map((f) => { try { const s = JSON.parse(fs.readFileSync(path.join(SECOES, f), "utf8"));
      return { ...s, html: undefined, temHtml: !!s.html }; } catch { return null; } }).filter(Boolean);
}
function listSkills() {
  return fs.readdirSync(SKILLS).filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(SKILLS, f), "utf8")); } catch { return null; } })
    .filter(Boolean).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
}
/* skills que já vêm prontas na primeira vez */
(function semearSkills() {
  if (fs.readdirSync(SKILLS).some((f) => f.endsWith(".json"))) return;
  const base = [
    { id: "importar-referencia", nome: "Importar site como referência", icone: "download", escopo: "biblioteca",
      acao: "importar", nativa: true,
      descricao: "Cola o HTML de uma página que você gostou, separa em seções e guarda como modelo de estrutura.",
      instrucoes: "" },
    { id: "revisar-contraste", nome: "Revisar contraste e legibilidade", icone: "eye", escopo: "pagina", nativa: true,
      descricao: "Passa a página inteira procurando texto de leitura difícil e corrige mantendo a identidade.",
      instrucoes: "Revise o contraste e a legibilidade desta landing page. Procure texto com contraste fraco sobre o fundo, tamanhos pequenos demais no mobile e entrelinha apertada. Corrija o que estiver ruim mantendo a identidade visual e a paleta da marca. Não mude a estrutura nem o conteúdo dos textos." },
    { id: "variacao-hero", nome: "Gerar variação do hero", icone: "sparkle", escopo: "pagina", nativa: true,
      descricao: "Reescreve o hero com outro ângulo de copy, mantendo o layout e a marca.",
      instrucoes: "Reescreva apenas a seção hero desta landing page com um ângulo de copy diferente do atual (outro gancho, outra promessa de valor), mantendo o mesmo layout, as mesmas cores e o mesmo tom de voz da marca. Não invente dados, números ou provas que não estejam na página." },
  ];
  base.forEach((sk) => fs.writeFileSync(path.join(SKILLS, sk.id + ".json"), JSON.stringify(sk, null, 2) + "\n"));
})();

const lerPastas = () => { try { return JSON.parse(fs.readFileSync(PASTAS_FILE, "utf8")); } catch { return ["Geral"]; } };
const salvarPastas = (a) => fs.writeFileSync(PASTAS_FILE, JSON.stringify(a, null, 2) + "\n");

/* ---- motor de IA (headless) — Claude por padrão, trocável por GPT/Codex ou custom ---- */
const IA_PADRAO = { motor: "claude", comando: "" };
function lerIA() { try { return { ...IA_PADRAO, ...(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).ia || {}) }; } catch { return { ...IA_PADRAO }; } }
/**
 * Monta o comando do motor escolhido.
 *
 * Ponto crítico do headless: a IA precisa poder GRAVAR o HTML sozinha, senão
 * ela só pede permissão e o arquivo nunca é criado (a geração "não conclui").
 * Por isso rodamos dentro da pasta de dados (o arquivo de saída fica dentro do
 * "espaço de trabalho") e liberamos a pasta de templates pra leitura:
 *   - Claude: --permission-mode acceptEdits + --add-dir <templates>; o prompt
 *     vai pela entrada padrão (stdin), evitando problemas de parsing.
 *   - Codex:  exec --full-auto (grava dentro do workspace = pasta de dados).
 * Retorna também `input` (o que mandar no stdin) e `cwd` (onde rodar).
 */
function comandoIA(prompt) {
  const ia = lerIA();
  if (ia.motor === "codex")
    return { cmd: "codex", args: ["exec", "--full-auto", prompt], input: null, cwd: DATA };
  if (ia.motor === "custom" && (ia.comando || "").includes("{prompt}")) {
    const linha = ia.comando.replace("{prompt}", prompt.replace(/"/g, '\\"'));
    return ehWin
      ? { cmd: "cmd.exe", args: ["/c", linha], input: null, cwd: DATA }
      : { cmd: "sh", args: ["-c", linha], input: null, cwd: DATA };
  }
  return {
    cmd: "claude",
    args: ["-p", "--permission-mode", "acceptEdits", "--add-dir", TEMPLATES],
    input: prompt,
    cwd: DATA,
  };
}
function runClaude(prompt) {
  return new Promise((resolve) => {
    const { cmd, args, input, cwd } = comandoIA(prompt);
    // stdin: "pipe" quando mandamos o prompt por ele; "ignore" senão (evita a
    // espera de 3s do Claude achando que vem algo do teclado).
    const opts = { cwd: cwd || ROOT, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] };
    // "custom" já vem como shell (cmd/sh) montado; os demais vão pelo spawnCLI
    // (que acha o .cmd no Windows e reforça o PATH).
    const eShell = cmd === "cmd.exe" || cmd === "sh";
    const child = eShell ? spawn(cmd, args, opts) : spawnCLI(cmd, args, opts);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ ok: false, missing: true, err: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, code, out: out.trim(), err: err.slice(-1200) }));
    if (input) { try { child.stdin.write(input); child.stdin.end(); } catch (e) {} }
  });
}
const MOTOR_NOME = { claude: "Claude Code", codex: "Codex (GPT)", custom: "Comando próprio" };

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
  if (p === "/api/projetos/excluir" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    // tira do ar se estiver publicado, e apaga tudo do projeto
    try { if (s.slug && fs.existsSync(pubDir(s.slug))) fs.rmSync(pubDir(s.slug), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join(SITES, s.id), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(projFile(s.id), { force: true }); } catch {}
    d.projetos = d.projetos.filter((x) => x.id !== b.id);
    writeDB(d); return json(res, 200, { ok: true });
  }

  if (p === "/api/projeto" && req.method === "GET") {
    const id = url.searchParams.get("id");
    const s = db().projetos.find((x) => x.id === id); if (!s) return json(res, 404, { ok: false });
    const pr = readProj(id);
    return json(res, 200, { ...s, blocos: pr.blocos, comentarios: pr.comentarios, chat: pr.chat || [],
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
    const brief = (s.briefing && s.briefing.texto || "").trim();
    const prompt = `Você é o motor de geração da Fábrica de LPs.
Leia o template em ${path.join(tplDir, "template.html")} e o manifesto em ${path.join(tplDir, "template.json")}.
Dados do cliente: ${JSON.stringify(s, null, 2)}
${brief ? `\nBRIEFING (use como fonte principal do conteúdo — copy, seções e ofertas devem sair daqui):\n"""\n${brief}\n"""\n` : ""}
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
    registrarChat(s.id, [{ who: "me", html: b.texto }, { who: "ai", html: r.out || "(sem resposta)" }]);
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
    if (r.ok) registrarChat(s.id, [{ who: "me", html: "Aplicar " + (b.instrucoes || []).length + " marcação(ões)" }, { who: "ai", html: r.out || "Pronto." }]);
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


  /* ============ FASE B · templates ============ */

  if (p === "/api/pastas" && req.method === "GET") return json(res, 200, lerPastas());
  if (p === "/api/pastas" && req.method === "POST") {
    const b = await body(req); const nome = (b.nome || "").trim();
    if (!nome) return json(res, 400, { ok: false, erro: "informe o nome da pasta" });
    const ps = lerPastas(); if (!ps.includes(nome)) ps.push(nome);
    salvarPastas(ps); return json(res, 200, { ok: true, pastas: ps });
  }
  if (p === "/api/pastas/excluir" && req.method === "POST") {
    const b = await body(req);
    if (b.nome === "Geral") return json(res, 400, { ok: false, erro: "a pasta Geral não pode ser removida" });
    salvarPastas(lerPastas().filter((x) => x !== b.nome));
    // o que estava nela volta pra Geral
    listTemplates().filter((t) => t.pasta === b.nome).forEach((t) => { const m = lerTpl(t.id); m.pasta = "Geral"; salvarTpl(t.id, m); });
    listSecoes().filter((x) => x.pasta === b.nome).forEach((x) => { const f = path.join(SECOES, x.id + ".json");
      const o = JSON.parse(fs.readFileSync(f, "utf8")); o.pasta = "Geral"; fs.writeFileSync(f, JSON.stringify(o, null, 2)); });
    return json(res, 200, { ok: true });
  }

  // renomear / mover template
  if (p === "/api/templates/editar" && req.method === "POST") {
    const b = await body(req); const m = lerTpl(b.id);
    if (!m) return json(res, 404, { ok: false, erro: "template não encontrado" });
    if (b.nome) m.nome = b.nome;
    if (b.pasta) m.pasta = b.pasta;
    salvarTpl(b.id, m); return json(res, 200, { ok: true });
  }
  if (p === "/api/templates/excluir" && req.method === "POST") {
    const b = await body(req); const m = lerTpl(b.id);
    if (!m) return json(res, 404, { ok: false });
    if ((m.origem || "nativo") === "nativo") return json(res, 400, { ok: false, erro: "templates nativos não podem ser excluídos" });
    fs.rmSync(path.join(TEMPLATES, b.id), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }

  // salvar a página atual como novo template
  if (p === "/api/templates/salvar" && req.method === "POST") {
    const b = await body(req);
    const arq = siteFile(b.projetoId);
    if (!fs.existsSync(arq)) return json(res, 400, { ok: false, erro: "gere a página antes de salvar como template" });
    let id = slug(b.nome || "meu-template"), n = 1;
    while (fs.existsSync(path.join(TEMPLATES, id))) id = slug(b.nome) + "-" + ++n;
    fs.mkdirSync(path.join(TEMPLATES, id), { recursive: true });
    fs.copyFileSync(arq, path.join(TEMPLATES, id, "template.html"));
    const pr = readProj(b.projetoId);
    salvarTpl(id, { id, nome: b.nome || "Meu template", pasta: b.pasta || "Geral", origem: "salvo",
      criadoEm: new Date().toISOString(), melhor_para: b.melhor_para || [],
      secoes: (pr.blocos || []).map((x, i) => ({ n: i + 1, id: x.id, titulo: x.nome })),
      regras_ia: ["Preencher com o conteúdo do briefing do cliente.",
        "Trocar cores e fontes para a marca do cliente.", "Nunca inventar prova social falsa."] });
    return json(res, 200, { ok: true, id });
  }

  // importar HTML externo como template
  if (p === "/api/templates/importar" && req.method === "POST") {
    const b = await body(req);
    const html = (b.html || "").trim();
    if (!/<html|<body|<section|<div/i.test(html)) return json(res, 400, { ok: false, erro: "não parece um HTML de página" });
    const parsed = B.parse(html);
    if (!parsed.blocos.length) return json(res, 400, { ok: false, erro: "não consegui separar seções nesse HTML" });
    let id = slug(b.nome || "importado"), n = 1;
    while (fs.existsSync(path.join(TEMPLATES, id))) id = slug(b.nome || "importado") + "-" + ++n;
    fs.mkdirSync(path.join(TEMPLATES, id), { recursive: true });
    fs.writeFileSync(path.join(TEMPLATES, id, "template.html"), B.render(parsed));
    salvarTpl(id, { id, nome: b.nome || "Importado", pasta: b.pasta || "Referências", origem: "importado",
      criadoEm: new Date().toISOString(), melhor_para: [], fonte: b.fonte || null,
      secoes: parsed.blocos.map((x, i) => ({ n: i + 1, id: x.id, titulo: x.nome })),
      regras_ia: ["Usar apenas a ESTRUTURA como referência — gerar conteúdo e identidade novos.",
        "Nunca copiar textos, marca ou imagens da página de origem."] });
    const ps = lerPastas(); const pasta = b.pasta || "Referências";
    if (!ps.includes(pasta)) { ps.push(pasta); salvarPastas(ps); }
    return json(res, 200, { ok: true, id, blocos: parsed.blocos.map((x) => x.nome) });
  }

  /* ============ FASE B · templates de seção ============ */
  if (p === "/api/secoes" && req.method === "GET") return json(res, 200, listSecoes());
  if (p === "/api/secoes/salvar" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.projetoId);
    const bl = (pr.blocos || []).find((x) => x.id === b.blocoId);
    if (!bl) return json(res, 404, { ok: false, erro: "seção não encontrada" });
    const id = slug(b.nome || bl.nome) + "-" + Date.now().toString(36);
    fs.writeFileSync(path.join(SECOES, id + ".json"), JSON.stringify({ id, nome: b.nome || bl.nome,
      pasta: b.pasta || "Geral", tipo: bl.tipo, html: bl.html, criadoEm: new Date().toISOString() }, null, 2));
    return json(res, 200, { ok: true, id });
  }
  if (p === "/api/secoes/excluir" && req.method === "POST") {
    const b = await body(req); fs.rmSync(path.join(SECOES, b.id + ".json"), { force: true });
    return json(res, 200, { ok: true });
  }
  if (p === "/api/secoes/aplicar" && req.method === "POST") {
    const b = await body(req);
    let sec; try { sec = JSON.parse(fs.readFileSync(path.join(SECOES, b.secaoId + ".json"), "utf8")); }
    catch { return json(res, 404, { ok: false, erro: "seção não encontrada" }); }
    const pr = readProj(b.projetoId);
    if (!pr.blocos.length) return json(res, 400, { ok: false, erro: "gere a página antes" });
    const novo = { id: sec.tipo + "-" + Date.now().toString(36), tipo: sec.tipo, nome: sec.nome, html: sec.html };
    const i = pr.blocos.findIndex((x) => x.id === b.substituir);
    if (i >= 0) pr.blocos[i] = { ...novo, id: pr.blocos[i].id };       // troca no lugar
    else pr.blocos.splice(b.posicao != null ? b.posicao : pr.blocos.length, 0, novo);
    writeProj(b.projetoId, pr);
    const v = salvarVersao(b.projetoId, (i >= 0 ? "trocou a seção por " : "adicionou a seção ") + sec.nome);
    return json(res, 200, { ok: true, versao: v, preview: "/preview/" + b.projetoId + "?t=" + Date.now() });
  }

  // a IA organiza a biblioteca (B7)
  if (p === "/api/templates/organizar" && req.method === "POST") {
    const b = await body(req);
    const prompt = `Você organiza a biblioteca de templates da Fábrica de LPs.
Os templates estão em ${TEMPLATES}/<id>/template.json. Cada arquivo tem os campos "nome" e "pasta".
Pastas existentes: ${JSON.stringify(lerPastas())}.
Templates atuais: ${JSON.stringify(listTemplates(), null, 2)}
Pedido da designer: ${b.texto}
Edite apenas os campos "nome" e "pasta" dos template.json necessários. Não altere template.html nem outros campos.
Se precisar de uma pasta nova, apenas use o nome dela no campo "pasta".
Ao terminar, responda em uma frase o que você organizou.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    // registra pastas que a IA tenha criado
    const ps = lerPastas(); let mudou = false;
    listTemplates().forEach((t) => { if (t.pasta && !ps.includes(t.pasta)) { ps.push(t.pasta); mudou = true; } });
    if (mudou) salvarPastas(ps);
    return json(res, 200, { ok: r.ok, resposta: r.out, detalhe: r.err });
  }

  // preview do arquivo de um template (B3)
  if (p.startsWith("/template-preview/")) {
    const id = p.split("/")[2];
    const f = path.join(TEMPLATES, id, "template.html");
    if (fs.existsSync(f)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("template sem arquivo");
  }

  /* ============ FASE D · skills ============ */
  if (p === "/api/skills" && req.method === "GET") return json(res, 200, listSkills());

  if (p === "/api/skills/salvar" && req.method === "POST") {
    const b = await body(req);
    if (!b.nome) return json(res, 400, { ok: false, erro: "dê um nome para a skill" });
    if (!b.id && !(b.instrucoes || "").trim()) return json(res, 400, { ok: false, erro: "escreva as instruções da skill" });
    let id = b.id || slug(b.nome), n = 1;
    while (!b.id && fs.existsSync(path.join(SKILLS, id + ".json"))) id = slug(b.nome) + "-" + ++n;
    const antiga = b.id ? (listSkills().find((x) => x.id === b.id) || {}) : {};
    const sk = { ...antiga, id, nome: b.nome, descricao: b.descricao || "", icone: b.icone || "sparkle",
      escopo: b.escopo || "pagina", instrucoes: b.instrucoes ?? antiga.instrucoes ?? "",
      nativa: antiga.nativa || false, criadaEm: antiga.criadaEm || new Date().toISOString() };
    fs.writeFileSync(path.join(SKILLS, id + ".json"), JSON.stringify(sk, null, 2) + "\n");
    return json(res, 200, { ok: true, skill: sk });
  }

  if (p === "/api/skills/excluir" && req.method === "POST") {
    const b = await body(req);
    const sk = listSkills().find((x) => x.id === b.id);
    if (!sk) return json(res, 404, { ok: false });
    if (sk.nativa) return json(res, 400, { ok: false, erro: "as skills que já vêm prontas não podem ser excluídas" });
    fs.rmSync(path.join(SKILLS, b.id + ".json"), { force: true });
    return json(res, 200, { ok: true });
  }

  if (p === "/api/skills/executar" && req.method === "POST") {
    const b = await body(req);
    const sk = listSkills().find((x) => x.id === b.skillId);
    if (!sk) return json(res, 404, { ok: false, erro: "skill não encontrada" });
    if (sk.acao) return json(res, 200, { ok: true, acao: sk.acao });   // resolvida na interface
    const d = db(); const s = d.projetos.find((x) => x.id === b.id);
    if (!s) return json(res, 404, { ok: false });
    const arq = siteFile(s.id);
    if (!fs.existsSync(arq)) return json(res, 200, { ok: false, erro: "gere a página antes de rodar uma skill nela." });
    const prompt = `Aplique a rotina abaixo na landing page em ${arq}.
Rotina "${sk.nome}": ${sk.instrucoes}
Mantenha a página auto-suficiente (CSS embutido, sem CDN) e altere só o necessário.
Salve no mesmo arquivo e responda em uma frase curta o que mudou.`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    let versao = null;
    if (r.ok) versao = sincronizarDoHTML(s.id, "skill: " + sk.nome);
    if (r.ok) registrarChat(s.id, [{ who: "me", html: "⚡ Skill: " + sk.nome }, { who: "ai", html: r.out || "Pronto." }]);
    return json(res, 200, { ok: r.ok, resposta: r.out, versao, preview: "/preview/" + s.id + "?t=" + Date.now(), detalhe: r.err });
  }

  /* ============ FASE 3 · publicação em subdomínio ============ */
  if (p === "/api/publicados" && req.method === "GET") {
    const lista = db().projetos.filter((x) => x.publicado).map((x) => ({
      id: x.id, nome: x.nome, proj: x.proj, slug: x.slug, dominio: x.dominio || "",
      endereco: x.dominio || (x.slug ? x.slug + "." + DOMINIO : ""), url: "/s/" + x.slug,
      publicadoEm: x.publicadoEm, publicadoVersao: x.publicadoVersao,
    }));
    return json(res, 200, { dominio: DOMINIO, sites: lista });
  }
  if (p === "/api/publicar/estado" && req.method === "GET") {
    const id = url.searchParams.get("id"); const pr = readProj(id);
    const meta = db().projetos.find((x) => x.id === id) || {};
    const s = pr.slug || slug(meta.proj || meta.nome || id);
    return json(res, 200, { dominio: DOMINIO, slug: s, dominioProprio: pr.dominio || "",
      publicado: !!pr.publicado, publicadoEm: pr.publicadoEm || null, publicadoVersao: pr.publicadoVersao || null,
      endereco: pr.dominio || (s ? s + "." + DOMINIO : ""), url: pr.slug ? "/s/" + pr.slug : "",
      versaoAtual: pr.versoes && pr.versoes.length ? pr.versoes[pr.versoes.length - 1].v : null,
      gerada: !!(pr.blocos && pr.blocos.length) });
  }
  if (p === "/api/publicar" && req.method === "POST") {
    const b = await body(req);
    if (b.dominio !== undefined) { const pr = readProj(b.id); pr.dominio = (b.dominio || "").trim(); writeProj(b.id, pr); }
    const r = publicarSite(b.id, b.slug);
    if (r.ok && b.enviar !== false) {
      const f = lerConfig().ftp;
      if (f.ativo && f.host) r.envio = await enviarFTP(r.slug, pubFile(r.slug));
    }
    return json(res, 200, r);
  }
  if (p === "/api/pasta" && req.method === "GET") return json(res, 200, { pasta: DATA });
  // quais motores de IA estão instalados nesta máquina
  if (p === "/api/motores" && req.method === "GET") {
    const testar = (cmd) => new Promise((r) => {
      const c = spawnCLI(cmd, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      c.on("error", () => r(false));
      c.on("close", (code) => r(code === 0));
    });
    const [claude, codex] = await Promise.all([testar("claude"), testar("codex")]);
    return json(res, 200, { claude, codex, ativo: lerIA().motor });
  }
  if (p === "/api/status" && req.method === "GET") {
    let versao = "1.0.0";
    try { versao = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || versao; } catch {}
    const ia = lerIA();
    const base = ia.motor === "codex" ? "codex" : ia.motor === "custom" ? (ia.comando || "").trim().split(/\s+/)[0] : "claude";
    if (!base) return json(res, 200, { versao, claude: false, motor: ia.motor, motorNome: MOTOR_NOME[ia.motor] });
    const c = spawnCLI(base, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    c.on("error", () => json(res, 200, { versao, claude: false, motor: ia.motor, motorNome: MOTOR_NOME[ia.motor] }));
    c.on("close", (code) => json(res, 200, { versao, claude: code === 0, claudeVersao: out.trim(), motor: ia.motor, motorNome: MOTOR_NOME[ia.motor] }));
    return;
  }
  if (p === "/api/config" && req.method === "GET") {
    const f = lerConfig().ftp;
    return json(res, 200, { ftp: { ...f, senha: "", temSenha: !!f.senha }, ia: lerIA() });
  }
  if (p === "/api/config/ia" && req.method === "POST") {
    const b = await body(req); const atual = lerConfig();
    const ia = { motor: b.motor || "claude", comando: (b.comando || "").trim() };
    escreverConfig({ ...atual, ia });
    return json(res, 200, { ok: true, ia });
  }
  if (p === "/api/config" && req.method === "POST") {
    const b = await body(req); const atual = lerConfig();
    const f = atual.ftp;
    const nova = { host: (b.host ?? f.host).trim(), port: +b.port || 21, user: (b.user ?? f.user).trim(),
      senha: (b.senha !== undefined && b.senha !== "") ? b.senha : f.senha,
      caminho: (b.caminho ?? f.caminho).trim() || "public_html/{slug}",
      ssl: b.ssl !== undefined ? !!b.ssl : f.ssl, ativo: b.ativo !== undefined ? !!b.ativo : f.ativo };
    escreverConfig({ ...atual, ftp: nova });
    return json(res, 200, { ok: true });
  }
  if (p === "/api/config/testar" && req.method === "POST") {
    const b = await body(req); const f = lerConfig().ftp;
    const teste = { host: (b.host ?? f.host).trim(), port: +b.port || 21, user: (b.user ?? f.user).trim(),
      senha: (b.senha !== undefined && b.senha !== "") ? b.senha : f.senha, ssl: b.ssl !== undefined ? !!b.ssl : f.ssl };
    return json(res, 200, await testarFTP(teste));
  }
  if (p === "/api/despublicar" && req.method === "POST") {
    const b = await body(req); return json(res, 200, despublicarSite(b.id));
  }
  if (p === "/api/exportar" && req.method === "GET") {
    const id = url.searchParams.get("id"); const pr = readProj(id);
    if (!pr.blocos || !pr.blocos.length) { res.writeHead(404); return res.end("página não gerada"); }
    const meta = db().projetos.find((x) => x.id === id) || {};
    const nome = (pr.slug || slug(meta.proj || meta.nome || id)) + ".html";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"` });
    return res.end(htmlFinal(pr));
  }
  // serve o site publicado (congelado) — simula o subdomínio localmente
  if (p.startsWith("/s/")) {
    const s = decodeURIComponent(p.split("/")[2] || "");
    const f = pubFile(s);
    if (s && fs.existsSync(f)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<h1>404</h1><p>Nenhum site publicado neste endereço.</p>");
  }

  /* ============ FASE C · edição visual ============ */
  if (p === "/api/blocos/atualizar" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const i = pr.blocos.findIndex((x) => x.id === b.blocoId);
    if (i < 0) return json(res, 404, { ok: false, erro: "seção não encontrada" });
    pr.blocos[i].html = b.html;
    writeProj(b.id, pr);
    const v = salvarVersao(b.id, b.motivo || "editou " + pr.blocos[i].nome);
    return json(res, 200, { ok: true, versao: v });
  }
  if (p === "/api/blocos/reordenar" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const mapa = new Map(pr.blocos.map((x) => [x.id, x]));
    const nova = b.ordem.map((x) => mapa.get(x)).filter(Boolean);
    if (nova.length !== pr.blocos.length) return json(res, 400, { ok: false, erro: "ordem inválida" });
    pr.blocos = nova; writeProj(b.id, pr);
    const v = salvarVersao(b.id, "reordenou as seções");
    return json(res, 200, { ok: true, versao: v, preview: "/preview/" + b.id + "?t=" + Date.now() });
  }
  if (p === "/api/blocos/remover" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const bl = pr.blocos.find((x) => x.id === b.blocoId);
    if (!bl) return json(res, 404, { ok: false });
    pr.blocos = pr.blocos.filter((x) => x.id !== b.blocoId);
    writeProj(b.id, pr);
    const v = salvarVersao(b.id, "removeu a seção " + bl.nome);
    return json(res, 200, { ok: true, versao: v, preview: "/preview/" + b.id + "?t=" + Date.now() });
  }

  /* ---- preview ---- */
  if (p.startsWith("/preview/")) {
    const id = p.split("/")[2];
    if (url.searchParams.get("edit") === "1") {
      const pr = readProj(id);
      if (!pr.blocos || !pr.blocos.length) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(B.render(pr, { edicao: true }));
    }
    if (fs.existsSync(siteFile(id))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(siteFile(id)));
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada");
  }

  // logo da marca: usa public/logo.svg ou logo.png se você largar o arquivo lá
  if (p === "/marca") {
    // a logo real da Isadora (png/jpg/webp) tem prioridade sobre a recriação (svg)
    for (const nome of ["logo.png", "logo.webp", "logo.jpg", "logo.svg"]) {
      const f = path.join(PUBLIC, nome);
      if (fs.existsSync(f)) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(nome)] || "image/png", "Cache-Control": "no-store" });
        return res.end(fs.readFileSync(f));
      }
    }
    res.writeHead(404); return res.end();
  }

  /* ---- estáticos ---- */
  const fp = path.join(PUBLIC, path.normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, ""));
  if (fp.startsWith(PUBLIC) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("não encontrado");
});

/** Abre o navegador sozinho ao ligar (pra parecer um app). Desliga com ESTUDIO_NO_OPEN=1. */
function abrirNavegador(alvo) {
  if (process.env.ESTUDIO_NO_OPEN) return;
  const { exec } = require("child_process");
  const cmd = process.platform === "win32" ? `start "" "${alvo}"`
    : process.platform === "darwin" ? `open "${alvo}"`
    : `xdg-open "${alvo}"`;
  exec(cmd, () => {});
}

server.listen(PORT, () => {
  const alvo = `http://localhost:${PORT}`;
  console.log(`\n  🏭  Estúdio da Fábrica de LPs`);
  console.log(`      → abra  ${alvo}\n`);
  const c = spawn("claude", ["--version"]);
  c.on("error", () => console.log("  ⚠️  'claude' não encontrado — instale o Claude Code p/ gerar e editar.\n"));
  c.on("close", (code) => { if (code === 0) console.log("  ✓ Claude Code detectado — geração e edição prontas.\n"); });
  setTimeout(() => abrirNavegador(alvo), 600);
});
