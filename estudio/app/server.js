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
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
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
  ".json":"application/json; charset=utf-8", ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon",
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".gif":"image/gif", ".avif":"image/avif",
  ".mp4":"video/mp4", ".webm":"video/webm", ".mov":"video/quicktime", ".ogg":"video/ogg", ".m4v":"video/mp4" };
const EXT_MIDIA = { "image/png":".png","image/jpeg":".jpg","image/jpg":".jpg","image/webp":".webp","image/gif":".gif",
  "image/svg+xml":".svg","image/avif":".avif","video/mp4":".mp4","video/webm":".webm","video/quicktime":".mov","video/ogg":".ogg" };
const assetsDir = (id) => path.join(SITES, id, "assets");
const docsDir = (id) => path.join(SITES, id, "docs");
const docFile = (id, docId) => path.join(docsDir(id), path.basename(String(docId)) + ".md");
const lerDoc = (id, docId) => { try { return fs.readFileSync(docFile(id, docId), "utf8"); } catch { return ""; } };

/* ===== ARTEFATOS: qualquer arquivo de apoio que a IA produz além da LP e dos docs
   (wireframe SVG, protótipo HTML isolado, diagrama, trecho de código). Ficam numa
   pasta própria por projeto e viram abas tipadas no preview do Estúdio. ===== */
const artefatosDir = (id) => path.join(SITES, id, "artefatos");
function tipoArtefato(nome) {
  const e = path.extname(String(nome)).toLowerCase();
  if (e === ".svg") return "svg";
  if (e === ".html" || e === ".htm") return "html";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico"].includes(e)) return "imagem";
  if ([".mp4", ".webm", ".mov", ".ogg", ".m4v"].includes(e)) return "video";
  if ([".js", ".mjs", ".ts", ".css", ".json", ".xml", ".yml", ".yaml", ".py", ".sh"].includes(e)) return "codigo";
  return "texto";
}
function listarArtefatos(id) {
  const dir = artefatosDir(id);
  let arqs = [];
  // só ARQUIVOS de verdade — nunca pastas (ex.: um "build/" que o motor GPT cria
  // e que, servido como arquivo, derrubava o servidor inteiro).
  try { arqs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith(".")).map((d) => d.name); } catch { return []; }
  return arqs.map((nome) => {
    let ts = 0; try { ts = fs.statSync(path.join(dir, nome)).mtimeMs; } catch {}
    return { id: nome, nome, tipo: tipoArtefato(nome), ts,
      url: "/preview/" + id + "/artefatos/" + encodeURIComponent(nome) };
  }).sort((a, b) => a.ts - b.ts);
}
/* ===== FASE B — PASTA DE TRABALHO LOCAL: o motor nunca toca no Google Drive.
   Antes de rodar, espelhamos a pasta do projeto pra um diretório LOCAL (fora do
   Drive); a IA trabalha lá; depois devolvemos o resultado pro Drive. Só o Node
   (este servidor) lê/grava no Drive, em momentos controlados — some o
   "arquivo local temporariamente indisponível". ===== */
function localWorkDir(id) { return path.join(os.tmpdir(), "fabrica-work", path.basename(String(id))); }
// pastas de lixo que o motor (sobretudo o GPT/Codex) às vezes cria e que NÃO
// devem ir pro Google Drive — copiar milhares desses arquivos deixava o
// "Finalizando..." travado por minutos.
const LIXO_COPIA = new Set(["node_modules", ".git", "dist", "build", ".next", "out",
  ".cache", ".turbo", ".parcel-cache", ".vercel", ".svelte-kit", "coverage", ".venv", "__pycache__"]);
function copiarPasta(src, dst) {
  try { fs.mkdirSync(dst, { recursive: true }); } catch (e) {}
  try {
    if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true, force: true,
      filter: (s) => !LIXO_COPIA.has(path.basename(s)) });
    return true;
  } catch (e) { return false; }
}
// Drive -> local (também força a hidratação de arquivos que estavam "só na nuvem")
function hidratarLocal(id) {
  const dst = localWorkDir(id);
  try { fs.rmSync(dst, { recursive: true, force: true }); } catch (e) {}
  copiarPasta(path.join(SITES, id), dst);
  try { fs.mkdirSync(dst, { recursive: true }); } catch (e) {}
  return dst;
}
// local -> Drive (devolve o que a IA produziu)
function devolverLocal(id) { copiarPasta(localWorkDir(id), path.join(SITES, id)); }

/* ===== ANEXOS: copia cada anexo pra uma pasta LOCAL (fora do Google Drive) — isso
   força a hidratação do arquivo e dá ao motor um caminho confiável pra LER. Distingue
   REFERÊNCIA (mockup a recriar) de CONTEÚDO (foto a inserir). ===== */
function ehReferencia(texto) {
  return /reproduz|recri|refer[êe]ncia|image.?to.?code|wireframe|mesmo formato|igual a (esta|essa|est[ae])|fiel [àa]|copiar (o|a|essa|esta|este)|transform\w* (essa|esta|a) imagem|vir(e|ar) (essa|esta|a) imagem/i.test(String(texto || ""));
}
function prepararAnexos(id, anexos, opts = {}) {
  const anxLocalDir = path.join(os.tmpdir(), "fabrica-anexos", id);
  const info = (anexos || []).filter((a) => a && a.url).map((a) => {
    const rel = String(a.url);
    const nome = path.basename(rel);
    const abs = path.join(assetsDir(id), nome);
    const texto = /\.(html?|md|markdown|svg|txt|json|css|js|xml|csv)$/i.test(nome);
    let local = abs, ok = false, conteudo = null;
    try { const buf = fs.readFileSync(abs); if (buf && buf.length) { fs.mkdirSync(anxLocalDir, { recursive: true }); local = path.join(anxLocalDir, nome); fs.writeFileSync(local, buf); ok = true; if (texto) conteudo = buf.toString("utf8").slice(0, 150000); } } catch (e) {}
    return { rel, local, nome, tipo: a.tipo || (texto ? "documento" : "imagem"), texto, ok, conteudo };
  });
  const docs = info.filter((a) => a.texto && a.conteudo != null);
  const midias = info.filter((a) => !a.texto);
  let txt = "";
  if (docs.length) {
    // arquivos de texto (HTML/MD/SVG...) entram COM O CONTEÚDO no prompt — o Node lê, sem depender de ferramenta (à prova de sandbox)
    txt += `\nARQUIVO(S) DE REFERÊNCIA ANEXADO(S) — conteúdo abaixo. Use como MOLDE/base conforme o pedido (ex.: aproveitar a estrutura da primeira dobra); adapte à marca e ao conteúdo do projeto, não copie cego:\n${docs.map((a) => `\n===== ${a.nome} =====\n\`\`\`\n${a.conteudo}\n\`\`\`\n`).join("")}`;
  }
  if (midias.length) {
    if (opts.referencia) {
      txt += `\nIMAGEM(NS) DE REFERÊNCIA — é um MOCKUP de design pra REPRODUZIR, NÃO um conteúdo pra inserir:\n${midias.map((a) => `- LEIA o arquivo local ${a.local} (ferramenta Read) e analise a composição em detalhe`).join("\n")}\nREGRAS OBRIGATÓRIAS:\n1. Reproduza a ESTRUTURA, o layout, as proporções e o estilo da referência com HTML e CSS DE VERDADE.\n2. NUNCA insira a imagem de referência com <img> ocupando a tela como se fosse a página.\n3. Para as ilustrações internas, gere imagens novas depois (ou deixe placeholder com as proporções certas).\n4. Página full-width e responsiva.\n`;
    } else {
      txt += `\nARQUIVOS ANEXADOS:\n${midias.map((a) => `- ${a.tipo}: para ANALISAR, LEIA ${a.local} (ferramenta Read); para INSERIR na página, use o caminho relativo ${a.rel}`).join("\n")}\nInsira imagens com <img> e vídeos com <video controls>, responsivos (max-width:100%; height:auto).\n`;
    }
  }
  return { anxLocalDir, info, txt, temAnexo: info.length > 0 };
}

/* processos de geração de mídia em andamento, por projeto (pra dar pra cancelar) */
const geradores = new Map();
function matarProcesso(child) {
  try {
    if (ehWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else { child.kill("SIGTERM"); setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} }, 1500); }
  } catch (e) {}
}

[PROJ, SITES, SECOES, SKILLS, PUBLICADOS].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* ------------------------- dados ------------------------- */
const readDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { projetos: [] }; } };
const writeDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2) + "\n");
const projFile = (id) => path.join(PROJ, id + ".json");
const readProj = (id) => { try { return JSON.parse(fs.readFileSync(projFile(id), "utf8")); } catch { return { shell: null, blocos: [], versoes: [], comentarios: [] }; } };
// Gravação ATÔMICA: escreve num .tmp e renomeia. Se o Google Drive sincronizar
// no meio, ele nunca pega um arquivo pela metade — não corrompe o projeto ao
// alternar entre a máquina de casa e a da empresa.
function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
// As VERSÕES (histórico) moram num arquivo SEPARADO, fora do arquivo "quente" do
// projeto. Assim comentário/status/chat gravam um arquivo pequeno e rápido, em
// vez de reescrever megabytes de histórico no Drive a cada clique.
const versoesFile = (id) => path.join(PROJ, id + ".versoes.json");
function lerVersoes(id) {
  try { return JSON.parse(fs.readFileSync(versoesFile(id), "utf8")); } catch (e) {}
  try { const p = JSON.parse(fs.readFileSync(projFile(id), "utf8")); if (Array.isArray(p.versoes)) return p.versoes; } catch (e) {}
  return [];
}
function escreverVersoes(id, arr) { writeAtomic(versoesFile(id), JSON.stringify(arr, null, 2) + "\n"); }
const writeProj = (id, p) => {
  const doc = { ...p };
  if (Array.isArray(doc.versoes)) {
    // primeira vez num projeto legado: migra o histórico embutido pro arquivo
    // separado (sem perder nada) e depois tira do arquivo principal.
    if (!fs.existsSync(versoesFile(id)) && doc.versoes.length) { try { escreverVersoes(id, doc.versoes); } catch (e) {} }
    delete doc.versoes;
  }
  writeAtomic(projFile(id), JSON.stringify(doc, null, 2) + "\n");
};
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

/* ---- memória: itens (cartões) + último projeto + contexto da conversa ---- */
const MEMORIA_FILE = path.join(DATA, "memoria.json");
function lerMemoria() {
  let m; try { m = JSON.parse(fs.readFileSync(MEMORIA_FILE, "utf8")); } catch { m = {}; }
  if (!Array.isArray(m.itens)) m.itens = [];
  // migração: notas antigas (texto único) viram um item
  if ((m.notas || "").trim()) { m.itens.push({ id: "m" + Date.now().toString(36), titulo: "Preferências gerais", texto: m.notas.trim(), categoria: "Preferência", ts: new Date().toISOString() }); delete m.notas; try { fs.writeFileSync(MEMORIA_FILE, JSON.stringify(m, null, 2) + "\n"); } catch (e) {} }
  return { itens: m.itens, ultimoProjeto: m.ultimoProjeto || null, autoAprender: m.autoAprender !== false };
}
/* aprende sozinho: depois de uma tarefa, extrai fatos duráveis da conversa e guarda na memória */
let aprendendo = false;
async function aprenderDaConversa(pedido, resposta, projNome) {
  const mem = lerMemoria();
  if (mem.autoAprender === false || aprendendo) return;
  aprendendo = true;
  try {
    const existentes = (mem.itens || []).map((x) => x.titulo).filter(Boolean).slice(0, 40).join("; ");
    const prompt = `Você observa o trabalho da Isadora (designer de landing pages) e mantém uma MEMÓRIA de preferências e regras dela que valham pra PRÓXIMOS projetos.
