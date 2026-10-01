// Reparo + diagnóstico do subdomínio no Cloudflare Pages.
// Roda na SUA máquina (que alcança o Cloudflare).
//
// Jeito fácil: dê dois cliques no REPARAR.bat (ele acha o config.json sozinho).
// Ou pela linha de comando:
//   node reparar-cloudflare.mjs                      (acha o config.json sozinho)
//   node reparar-cloudflare.mjs "CAMINHO\config.json"
//   node reparar-cloudflare.mjs "CAMINHO\config.json" nomedoslug
//
// O config.json fica na pasta de dados da Fábrica (Configurações -> "Onde ficam
// os arquivos"). O token/account/zone do Cloudflare são lidos DE LÁ — nada fica
// guardado neste arquivo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- acha o config.json da Fábrica sozinho ----
function temCredenciais(j) { return j && j.cloudflare && j.cloudflare.token && j.cloudflare.accountId; }
function acharConfig() {
  const roots = [];
  const home = os.homedir();
  if (home) roots.push(home);
  if (process.env.OneDrive) roots.push(process.env.OneDrive);
  for (const L of ["C", "D", "E", "F", "G", "H", "I"]) for (const d of ["My Drive", "Meu Drive", "Google Drive"]) roots.push(L + ":\\" + d);
  const pular = new Set(["node_modules", "AppData", "Windows", "Program Files", "Program Files (x86)", "$Recycle.Bin"]);
  let achado = null;
  const visit = (dir, depth) => {
    if (achado || depth > 6) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (achado) return;
      if (e.isFile() && e.name === "config.json") {
        try { const j = JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")); if (temCredenciais(j)) { achado = path.join(dir, e.name); return; } } catch {}
      }
    }
    for (const e of ents) {
      if (achado) return;
      if (e.isDirectory() && !e.name.startsWith(".") && !pular.has(e.name)) visit(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) { if (achado) break; try { if (fs.existsSync(r)) visit(r, 0); } catch {} }
  return achado;
}

const argPath = process.argv[2] && process.argv[2].toLowerCase().endsWith(".json") ? process.argv[2] : null;
const slug = ((argPath ? process.argv[3] : process.argv[2]) || "teste").toLowerCase();
let caminho = argPath;
if (!caminho) { console.log("Procurando o config.json da Fábrica..."); caminho = acharConfig(); }
if (!caminho) {
  console.error('\nNão achei o config.json sozinho. Arraste o arquivo config.json pra cima do REPARAR.bat,');
  console.error('ou rode: node reparar-cloudflare.mjs "CAMINHO\\config.json"');
  console.error('(o config.json fica na pasta que aparece em Configurações -> "Onde ficam os arquivos")');
  process.exit(1);
}
console.log("Usando config:", caminho, "\n");

let cfg;
try { cfg = JSON.parse(fs.readFileSync(caminho, "utf8")); }
catch (e) { console.error("Não consegui ler o config.json:", e.message); process.exit(1); }

const cf = cfg.cloudflare || {};
const TOKEN = (cf.token || "").trim();
const ACCOUNT = (cf.accountId || "").trim();
const ZONE = (cf.zoneId || "").trim();
const DOMINIO_BASE = cfg.FABRICA_DOMINIO || "fabricadelps.com.br";
const proj = "lp-" + slug.replace(/[^a-z0-9-]/g, "-");
const fqdn = slug + "." + DOMINIO_BASE;

if (!TOKEN || !ACCOUNT || !ZONE) { console.error("O config.json não tem cloudflare.token / accountId / zoneId. Configure na Fábrica primeiro."); process.exit(1); }

const sono = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, p, body) {
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4" + p, {
      method, headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, ok: !!(j && j.success), json: j };
  } catch (e) { return { status: 0, ok: false, json: { errors: [{ message: "falha de rede: " + (e.message || e) }] } }; }
}
const resumo = (r) => "HTTP " + r.status + (r.ok ? " OK" : " FALHOU") + (r.json && r.json.errors && r.json.errors.length ? " | erros: " + JSON.stringify(r.json.errors) : "");

console.log("=== REPARO CLOUDFLARE ===");
console.log("projeto:", proj, "| subdominio:", fqdn, "\n");

console.log("0) Verificar token...");
console.log("   ", resumo(await api("GET", "/user/tokens/verify")));

console.log("1) Projeto Pages e endereco .pages.dev REAL...");
const p = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj);
console.log("   ", resumo(p));
let alvoReal = proj + ".pages.dev";
if (p.json && p.json.result) {
  if (p.json.result.subdomain) alvoReal = p.json.result.subdomain;
  const dep = p.json.result.canonical_deployment || p.json.result.latest_deployment;
  console.log("    endereco .pages.dev REAL:", alvoReal, (alvoReal !== (proj + ".pages.dev") ? "  <-- DIFERENTE do bugado (" + proj + ".pages.dev)!" : ""));
  console.log("    deploy de producao:", dep ? (dep.url || dep.id || "existe") : "NENHUM (publique a pagina antes)");
} else console.log("    (projeto nao encontrado — publique ao menos 1 vez pelo app)");

console.log("2) Dominios ja no projeto...");
const dlist = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains");
console.log("   ", resumo(dlist));
for (const d of (((dlist.json || {}).result) || [])) console.log("     -", d.name, "| status:", d.status);

console.log("3) Registros DNS atuais de", fqdn, "...");
const recs = await api("GET", "/zones/" + ZONE + "/dns_records?name=" + encodeURIComponent(fqdn));
console.log("   ", resumo(recs));
for (const rec of (((recs.json || {}).result) || [])) {
  console.log("     - apagando", rec.type, rec.name, "->", rec.content, "(proxied:", rec.proxied + ")");
  console.log("       ", resumo(await api("DELETE", "/zones/" + ZONE + "/dns_records/" + rec.id)));
}

console.log("4) Removendo o dominio do projeto (pra re-adicionar limpo)...");
console.log("   ", resumo(await api("DELETE", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains/" + encodeURIComponent(fqdn))));
await sono(2500);

console.log("5) Re-adicionando o dominio ao projeto...");
console.log("   ", resumo(await api("POST", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains", { name: fqdn })));
await sono(4000);

console.log("6) O Pages criou o DNS sozinho (apontando pro endereco certo)?");
let recs2 = (((await api("GET", "/zones/" + ZONE + "/dns_records?name=" + encodeURIComponent(fqdn))).json || {}).result) || [];
const certo = recs2.find(r => r.type === "CNAME" && r.content === alvoReal);
if (certo) console.log("     - SIM:", certo.name, "->", certo.content);
else {
  for (const r of recs2) { console.log("     - apagando registro errado:", r.type, "->", r.content); await api("DELETE", "/zones/" + ZONE + "/dns_records/" + r.id); }
  console.log("     - criando CNAME proxied -> " + alvoReal + " ...");
  console.log("       ", resumo(await api("POST", "/zones/" + ZONE + "/dns_records", { type: "CNAME", name: fqdn, content: alvoReal, proxied: true, ttl: 1 })));
}
await sono(2500);

console.log("7) Status final do dominio...");
const st = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains/" + encodeURIComponent(fqdn));
console.log("   ", resumo(st));
if (st.json && st.json.result) console.log("    status:", st.json.result.status);
console.log("\n=== FIM ===");
console.log("Se o status for 'active', abra https://" + fqdn + " (aba anonima) em 1-3 min.");
console.log("Copie TODO este texto e mande pra Claude.");