Do par pedido/resposta abaixo, extraia de 0 a 2 FATOS DURÁVEIS (preferências de estilo, tom de voz, marca, regras de layout). IGNORE o que é específico de um cliente só, saudações e detalhes efêmeros. Se não houver nada durável, responda exatamente [].
Já existem na memória (não repita): ${existentes || "(vazio)"}
PEDIDO: "${String(pedido || "").slice(0, 700)}"
RESPOSTA DA IA: "${String(resposta || "").slice(0, 700)}"
Responda SÓ com um JSON array, sem markdown: [{"titulo":"curto","texto":"a preferência/regra em uma frase","categoria":"Preferência"}].`;
    const r = await runClaude(prompt);
    let arr = null; try { const mm = (r.out || "").match(/\[[\s\S]*\]/); arr = mm ? JSON.parse(mm[0]) : null; } catch (e) {}
    if (Array.isArray(arr) && arr.length) {
      const m2 = lerMemoria();
      const titulos = new Set((m2.itens || []).map((x) => (x.titulo || "").toLowerCase()));
      let add = 0;
      for (const it of arr.slice(0, 2)) {
        if (!it || !it.texto) continue;
        const tit = String(it.titulo || "").trim();
        if (tit && titulos.has(tit.toLowerCase())) continue;
        m2.itens.unshift({ id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), titulo: tit.slice(0, 80) || "Aprendido", texto: String(it.texto).slice(0, 400), categoria: it.categoria || "Aprendido", auto: true, origem: projNome || "", ts: new Date().toISOString() });
        add++;
      }
      if (add) salvarMemoria(m2);
    }
  } catch (e) {} finally { aprendendo = false; }
}
function salvarMemoria(m) { try { fs.writeFileSync(MEMORIA_FILE, JSON.stringify(m, null, 2) + "\n"); } catch (e) {} }
function marcarUltimoProjeto(id, nome) { const m = lerMemoria(); m.ultimoProjeto = { id, nome: nome || id, quando: new Date().toISOString() }; salvarMemoria(m); }
/* MEMÓRIA por projeto: id de sessão do CLI. 1ª vez cria (--session-id); depois continua (--resume). */
function sessaoCli(projId) {
  const pr = readProj(projId);
  if (!pr.cliSession) { try { pr.cliSession = require("crypto").randomUUID(); } catch { pr.cliSession = "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2); } pr.cliSessionOn = false; }
  const resume = !!pr.cliSessionOn;
  if (!pr.cliSessionOn) { pr.cliSessionOn = true; writeProj(projId, pr); }
  return { id: pr.cliSession, resume };
}
function resetarSessaoCli(projId) { try { const pr = readProj(projId); pr.cliSession = null; pr.cliSessionOn = false; writeProj(projId, pr); } catch (e) {} }
/** Junta todos os itens de memória num texto pra IA. */
function memoriaTexto() {
  const its = lerMemoria().itens || [];
  return its.map((x) => `- ${x.titulo ? x.titulo + ": " : ""}${(x.texto || "").trim()}${x.categoria ? " [" + x.categoria + "]" : ""}`).filter((s) => s.length > 3).join("\n").slice(0, 4000);
}
const semTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** Monta o bloco de contexto (memória + últimas mensagens) pra IA "lembrar".
 *  opts.resumindo = true quando a sessão do CLI já carrega o histórico nativamente
 *  (aí não reinjetamos a conversa pra não duplicar/inchar o prompt). */
function contextoChat(pr, opts = {}) {
  let ctx = ""; const mem = memoriaTexto();
  if (mem) ctx += `MEMÓRIA (preferências e regras da Isadora, valem pra todos os projetos):\n"""\n${mem}\n"""\n`;
  if (!opts.resumindo) {
    // histórico do projeto: janela maior pra "lembrar" o que foi feito antes (inclusive ontem),
    // com um teto total de caracteres pra não estourar o prompt.
    let hist = (pr.chat || []).slice(-30).map((x) => `${x.who === "me" ? "Isadora" : "Você"}: ${semTags(x.html).slice(0, 700)}`).filter(Boolean);
    let junto = hist.join("\n");
    while (junto.length > 12000 && hist.length > 6) { hist = hist.slice(1); junto = hist.join("\n"); } // mantém as mais recentes
    if (hist.length) ctx += `\nCONVERSA DESTE PROJETO ATÉ AGORA (memória do que já foi pedido e feito — use pra continuar de onde parou, sem pedir a Isadora pra repetir; não copie isto na resposta):\n${junto}\n`;
  }
  return ctx ? ctx + "\n" : "";
}
const siteFile = (id) => path.join(SITES, id, "index.html");

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const slug = (s) => (s || "cliente").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

/** Grava uma nova versão (guardamos todas) e republica o site. */
const MAX_VERSOES = 40; // guarda as últimas N versões; sem isso o JSON do projeto
                        // crescia pra sempre e deixava TUDO (ler/gravar no Drive) lento.
function salvarVersao(id, motivo, autor = "designer") {
  const p = readProj(id);
  let vs = lerVersoes(id);
  const v = (vs.length ? vs[vs.length - 1].v : 0) + 1;
  vs.push({ v, ts: new Date().toISOString(), motivo, autor, blocos: JSON.parse(JSON.stringify(p.blocos)) });
  if (vs.length > MAX_VERSOES) vs = vs.slice(-MAX_VERSOES);
  escreverVersoes(id, vs);
  writeProj(id, p);   // arquivo principal, leve (writeProj segrega qualquer versão legada)
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
  // leva os arquivos de mídia junto (senão as imagens quebram no ar)
  const srcA = assetsDir(id), dstA = path.join(pubDir(s), "assets");
  if (fs.existsSync(dstA)) fs.rmSync(dstA, { recursive: true, force: true });
  if (fs.existsSync(srcA)) { fs.mkdirSync(dstA, { recursive: true });
    for (const nm of fs.readdirSync(srcA).filter((x) => !x.startsWith("."))) fs.copyFileSync(path.join(srcA, nm), path.join(dstA, nm)); }
  const _vs = lerVersoes(id); const versao = _vs.length ? _vs[_vs.length - 1].v : 1;
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

/* ---- acompanhamento do cliente (página pública) ---- */
// status interno -> etapa amigável + % + posição na linha do tempo (o % vem daqui, nunca do relógio)
const ACOMP = {
  new:      { etapa: "Recebi seu briefing",      pct: 15,  idx: 0 },
  prod:     { etapa: "Fazendo sua página",       pct: 50,  idx: 1 },
  alt:      { etapa: "Fazendo seus ajustes",     pct: 70,  idx: 1 },
  rev:      { etapa: "Revisão da Isa",           pct: 85,  idx: 2 },
  entregue: { etapa: "Sua página está pronta",   pct: 100, idx: 3 },
};
const escH = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function paginaAcompanhamento(s) {
  const info = ACOMP[s.status] || ACOMP.new;
  const primeiro = escH(String(s.nome || "").trim().split(/\s+/)[0] || "você");
  const entregue = s.status === "entregue";
  const passos = [
    { t: "Recebi seu briefing", d: "Já estou com seus textos, cores e referências em mãos." },
    (s.status === "alt")
      ? { t: "Fazendo seus ajustes", d: "Aplicando as mudanças que você pediu, com o mesmo cuidado." }
      : { t: "Fazendo sua página", d: "Montando a página e escrevendo os textos pra ela vender de verdade." },
    { t: "Revisão da Isa", d: "Você só vê a página depois de pronta e revisada por mim." },
    { t: "Sua página pronta 🎉", d: "Te mando o link no WhatsApp. Se quiser mudar algo, o primeiro ajuste é por minha conta." },
  ];
  const cur = info.idx;
  const passosHTML = passos.map((ps, i) => {
    const cls = (entregue || i < cur) ? "done" : (i === cur ? "now" : "upcoming");
    const ic = (entregue || i < cur) ? "✓" : String(i + 1);
    const tag = cls === "done" ? '<span class="tag">Feito</span>' : (cls === "now" ? '<span class="tag">Agora</span>' : "");
    return '<div class="step ' + cls + '"><div class="icon">' + ic + '</div><div class="body"><div class="t">' + ps.t + '</div><div class="d">' + ps.d + '</div>' + tag + '</div></div>';
  }).join("");
  const dataEnt = /^\d{4}-\d{2}-\d{2}$/.test(s.dataEntrega || "") ? s.dataEntrega : "";
  const waNum = String((lerConfig().whatsapp || "")).replace(/\D/g, "");
  const wa = waNum ? "https://wa.me/" + waNum : "https://wa.me/";
  return paginaAcompHTML({ primeiro, pct: info.pct, etapa: escH(info.etapa), passosHTML, dataEnt, wa });
}
function paginaAcompNaoEncontrada() {
  return paginaAcompHTML({ naoEncontrada: true });
}
const LOGO_SVG = '<svg class="logo" viewBox="0 0 331.483 118.746" fill="none" preserveAspectRatio="xMidYMid meet" aria-label="Fábrica de LPs"><g><path d="M82.8092 41.762H74.0412C73.5415 41.762 73.134 42.1749 73.1338 42.6811V45.2752C73.1338 45.3765 73.2392 45.4591 73.3685 45.4591H83.4816C83.6109 45.4591 83.7163 45.3765 83.7163 45.2752V42.6811C83.7163 42.1752 83.3089 41.762 82.8092 41.762Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M83.7166 74.1288V48.2166C83.7166 48.1153 83.6112 48.0328 83.4818 48.0328H73.3688C73.2394 48.0328 73.134 48.1153 73.134 48.2166V74.1288C73.134 74.2301 73.2394 74.3126 73.3688 74.3126H83.4818C83.6112 74.3126 83.7166 74.2301 83.7166 74.1288Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M55.725 36.6767H44.0522C43.3869 36.6767 42.8444 37.1558 42.8444 37.7434V40.7538C42.8444 40.8713 42.9848 40.9671 43.1569 40.9671H56.6202C56.7924 40.9671 56.9327 40.8713 56.9327 40.7538V37.7434C56.9327 37.1567 56.3902 36.6767 55.725 36.6767Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M56.933 71.2729V44.167C56.933 44.0494 56.7927 43.9536 56.6205 43.9536H43.1569C42.9848 43.9536 42.8444 44.0494 42.8444 44.167V74.0993C42.8444 74.2168 42.9848 74.3126 43.1569 74.3126L56.6205 71.4862C56.6205 71.4862 53.9348 68.8803 56.933 71.2729Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M136.21 18.3729V23.9976H4.12477V18.3729H136.21Z" fill="#D12B6D"/><path d="M118.903 9.11419C120.284 9.11419 121.403 10.2334 121.403 11.6141C121.403 12.9947 120.284 14.1139 118.903 14.1139H67.6636C66.283 14.1139 65.1638 12.9947 65.1638 11.6141C65.1638 10.2334 66.283 9.11419 67.6636 9.11419H118.903Z" fill="#D12B6D"/><path d="M32.0537 11.6141C32.0537 13.0289 30.9067 14.1759 29.4918 14.1759C28.0769 14.1759 26.9299 13.0289 26.9299 11.6141C26.9299 10.1992 28.0769 9.05217 29.4918 9.05217C30.9067 9.05217 32.0537 10.1992 32.0537 11.6141Z" fill="#D12B6D"/><path d="M20.152 11.6141C20.152 13.0289 19.005 14.1759 17.5901 14.1759C16.1752 14.1759 15.0282 13.0289 15.0282 11.6141C15.0282 10.1992 16.1752 9.05217 17.5901 9.05217C19.005 9.05217 20.152 10.1992 20.152 11.6141Z" fill="#D12B6D"/><path d="M77.9109 81.4919C75.8557 83.0712 72.8823 81.6061 72.8822 79.0144V59.6334L47.8409 79.6668C45.7949 81.3035 42.764 79.8468 42.764 77.2267V59.8538L32.0895 68.9038V112.978H106.544V59.49L77.9109 81.4919ZM112.168 115.478C112.168 117.203 110.769 118.603 109.043 118.603H29.5897C27.8639 118.603 26.4649 117.204 26.4649 115.478V67.7461C26.4649 66.828 26.8686 65.9562 27.5689 65.3625L43.2431 52.0734L43.3392 51.995C45.3701 50.3976 48.3886 51.8369 48.3886 54.457V72.0253L73.4299 51.9923L73.5267 51.9178C75.57 50.4015 78.5069 51.8534 78.5069 54.4326V73.9405L107.14 51.9389L107.236 51.8669C109.287 50.4055 112.168 51.8651 112.168 54.4165V115.478Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M73.0049 86.3635C73.0049 84.9829 74.1241 83.8637 75.5047 83.8637H90.7836C92.1642 83.8637 93.2834 84.9829 93.2834 86.3635V113.29C93.2834 114.671 92.1642 115.79 90.7836 115.79H75.5047C74.1241 115.79 73.0049 114.671 73.0049 113.29V86.3635Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M42.8444 86.3635C42.8444 84.9829 43.9637 83.8637 45.3443 83.8637H60.6231C62.0038 83.8637 63.123 84.9829 63.123 86.3635V113.29C63.123 114.671 62.0038 115.79 60.6231 115.79H45.3443C43.9637 115.79 42.8444 114.671 42.8444 113.29V86.3635Z" fill="#FBCFE8" fill-opacity="0.8"/><path d="M123.495 49.7498L122.37 50.7498L122.912 54.6245C123.204 56.7911 124.37 64.3323 125.495 71.4569C127.37 83.6229 127.578 84.4145 128.578 85.2895C130.828 87.2477 131.828 86.6644 136.286 80.9147C137.536 79.2898 138.661 77.9566 138.786 77.9566C138.911 77.9149 140.328 79.9564 141.911 82.4146C144.661 86.5811 144.911 86.8727 146.327 86.9977C148.036 87.1227 149.452 86.1644 149.827 84.5812C150.035 83.7062 149.494 82.6229 147.369 79.3731C145.869 77.0816 144.619 74.9984 144.619 74.7901C144.619 74.5401 146.619 73.8735 149.036 73.2485C151.494 72.6235 153.702 71.9152 154.035 71.6652C154.827 70.9986 155.16 68.9154 154.66 67.9571C153.785 66.3322 127.203 48.7499 125.62 48.7499C125.079 48.7499 124.162 49.2082 123.495 49.7498ZM136.828 62.9574C140.286 65.2906 143.328 67.3322 143.536 67.5405C143.744 67.7071 143.078 68.0821 142.078 68.3321C137.744 69.4154 136.911 69.9153 134.87 72.7485C133.745 74.2484 132.786 75.3734 132.703 75.29C132.578 75.165 130.037 59.7909 130.037 59.041C130.037 58.8743 130.12 58.7493 130.245 58.7493C130.37 58.7493 133.328 60.6659 136.828 62.9574Z" fill="#FBCFE8"/><path d="M129.805 0.00305158C134.702 0.127166 138.633 4.13545 138.633 9.06198V49.1354L133.009 46.1229V9.06198C133.009 7.16371 131.47 5.62481 129.571 5.62468H9.06198C7.16363 5.62468 5.62471 7.16363 5.62468 9.06198V109.684C5.62469 111.583 7.16363 113.122 9.06198 113.122H129.571C131.47 113.121 133.009 111.583 133.009 109.684V93.9305L138.633 88.4248V109.684L138.63 109.918C138.508 114.737 134.624 118.621 129.805 118.743L129.571 118.746H9.06198L8.82823 118.743C4.00915 118.621 0.125081 114.737 0.00305158 109.918L0 109.684V9.06198C2.61706e-05 4.13536 3.93149 0.127037 8.82823 0.00305158L9.06198 0H129.571L129.805 0.00305158Z" fill="#D12B6D"/><path d="M213.72 55.6763C213.922 56.4507 213.805 57.1578 213.367 57.7976C212.929 58.4036 212.306 58.7067 211.498 58.7067H210.033C209.562 58.7067 209.107 58.5552 208.67 58.2521C208.266 57.9491 207.979 57.5787 207.811 57.141L205.892 51.3327C205.757 50.895 205.471 50.6761 205.033 50.6761H196.397C195.959 50.6761 195.673 50.895 195.538 51.3327L193.619 57.141C193.45 57.5787 193.164 57.9491 192.76 58.2521C192.356 58.5552 191.901 58.7067 191.396 58.7067H189.932C189.124 58.7067 188.501 58.4036 188.063 57.7976C187.591 57.1241 187.49 56.417 187.76 55.6763L197.558 26.1298C197.727 25.6584 197.996 25.288 198.366 25.0186C198.77 24.7156 199.208 24.5641 199.679 24.5641H201.75C202.222 24.5641 202.659 24.7156 203.063 25.0186C203.467 25.288 203.737 25.6584 203.872 26.1298L213.72 55.6763ZM203.518 44.0597L200.993 36.3322C200.824 36.0965 200.639 36.0965 200.437 36.3322L197.912 44.0597C197.844 44.2281 197.861 44.3796 197.962 44.5143C198.063 44.649 198.198 44.7163 198.366 44.7163H203.063C203.232 44.7163 203.366 44.649 203.467 44.5143C203.568 44.3796 203.585 44.2281 203.518 44.0597Z" fill="white"/><path d="M188.747 28.2511C188.747 28.8908 188.511 29.4464 188.04 29.9178C187.602 30.3555 187.08 30.5744 186.474 30.5744H173.443C173.039 30.5744 172.837 30.7932 172.837 31.231V37.9484C172.837 38.4198 173.039 38.6555 173.443 38.6555H184.656C185.329 38.6555 185.885 38.8743 186.323 39.3121C186.76 39.7498 186.979 40.2885 186.979 40.9283V42.3425C186.979 42.9822 186.76 43.5378 186.323 44.0092C185.885 44.4469 185.329 44.6658 184.656 44.6658H173.443C173.039 44.6658 172.837 44.8678 172.837 45.2719V56.3834C172.837 57.0231 172.602 57.5787 172.13 58.0501C171.693 58.4878 171.154 58.7067 170.514 58.7067H169.1C168.494 58.7067 167.955 58.4878 167.484 58.0501C167.046 57.5787 166.827 57.0231 166.827 56.3834V26.8874C166.827 26.214 167.046 25.6584 167.484 25.2207C167.955 24.7829 168.494 24.5641 169.1 24.5641H186.474C187.08 24.5641 187.602 24.7829 188.04 25.2207C188.511 25.6584 188.747 26.214 188.747 26.8874V28.2511Z" fill="white"/><path d="M275.841 56.3834C275.841 57.0231 275.605 57.5787 275.134 58.0501C274.696 58.4878 274.157 58.7067 273.517 58.7067H272.154C271.514 58.7067 270.958 58.4878 270.487 58.0501C270.049 57.5787 269.83 57.0231 269.83 56.3834V26.8874C269.83 26.214 270.049 25.6584 270.487 25.2207C270.958 24.7829 271.514 24.5641 272.154 24.5641H273.517C274.157 24.5641 274.696 24.7829 275.134 25.2207C275.605 25.6584 275.841 26.214 275.841 26.8874V56.3834Z" fill="white"/><path d="M301.791 52.0398C301.791 53.2519 301.488 54.3631 300.882 55.3732C300.276 56.3834 299.468 57.1915 298.458 57.7976C297.447 58.4036 296.336 58.7067 295.124 58.7067H286.033C284.821 58.7067 283.693 58.4036 282.649 57.7976C281.639 57.1915 280.831 56.3834 280.225 55.3732C279.619 54.3631 279.316 53.2519 279.316 52.0398V31.2815C279.316 30.0356 279.619 28.9077 280.225 27.8975C280.831 26.8874 281.639 26.0793 282.649 25.4732C283.693 24.8671 284.821 24.5641 286.033 24.5641H295.124C296.336 24.5641 297.447 24.8671 298.458 25.4732C299.468 26.0793 300.276 26.8874 300.882 27.8975C301.488 28.9077 301.791 30.0356 301.791 31.2815V32.6452C301.791 33.2849 301.572 33.8237 301.134 34.2614C300.697 34.6991 300.141 34.918 299.468 34.918H298.104C297.464 34.918 296.909 34.6991 296.437 34.2614C296 33.8237 295.781 33.2849 295.781 32.6452V31.2815C295.781 30.8101 295.562 30.5744 295.124 30.5744H286.033C285.595 30.5744 285.376 30.8101 285.376 31.2815V52.0398C285.376 52.2081 285.444 52.3765 285.578 52.5448C285.713 52.6795 285.865 52.7469 286.033 52.7469H295.124C295.293 52.7469 295.444 52.6795 295.579 52.5448C295.713 52.3765 295.781 52.2081 295.781 52.0398V50.5246C295.781 49.8848 296 49.3461 296.437 48.9084C296.909 48.437 297.464 48.2013 298.104 48.2013H299.468C300.141 48.2013 300.697 48.437 301.134 48.9084C301.572 49.3461 301.791 49.8848 301.791 50.5246V52.0398Z" fill="white"/><path d="M331.388 55.6763C331.59 56.4507 331.472 57.1578 331.034 57.7976C330.596 58.4036 329.974 58.7067 329.165 58.7067H327.701C327.229 58.7067 326.775 58.5552 326.337 58.2521C325.933 57.9491 325.647 57.5787 325.478 57.141L323.559 51.3327C323.424 50.895 323.138 50.6761 322.701 50.6761H314.064C313.626 50.6761 313.34 50.895 313.205 51.3327L311.286 57.141C311.118 57.5787 310.831 57.9491 310.427 58.2521C310.023 58.5552 309.569 58.7067 309.064 58.7067H307.599C306.791 58.7067 306.168 58.4036 305.73 57.7976C305.259 57.1241 305.158 56.417 305.427 55.6763L315.226 26.1298C315.394 25.6584 315.663 25.288 316.034 25.0186C316.438 24.7156 316.875 24.5641 317.347 24.5641H319.418C319.889 24.5641 320.327 24.7156 320.731 25.0186C321.135 25.288 321.404 25.6584 321.539 26.1298L331.388 55.6763ZM321.185 44.0597L318.66 36.3322C318.492 36.0965 318.306 36.0965 318.104 36.3322L315.579 44.0597C315.512 44.2281 315.529 44.3796 315.63 44.5143C315.731 44.649 315.865 44.7163 316.034 44.7163H320.731C320.899 44.7163 321.034 44.649 321.135 44.5143C321.236 44.3796 321.253 44.2281 321.185 44.0597Z" fill="white"/><path d="M266.058 55.5248C266.395 56.2992 266.344 57.0063 265.907 57.646C265.402 58.3531 264.762 58.7067 263.987 58.7067H262.472C262.034 58.7067 261.597 58.572 261.159 58.3026C260.755 58.0333 260.469 57.6965 260.3 57.2925L255.553 45.9285C255.384 45.5244 255.081 45.3224 254.644 45.3224H249.946C249.509 45.3224 249.29 45.5412 249.29 45.979V56.3834C249.29 57.0231 249.054 57.5787 248.583 58.0501C248.145 58.4878 247.606 58.7067 246.967 58.7067H245.552C244.913 58.7067 244.374 58.4878 243.936 58.0501C243.532 57.5787 243.33 57.0231 243.33 56.3834V26.8874C243.33 26.214 243.532 25.6584 243.936 25.2207C244.374 24.7829 244.913 24.5641 245.552 24.5641H259.24C260.452 24.5641 261.563 24.8671 262.573 25.4732C263.583 26.0793 264.391 26.8874 264.998 27.8975C265.604 28.9077 265.907 30.0356 265.907 31.2815V38.6555C265.907 39.9687 265.553 41.164 264.846 42.2415C264.173 43.2853 263.28 44.0934 262.169 44.6658C262.034 44.6995 261.933 44.8173 261.866 45.0193C261.799 45.1877 261.816 45.356 261.917 45.5244L266.058 55.5248ZM259.896 38.6555V31.2815C259.896 30.8101 259.677 30.5744 259.24 30.5744H249.946C249.509 30.5744 249.29 30.7932 249.29 31.231V38.6555C249.29 39.0932 249.509 39.3121 249.946 39.3121H259.24C259.677 39.3121 259.896 39.0932 259.896 38.6555Z" fill="white"/><path d="M239.694 52.0398C239.694 53.2519 239.391 54.3631 238.785 55.3732C238.179 56.3834 237.371 57.1915 236.361 57.7976C235.35 58.4036 234.239 58.7067 233.027 58.7067H219.542C218.902 58.7067 218.346 58.4878 217.875 58.0501C217.437 57.5787 217.218 57.0231 217.218 56.3834V26.8874C217.218 26.214 217.437 25.6584 217.875 25.2207C218.346 24.7829 218.902 24.5641 219.542 24.5641H232.32C233.566 24.5641 234.677 24.8671 235.653 25.4732C236.664 26.0793 237.472 26.8874 238.078 27.8975C238.684 28.9077 238.987 30.0356 238.987 31.2815V37.2918C238.987 38.2009 238.818 39.0427 238.482 39.8171C238.313 40.1875 238.347 40.5579 238.583 40.9283C239.324 42.0394 239.694 43.2853 239.694 44.6658V52.0398ZM233.027 37.2918V31.2815C233.027 31.0795 232.943 30.9111 232.775 30.7764C232.64 30.6417 232.488 30.5744 232.32 30.5744H223.936C223.498 30.5744 223.279 30.7932 223.279 31.231V37.2918C223.279 37.7295 223.498 37.9484 223.936 37.9484H232.32C232.488 37.9484 232.64 37.881 232.775 37.7463C232.943 37.6117 233.027 37.4601 233.027 37.2918ZM233.684 52.0398V44.6658C233.684 44.1944 233.465 43.9587 233.027 43.9587H223.936C223.498 43.9587 223.279 44.1776 223.279 44.6153V52.0903C223.279 52.528 223.498 52.7469 223.936 52.7469H233.027C233.195 52.7469 233.347 52.6795 233.482 52.5448C233.616 52.3765 233.684 52.2081 233.684 52.0398Z" fill="white"/><path d="M189.274 102.372C189.274 103.584 188.971 104.695 188.365 105.705C187.759 106.715 186.951 107.523 185.941 108.129C184.931 108.736 183.82 109.039 182.607 109.039H169.122C168.482 109.039 167.927 108.82 167.455 108.382C167.018 107.911 166.799 107.355 166.799 106.715V77.2193C166.799 76.5459 167.018 75.9903 167.455 75.5526C167.927 75.1148 168.482 74.896 169.122 74.896H182.607C183.82 74.896 184.931 75.199 185.941 75.8051C186.951 76.4112 187.759 77.2193 188.365 78.2294C188.971 79.2396 189.274 80.3676 189.274 81.6134V102.372ZM183.264 102.372V81.6134C183.264 81.142 183.045 80.9063 182.607 80.9063H173.516C173.078 80.9063 172.86 81.1252 172.86 81.5629V102.422C172.86 102.86 173.078 103.079 173.516 103.079H182.607C182.776 103.079 182.927 103.011 183.062 102.877C183.197 102.708 183.264 102.54 183.264 102.372Z" fill="white"/><path d="M281.073 88.9874C281.073 90.1996 280.77 91.3107 280.163 92.3208C279.591 93.331 278.8 94.1391 277.79 94.7452C276.78 95.3513 275.652 95.6543 274.406 95.6543H265.112C264.708 95.6543 264.506 95.8732 264.506 96.3109V106.715C264.506 107.355 264.271 107.911 263.799 108.382C263.362 108.82 262.823 109.039 262.183 109.039H260.819C260.18 109.039 259.624 108.82 259.153 108.382C258.715 107.911 258.496 107.355 258.496 106.715V77.2193C258.496 76.5459 258.715 75.9903 259.153 75.5526C259.624 75.1148 260.18 74.896 260.819 74.896H274.406C275.652 74.896 276.78 75.199 277.79 75.8051C278.8 76.4112 279.591 77.2193 280.163 78.2294C280.77 79.2396 281.073 80.3676 281.073 81.6134V88.9874ZM275.113 88.9874V81.6134C275.113 81.142 274.877 80.9063 274.406 80.9063H265.112C264.708 80.9063 264.506 81.1252 264.506 81.5629V88.9874C264.506 89.4251 264.708 89.644 265.112 89.644H274.406C274.877 89.644 275.113 89.4251 275.113 88.9874Z" fill="white"/><path d="M308.264 102.372C308.264 103.584 307.961 104.695 307.355 105.705C306.749 106.715 305.94 107.523 304.93 108.129C303.92 108.736 302.809 109.039 301.597 109.039H291.9C290.687 109.039 289.559 108.736 288.516 108.129C287.505 107.523 286.697 106.715 286.091 105.705C285.485 104.695 285.182 103.584 285.182 102.372V100.856C285.182 100.217 285.401 99.678 285.839 99.2403C286.31 98.7689 286.866 98.5332 287.505 98.5332H288.92C289.526 98.5332 290.048 98.7689 290.485 99.2403C290.957 99.678 291.193 100.217 291.193 100.856V102.372C291.193 102.54 291.26 102.708 291.395 102.877C291.563 103.011 291.731 103.079 291.9 103.079H301.597C301.765 103.079 301.917 103.011 302.051 102.877C302.186 102.708 302.254 102.54 302.254 102.372V97.7756C302.254 97.4052 302.085 97.1695 301.748 97.0685L289.627 92.5229C288.28 92.0515 287.202 91.2265 286.394 90.048C285.586 88.8695 285.182 87.5732 285.182 86.159V81.6134C285.182 80.3676 285.485 79.2396 286.091 78.2294C286.697 77.2193 287.505 76.4112 288.516 75.8051C289.559 75.199 290.687 74.896 291.9 74.896H301.597C302.809 74.896 303.92 75.199 304.93 75.8051C305.94 76.4112 306.749 77.2193 307.355 78.2294C307.961 79.2396 308.264 80.3676 308.264 81.6134V82.9771C308.264 83.6168 308.028 84.1556 307.557 84.5933C307.119 85.031 306.58 85.2499 305.94 85.2499H304.577C303.937 85.2499 303.381 85.031 302.91 84.5933C302.472 84.1556 302.254 83.6168 302.254 82.9771V81.6134C302.254 81.142 302.035 80.9063 301.597 80.9063H291.9C291.731 80.9063 291.563 80.9736 291.395 81.1083C291.26 81.243 291.193 81.4114 291.193 81.6134V86.159C291.193 86.5631 291.361 86.8156 291.698 86.9166L303.87 91.4622C305.183 91.9336 306.244 92.7586 307.052 93.9371C307.86 95.1156 308.264 96.3951 308.264 97.7756V102.372Z" fill="white"/><path d="M215.304 106.715C215.304 107.355 215.068 107.911 214.597 108.382C214.159 108.82 213.637 109.039 213.031 109.039H195.657C195.051 109.039 194.512 108.82 194.04 108.382C193.603 107.911 193.384 107.355 193.384 106.715V77.2193C193.384 76.5459 193.603 75.9903 194.04 75.5526C194.512 75.1148 195.051 74.896 195.657 74.896H213.031C213.637 74.896 214.159 75.1148 214.597 75.5526C215.068 75.9903 215.304 76.5459 215.304 77.2193V78.583C215.304 79.2227 215.068 79.7783 214.597 80.2497C214.159 80.6874 213.637 80.9063 213.031 80.9063H200C199.596 80.9063 199.394 81.1252 199.394 81.5629V88.2803C199.394 88.7517 199.596 88.9874 200 88.9874H211.213C211.886 88.9874 212.442 89.2063 212.88 89.644C213.317 90.0817 213.536 90.6204 213.536 91.2602V92.6744C213.536 93.3141 213.317 93.8697 212.88 94.3411C212.442 94.7788 211.886 94.9977 211.213 94.9977H200C199.596 94.9977 199.394 95.1997 199.394 95.6038V102.422C199.394 102.86 199.596 103.079 200 103.079H213.031C213.637 103.079 214.159 103.298 214.597 103.735C215.068 104.173 215.304 104.729 215.304 105.402V106.715Z" fill="white"/><path d="M254.523 106.715C254.523 107.355 254.287 107.911 253.815 108.382C253.378 108.82 252.856 109.039 252.25 109.039H234.875C234.269 109.039 233.731 108.82 233.259 108.382C232.821 107.911 232.603 107.355 232.603 106.715V77.2193C232.603 76.5459 232.821 75.9903 233.259 75.5526C233.731 75.1148 234.269 74.896 234.875 74.896H236.29C236.929 74.896 237.468 75.1148 237.906 75.5526C238.377 75.9903 238.613 76.5459 238.613 77.2193V102.422C238.613 102.86 238.815 103.079 239.219 103.079H252.25C252.856 103.079 253.378 103.298 253.815 103.735C254.287 104.173 254.523 104.729 254.523 105.402V106.715Z" fill="white"/></g></svg>';

function paginaAcompHTML(o) {
  const off = (590.619 * (1 - (o.pct || 0) / 100)).toFixed(1);
  const corpo = o.naoEncontrada
    ? '<div class="hello"><h1>Esse link não está mais no ar</h1><p>Pode ser que a sua página já tenha sido entregue. Me chama no WhatsApp que eu te ajudo. 💗</p></div>'
    : '<div class="hello"><h1>Oi, ' + o.primeiro + '! 💗<br>já comecei a sua página.</h1>'
      + '<p>Você pode acompanhar por aqui quando quiser. Quando ela ficar pronta, eu te chamo no WhatsApp com o link.</p></div>'
      + '<div class="ring-card"><div class="ring"><svg viewBox="0 0 212 212" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d12b6d"/><stop offset="1" stop-color="#f9a8d4"/></linearGradient></defs><circle class="track" cx="106" cy="106" r="94"/><circle class="prog" id="ring" cx="106" cy="106" r="94" stroke-dasharray="590.6" stroke-dashoffset="' + off + '"/></svg>'
      + '<div class="mid"><div class="pct" id="pct">' + (o.pct || 0) + '<span>%</span></div><div class="stage"><span class="pulse-dot"></span>' + o.etapa + '</div></div></div>'
      + '<div class="eta" id="eta"><div><div class="lbl">Previsão de entrega</div><div class="date" id="etaDate">a combinar</div></div><div class="count" id="etaCount"></div></div></div>'
      + '<div class="timeline">' + o.passosHTML + '</div>'
      + '<div class="note"><div class="av">👩🏻‍💻</div><div><div class="msg">Uso inteligência artificial pra adiantar a parte trabalhosa, mas quem senta, <strong>revisa e ajusta cada detalhe sou eu</strong>. Sua página passa pela minha mão antes de chegar em você.</div><div class="sig">— Isa, designer da Fábrica de LPs</div></div></div>'
      + '<a class="cta" href="' + (o.wa || "https://wa.me/") + '" target="_blank" rel="noopener"><svg class="wa" viewBox="0 0 24 24" fill="#0a2e14"><path d="M17.5 14.4c-.3-.15-1.7-.85-2-.95-.26-.1-.45-.15-.64.15-.19.28-.73.94-.9 1.13-.16.19-.33.21-.62.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.29-.02-.44.13-.59.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.08-.15-.64-1.54-.88-2.11-.23-.55-.47-.48-.64-.49h-.55c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38s1.02 2.76 1.17 2.95c.15.19 2.02 3.08 4.9 4.32.68.29 1.22.47 1.64.6.69.22 1.31.19 1.81.11.55-.08 1.7-.69 1.94-1.37.24-.67.24-1.25.17-1.37-.07-.12-.26-.19-.55-.34zM12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2z"/></svg>Falar com a Isa no WhatsApp</a>';
  const dataJS = JSON.stringify(o.dataEnt || "");
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Acompanhar projeto · Fábrica de LPs</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">'
    + '<style>'
    + ':root{--ground:#08070a;--ground-2:#0d0c10;--card:rgba(20,17,23,.66);--card-solid:#141117;--line:rgba(150,26,76,.28);--line-soft:rgba(150,26,76,.16);--rasp:#d12b6d;--rasp-bright:#e04080;--blush:#f9a8d4;--text:#f6eef2;--muted:#b39aa6;--dim:#6c5b66;--done:#34d39a;--gold:#ffad4e;--wa:#25d366;--font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    + '*{box-sizing:border-box}html,body{margin:0}'
    + 'body{font-family:var(--font);color:var(--text);background:radial-gradient(circle at 50% 0%,rgba(209,43,109,.16) 0%,transparent 55%),linear-gradient(180deg,var(--ground-2) 0%,var(--ground) 100%);background-attachment:fixed;min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.5}'
    + '.grid-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(150,26,76,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(150,26,76,.05) 1px,transparent 1px);background-size:40px 40px;-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 70%);mask-image:linear-gradient(180deg,#000 0%,transparent 70%)}'
    + '.wrap{position:relative;z-index:1;max-width:468px;margin:0 auto;padding:22px 20px 40px;display:flex;flex-direction:column;gap:20px}'
    + '.top{display:flex;align-items:center;justify-content:space-between;gap:12px}.logo{height:30px;width:auto;display:block;filter:drop-shadow(0 0 14px rgba(209,43,109,.45))}'
    + '.eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--blush);opacity:.85;white-space:nowrap}'
    + '.hello h1{margin:0;font-size:clamp(24px,7vw,30px);font-weight:800;letter-spacing:-.02em;line-height:1.15}.hello p{margin:8px 0 0;color:var(--muted);font-size:14.5px;max-width:42ch}.hello .name{color:var(--blush)}'
    + '.ring-card{background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:22px;padding:26px 22px 24px;display:flex;flex-direction:column;align-items:center;gap:18px;box-shadow:0 0 40px rgba(0,0,0,.5)}'
    + '.ring{position:relative;width:212px;height:212px}.ring svg{width:100%;height:100%;transform:rotate(-90deg)}.ring .track{fill:none;stroke:var(--line);stroke-width:13}.ring .prog{fill:none;stroke:url(#g);stroke-width:13;stroke-linecap:round;filter:drop-shadow(0 0 8px rgba(209,43,109,.55))}'
    + '@media (prefers-reduced-motion:no-preference){.ring .prog{transition:stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)}}'
    + '.ring .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0 42px;text-align:center}'
    + '.ring .pct{font-size:46px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}.ring .pct span{font-size:22px;color:var(--muted);font-weight:700}'
    + '.ring .stage{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--blush);margin-top:6px;line-height:1.35}.pulse-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--rasp-bright);margin-bottom:2px;box-shadow:0 0 10px rgba(224,64,128,.7)}'
    + '.eta{width:100%;display:flex;align-items:center;justify-content:space-between;gap:14px;background:rgba(255,173,78,.07);border:1px solid rgba(255,173,78,.22);border-radius:14px;padding:13px 16px}'
    + '.eta .lbl{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.eta .date{font-size:16px;font-weight:800;margin-top:2px}.eta .count{text-align:right;font-size:15px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '.timeline{background:var(--card);border:1px solid var(--line-soft);border-radius:20px;padding:8px 20px}.step{display:flex;gap:15px;padding:15px 0}.step+.step{border-top:1px solid rgba(255,255,255,.04)}'
    + '.step .icon{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:900;border:1.5px solid var(--dim);color:var(--dim)}'
    + '.step.done .icon{border-color:var(--done);color:var(--done);background:rgba(52,211,154,.1)}.step.now .icon{border-color:var(--rasp-bright);color:#fff;background:linear-gradient(135deg,var(--rasp),var(--rasp-bright));box-shadow:0 0 16px rgba(209,43,109,.5)}'
    + '.step .body{display:flex;flex-direction:column;gap:2px;min-width:0}.step .t{font-size:15px;font-weight:700}.step.upcoming .t{color:var(--dim)}.step .d{font-size:12.5px;color:var(--muted)}.step.upcoming .d{color:var(--dim)}'
    + '.step .tag{align-self:flex-start;margin-top:5px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:20px}.step.done .tag{color:var(--done);background:rgba(52,211,154,.12)}.step.now .tag{color:var(--blush);background:rgba(209,43,109,.15)}'
    + '.note{display:flex;gap:14px;align-items:flex-start;background:linear-gradient(135deg,rgba(209,43,109,.12),rgba(249,168,212,.05));border:1px solid var(--line);border-radius:18px;padding:18px}.note .av{flex:none;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,var(--rasp),var(--blush));display:grid;place-items:center;font-size:20px}.note .msg{font-size:14px;line-height:1.55}.note .msg strong{color:var(--blush)}.note .sig{margin-top:7px;font-size:12px;color:var(--muted);font-weight:600}'
    + '.cta{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;color:#0a2e14;font-weight:800;font-size:15.5px;background:var(--wa);border-radius:14px;padding:16px;box-shadow:0 0 24px rgba(37,211,102,.45)}.cta .wa{width:22px;height:22px;flex:none}'
    + '.foot{text-align:center;font-size:11px;color:var(--dim);padding-top:4px}.foot b{color:var(--muted);font-weight:600}'
    + '</style></head><body><div class="grid-bg"></div><div class="wrap">'
    + '<div class="top">' + LOGO_SVG + '<div class="eyebrow">Seu projeto</div></div>'
    + corpo
    + '<div class="foot"><b>Fábrica de LPs</b> · sua landing page com a assinatura de uma designer</div>'
    + '</div>'
    + '<script>(function(){var DATA_ENTREGA=' + dataJS + ';var ring=document.getElementById("ring");if(ring){var CIRC=2*Math.PI*94;ring.setAttribute("stroke-dasharray",CIRC.toFixed(1));}'
    + 'var eta=document.getElementById("eta");if(DATA_ENTREGA&&eta){var alvo=new Date(DATA_ENTREGA+"T00:00:00");var hoje=new Date();hoje.setHours(0,0,0,0);var dias=Math.round((alvo-hoje)/86400000);'
    + 'var txt=dias>1?"faltam "+dias+" dias":dias===1?"falta 1 dia":dias===0?"é hoje!":"no prazo final";document.getElementById("etaCount").textContent=txt;'
    + 'var semana=["domingo","segunda","terça","quarta","quinta","sexta","sábado"];var dd=("0"+alvo.getDate()).slice(-2),mm=("0"+(alvo.getMonth()+1)).slice(-2);document.getElementById("etaDate").textContent=semana[alvo.getDay()]+", "+dd+"/"+mm;}'
    + 'else if(eta){eta.style.display="none";}})();<\/script>'
    + '</body></html>';
}

/* ---- envio automático pra Hostinger (FTP via curl) ---- */
const CONFIG_FILE = path.join(DATA, "config.json");
const FTP_PADRAO = { host: "", port: 21, user: "", senha: "", caminho: "public_html/{slug}", ssl: true, ativo: false };
function lerConfig() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); return { ...c, ftp: { ...FTP_PADRAO, ...(c.ftp || {}) } }; }
  catch { return { ftp: { ...FTP_PADRAO } }; }
}
function escreverConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + "\n"); }

/** Sobe um arquivo por FTP(S) usando o curl do sistema. */
function curlPut(alvo, arquivoLocal, f) {
  return new Promise((resolve) => {
    const args = ["-T", arquivoLocal, "--ftp-create-dirs", "--user", `${f.user}:${f.senha}`,
      "-sS", "--connect-timeout", "20", "--max-time", "120"];
    if (f.ssl) args.push("--ssl-reqd");
    args.push(alvo);
    const c = spawn("curl", args);
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", () => resolve({ ok: false, erro: "curl não encontrado no sistema" }));
    c.on("close", (code) => resolve({ ok: code === 0, erro: code === 0 ? "" : (err.trim() || "falha no envio (código " + code + ")") }));
  });
}
/** Publica a pasta inteira (index.html + assets/) por FTP(S). */
async function enviarFTP(slug, dirLocal) {
  const f = lerConfig().ftp;
  if (!f.host || !f.user || !f.senha) return { ok: false, erro: "configure o envio automático primeiro" };
  const dir = (f.caminho || "public_html/{slug}").replace(/\{slug\}/g, slug).replace(/^\/+|\/+$/g, "");
  const base = `ftp://${f.host}:${f.port || 21}/${dir}/`;
  const arquivos = [["index.html", path.join(dirLocal, "index.html")]];
  const ad = path.join(dirLocal, "assets");
  if (fs.existsSync(ad)) for (const nm of fs.readdirSync(ad).filter((x) => !x.startsWith("."))) arquivos.push(["assets/" + nm, path.join(ad, nm)]);
  let enviados = 0;
  for (const [rel, local] of arquivos) {
    const r = await curlPut(base + rel, local, f);
    if (!r.ok) return { ok: false, erro: `${rel}: ${r.erro}`, enviados };
    enviados++;
  }
  return { ok: true, enviados, total: arquivos.length };
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
// pasta das skills do repositório (.claude/skills): em dev vem do próprio repo;
// no app instalado vem de uma cópia empacotada (app/skills-md, criada no build).
function skillsMdDir() {
  const cands = [path.resolve(ROOT, "..", ".claude", "skills"), path.join(APP, "skills-md")];
  return cands.find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) || null;
}
function listSkillsMd() {
  const dir = skillsMdDir(); if (!dir) return [];
  const out = [];
  for (const nome of fs.readdirSync(dir)) {
    try {
      const arq = path.join(dir, nome, "SKILL.md");
      if (!fs.existsSync(arq)) continue;
      const p = parseSkillMd(fs.readFileSync(arq, "utf8"));
      out.push({ id: "gh-" + nome, nome: p.nome, descricao: p.descricao, instrucoes: p.instrucoes,
        escopo: "pagina", origem: "github", nativa: true, icone: "github" });
    } catch (e) {}
  }
  return out;
}
function listSkills() {
  const locais = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(SKILLS, f), "utf8")); } catch { return null; } })
    .filter(Boolean);
  return locais.concat(listSkillsMd()).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
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

/* ---- importar skills de criadores do GitHub (arquivo SKILL.md público) ----
 * Aceita link de repositório, de pasta (tree) ou do próprio arquivo (blob/raw).
 * Como não sabemos o caminho exato, tentamos os candidatos mais comuns em ordem. */
/** Baixa um arquivo binário (imagem) seguindo redirecionamentos. */
function fetchBinary(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    };
    let req;
    try {
      req = https.get(url, { headers }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
          r.resume();
          return resolve(fetchBinary(new URL(r.headers.location, url).toString(), redirects - 1));
        }
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve({ status: r.statusCode, buffer: Buffer.concat(chunks),
          contentType: String(r.headers["content-type"] || "").split(";")[0].trim() }));
      });
    } catch (e) { return reject(e); }
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("tempo esgotado")));
  });
}
/** Baixa uma imagem do Google Drive por ID. Tenta a miniatura (mais confiável
 * pra arquivos com link público: não cai na página de confirmação/login) e,
 * se não vier imagem, tenta o download direto. Retorna {buffer,contentType} ou null. */
async function baixarImagemDrive(fileId) {
  const tentativas = [
    "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1600",
    "https://lh3.googleusercontent.com/d/" + fileId + "=w1600",
    "https://drive.google.com/uc?export=download&id=" + fileId
  ];
  for (const u of tentativas) {
    let bin;
    try { bin = await fetchBinary(u); } catch (e) { continue; }
    if (bin && bin.buffer && bin.buffer.length && (bin.contentType || "").indexOf("image/") === 0) return bin;
  }
  return null;
}
function fetchURL(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = https.get(url, { headers: { "User-Agent": "fabrica-lps", Accept: "text/plain,*/*" } }, (r) => {
        if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
          r.resume();
          return resolve(fetchURL(new URL(r.headers.location, url).toString(), redirects - 1));
        }
        let data = "";
        r.setEncoding("utf8");
        r.on("data", (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
        r.on("end", () => resolve({ status: r.statusCode, body: data }));
      });
    } catch (e) { return reject(e); }
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("tempo esgotado")));
  });
}
/** Busca uma URL como um navegador: carrega os cookies pelos redirecionamentos.
 * Necessário pra ler apps do Google Apps Script (eles setam cookie no meio do caminho). */
function fetchComCookies(url, redirects = 6, cookies = "") {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
    };
    if (cookies) headers.Cookie = cookies;
    let req;
    try {
      req = https.get(url, { headers }, (r) => {
        let acc = cookies;
        const set = r.headers["set-cookie"];
        if (set && set.length) {
          const add = set.map((c) => String(c).split(";")[0]).join("; ");
          acc = cookies ? (cookies + "; " + add) : add;
        }
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
          r.resume();
          return resolve(fetchComCookies(new URL(r.headers.location, url).toString(), redirects - 1, acc));
        }
        let data = ""; r.setEncoding("utf8");
        r.on("data", (c) => { data += c; if (data.length > 5_000_000) req.destroy(); });
        r.on("end", () => resolve({ status: r.statusCode, body: data }));
      });
    } catch (e) { return reject(e); }
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("tempo esgotado")));
  });
}
/** Lê um CSV (com aspas, vírgulas e quebras de linha dentro de célula). */
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') { q = true; }
    else if (c === ',') { row.push(field); field = ""; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
/** Aceita qualquer link da planilha (compartilhar, publicado em HTML ou CSV) e
 * devolve o link de DADOS em CSV. */
function urlCsvDaPlanilha(u) {
  u = String(u || "").trim();
  if (/output=csv|tqx=out:csv/.test(u)) return u; // já é CSV
  // publicado na web (pub / pubhtml) -> força CSV, mantendo o gid da aba
  const mp = u.match(/\/spreadsheets\/d\/e\/([^/]+)\/pub/);
  if (mp) {
    const gid = (u.match(/[?&]gid=(\d+)/) || [])[1];
    return "https://docs.google.com/spreadsheets/d/e/" + mp[1] + "/pub?" + (gid ? "gid=" + gid + "&" : "") + "single=true&output=csv";
  }
  // link normal da planilha -> gviz CSV da aba Briefings
  const m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return "https://docs.google.com/spreadsheets/d/" + m[1] + "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(ABA);
  return u;
}
/** Converte as linhas do CSV publicado em briefings organizados. */
function csvParaBriefings(rows) {
  if (!rows || rows.length < 2) return [];
  const head = rows[0].map((h) => String(h).trim());
  const H2K = { "Negócio": "negocio", "O que vende": "vende", "Objetivo da página": "objetivo", "Público": "publico",
    "Oferta": "oferta", "Diferencial": "diferencial", "Provas": "provas", "Tom": "tom", "Cores": "cores", "Fotos": "fotos",
    "Referência que ama": "amo", "O que evitar": "evitar", "Contatos": "contato" };
  const idx = (n) => head.indexOf(n);
  const iData = idx("Data"), iNome = idx("Nome"), iTel = idx("WhatsApp"), iStatus = idx("Status"), iArq = idx("Arquivos"), iChave = idx("Chave");
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some((x) => String(x).trim())) continue;
    const respostas = {};
    Object.keys(H2K).forEach((h) => { const j = idx(h); if (j >= 0) respostas[H2K[h]] = row[j] || ""; });
    const arquivos = [];
    if (iArq >= 0) String(row[iArq] || "").split("\n").forEach((l) => {
      const m = String(l).match(/^\s*([^:]+):\s*(https?:\/\/\S+)/);
      if (m) arquivos.push({ campo: m[1].trim(), url: m[2].trim() });
    });
    out.push({ data: iData >= 0 ? row[iData] : "", nome: iNome >= 0 ? row[iNome] : "", tel: iTel >= 0 ? row[iTel] : "",
      status: iStatus >= 0 ? row[iStatus] : "", respostas, arquivos, chave: iChave >= 0 ? row[iChave] : "" });
  }
  return out;
}
/** POST JSON e devolve { status, json }. */
function postJSON(urlStr, obj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr); const dados = Buffer.from(JSON.stringify(obj));
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": dados.length } }, (r) => {
      let d = ""; r.setEncoding("utf8"); r.on("data", (c) => { d += c; if (d.length > 30_000_000) req.destroy(); });
      r.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: r.statusCode, json: j, raw: d.slice(0, 500) }); });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("tempo esgotado")));
    req.write(dados); req.end();
  });
}
/** Gera (ou edita) uma imagem com a API do Gemini (Nano Banana) e salva na pasta.
 * refs: lista de {mime, base64} de imagens de referência — quando passado, o modelo
 * EDITA/varia a imagem em vez de criar do zero. Retorna {ok, nome} ou {ok:false, erro}. */
async function gerarGeminiImagem(prompt, dir, refs) {
  const key = (lerConfig().geminiKey || "").trim();
  if (!key) return { ok: false, erro: "sem chave da API do Gemini — cole em Configurações." };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(key)}`;
  const reqParts = [];
  for (const ref of (refs || [])) if (ref && ref.base64) reqParts.push({ inlineData: { mimeType: ref.mime || "image/png", data: ref.base64 } });
  reqParts.push({ text: prompt });
  let r;
  try { r = await postJSON(url, { contents: [{ parts: reqParts }] }); }
  catch (e) { return { ok: false, erro: "não consegui falar com a API do Gemini: " + (e.message || e) }; }
  if (r.status !== 200) {
    const msg = (r.json && r.json.error && r.json.error.message) || r.raw || ("HTTP " + r.status);
    return { ok: false, erro: "API do Gemini recusou: " + String(msg).slice(0, 300) };
  }
  const parts = (((r.json || {}).candidates || [])[0] || {}).content && r.json.candidates[0].content.parts || [];
  const img = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!img) return { ok: false, erro: "a API não devolveu imagem (talvez o modelo não esteja liberado na sua chave)." };
  const mime = (img.inlineData.mimeType || "image/png").toLowerCase();
  const ext = EXT_MIDIA[mime] || ".png";
  fs.mkdirSync(dir, { recursive: true });
  let nome = "nano-" + Date.now().toString(36) + ext;
  try { fs.writeFileSync(path.join(dir, nome), Buffer.from(img.inlineData.data, "base64")); }
  catch (e) { return { ok: false, erro: "não consegui salvar o arquivo: " + (e.message || e) }; }
  return { ok: true, nome };
}
function candidatosRaw(entrada) {
  let u;
  try { u = new URL(String(entrada).trim()); } catch { return []; }
  const host = u.hostname.replace(/^www\./, ""), parts = u.pathname.split("/").filter(Boolean), cand = [];
  const push = (raw) => { if (raw && !cand.includes(raw)) cand.push(raw); };
  if (host === "raw.githubusercontent.com") { push(u.toString()); return cand; }
  if (host !== "github.com") return cand;
  const [owner, repo, tipo, ...resto] = parts;
  if (!owner || !repo) return cand;
  const raw = (branch, sub) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${sub}`.replace(/\/+$/, "");
  const nomes = ["SKILL.md", "skill.md", "README.md"];
  if (tipo === "blob" || tipo === "tree") {
    const branch = resto[0], sub = resto.slice(1).join("/");
    if (branch) {
      if (/\.md$/i.test(sub)) push(raw(branch, sub));
      else nomes.forEach((nm) => push(raw(branch, (sub ? sub + "/" : "") + nm)));
    }
  } else {
    for (const br of ["main", "master"]) nomes.forEach((nm) => push(raw(br, nm)));
  }
  return cand;
}
function parseSkillMd(md) {
  let nome = "", descricao = "", corpo = md;
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (fm) {
    corpo = fm[2];
    const ln = fm[1].split("\n");
    for (let i = 0; i < ln.length; i++) {
      const m = ln[i].match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase();
      let v = m[2].trim();
      if (/^[|>][+-]?$/.test(v) || v === "") {
        // YAML multilinha (>, >-, |, ...): junta as linhas indentadas de baixo
        const buf = []; let j = i + 1;
        for (; j < ln.length; j++) {
          if (/^\s+\S/.test(ln[j]) || ln[j].trim() === "") buf.push(ln[j].replace(/^\s+/, ""));
          else break;
        }
        while (buf.length && buf[buf.length - 1] === "") buf.pop();
        v = (v.startsWith("|") ? buf.join("\n") : buf.join(" ")).trim();
        i = j - 1;
      } else {
        v = v.replace(/^["']|["']$/g, "");
      }
      if (k === "name" || k === "title") nome = nome || v;
      else if (k === "description") descricao = descricao || v;
    }
  }
  if (!nome) { const h = corpo.match(/^#\s+(.+)$/m); if (h) nome = h[1].trim(); }
  if (!descricao) { const linha = corpo.split("\n").map((s) => s.trim()).find((s) => s && !s.startsWith("#") && !s.startsWith("---")); if (linha) descricao = linha.slice(0, 180); }
  return { nome: (nome || "Skill importada").slice(0, 90), descricao: descricao.slice(0, 200), instrucoes: corpo.trim().slice(0, 12000) };
}

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
  // prompt pela ENTRADA PADRÃO (stdin), não por argumento — evita estourar o
  // limite/escape da linha de comando no Windows quando o pedido é grande.
  if (ia.motor === "codex")
    return { cmd: "codex", args: ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write"], input: prompt, cwd: DATA };
  if (ia.motor === "gemini")
    return { cmd: "gemini", args: ["-y"], input: prompt, cwd: DATA };
  if (ia.motor === "antigravity")
    return { cmd: "Agy", args: ["-y"], input: prompt, cwd: DATA };
  return {
    cmd: "claude",
    args: ["-p", "--permission-mode", "acceptEdits", "--add-dir", TEMPLATES],
    input: prompt,
    cwd: DATA,
  };
}
/* ===== FASE B — SONDA DE CAPACIDADES: pergunta ao próprio CLI quais flags ele
   aceita (rodando `claude -p --help`), pra nunca passar uma flag que a versão
   instalada não conhece (que a faria sair com "unknown option" e quebrar o chat).
   Igual ao Open Design. Resultado é cacheado. ===== */
let _caps = null;
function capacidadesClaude() {
  if (_caps) return _caps;
  _caps = { streamJson: false, addDir: false, partialMessages: false, thinkingDisplay: false, disallowedTools: false, settings: false, resume: false };
  try {
    const exe = resolverExe("claude") || "claude";
    const r = require("child_process").spawnSync(exe, ["-p", "--help"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    const help = String((r && (r.stdout || "")) + (r && (r.stderr || "")) || "");
    if (help) {
      _caps.streamJson = /--output-format/.test(help) && /stream-json/.test(help);
      _caps.addDir = /--add-dir/.test(help);
      _caps.partialMessages = /--include-partial-messages/.test(help);
      _caps.thinkingDisplay = /--thinking-display/.test(help);
      _caps.disallowedTools = /--disallowedTools|--disallowed-tools/.test(help);
      _caps.settings = /--settings\b/.test(help);
      _caps.resume = /--resume\b/.test(help) && /--session-id\b/.test(help);
      _caps.sondado = true;
    }
  } catch (e) {}
  return _caps;
}

/* processos de chat em andamento, por projeto — pra dar pra INTERROMPER */
const processos = new Map();
const cancelados = new Set(); // chaves que foram interrompidas pela pessoa

/* ===== FLUXO AO VIVO (SSE): mostra o processo da IA no chat em tempo real =====
   Assinantes por chave (ex.: "chat:<id>"). O runClaude, no modo streaming do
   Claude, traduz os eventos do CLI em passos amigáveis e os transmite aqui. */
const fluxos = new Map(); // chave -> Set(res)
const fluxosBuf = new Map(); // chave -> { ativo, eventos:[] } — repete os passos pra quem conecta um instante depois (evita corrida)
function assinarFluxo(chave, res) {
  if (!fluxos.has(chave)) fluxos.set(chave, new Set());
  fluxos.get(chave).add(res);
  // se um run está em andamento, repete o que já aconteceu pra este assinante recém-chegado
  const b = fluxosBuf.get(chave);
  if (b && b.ativo && b.eventos.length) {
    for (const ev of b.eventos) { try { res.write("data: " + JSON.stringify(ev) + "\n\n"); } catch (e) {} }
  }
}
function desassinarFluxo(chave, res) {
  const s = fluxos.get(chave); if (!s) return;
  s.delete(res); if (!s.size) fluxos.delete(chave);
}
function emitirFluxo(chave, evento) {
  // buffer do run atual: zera no início, marca inativo no fim
  let b = fluxosBuf.get(chave);
  if (evento && evento.tipo === "inicio") { b = { ativo: true, eventos: [] }; fluxosBuf.set(chave, b); }
  if (!b) { b = { ativo: true, eventos: [] }; fluxosBuf.set(chave, b); }
  b.eventos.push(evento); if (b.eventos.length > 300) b.eventos.shift();
  if (evento && evento.tipo === "fim") b.ativo = false;
  const s = fluxos.get(chave); if (!s || !s.size) return;
  const dado = "data: " + JSON.stringify(evento) + "\n\n";
  for (const res of s) { try { res.write(dado); } catch (e) {} }
}
function nomeArq(p) { try { return path.basename(String(p)); } catch { return String(p || ""); } }
/* traduz um evento cru do CLI (stream-json) em um passo curto e humano em pt-BR */
function passoDoEvento(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
    const passos = [];
    for (const c of ev.message.content) {
      if (c.type === "thinking" && c.thinking && c.thinking.trim())
        passos.push({ tipo: "pensa", texto: c.thinking.trim().slice(0, 280) });
      else if (c.type === "text" && c.text && c.text.trim())
        passos.push({ tipo: "fala", texto: c.text.trim() });
      else if (c.type === "tool_use") {
        const n = c.name || "", inp = c.input || {};
        if (n === "Read") passos.push({ tipo: "acao", icone: "read", texto: "Lendo " + nomeArq(inp.file_path) });
        else if (n === "Write") passos.push({ tipo: "acao", icone: "write", texto: "Criando " + nomeArq(inp.file_path) });
        else if (n === "Edit" || n === "MultiEdit") passos.push({ tipo: "acao", icone: "write", texto: "Editando " + nomeArq(inp.file_path) });
        else if (n === "Bash") passos.push({ tipo: "acao", icone: "run", texto: "Rodando: " + String(inp.command || "").slice(0, 60) });
        else if (n === "Grep" || n === "Glob") passos.push({ tipo: "acao", icone: "search", texto: "Procurando no projeto" });
        else if (n === "WebFetch" || n === "WebSearch") passos.push({ tipo: "acao", icone: "web", texto: "Consultando a web" });
        else if (n === "TodoWrite") { /* silencioso */ }
        else passos.push({ tipo: "acao", icone: "tool", texto: n });
      }
    }
    return passos.length ? passos : null;
  }
  return null;
}
function runClaude(prompt, chave, opts = {}) {
  return new Promise((resolve) => {
    const ia = lerIA();
    const ehClaude = (ia.motor || "claude") === "claude";
    const caps = ehClaude ? capacidadesClaude() : {};
    // se sondamos o CLI e ele NÃO tem stream-json, nem tenta streamar (evita rodada perdida)
    const stream = !!opts.stream && ehClaude && !(caps.sondado && !caps.streamJson);
    // só usa --add-dir se o CLI aceitar (ou se não deu pra sondar — aí assume que sim)
    const podeAddDir = !ehClaude ? false : (!caps.sondado || caps.addDir);
    let base = comandoIA(prompt);
    let { cmd, args, input, cwd } = base;
    // pastas extras que o motor pode LER/GRAVAR (ex.: a pasta do site, pra ler a
    // imagem anexada e gravar os artefatos). Só faz sentido no Claude.
    const extraDirs = (opts.addDirs || []).filter(Boolean);
    // FASE A/B — liberdade: no modo "estúdio" a IA trabalha solta na PASTA LOCAL do
    // projeto. bypassPermissions pula o "trust da pasta" e o bloqueio de acesso
    // que aparecem no headless — MAS o Claude recusa isso rodando como root/sudo.
    // Então: usuário normal (Windows da Isa) -> bypass; root (sandbox) -> acceptEdits.
    const ehRoot = (typeof process.getuid === "function" && process.getuid() === 0);
    const permMode = (opts.freedom && !ehRoot) ? "bypassPermissions" : "acceptEdits";
    // desliga ferramentas que o design não precisa e que dão problema (o Bash/terminal
    // falha no sandbox de algumas máquinas). Ler/editar/criar arquivo continua liberado.
    const disallow = (opts.disallow || []).filter(Boolean);
    const argsDisallow = (caps.disallowedTools && disallow.length) ? ["--disallowedTools", ...disallow] : [];
    // FORÇA O SANDBOX DESLIGADO no boot: a Anthropic empurrou um sandbox de arquivos
    // pras sessões headless que bloqueia ler/gravar mid-session (issue #79639). Passar
    // isto no --settings recupera o acesso a arquivo. Só se o CLI aceitar --settings.
    const argsSettings = (ehClaude && caps.settings) ? ["--settings", '{"sandbox":{"enabled":false,"filesystem":{"disabled":true}}}'] : [];
    // MEMÓRIA: sessão persistente por projeto — --session-id cria, --resume continua
    // (o CLI lembra a conversa e o trabalho anteriores nativamente, como no Open Design).
    const argsSessao = (ehClaude && caps.resume && opts.sessionId) ? [opts.resume ? "--resume" : "--session-id", String(opts.sessionId)] : [];
    // no modo ao vivo, pedimos ao Claude a saída em stream de JSON (um evento por linha)
    if (stream) args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permMode].concat(argsSessao).concat(argsSettings).concat(argsDisallow).concat(podeAddDir ? ["--add-dir", TEMPLATES] : []);
    else if (ehClaude) args = args.concat(argsSessao).concat(argsSettings); // modo buffered também
    if (podeAddDir) for (const dir of extraDirs) args = args.concat(["--add-dir", dir]);
    const spawnCwd = opts.cwd || cwd || ROOT;
    if (opts.cwd) { try { fs.mkdirSync(opts.cwd, { recursive: true }); } catch (e) {} }
    const spawnOpts = { cwd: spawnCwd, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] };
    const child = spawnCLI(cmd, args, spawnOpts);
    if (chave) { if (processos.has(chave)) { try { matarProcesso(processos.get(chave)); } catch (e) {} } processos.set(chave, child); }
    // Motores que não são Claude não mandam os passos ao vivo (formato diferente):
    // a Fábrica roda, mas não tem o que narrar. Mostra UM passo claro pra a tela
    // não parecer travada — a IA está trabalhando, só não conta os passos.
    if (!stream && chave) emitirFluxo(chave, { tipo: "acao", icone: "motor",
      texto: "Gerando com " + (MOTOR_NOME[ia.motor] || "a IA") + " — este motor não mostra os passos ao vivo, mas está trabalhando…" });
    let out = "", err = "", done = false, buf = "", resultado = null, viuJSON = false;
    const errosFerramenta = []; // erros REAIS das ferramentas (verdade, não a paráfrase da IA)
    const fim = (v) => { if (done) return; done = true; clearTimeout(t); if (chave && processos.get(chave) === child) processos.delete(chave); resolve(v); };
    const t = setTimeout(() => { matarProcesso(child); fim({ ok: false, code: null, out: out.trim(), err: (err.slice(-1000) + "\n[o motor passou de 6 min e foi cortado]").trim() }); }, 360000);
    // processa uma linha do stream-json; devolve texto "solto" (fallback) se não for JSON
    const linha = (ln) => {
      if (!ln.trim()) return;
      let ev; try { ev = JSON.parse(ln); } catch { out += ln + "\n"; return; }
      viuJSON = true;
      if (ev.type === "result" && typeof ev.result === "string") resultado = ev.result;
      // resultado de cada ferramenta: marca o passo como concluído ✓ ou falhou ✗ (Fase C)
      // e captura o erro REAL quando falha (verdade, não a paráfrase da IA)
      if (ev.type === "user" && ev.message && Array.isArray(ev.message.content)) {
        for (const c of ev.message.content) {
          if (c && c.type === "tool_result") {
            if (c.is_error) {
              const txt = typeof c.content === "string" ? c.content : (Array.isArray(c.content) ? c.content.map((x) => x && x.text || "").join(" ") : JSON.stringify(c.content || ""));
              if (txt) errosFerramenta.push(String(txt).slice(0, 400));
              if (chave) emitirFluxo(chave, { tipo: "resultado", ok: false });
            } else if (chave) emitirFluxo(chave, { tipo: "resultado", ok: true });
          }
        }
      }
      if (chave) { const passos = passoDoEvento(ev); if (passos) passos.forEach((p) => emitirFluxo(chave, p)); }
    };
    child.stdout.on("data", (d) => {
      if (!stream) { out += d; return; }
      buf += d; let i;
      while ((i = buf.indexOf("\n")) >= 0) { linha(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => fim({ ok: false, missing: true, err: e.message }));
    child.on("close", (code) => {
      if (stream && buf.trim()) linha(buf); // sobra sem \n
      // rede de segurança: se o CLI não engoliu o modo stream-json (nenhum JSON e
      // saiu com erro), cai pro modo normal — o chat funciona mesmo em CLI antigo.
      if (stream && !viuJSON && code !== 0 && !done) {
        if (chave && processos.get(chave) === child) processos.delete(chave);
        clearTimeout(t);
        return runClaude(prompt, chave, { ...opts, stream: false }).then((v) => { done = true; resolve(v); });
      }
      const texto = stream ? (resultado != null ? resultado : out) : out;
      // junta o stderr do processo + os erros REAIS das ferramentas (a verdade do que travou)
      const errTools = errosFerramenta.length ? "\n[erros de ferramenta]\n" + errosFerramenta.join("\n") : "";
      fim({ ok: code === 0, code, out: texto.trim(), err: (err.slice(-1000) + errTools).trim(), errosFerramenta });
    });
    if (input) { try { child.stdin.write(input); child.stdin.end(); } catch (e) {} }
  });
}
const MOTOR_NOME = { claude: "Claude Code", codex: "Codex (GPT)", gemini: "Gemini (Google)", antigravity: "Antigravity (Agy)" };

/* ===== MODO À PROVA DE SANDBOX: a IA gera o HTML como TEXTO e o Node grava o
   arquivo. Não usa as ferramentas de arquivo do Claude (que o sandbox de conta
   headless bloqueia). É o caminho confiável em qualquer máquina. ===== */
// aprende: se a IA não conseguir gravar via ferramenta (sandbox de conta headless),
// passa a usar direto o modo texto. Persiste num marcador pra não repetir a
// tentativa perdida a cada sessão. Pode ser forçado com ESTUDIO_FORCE_TEXTO=1.
const MARCADOR_TEXTO = path.join(DATA, ".modo-texto");
let cliBloqueiaArquivo = process.env.ESTUDIO_FORCE_TEXTO === "1";
try { if (fs.existsSync(MARCADOR_TEXTO)) cliBloqueiaArquivo = true; } catch (e) {}
function marcarBloqueioArquivo() { cliBloqueiaArquivo = true; try { fs.writeFileSync(MARCADOR_TEXTO, new Date().toISOString()); } catch (e) {} }
function extrairHTML(txt) {
  const s = String(txt || "");
  let m = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let html = m ? m[1].trim() : null;
  if (!html) { const h = s.match(/<!doctype[\s\S]*<\/html>/i) || s.match(/<html[\s\S]*<\/html>/i); if (h) html = h[0].trim(); }
  return (html && /<\/html>|<body/i.test(html)) ? html : null;
}
// Voz da Fábrica no chat: uma designer sênior conversando, não um robô que só
// confirma. (A Isadora pediu: quer que a CLI converse com ela como o Claude do
// Code, e não com respostas secas de uma frase.)
const VOZ_DESIGNER = `Depois de aplicar, CONVERSE comigo em português como uma designer sênior e parceira — não responda seco nem em uma frase só. Em 2 a 5 frases, com tom caloroso e direto: conte o que você mudou e por quê, aponte uma decisão de design que tomou, e, se fizer sentido, sugira um próximo passo ou me faça uma pergunta. Sem jargão e sem enrolação.`;

// roda o motor pedindo o HTML final em texto; grava com o Node em arqRun. Devolve {ok,out}.
async function escreverViaTexto(ctx, arqRun, tarefaTxt, blocoExtra, chave, sesOpts = {}) {
  let atual = ""; try { atual = fs.readFileSync(arqRun, "utf8"); } catch (e) {}
  const p = ctx + `${atual ? "HTML ATUAL da página (edite a PARTIR dele, preservando tudo que o pedido não mandou mudar):\n```html\n" + atual + "\n```\n\n" : ""}${blocoExtra || ""}TAREFA: ${tarefaTxt}
IMPORTANTE: NÃO use ferramentas de arquivo nem terminal — não tente abrir nem gravar arquivos. Responda com o HTML FINAL COMPLETO da página (auto-suficiente: CSS embutido, sem CDN; responsiva) dentro de UM único bloco \`\`\`html ... \`\`\`. ${VOZ_DESIGNER} (esse texto vai FORA do bloco de código.)`;
  const r = await runClaude(p, chave, { stream: true, disallow: ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "Task"], ...sesOpts });
  if (cancelados.has(chave)) return { ok: false, interrompido: true };
  const html = extrairHTML(r.out);
  if (html) {
    try { fs.mkdirSync(path.dirname(arqRun), { recursive: true }); fs.writeFileSync(arqRun, html); }
    catch (e) { return { ok: false, out: r.out, err: "não consegui gravar o arquivo: " + e.message }; }
    const fora = String(r.out || "").replace(/```[\s\S]*?```/g, "").trim();
    return { ok: true, out: fora || "Pronto — apliquei a alteração na página." };
  }
  return { ok: false, out: r.out, err: r.err || "a IA não devolveu o HTML." };
}

// EDIÇÃO CIRÚRGICA à prova de sandbox: pra páginas com base (grandes inclusive), a IA
// devolve só os trechos a trocar (buscar->trocar) num JSON pequeno, e o NODE aplica.
// Rápido e fiel. Se não houver base, ou se falhar, cai pro reescrever completo.
async function editarViaTexto(ctx, arqRun, tarefaTxt, blocoExtra, chave, sesOpts = {}) {
  let atual = ""; try { atual = fs.readFileSync(arqRun, "utf8"); } catch (e) {}
  if (!atual.trim()) return escreverViaTexto(ctx, arqRun, tarefaTxt, blocoExtra, chave, sesOpts);
  const p = ctx + `Você vai EDITAR a página HTML abaixo aplicando SÓ o que o pedido manda e preservando todo o resto.
HTML ATUAL:
\`\`\`html
${atual}
\`\`\`
${blocoExtra || ""}PEDIDO: ${tarefaTxt}

Responda APENAS com um JSON válido (sem markdown, sem texto fora do JSON), no formato:
{"edicoes":[{"buscar":"<trecho EXATO e único do HTML atual>","trocar":"<novo trecho>"}],"resumo":"<2 a 5 frases, em tom de designer sênior conversando comigo: o que mudou, por quê, uma decisão de design e, se couber, um próximo passo>"}
Regras: cada "buscar" deve ser um trecho EXATO e único do HTML atual (copie caractere por caractere, com aspas e espaços). Pra inserir algo novo, use como "buscar" um trecho existente e repita-o dentro de "trocar" junto com a adição. Não invente trechos. NÃO use ferramentas de arquivo nem terminal.`;
  const r = await runClaude(p, chave, { stream: true, disallow: ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "Task"], ...sesOpts });
  if (cancelados.has(chave)) return { ok: false, interrompido: true };
  let obj = null; try { const m = (r.out || "").match(/\{[\s\S]*\}/); obj = m ? JSON.parse(m[0]) : null; } catch (e) {}
  if (!obj || !Array.isArray(obj.edicoes) || !obj.edicoes.length) return escreverViaTexto(ctx, arqRun, tarefaTxt, blocoExtra, chave);
  let novo = atual, aplicadas = 0; const faltou = [];
  for (const e of obj.edicoes) {
    if (!e || typeof e.buscar !== "string" || !e.buscar) continue;
    if (novo.includes(e.buscar)) { novo = novo.replace(e.buscar, () => String(e.trocar == null ? "" : e.trocar)); aplicadas++; }
    else faltou.push(e.buscar.slice(0, 40));
  }
  if (aplicadas === 0) return escreverViaTexto(ctx, arqRun, tarefaTxt, blocoExtra, chave); // não casou nada -> reescreve tudo
  try { fs.writeFileSync(arqRun, novo); } catch (e) { return { ok: false, out: r.out, err: "não consegui gravar: " + e.message }; }
  return { ok: true, out: (obj.resumo || "Apliquei a alteração.") + (faltou.length ? ` (aviso: ${faltou.length} trecho(s) não encontrado(s))` : "") };
}

/* ===== IMPORTAR PÁGINA DO GITHUB (ou URL): o Node baixa o HTML e semeia o projeto.
   Converte links github.com/.../blob/... pro raw. ===== */
function githubRaw(u) {
  const s = String(u || "").trim();
  let m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  return s; // já é raw ou outra URL http(s)
}
function primeiraURL(txt) { const m = String(txt || "").match(/https?:\/\/[^\s)>\]]+/i); return m ? m[0] : null; }
function baixarTexto(url) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith("http://") ? require("http") : https;
      const req = lib.get(url, { headers: { "User-Agent": "FabricaLPs" }, timeout: 20000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(baixarTexto(res.headers.location)); }
        if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, status: res.statusCode }); }
        let d = ""; res.setEncoding("utf8"); res.on("data", (c) => (d += c)); res.on("end", () => resolve({ ok: true, texto: d }));
      });
      req.on("error", (e) => resolve({ ok: false, erro: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, erro: "timeout" }); });
    } catch (e) { resolve({ ok: false, erro: e.message }); }
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

/* ---------------- editor "na página viva" ----------------
 * Serve a PÁGINA REAL (o index.html do projeto, com Tailwind/GSAP/tudo) num
 * iframe editável, SEM passar por parser estranho (o GrapesJS destruía as
 * páginas Tailwind+GSAP da Isadora — testado). A ideia:
 *  - Tailwind continua rodando (estilo aparece), mas os <script> que MEXEM no
 *    DOM (GSAP, ScrollTrigger, embeds) ficam desligados enquanto edita, pra não
 *    sujar a página com estilos inline de animação nem esconder conteúdo.
 *  - A pessoa clica, edita texto, move blocos entre irmãos (sem quebrar o fluxo)
 *    e remove/duplica. Ao salvar, o controlador serializa só o <body> limpo e
 *    manda pro pai, que junta com o <head> ORIGINAL (verbatim) e grava pelo Node
 *    (endpoint /api/projeto/salvar-fonte — nunca passa pelo CLI/sandbox).
 */
const EDITOR_VIVO_JS = `
(function(){
  var PARENT_OK = true;
  var sel = null;
  function post(m){ try{ parent.postMessage(Object.assign({fonte:'editor-vivo'},m),'*'); }catch(e){} }

  // 1) revela conteúdo que a animação (GSAP) deixaria escondido no estado inicial,
  //    só pra edição — é reversível (classe __edshow removida ao salvar).
  function revelar(){
    var todos = document.body.querySelectorAll('*');
    for (var i=0;i<todos.length;i++){
      var el=todos[i]; if(el.hasAttribute('data-ed'))continue;
      var cs=getComputedStyle(el);
      if((parseFloat(cs.opacity)||1)<0.06 || cs.visibility==='hidden'){ el.classList.add('__edshow'); }
    }
  }

  // 2) trava navegação/formulários enquanto edita
  document.addEventListener('click',function(e){
    var a=e.target.closest && e.target.closest('a,button,[type=submit]');
    if(a){ e.preventDefault(); }
  },true);
  document.addEventListener('submit',function(e){ e.preventDefault(); },true);

  // 3) seleção
  function limpar(){ if(sel){sel.classList.remove('__edsel'); sel.removeAttribute('contenteditable');} sel=null; barra.style.display='none'; }
  function selecionar(el){
    if(!el||el===document.body||el.hasAttribute('data-ed'))return;
    if(sel)sel.classList.remove('__edsel');
    sel=el; sel.classList.add('__edsel'); posBarra(); barra.style.display='flex';
  }
  document.addEventListener('mouseover',function(e){ if(e.target.hasAttribute&&e.target.hasAttribute('data-ed'))return; if(e.target.classList){e.target.classList.add('__edhov');} },true);
  document.addEventListener('mouseout',function(e){ if(e.target.classList){e.target.classList.remove('__edhov');} },true);
  document.addEventListener('click',function(e){
    if(e.target.hasAttribute&&e.target.hasAttribute('data-ed'))return;
    selecionar(e.target);
  },false);

  // 4) barra flutuante de ações
  var barra=document.createElement('div'); barra.setAttribute('data-ed','1');
  barra.style.cssText='position:absolute;z-index:2147483000;display:none;gap:4px;background:#12040c;border:1px solid #3a1226;border-radius:10px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:600 12px/1 Inter,system-ui,sans-serif';
  function botao(txt,fn,cor){ var b=document.createElement('button'); b.setAttribute('data-ed','1'); b.textContent=txt;
    b.style.cssText='border:0;border-radius:7px;padding:6px 9px;color:#fff;cursor:pointer;background:'+(cor||'#7a1540'); b.onclick=function(ev){ev.stopPropagation();fn();}; return b; }
  function posBarra(){ if(!sel)return; var r=sel.getBoundingClientRect();
    var top=(window.scrollY+r.top-40); if(top<window.scrollY+4)top=window.scrollY+r.bottom+6;
    barra.style.top=top+'px'; barra.style.left=(window.scrollX+r.left)+'px'; }
  var bTexto=botao('✎ Texto',function(){ if(!sel)return;
      if(sel.getAttribute('contenteditable')==='true'){ sel.removeAttribute('contenteditable'); bTexto.textContent='✎ Texto'; }
      else { sel.setAttribute('contenteditable','true'); sel.focus(); bTexto.textContent='✓ Ok'; } });
  barra.appendChild(bTexto);
  barra.appendChild(botao('↑',function(){ if(sel&&sel.previousElementSibling){ sel.parentNode.insertBefore(sel,sel.previousElementSibling); posBarra(); } }));
  barra.appendChild(botao('↓',function(){ if(sel&&sel.nextElementSibling){ sel.parentNode.insertBefore(sel.nextElementSibling,sel); posBarra(); } }));
  barra.appendChild(botao('⧉ Duplicar',function(){ if(sel){ var c=sel.cloneNode(true); c.classList.remove('__edsel'); sel.parentNode.insertBefore(c,sel.nextElementSibling); } }));
  barra.appendChild(botao('🗑 Remover',function(){ if(sel){ var el=sel; limpar(); el.remove(); } },'#b3204a'));
  document.body.appendChild(barra);
  window.addEventListener('scroll',posBarra,true);

  // 5) arrastar pra reordenar ENTRE IRMÃOS (fica no fluxo, não quebra o layout)
  var arr=null;
  barra.addEventListener('mousedown',function(){},true);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')limpar(); });

  // 6) serializar só o body, limpo, com os <script> restaurados
  function serializarBody(){
    var clone=document.body.cloneNode(true);
    // restaura <script> desligados
    var offs=clone.querySelectorAll('script[data-ed-off]');
    for(var i=0;i<offs.length;i++){ var s=offs[i]; try{ var orig=decodeURIComponent(s.getAttribute('data-ed-off'));
      var tmp=document.createElement('div'); tmp.innerHTML=orig; if(tmp.firstChild) s.parentNode.replaceChild(tmp.firstChild,s); }catch(e){} }
    // tira tudo do editor
    var eds=clone.querySelectorAll('[data-ed]'); for(var j=0;j<eds.length;j++){ eds[j].remove(); }
    var lixo=clone.querySelectorAll('.__edsel,.__edhov,.__edshow');
    for(var k=0;k<lixo.length;k++){ lixo[k].classList.remove('__edsel','__edhov','__edshow'); if(!lixo[k].getAttribute('class'))lixo[k].removeAttribute('class'); }
    var edit=clone.querySelectorAll('[contenteditable]'); for(var l=0;l<edit.length;l++){ edit[l].removeAttribute('contenteditable'); }
    return clone.innerHTML;
  }

  window.addEventListener('message',function(ev){
    var m=ev.data||{}; if(m.fonte!=='estudio-vivo')return;
    if(m.t==='salvar'){ limpar(); post({t:'html', bodyHTML: serializarBody()}); }
  });

  revelar(); post({t:'pronto'});
})();
`;
const EDITOR_VIVO_CSS = "\n.__edhov{outline:1px dashed rgba(255,45,139,.55)!important;outline-offset:1px;cursor:pointer}\n.__edsel{outline:2px solid #ff2d8b!important;outline-offset:1px}\n.__edshow{opacity:1!important;visibility:visible!important;transform:none!important}\n[contenteditable=true]{cursor:text}\n";

/** Prepara o HTML da página real pra edição ao vivo:
 *  - <base> pra resolver assets relativos dentro do preview;
 *  - desliga os <script> que mexem no DOM (menos o Tailwind), guardando o
 *    original em data-ed-off pra restaurar ao salvar;
 *  - injeta o CSS e o controlador do editor. */
function servirEditorVivo(html, id) {
  html = String(html).replace(/<head([^>]*)>/i, `<head$1><base href="/preview/${id}/" data-ed="1">`);
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs) => {
    if (/tailwind/i.test(attrs)) return m;                 // Tailwind PRECISA rodar (estilo)
    return `<script type="application/x-ed-off" data-ed-off="${encodeURIComponent(m)}" data-ed="1">/*off*/</script>`;
  });
  const inj = `<style data-ed="1">${EDITOR_VIVO_CSS}</style><script data-ed="1">${EDITOR_VIVO_JS}<\/script>`;
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, inj + "</body>");
  else html += inj;
  return html;
}

/* Rede de segurança: um erro solto (ex.: ler um arquivo que na verdade é uma
 * pasta) NUNCA deve derrubar a Fábrica inteira e deixar tudo em branco. */
process.on("uncaughtException", (e) => { try { console.error("[fabrica] erro não tratado:", (e && e.stack) || e); } catch (x) {} });
process.on("unhandledRejection", (e) => { try { console.error("[fabrica] promessa rejeitada:", (e && e.stack) || e); } catch (x) {} });

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

  // data de entrega estimada (previsão que o cliente vê no acompanhamento)
  if (p === "/api/projetos/entrega" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    const v = String(b.dataEntrega || "").slice(0, 10);
    s.dataEntrega = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    writeDB(d); return json(res, 200, { ok: true, dataEntrega: s.dataEntrega || "" });
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

  /* código-fonte da página (pra inspecionar/baixar no Estúdio) */
  if (p === "/api/projeto/fonte" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!db().projetos.find((x) => x.id === id)) return json(res, 404, { ok: false });
    let html = ""; try { html = fs.readFileSync(siteFile(id), "utf8"); } catch (e) {}
    return json(res, 200, { ok: true, html, bytes: Buffer.byteLength(html) });
  }

  // Salvar o HTML editado NA MÃO (editor "na página viva"). O Node grava direto —
  // sem CLI, sem sandbox: nunca é bloqueado. Antes de gravar, guarda um backup da
  // versão anterior (pra dar pra desfazer se a edição sair torta).
  if (p === "/api/projeto/salvar-fonte" && req.method === "POST") {
    const b = await body(req);
    const id = b.id;
    if (!db().projetos.find((x) => x.id === id)) return json(res, 404, { ok: false, erro: "projeto não encontrado" });
    const html = typeof b.html === "string" ? b.html : "";
    // salvaguarda: HTML precisa parecer uma página inteira (não um pedaço solto)
    if (html.length < 200 || !/<\/html>/i.test(html) || !/<body[\s>]/i.test(html)) {
      return json(res, 400, { ok: false, erro: "html incompleto — não vou gravar pra não quebrar a página" });
    }
    const arq = siteFile(id);
    let versao = null;
    try {
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      if (fs.existsSync(arq)) { try { fs.copyFileSync(arq, arq + ".bak"); } catch (e) {} }
      fs.writeFileSync(arq, html);
      // registra como versão (mesma rotina do chat): reimporta o HTML pra blocos
      // e cria um ponto de restauração no histórico.
      versao = sincronizarDoHTML(id, "editou na página");
    } catch (e) {
      return json(res, 500, { ok: false, erro: String(e.message || e) });
    }
    return json(res, 200, { ok: true, bytes: Buffer.byteLength(html), versao });
  }

  if (p === "/api/projeto" && req.method === "GET") {
    const id = url.searchParams.get("id");
    const s = db().projetos.find((x) => x.id === id); if (!s) return json(res, 404, { ok: false });
    const pr = readProj(id);
    marcarUltimoProjeto(s.id, s.proj);
    if (!Array.isArray(pr.docs)) pr.docs = [];
    // migração: rascunho .md antigo vira documento; docs com md inline viram arquivo
    let mud = false;
    if (pr.md) { pr.docs.push({ id: "doc" + Date.now().toString(36), titulo: "Anotações", ts: new Date().toISOString(), md: pr.md }); delete pr.md; mud = true; }
    for (const dc of pr.docs) { if (dc.md !== undefined) { fs.mkdirSync(docsDir(id), { recursive: true }); try { fs.writeFileSync(docFile(id, dc.id), dc.md); } catch (e) {} delete dc.md; mud = true; } }
    if (mud) writeProj(id, pr);
    const docs = pr.docs.map((dc) => ({ id: dc.id, titulo: dc.titulo, ts: dc.ts, md: lerDoc(id, dc.id) }));
    return json(res, 200, { ...s, blocos: pr.blocos, comentarios: pr.comentarios, chat: pr.chat || [], docs,
      artefatos: listarArtefatos(id),
      versoes: lerVersoes(id).map(({ v, ts, motivo, autor }) => ({ v, ts, motivo, autor })) });
  }
  /* artefatos de apoio do projeto (wireframes, protótipos, diagramas) */
  if (p === "/api/projeto/artefatos" && req.method === "GET") {
    const id = url.searchParams.get("id");
    if (!db().projetos.find((x) => x.id === id)) return json(res, 404, { ok: false });
    return json(res, 200, { ok: true, artefatos: listarArtefatos(id) });
  }
  if (p === "/api/projeto/artefato/excluir" && req.method === "POST") {
    const b = await body(req);
    const dir = artefatosDir(b.id);
    const f = path.join(dir, path.basename(String(b.arte || "")));
    if (f.startsWith(dir)) { try { fs.rmSync(f, { force: true }); } catch (e) {} }
    return json(res, 200, { ok: true, artefatos: listarArtefatos(b.id) });
  }
  /* documentos (markdown) do projeto — guardados como ARQUIVOS (a IA escreve neles) */
  if (p === "/api/projeto/doc" && req.method === "POST") {
    const b = await body(req); const pr = readProj(b.id); if (!Array.isArray(pr.docs)) pr.docs = [];
    let doc = b.docId ? pr.docs.find((x) => x.id === b.docId) : null;
    if (!doc) { doc = { id: "doc" + Date.now().toString(36), titulo: "", ts: new Date().toISOString() }; pr.docs.push(doc); }
    if (b.titulo !== undefined) doc.titulo = String(b.titulo).slice(0, 120);
    if (!doc.titulo) doc.titulo = "Sem título";
    fs.mkdirSync(docsDir(b.id), { recursive: true });
    if (b.md !== undefined) { try { fs.writeFileSync(docFile(b.id, doc.id), String(b.md).slice(0, 200000)); } catch (e) {} }
    writeProj(b.id, pr);
    return json(res, 200, { ok: true, doc: { id: doc.id, titulo: doc.titulo, md: lerDoc(b.id, doc.id) } });
  }
  if (p === "/api/projeto/doc/excluir" && req.method === "POST") {
    const b = await body(req); const pr = readProj(b.id);
    pr.docs = (pr.docs || []).filter((x) => x.id !== b.docId); writeProj(b.id, pr);
    try { fs.rmSync(docFile(b.id, b.docId), { force: true }); } catch (e) {}
    return json(res, 200, { ok: true });
  }
  /* a IA cria/edita um documento escrevendo no arquivo (autonomia: ela mexe no ambiente) */
  if (p === "/api/doc/ia" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    if (!(b.texto || "").trim()) return json(res, 400, { ok: false, erro: "descreva o que quer no documento" });
    const pr = readProj(b.id); if (!Array.isArray(pr.docs)) pr.docs = [];
    fs.mkdirSync(docsDir(b.id), { recursive: true });
    let doc = b.docId ? pr.docs.find((x) => x.id === b.docId) : null;
    const criar = !doc;
    if (!doc) { doc = { id: "doc" + Date.now().toString(36), titulo: "Novo documento", ts: new Date().toISOString() }; pr.docs.push(doc); writeProj(b.id, pr); }
    const arq = docFile(b.id, doc.id);
    const atual = lerDoc(b.id, doc.id);
    const ctx = contextoChat(pr);
    const prompt = ctx + `Você cuida de um DOCUMENTO em Markdown do projeto, salvo no arquivo ${arq}.
${atual ? `Conteúdo atual:\n"""\n${atual.slice(0, 12000)}\n"""\n` : "O documento ainda está vazio.\n"}
Pedido da Isadora: ${b.texto}
${(criar || !atual) ? "Crie o documento" : "Atualize o documento"} escrevendo o Markdown final COMPLETO no arquivo ${arq} (comece com um título "# ..."). Não crie nem altere nenhum outro arquivo. Ao terminar, responda em UMA frase curta o que você fez.`;
    const r = await runClaude(prompt, "chat:" + b.id);
    if (cancelados.has("chat:" + b.id)) { cancelados.delete("chat:" + b.id); if (criar) { const p2 = readProj(b.id); p2.docs = (p2.docs || []).filter((x) => x.id !== doc.id); writeProj(b.id, p2); try { fs.rmSync(arq, { force: true }); } catch (e) {} } return json(res, 200, { ok: false, interrompido: true }); }
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando do motor não encontrado." });
    const md = lerDoc(b.id, doc.id);
    if (!md.trim()) { if (criar) { const p2 = readProj(b.id); p2.docs = (p2.docs || []).filter((x) => x.id !== doc.id); writeProj(b.id, p2); } return json(res, 200, { ok: false, erro: "o motor não escreveu o documento.", detalhe: (r.out || "") + "\n" + (r.err || "") }); }
    const tituloM = md.match(/^#\s+(.+)$/m); const titulo = (tituloM ? tituloM[1] : b.texto).slice(0, 80);
    const p3 = readProj(b.id); const dd = (p3.docs || []).find((x) => x.id === doc.id); if (dd) { dd.titulo = titulo; writeProj(b.id, p3); }
    registrarChat(b.id, [{ who: "me", html: b.texto }, { who: "ai", html: "📄 " + (criar ? "Criei" : "Atualizei") + " o documento: " + titulo }]);
    aprenderDaConversa(b.texto, "Documento: " + titulo, s.proj); // aprende em segundo plano
    return json(res, 200, { ok: true, doc: { id: doc.id, titulo, md }, criado: criar, resposta: r.out || ("📄 " + (criar ? "Criei" : "Atualizei") + " o documento **" + titulo + "**.") });
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
    const memN = memoriaTexto();
    const prompt = `Você é o motor de geração da Fábrica de LPs.
Leia o template em ${path.join(tplDir, "template.html")} e o manifesto em ${path.join(tplDir, "template.json")}.
Dados do cliente: ${JSON.stringify(s, null, 2)}
${memN ? `\nMEMÓRIA GERAL (preferências da Isadora, valem pra todos os projetos):\n"""\n${memN.slice(0, 2000)}\n"""\n` : ""}${brief ? `\nBRIEFING (use como fonte principal do conteúdo — copy, seções e ofertas devem sair daqui):\n"""\n${brief}\n"""\n` : ""}
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

  /* ---- fluxo AO VIVO do chat (SSE): a página abre isto antes de mandar o pedido,
     e recebe os passos da IA (lendo, editando, rodando) em tempo real ---- */
  if (p === "/api/chat/stream" && req.method === "GET") {
    const id = url.searchParams.get("id"); if (!id) { res.writeHead(400); return res.end(); }
    const chave = "chat:" + id;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    assinarFluxo(chave, res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20000);
    req.on("close", () => { clearInterval(ping); desassinarFluxo(chave, res); });
    return; // fica aberta
  }

  /* ---- chat com modos (A5) ---- */
  if (p === "/api/chat" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id); if (!s) return json(res, 404, { ok: false });
    const arq = siteFile(s.id);
    const existe = fs.existsSync(arq);
    const modo = b.modo || "design";
    const anexos = Array.isArray(b.anexos) ? b.anexos.filter((a) => a && a.url) : [];
    // skill(s) "etiquetada(s)" na mensagem (opcional): viram o(s) MÉTODO(s) a seguir.
    // Pode ser várias — todas se aplicam juntas.
    const skIds = Array.isArray(b.skillIds) ? b.skillIds : (b.skillId ? [b.skillId] : []);
    const sksAtivas = skIds.length ? listSkills().filter((x) => skIds.includes(x.id) && !x.acao) : [];
    const skRef = sksAtivas.some((sk) => /refer[êe]ncia|reproduz|image.?to.?code|movimento|design/i.test((sk.nome || "") + " " + (sk.descricao || "")));
    const metodoTxt = sksAtivas.length ? `\nMÉTODO(S)/rotina(s) a seguir nesta tarefa${sksAtivas.length > 1 ? " (aplique TODAS, em conjunto e na ordem)" : ""}:\n${sksAtivas.map((sk, i) => `${i + 1}. Skill "${sk.nome}": ${sk.instrucoes}`).join("\n")}\n` : "";
    // Prepara os anexos: cópia local (fora do Drive) + distingue referência de conteúdo.
    const anx = prepararAnexos(s.id, anexos, { referencia: ehReferencia(b.texto) || skRef });
    const anxLocalDir = anx.anxLocalDir;
    const anexosTxt = anx.txt;
    const ctx = contextoChat(readProj(s.id)); // memória geral + conversa até agora
    marcarUltimoProjeto(s.id, s.proj);
    // FASE B: no design, a IA trabalha numa CÓPIA LOCAL da pasta do projeto (fora do Drive).
    const freedomDesign = (modo === "design");
    const workDir = freedomDesign ? hidratarLocal(s.id) : path.join(SITES, s.id);
    const arqRun = freedomDesign ? path.join(workDir, "index.html") : arq;
    const artDir = freedomDesign ? path.join(workDir, "artefatos") : artefatosDir(s.id);
    if (modo === "design") { try { fs.mkdirSync(artDir, { recursive: true }); } catch (e) {} }
    const artesAntes = new Set(listarArtefatos(s.id).map((a) => a.id));
    const artefatosTxt = `\nSe (e SÓ se) você produzir um ARTEFATO DE APOIO — um wireframe em SVG, um protótipo/componente HTML isolado, um diagrama, um trecho de código — que não é a página final, salve-o como um arquivo dentro da pasta ${artDir} (crie a pasta se precisar). Dê um nome claro com a extensão certa (ex.: wireframe-hero.svg, prototipo.html). Isso faz o artefato abrir numa aba própria de visualização no Estúdio. A página final continua sendo ${arqRun}.\n`;
    // ===== PERGUNTAR / PLANO: só responde, não mexe em arquivo =====
    if (modo === "perguntar" || modo === "plan") {
      const prompt = ctx + (modo === "perguntar"
        ? `Responda em português, de forma curta e direta. NÃO modifique nenhum arquivo — apenas responda.\n${existe ? `Contexto: a landing page do cliente está em ${arq}.` : ""}\nPergunta: ${b.texto}`
        : `Faça um PLANO em português, em tópicos curtos, do que você mudaria. NÃO modifique nenhum arquivo — apenas descreva o plano.\n${existe ? `A landing page está em ${arq}.` : ""}\nPedido: ${b.texto}`);
      emitirFluxo("chat:" + s.id, { tipo: "inicio" });
      const rq = await runClaude(prompt, "chat:" + s.id, { stream: true });
      emitirFluxo("chat:" + s.id, { tipo: "fim", ok: rq.ok });
      if (cancelados.has("chat:" + s.id)) { cancelados.delete("chat:" + s.id); return json(res, 200, { ok: false, interrompido: true, erro: "interrompido" }); }
      if (rq.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
      registrarChat(s.id, [{ who: "me", html: b.texto }, { who: "ai", html: rq.out || "(sem resposta)" }]);
      return json(res, 200, { ok: rq.ok, resposta: rq.out || "(sem resposta)", modo, versao: null, artefatos: [], artefatosNovos: [], detalhe: rq.err });
    }

    // ===== DESIGN: cria/edita a página do projeto =====
    // MEMÓRIA por projeto: sessão persistente do CLI (continua de onde parou).
    const ses = sessaoCli(s.id);
    const sesOpts = { sessionId: ses.id, resume: ses.resume };
    const ctxD = contextoChat(readProj(s.id), { resumindo: ses.resume && capacidadesClaude().resume });
    // IMPORTAR do GitHub/URL: se o pedido traz um link de página, o Node baixa e semeia
    let importou = null;
    { const u = primeiraURL(b.texto);
      if (u && /(\.html?($|\?))|\/blob\/|raw\.githubusercontent/i.test(u)) {
        emitirFluxo("chat:" + s.id, { tipo: "acao", icone: "web", texto: "Baixando a página do seu repositório" });
        const dl = await baixarTexto(githubRaw(u));
        if (dl.ok && /<html|<!doctype/i.test(dl.texto || "")) { try { fs.mkdirSync(path.dirname(arqRun), { recursive: true }); fs.writeFileSync(arqRun, dl.texto); importou = u; } catch (e) {} }
      }
    }
    let htmlAntes = ""; try { htmlAntes = fs.readFileSync(arqRun, "utf8"); } catch (e) {}
    const temBase = !!htmlAntes.trim();
    const tarefaBase = b.texto || "(siga o método/rotina e a referência acima)";
    const tarefaTxt = importou ? `A página do repositório já está carregada. ${tarefaBase}` : tarefaBase;
    const blocoExtra = metodoTxt + anexosTxt;

    emitirFluxo("chat:" + s.id, { tipo: "inicio" });
    let r;
    if (cliBloqueiaArquivo) {
      // já aprendemos que a máquina bloqueia gravação por ferramenta -> vai direto ao modo texto
      r = await editarViaTexto(ctxD, arqRun, tarefaTxt, blocoExtra, "chat:" + s.id, sesOpts);
    } else {
      const dirsChat = []; if (anexos.length) dirsChat.push(anxLocalDir);
      const promptAg = ctxD + `Você é a IA de design da Fábrica de LPs, trabalhando na pasta local deste projeto (${workDir}). Leia o que precisar (Read/Glob/Grep) e ${temBase ? "edite" : "crie"} a página. Não use terminal/Bash.
TAREFA: ${tarefaTxt}
${blocoExtra}${artefatosTxt}A PÁGINA FINAL é ${arqRun} — auto-suficiente (CSS embutido, sem CDN), responsiva. ${VOZ_DESIGNER}`;
      r = await runClaude(promptAg, "chat:" + s.id, { stream: true, freedom: true, cwd: workDir, addDirs: dirsChat, disallow: ["Bash"], ...sesOpts });
      let htmlDepois = ""; try { htmlDepois = fs.readFileSync(arqRun, "utf8"); } catch (e) {}
      if (!r.interrompido && r.ok && htmlDepois === htmlAntes) {
        // o sandbox bloqueou a gravação por ferramenta -> aprende (persiste) e grava pelo modo texto
        marcarBloqueioArquivo();
        emitirFluxo("chat:" + s.id, { tipo: "acao", icone: "write", texto: "Gravando a página (modo à prova de sandbox)" });
        r = await editarViaTexto(ctxD, arqRun, tarefaTxt, blocoExtra, "chat:" + s.id, sesOpts);
      }
    }
    // memória: se a sessão de resume falhou, zera pra recriar do zero na próxima
    if (ses.resume && !r.ok && !r.interrompido) resetarSessaoCli(s.id);
    devolverLocal(s.id); // devolve pro Drive o que foi gravado
    emitirFluxo("chat:" + s.id, { tipo: "fim", ok: r.ok });
    if (cancelados.has("chat:" + s.id) || r.interrompido) { cancelados.delete("chat:" + s.id); return json(res, 200, { ok: false, interrompido: true, erro: "interrompido" }); }
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    let versao = null, criou = false;
    if (r.ok && fs.existsSync(arq)) {
      versao = sincronizarDoHTML(s.id, (existe ? "chat: " : "criada no chat: ") + String(b.texto).slice(0, 60));
      if (!existe) { s.generated = true; if (s.status === "new") s.status = "rev"; writeDB(d); criou = true; }
    }
    registrarChat(s.id, [{ who: "me", html: (sksAtivas.length ? "⚡ " + sksAtivas.map((x) => x.nome).join(" + ") + ": " : "") + b.texto }, { who: "ai", html: r.out || "(sem resposta)" }]);
    if (r.ok && (modo === "design")) aprenderDaConversa(b.texto, r.out, s.proj); // aprende em segundo plano
    if (r.ok) for (const sk of sksAtivas) { if (sk.origem) continue; try { const at = listSkills().find((x) => x.id === sk.id); if (at && !at.origem) { at.usos = (at.usos || 0) + 1; fs.writeFileSync(path.join(SKILLS, at.id + ".json"), JSON.stringify(at, null, 2) + "\n"); } } catch (e) {} }
    const artefatos = modo === "design" ? listarArtefatos(s.id) : [];
    const artefatosNovos = artefatos.filter((a) => !artesAntes.has(a.id)).map((a) => a.id);
    // se o design não mudou a página E houve erro de ferramenta, mostra o erro REAL
    let resposta = r.out || "(sem resposta)";
    const semMudanca = (modo === "design" && r.ok && !versao && !artefatosNovos.length);
    if (semMudanca && (r.errosFerramenta || []).length) {
      resposta += "\n\n⚠️ Nenhuma alteração foi salva. Erro real da ferramenta:\n" + r.errosFerramenta.join("\n");
    }
    return json(res, 200, { ok: r.ok, resposta, modo, versao, criou, generated: s.generated,
      artefatos, artefatosNovos,
      preview: (modo === "design" && versao) ? "/preview/" + s.id + "?t=" + Date.now() : null, detalhe: r.err });
  }
  if (p === "/api/chat/cancelar" && req.method === "POST") {
    const b = await body(req); const chave = "chat:" + b.id; const c = processos.get(chave);
    cancelados.add(chave);
    if (c) { matarProcesso(c); processos.delete(chave); return json(res, 200, { ok: true }); }
    return json(res, 200, { ok: false });
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
Mudanças:\n${itens}\nSalve no mesmo arquivo. ${VOZ_DESIGNER}`;
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
    const alvo = lerVersoes(b.id).find((x) => x.v === Number(b.v));
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
  // limpa vários (ou todos) de uma vez — UMA gravação só, em vez de centenas
  // (foi o que travou a Fábrica com 300 comentários).
  if (p === "/api/comentarios/limpar" && req.method === "POST") {
    const b = await body(req);
    const pr = readProj(b.id);
    const antes = (pr.comentarios || []).length;
    if (Array.isArray(b.ids) && b.ids.length) { const rem = new Set(b.ids); pr.comentarios = pr.comentarios.filter((x) => !rem.has(x.id)); }
    else if (b.so === "resolvidos") pr.comentarios = pr.comentarios.filter((x) => x.estado !== "resolvido");
    else pr.comentarios = [];
    writeProj(b.id, pr);
    return json(res, 200, { ok: true, removidos: antes - pr.comentarios.length, comentarios: pr.comentarios });
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
    if (listTemplates().length <= 1) return json(res, 400, { ok: false, erro: "é o seu único template — mantenha ao menos um pra poder gerar páginas." });
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

  /* ============ Mídia do projeto (imagens/vídeos pra usar na LP) ============ */
  if (p === "/api/midia" && req.method === "GET") {
    const id = url.searchParams.get("id"); const dir = assetsDir(id);
    if (!id || !fs.existsSync(dir)) return json(res, 200, []);
    const itens = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).map((f) => {
      const st = fs.statSync(path.join(dir, f)); const ext = path.extname(f).toLowerCase();
      const video = [".mp4", ".webm", ".mov", ".ogg", ".m4v"].includes(ext);
      return { nome: f, url: "assets/" + f, previewUrl: "/preview/" + id + "/assets/" + f,
        tipo: video ? "video" : "imagem", tamanho: st.size, criadoEm: st.mtimeMs };
    }).sort((a, b) => b.criadoEm - a.criadoEm);
    return json(res, 200, itens);
  }
  if (p === "/api/midia/upload" && req.method === "POST") {
    const b = await body(req);
    if (!b.projetoId || !b.dataUrl) return json(res, 400, { ok: false, erro: "faltou o arquivo" });
    const m = String(b.dataUrl).match(/^data:([^;,]+)[^,]*,(.*)$/s);
    if (!m) return json(res, 400, { ok: false, erro: "arquivo inválido" });
    const mime = m[1].toLowerCase();
    const extNome = (path.extname(b.nome || "") || "").toLowerCase();
    const DOC_EXTS = [".html", ".htm", ".md", ".markdown", ".svg", ".txt", ".json", ".css", ".js", ".xml", ".csv"];
    let ext, tipo;
    if (DOC_EXTS.includes(extNome)) { ext = extNome === ".htm" ? ".html" : extNome; tipo = "documento"; }
    else if (EXT_MIDIA[mime]) { ext = EXT_MIDIA[mime]; tipo = mime.startsWith("video") ? "video" : "imagem"; }
    else return json(res, 400, { ok: false, erro: "tipo não suportado (imagem, vídeo, HTML, MD, SVG, TXT, JSON, CSS)" });
    let buf; try { buf = Buffer.from(m[2], "base64"); } catch { return json(res, 400, { ok: false, erro: "não consegui ler o arquivo" }); }
    if (buf.length > 60 * 1024 * 1024) return json(res, 400, { ok: false, erro: "arquivo muito grande (máx. 60 MB)" });
    const dir = assetsDir(b.projetoId); fs.mkdirSync(dir, { recursive: true });
    const baseNome = slug((b.nome || "midia").replace(/\.[^.]+$/, "")) || "arquivo";
    let nome = baseNome + ext, n = 1;
    while (fs.existsSync(path.join(dir, nome))) nome = baseNome + "-" + ++n + ext;
    fs.writeFileSync(path.join(dir, nome), buf);
    return json(res, 200, { ok: true, nome, url: "assets/" + nome, previewUrl: "/preview/" + b.projetoId + "/assets/" + nome,
      tipo, tamanho: buf.length });
  }
  if (p === "/api/midia/excluir" && req.method === "POST") {
    const b = await body(req); const f = path.join(assetsDir(b.projetoId), path.basename(b.nome || ""));
    if (f.startsWith(assetsDir(b.projetoId)) && fs.existsSync(f)) fs.rmSync(f, { force: true });
    return json(res, 200, { ok: true });
  }
  /* gerar mídia com as ferramentas da máquina (Magnific via MCP no Claude, ou Gemini CLI).
   * A ferramenta salva o arquivo na pasta assets; a gente detecta o que apareceu de novo. */
  if (p === "/api/midia/gerar" && req.method === "POST") {
    const b = await body(req);
    if (!b.projetoId || !(b.prompt || "").trim()) return json(res, 400, { ok: false, erro: "descreva a imagem/vídeo" });
    const motor = b.motor || "gemini-api";
    const dir = assetsDir(b.projetoId); fs.mkdirSync(dir, { recursive: true });
    const siteDir = path.join(SITES, b.projetoId);
    // referências: arquivos que já estão na pasta assets (pra EDITAR/variar uma imagem)
    const refs = [];
    for (const nomeRef of (Array.isArray(b.refs) ? b.refs : []).slice(0, 3)) {
      const fr = path.join(dir, path.basename(String(nomeRef || "")));
      if (!fr.startsWith(dir) || !fs.existsSync(fr)) continue;
      const ext = path.extname(fr).toLowerCase();
      const mime = Object.keys(EXT_MIDIA).find((k) => EXT_MIDIA[k] === ext && k.startsWith("image")) || "image/png";
      try { refs.push({ mime, base64: fs.readFileSync(fr).toString("base64") }); } catch (e) {}
    }
    // Nano Banana pela API do Gemini: chamada direta (rápida e confiável, sem CLI)
    if (motor === "gemini-api") {
      const g = await gerarGeminiImagem(String(b.prompt).slice(0, 1500), dir, refs);
      if (!g.ok) return json(res, 200, { ok: false, erro: g.erro });
      return json(res, 200, { ok: true, itens: [{ nome: g.nome, url: "assets/" + g.nome, previewUrl: "/preview/" + b.projetoId + "/assets/" + g.nome, tipo: "imagem" }] });
    }
    const antes = new Set(fs.readdirSync(dir));
    const desc = String(b.prompt).slice(0, 1500).replace(/"/g, "'");
    let base, args, input = null;
    if (motor === "antigravity") {
      base = "Agy";
      args = ["-y", "-p", `Gere uma imagem a partir desta descrição: "${desc}". Salve o arquivo de imagem final (png/jpg/webp) NA PASTA ATUAL, com um nome curto em minúsculas com hífens. Não crie subpastas. Ao terminar, responda só com o nome do arquivo.`];
    } else {
      // magnific: Claude Code usando o Magnific pelo MCP
      base = "claude";
      args = ["-p", "--dangerously-skip-permissions", "--add-dir", siteDir];
      input = `Sua única tarefa é GERAR UMA IMAGEM e salvar o arquivo na PASTA ATUAL.
Descrição: "${desc}".
Use a ferramenta do Magnific (servidor MCP) para gerar/upscalar a imagem; depois baixe o resultado e salve como arquivo de imagem (png/jpg/webp) na pasta atual, com um nome curto em minúsculas com hífens. Não crie subpastas nem escreva outros arquivos. Ao terminar, responda só com o nome do arquivo salvo.`;
    }
    const TEMPO = 210000; // corta se travar (imagem sai em segundos)
    if (geradores.has(b.projetoId)) { try { matarProcesso(geradores.get(b.projetoId)); } catch (e) {} }
    const r = await new Promise((resolve) => {
      const opts = { cwd: dir, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] };
      const child = spawnCLI(base, args, opts);
      geradores.set(b.projetoId, child);
      let out = "", err = "", done = false;
      const fim = (v) => { if (done) return; done = true; clearTimeout(t); geradores.delete(b.projetoId); resolve(v); };
      const t = setTimeout(() => { matarProcesso(child); fim({ ok: false, timeout: true, out: out.trim(), err: err.slice(-1500) }); }, TEMPO);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => fim({ ok: false, missing: true, err: e.message }));
      child.on("close", (code) => fim({ ok: code === 0, cancel: code === null, out: out.trim(), err: err.slice(-1500) }));
      if (input) { try { child.stdin.write(input); child.stdin.end(); } catch (e) {} }
    });
    if (r.missing) return json(res, 200, { ok: false, erro: `comando '${base}' não encontrado nesta máquina.` });
    // o que apareceu de novo na pasta?
    const novos = fs.readdirSync(dir).filter((f) => !antes.has(f) && !f.startsWith("."));
    if (r.timeout && !novos.length) return json(res, 200, { ok: false, erro: `passou de ${Math.round(TEMPO / 1000)}s e cancelei — pelo visto o '${base}' não gera imagem desse jeito na sua máquina. Me manda o texto abaixo que eu acerto o comando.`, detalhe: (r.out || "") + "\n" + (r.err || "") });
    if (r.cancel && !novos.length) return json(res, 200, { ok: false, erro: "geração cancelada." });
    if (!novos.length) return json(res, 200, { ok: false, erro: "a ferramenta não salvou nenhum arquivo. Confira se o Magnific/Gemini está configurado.", detalhe: (r.out || "") + "\n" + (r.err || "") });
    const item = novos.map((nome) => {
      const ext = path.extname(nome).toLowerCase();
      const video = [".mp4", ".webm", ".mov", ".ogg", ".m4v"].includes(ext);
      return { nome, url: "assets/" + nome, previewUrl: "/preview/" + b.projetoId + "/assets/" + nome, tipo: video ? "video" : "imagem" };
    });
    return json(res, 200, { ok: true, itens: item, resposta: r.out });
  }
  if (p === "/api/midia/gerar/cancelar" && req.method === "POST") {
    const b = await body(req); const child = geradores.get(b.projetoId);
    if (child) { matarProcesso(child); geradores.delete(b.projetoId); return json(res, 200, { ok: true }); }
    return json(res, 200, { ok: false, erro: "nada rodando" });
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
      origem: antiga.origem || b.origem || "propria", autor: antiga.autor || b.autor || "", fonte: antiga.fonte || b.fonte || "",
      usos: antiga.usos || 0, nativa: antiga.nativa || false, criadaEm: antiga.criadaEm || new Date().toISOString() };
    fs.writeFileSync(path.join(SKILLS, id + ".json"), JSON.stringify(sk, null, 2) + "\n");
    return json(res, 200, { ok: true, skill: sk });
  }

  /* importar a skill de um criador do GitHub (SKILL.md público) */
  if (p === "/api/skills/importar-github" && req.method === "POST") {
    const b = await body(req);
    const cands = candidatosRaw(b.url || "");
    if (!cands.length) return json(res, 400, { ok: false, erro: "cole um link do GitHub (repositório, pasta ou o arquivo SKILL.md)." });
    let corpo = null, fonteRaw = null;
    for (const c of cands) {
      try { const r = await fetchURL(c); if (r.status === 200 && r.body.trim()) { corpo = r.body; fonteRaw = c; break; } } catch (e) {}
    }
    if (!corpo) return json(res, 400, { ok: false, erro: "não achei um SKILL.md nesse link. Confira se o repositório é público e tem o arquivo." });
    const owner = (() => { try { return new URL(b.url).pathname.split("/").filter(Boolean)[0] || ""; } catch { return ""; } })();
    const parsed = parseSkillMd(corpo);
    let id = slug(parsed.nome), n = 1;
    while (fs.existsSync(path.join(SKILLS, id + ".json"))) id = slug(parsed.nome) + "-" + ++n;
    const sk = { id, nome: parsed.nome, descricao: parsed.descricao, icone: "github", escopo: "pagina",
      instrucoes: parsed.instrucoes, origem: "github", autor: owner, fonte: b.url, usos: 0,
      nativa: false, criadaEm: new Date().toISOString() };
    fs.writeFileSync(path.join(SKILLS, id + ".json"), JSON.stringify(sk, null, 2) + "\n");
    return json(res, 200, { ok: true, skill: sk });
  }

  /* a IA transforma um pedido solto (do chat) numa skill reutilizável e limpa */
  if (p === "/api/skills/sugerir" && req.method === "POST") {
    const b = await body(req);
    const txt = (b.texto || "").trim();
    if (!txt) return json(res, 400, { ok: false, erro: "sem texto para organizar" });
    const prompt = `Transforme o pedido abaixo numa "skill" reutilizável, que sirva pra QUALQUER landing page (não só uma específica). Responda SÓ com um JSON válido, sem comentários e sem markdown, exatamente no formato:
{"nome":"...","descricao":"...","instrucoes":"..."}
Regras: nome curto (até 4 palavras); descrição em uma linha; instruções no imperativo, generalizadas, sem citar nome de cliente, números ou dados específicos daquele projeto.

Pedido:
"""
${txt.slice(0, 4000)}
"""`;
    const r = await runClaude(prompt);
    if (r.missing) return json(res, 200, { ok: false, erro: "CLI de IA não encontrado" });
    if (!r.ok) return json(res, 200, { ok: false, erro: "a IA não respondeu agora" });
    let sug = null;
    try { const m = (r.out || "").match(/\{[\s\S]*\}/); sug = m ? JSON.parse(m[0]) : null; } catch (e) {}
    if (!sug || !sug.nome) return json(res, 200, { ok: false, erro: "não consegui organizar automaticamente" });
    return json(res, 200, { ok: true, sugestao: {
      nome: String(sug.nome).slice(0, 80), descricao: String(sug.descricao || "").slice(0, 200),
      instrucoes: String(sug.instrucoes || txt).slice(0, 6000) } });
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
    const criar = !fs.existsSync(arq); // a skill PRECEDE a página: se não existe, ela cria com o método dela
    const ctx = contextoChat(readProj(s.id)); // briefing/memória/conversa do projeto
    // anexos: numa skill de design (referencia-para-lp etc.) a imagem anexada é uma
    // REFERÊNCIA pra recriar — nunca pra embutir como <img>.
    const anexos = Array.isArray(b.anexos) ? b.anexos.filter((a) => a && a.url) : [];
    const skRef = /refer[êe]ncia|reproduz|image.?to.?code|movimento|design/i.test((sk.nome || "") + " " + (sk.descricao || ""));
    const anx = prepararAnexos(s.id, anexos, { referencia: skRef });
    // FASE B: trabalha numa CÓPIA LOCAL da pasta do projeto (fora do Drive)
    const workDir = hidratarLocal(s.id);
    const arqRun = path.join(workDir, "index.html");
    const artDir = path.join(workDir, "artefatos"); try { fs.mkdirSync(artDir, { recursive: true }); } catch (e) {}
    const artesAntes = new Set(listarArtefatos(s.id).map((a) => a.id));
    const artefatosTxt = `\nSe produzir um ARTEFATO DE APOIO (wireframe SVG, protótipo isolado, diagrama), salve-o na pasta ${artDir} com a extensão certa — ele abre numa aba própria no Estúdio.\n`;
    let prompt;
    if (criar) {
      const tplDir = s.tpl ? path.join(TEMPLATES, s.tpl) : null;
      const temTpl = tplDir && fs.existsSync(path.join(tplDir, "template.html"));
      prompt = `Você é a IA de design da Fábrica de LPs, trabalhando COM LIBERDADE na pasta deste projeto (${workDir}). Explore e leia o que precisar (Read/Glob/Grep) e crie/edite os arquivos. Não use terminal/Bash; trabalhe só pelas ferramentas de arquivo.
TAREFA: crie a landing page do projeto seguindo o MÉTODO abaixo como guia principal.
Método/rotina "${sk.nome}": ${sk.instrucoes}
${temTpl ? `Se ajudar, você pode se inspirar no template em ${path.join(tplDir, "template.html")} (opcional).` : ""}
Use o contexto do projeto (briefing/cliente) acima para o conteúdo.
${anx.txt}${artefatosTxt}A PÁGINA FINAL é ${arqRun} — auto-suficiente (CSS embutido, sem CDN), responsiva. ${VOZ_DESIGNER}`;
    } else {
      prompt = `Você é a IA de design da Fábrica de LPs, trabalhando COM LIBERDADE na pasta deste projeto (${workDir}). Explore e leia o que precisar (Read/Glob/Grep) e edite os arquivos. Não use terminal/Bash; trabalhe só pelas ferramentas de arquivo.
TAREFA: aplique a rotina abaixo na landing page do projeto.
Rotina "${sk.nome}": ${sk.instrucoes}
${anx.txt}${artefatosTxt}A landing page é ${arqRun} — mantenha auto-suficiente (CSS embutido, sem CDN). ${VOZ_DESIGNER}`;
    }
    prompt = ctx + prompt;
    emitirFluxo("chat:" + s.id, { tipo: "inicio" });
    const dirsSk = []; if (anx.temAnexo) dirsSk.push(anx.anxLocalDir);
    const r = await runClaude(prompt, "chat:" + s.id, { stream: true, freedom: true, cwd: workDir, addDirs: dirsSk, disallow: ["Bash"] });
    devolverLocal(s.id); // devolve o que a IA produziu pro Drive
    emitirFluxo("chat:" + s.id, { tipo: "fim", ok: r.ok });
    if (cancelados.has("chat:" + s.id)) { cancelados.delete("chat:" + s.id); return json(res, 200, { ok: false, interrompido: true }); }
    if (r.missing) return json(res, 200, { ok: false, erro: "Comando 'claude' não encontrado." });
    let versao = null, criou = false;
    if (r.ok && fs.existsSync(arq)) {
      versao = sincronizarDoHTML(s.id, (criar ? "skill criou: " : "skill: ") + sk.nome);
      if (criar) { s.generated = true; if (s.status === "new") s.status = "rev"; writeDB(d); criou = true; }
    }
    if (r.ok) registrarChat(s.id, [{ who: "me", html: "⚡ Skill: " + sk.nome }, { who: "ai", html: r.out || "Pronto." }]);
    if (r.ok) { try { const at = listSkills().find((x) => x.id === sk.id); if (at && !at.origem) { at.usos = (at.usos || 0) + 1; fs.writeFileSync(path.join(SKILLS, at.id + ".json"), JSON.stringify(at, null, 2) + "\n"); } } catch (e) {} }
    const artefatos = listarArtefatos(s.id);
    const artefatosNovos = artefatos.filter((a) => !artesAntes.has(a.id)).map((a) => a.id);
    return json(res, 200, { ok: r.ok, resposta: r.out, versao, criou, generated: s.generated, artefatos, artefatosNovos,
      preview: "/preview/" + s.id + "?t=" + Date.now(), detalhe: r.err });
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
      versaoAtual: (() => { const _v = lerVersoes(id); return _v.length ? _v[_v.length - 1].v : null; })(),
      gerada: !!(pr.blocos && pr.blocos.length) });
  }
  if (p === "/api/publicar" && req.method === "POST") {
    const b = await body(req);
    if (b.dominio !== undefined) { const pr = readProj(b.id); pr.dominio = (b.dominio || "").trim(); writeProj(b.id, pr); }
    const r = publicarSite(b.id, b.slug);
    if (r.ok && b.enviar !== false) {
      const f = lerConfig().ftp;
      if (f.ativo && f.host) r.envio = await enviarFTP(r.slug, pubDir(r.slug));
    }
    return json(res, 200, r);
  }
  if (p === "/api/memoria" && req.method === "GET") { const m = lerMemoria(); return json(res, 200, { itens: m.itens || [], ultimoProjeto: m.ultimoProjeto || null, autoAprender: m.autoAprender !== false }); }
  if (p === "/api/memoria/config" && req.method === "POST") {
    const b = await body(req); const m = lerMemoria();
    if (b.autoAprender !== undefined) m.autoAprender = !!b.autoAprender;
    salvarMemoria(m); return json(res, 200, { ok: true, autoAprender: m.autoAprender !== false });
  }
  if (p === "/api/memoria/item" && req.method === "POST") {
    const b = await body(req); const m = lerMemoria();
    let it = b.id ? m.itens.find((x) => x.id === b.id) : null;
    if (!it) { it = { id: "m" + Date.now().toString(36), ts: new Date().toISOString() }; m.itens.unshift(it); }
    if (b.titulo !== undefined) it.titulo = String(b.titulo).slice(0, 120);
    if (b.texto !== undefined) it.texto = String(b.texto).slice(0, 3000);
    if (b.categoria !== undefined) it.categoria = String(b.categoria).slice(0, 40);
    if (!(it.texto || "").trim() && !(it.titulo || "").trim()) return json(res, 400, { ok: false, erro: "escreva a memória" });
    salvarMemoria(m); return json(res, 200, { ok: true, item: it });
  }
  if (p === "/api/memoria/item/excluir" && req.method === "POST") {
    const b = await body(req); const m = lerMemoria();
    m.itens = (m.itens || []).filter((x) => x.id !== b.id); salvarMemoria(m);
    return json(res, 200, { ok: true });
  }
  if (p === "/api/pasta" && req.method === "GET") return json(res, 200, { pasta: DATA });
  // quais motores de IA estão instalados nesta máquina
  if (p === "/api/motores" && req.method === "GET") {
    // cada CLI é testada com um LIMITE de tempo: se uma trava no --version
    // (ex.: install quebrada esperando login), ela conta como "não instalada"
    // em vez de deixar a tela "Verificando…" girando pra sempre.
    const testar = (cmd) => new Promise((r) => {
      let feito = false;
      const c = spawnCLI(cmd, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      const fim = (v) => { if (feito) return; feito = true; clearTimeout(t); try { c.kill(); } catch (e) {} r(v); };
      const t = setTimeout(() => fim(false), 7000);
      c.on("error", () => fim(false));
      c.on("close", (code) => fim(code === 0));
    });
    const [claude, codex, gemini, agy] = await Promise.all([testar("claude"), testar("codex"), testar("gemini"), testar("Agy")]);
    return json(res, 200, { claude, codex, gemini, agy, temGemKey: !!lerConfig().geminiKey, ativo: lerIA().motor });
  }
  if (p === "/api/status" && req.method === "GET") {
    let versao = "1.0.0";
    try { versao = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || versao; } catch {}
    const ia = lerIA();
    const base = ia.motor === "codex" ? "codex" : ia.motor === "gemini" ? "gemini" : ia.motor === "antigravity" ? "Agy" : "claude";
    if (!base) return json(res, 200, { versao, claude: false, motor: ia.motor, motorNome: MOTOR_NOME[ia.motor] });
    const c = spawnCLI(base, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", respondeu = false;
    const responder = (extra) => { if (respondeu) return; respondeu = true; clearTimeout(t); try { c.kill(); } catch (e) {} json(res, 200, { versao, motor: ia.motor, motorNome: MOTOR_NOME[ia.motor], ...extra }); };
    const t = setTimeout(() => responder({ claude: false }), 7000); // não trava se o motor não responde
    c.stdout.on("data", (d) => (out += d));
    c.on("error", () => responder({ claude: false }));
    c.on("close", (code) => responder({ claude: code === 0, claudeVersao: out.trim() }));
    return;
  }
  if (p === "/api/config" && req.method === "GET") {
    const c = lerConfig(); const f = c.ftp || {};
    return json(res, 200, { ftp: { ...f, senha: "", temSenha: !!f.senha }, ia: lerIA(), temGemKey: !!c.geminiKey,
      briefingUrl: c.briefingUrl || "", temBriefingToken: !!c.briefingToken });
  }
  if (p === "/api/config/ia" && req.method === "POST") {
    const b = await body(req); const atual = lerConfig();
    const ia = { motor: b.motor || "claude", comando: (b.comando || "").trim() };
    escreverConfig({ ...atual, ia });
    return json(res, 200, { ok: true, ia });
  }
  if (p === "/api/config/gemini" && req.method === "POST") {
    const b = await body(req); const atual = lerConfig();
    if (b.chave !== undefined) atual.geminiKey = String(b.chave).trim();
    escreverConfig(atual);
    return json(res, 200, { ok: true, temGemKey: !!atual.geminiKey });
  }
  // link + senha do briefing (a ponte com o Google Sheets)
  if (p === "/api/config/briefing" && req.method === "POST") {
    const b = await body(req); const atual = lerConfig();
    if (b.url !== undefined) atual.briefingUrl = String(b.url).trim();
    if (b.token !== undefined && b.token !== "") atual.briefingToken = String(b.token).trim();
    escreverConfig(atual);
    return json(res, 200, { ok: true, briefingUrl: atual.briefingUrl || "", temBriefingToken: !!atual.briefingToken });
  }
  // puxa os briefings novos da planilha e cria os cards na fila
  if (p === "/api/briefings/importar" && req.method === "POST") {
    const c = lerConfig();
    const url = (c.briefingUrl || "").trim();
    const token = (c.briefingToken || "").trim();
    if (!url) return json(res, 400, { ok: false, erro: "configure o link do briefing nas Configurações" });
    let briefings = [], detalhe = "";
    try {
      const r = await fetchComCookies(urlCsvDaPlanilha(url));
      detalhe = "HTTP " + r.status + " · " + String(r.body || "").replace(/\s+/g, " ").slice(0, 160);
      briefings = csvParaBriefings(parseCSV(r.body));
    } catch (e) {
      return json(res, 502, { ok: false, erro: "não consegui ler a planilha publicada", detalhe: detalhe || String((e && e.message) || e) });
    }
    if (!briefings.length && /accounts\.google|<!doctype|<html/i.test(detalhe)) {
      return json(res, 502, { ok: false, erro: "esse link não é o CSV publicado (veio uma página web)", detalhe });
    }
    const d = db();
    const jaTem = new Set(d.projetos.map((x) => (x.briefing && x.briefing.chave) || "").filter(Boolean));
    const cores = ["#2563eb", "#db2777", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
    let novos = 0;
    (briefings || []).forEach((br) => {
      const chave = String(br.chave || "");
      if (!chave || jaTem.has(chave)) return;
      let nome = String(br.nome || (br.respostas && br.respostas.negocio) || "Cliente").trim() || "Cliente";
      let id = slug(nome), n = 1;
      while (d.projetos.some((s) => s.id === id)) id = slug(nome) + "-" + ++n;
      d.projetos.unshift({ id, nome, proj: nome, area: "Geral", cor: cores[d.projetos.length % cores.length],
        email: "", phone: br.tel || "", tpl: "servico-premium", origem: "briefing", status: "new",
        arquivado: false, createdAt: new Date().toISOString(), generated: false, briefing: br });
      writeProj(id, { shell: null, blocos: [], versoes: [], comentarios: [] });
      jaTem.add(chave); novos++;
    });
    writeDB(d);
    return json(res, 200, { ok: true, novos });
  }
  // baixa as imagens do briefing (do Drive) pra mídia do projeto
  if (p === "/api/briefings/midia" && req.method === "POST") {
    const b = await body(req); const d = db();
    const s = d.projetos.find((x) => x.id === b.id);
    if (!s || !s.briefing) return json(res, 404, { ok: false, erro: "projeto sem briefing" });
    const dir = assetsDir(s.id); fs.mkdirSync(dir, { recursive: true });
    const baixados = []; let nfoto = 0;
    for (const a of (s.briefing.arquivos || [])) {
      const m = String(a.url || "").match(/\/d\/([^/]+)/) || String(a.url || "").match(/[?&]id=([^&]+)/);
      if (!m) continue;
      const bin = await baixarImagemDrive(m[1]);
      if (!bin) continue; // não veio imagem (link privado ou confirmação do Drive)
      const ext = EXT_MIDIA[bin.contentType] || ".jpg";
      const base = a.campo === "logo" ? "logo" : ("foto-" + (++nfoto));
      let nome = base + ext, k = 1;
      while (fs.existsSync(path.join(dir, nome))) nome = base + "-" + (++k) + ext;
      fs.writeFileSync(path.join(dir, nome), bin.buffer);
      baixados.push({ nome, url: "assets/" + nome, previewUrl: "/preview/" + s.id + "/assets/" + nome, campo: a.campo });
    }
    return json(res, 200, { ok: true, baixados });
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
    const parts = p.split("/"); const s = decodeURIComponent(parts[2] || "");
    // mídia do site publicado: /s/<slug>/assets/<arquivo>
    if (parts[3] === "assets" && parts[4]) {
      const af = path.join(pubDir(s), "assets", path.basename(decodeURIComponent(parts[4])));
      if (af.startsWith(pubDir(s)) && fs.existsSync(af)) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(af).toLowerCase()] || "application/octet-stream" });
        return res.end(fs.readFileSync(af));
      }
      res.writeHead(404); return res.end();
    }
    const f = pubFile(s);
    if (s && fs.existsSync(f)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      // <base> só pra visualização local; o arquivo enviado por FTP fica limpo (relativo)
      return res.end(String(fs.readFileSync(f, "utf8")).replace(/<head([^>]*)>/i, `<head$1><base href="/s/${s}/">`));
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
  // página pública de acompanhamento do cliente: /acompanhar/<id>
  if (p.startsWith("/acompanhar/")) {
    const id = decodeURIComponent(p.slice(12).split("/")[0]);
    const s = db().projetos.find((x) => x.id === id);
    res.writeHead(s ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(s ? paginaAcompanhamento(s) : paginaAcompNaoEncontrada());
  }

  if (p.startsWith("/preview/")) {
    const parts = p.split("/"); const id = parts[2];
    // arquivos de mídia do projeto: /preview/<id>/assets/<arquivo>
    if (parts[3] === "assets" && parts[4]) {
      const f = path.join(assetsDir(id), path.basename(decodeURIComponent(parts[4])));
      if (f.startsWith(assetsDir(id)) && fs.existsSync(f)) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); return res.end();
    }
    // artefatos de apoio: /preview/<id>/artefatos/<arquivo>
    if (parts[3] === "artefatos" && parts[4]) {
      const dir = artefatosDir(id);
      const f = path.join(dir, path.basename(decodeURIComponent(parts[4])));
      try {
        if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
          res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
          return res.end(fs.readFileSync(f));
        }
      } catch (e) {}
      res.writeHead(404); return res.end();
    }
    // <base> faz o caminho relativo "assets/x.jpg" resolver certo dentro do preview
    const comBase = (html) => String(html).replace(/<head([^>]*)>/i, `<head$1><base href="/preview/${id}/">`);
    if (url.searchParams.get("edit") === "1") {
      const pr = readProj(id);
      if (!pr.blocos || !pr.blocos.length) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(comBase(B.render(pr, { edicao: true })));
    }
    if (url.searchParams.get("vivo") === "1") {
      if (!fs.existsSync(siteFile(id))) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("ainda não gerada"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(servirEditorVivo(fs.readFileSync(siteFile(id), "utf8"), id));
    }
    if (fs.existsSync(siteFile(id))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(comBase(fs.readFileSync(siteFile(id), "utf8")));
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
