// Reparo + diagnóstico do subdomínio no Cloudflare Pages.
// Roda na SUA máquina (que alcança o Cloudflare). Uso:
//   node reparar-cloudflare.mjs "CAMINHO\DO\config.json" [slug]
// Onde config.json é o arquivo que fica na pasta de dados da Fábrica
// (Configurações -> "Onde ficam os arquivos"). slug é opcional (padrão: teste).
import fs from "node:fs";

const caminho = process.argv[2];
const slug = (process.argv[3] || "teste").toLowerCase();
if (!caminho) { console.error('Faltou o caminho do config.json. Ex: node reparar-cloudflare.mjs "C:\\...\\config.json"'); process.exit(1); }

let cfg;
try { cfg = JSON.parse(fs.readFileSync(caminho, "utf8")); }
catch (e) { console.error("Não consegui ler o config.json em:", caminho, "\n", e.message); process.exit(1); }

const cf = cfg.cloudflare || {};
const TOKEN = (cf.token || "").trim();
const ACCOUNT = (cf.accountId || "").trim();
const ZONE = (cf.zoneId || "").trim();
const DOMINIO_BASE = cfg.FABRICA_DOMINIO || "fabricadelps.com.br";
const proj = "lp-" + slug.replace(/[^a-z0-9-]/g, "-");
const fqdn = slug + "." + DOMINIO_BASE;
const alvo = proj + ".pages.dev";

if (!TOKEN || !ACCOUNT || !ZONE) { console.error("config.json não tem cloudflare.token / accountId / zoneId preenchidos."); process.exit(1); }

const sono = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, body) {
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
      method,
      headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, ok: !!(j && j.success), json: j };
  } catch (e) {
    return { status: 0, ok: false, json: { errors: [{ message: "falha de rede: " + (e.message || e) }] } };
  }
}
const resumo = (r) => "HTTP " + r.status + (r.ok ? " OK" : " FALHOU") + (r.json && r.json.errors && r.json.errors.length ? " | erros: " + JSON.stringify(r.json.errors) : "");

console.log("=== REPARO CLOUDFLARE ===");
console.log("projeto:", proj, "| subdomínio:", fqdn, "| alvo:", alvo);
console.log("account:", ACCOUNT.slice(0,6) + "…", "| zone:", ZONE.slice(0,6) + "…\n");

// 0) token
console.log("0) Verificar token…");
console.log("   ", resumo(await api("GET", "/user/tokens/verify")));

// 1) projeto existe? QUAL é o endereço .pages.dev REAL dele?
console.log("1) Projeto Pages…");
const p = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj);
console.log("   ", resumo(p));
let alvoReal = alvo;
if (p.json && p.json.result) {
  const sub = p.json.result.subdomain; // ex.: lp-teste.pages.dev OU lp-teste-xyz.pages.dev
  if (sub) alvoReal = sub;
  const dep = p.json.result.canonical_deployment || p.json.result.latest_deployment;
  console.log("    endereço .pages.dev REAL do teu projeto:", alvoReal, (alvoReal !== alvo ? "  <-- DIFERENTE do que eu assumia (" + alvo + ")!" : ""));
  console.log("    deploy de produção:", dep ? (dep.url || dep.id || "existe") : "NENHUM (precisa publicar a página antes)");
} else {
  console.log("    (não achei o projeto — confira se publicou pelo menos uma vez)");
}

// 2) domínios atuais do projeto
console.log("2) Domínios já no projeto…");
const dlist = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains");
console.log("   ", resumo(dlist));
for (const d of (((dlist.json||{}).result)||[])) console.log("     -", d.name, "| status:", d.status);

// 3) apagar registros DNS do fqdn (CNAME manual que trava o Pages)
console.log("3) Registros DNS atuais de", fqdn, "…");
const recs = await api("GET", "/zones/" + ZONE + "/dns_records?name=" + encodeURIComponent(fqdn));
console.log("   ", resumo(recs));
for (const rec of (((recs.json||{}).result)||[])) {
  console.log("     - apagando", rec.type, rec.name, "->", rec.content, "(proxied:", rec.proxied + ")");
  console.log("       ", resumo(await api("DELETE", "/zones/" + ZONE + "/dns_records/" + rec.id)));
}

// 4) remover o custom domain do projeto
console.log("4) Removendo o domínio do projeto (pra re-adicionar limpo)…");
console.log("   ", resumo(await api("DELETE", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains/" + encodeURIComponent(fqdn))));
await sono(2500);

// 5) re-adicionar o custom domain (o Pages deve criar o DNS sozinho)
console.log("5) Re-adicionando o domínio ao projeto…");
const add = await api("POST", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains", { name: fqdn });
console.log("   ", resumo(add));
await sono(4000);

// 6) o Pages criou o DNS?
console.log("6) O Pages criou o registro de DNS sozinho?");
const recs2 = await api("GET", "/zones/" + ZONE + "/dns_records?name=" + encodeURIComponent(fqdn));
const lista2 = ((recs2.json||{}).result)||[];
if (lista2.length) { for (const r of lista2) console.log("     - SIM:", r.type, r.name, "->", r.content, "(proxied:", r.proxied + ")"); }
else {
  console.log("     - NÃO criou. Criando CNAME proxied na mão apontando pro endereço REAL (" + alvoReal + ")…");
  const c = await api("POST", "/zones/" + ZONE + "/dns_records", { type: "CNAME", name: fqdn, content: alvoReal, proxied: true, ttl: 1 });
  console.log("       ", resumo(c));
}
await sono(2500);

// 7) status final do domínio
console.log("7) Status final do domínio no projeto…");
const st = await api("GET", "/accounts/" + ACCOUNT + "/pages/projects/" + proj + "/domains/" + encodeURIComponent(fqdn));
console.log("   ", resumo(st));
if (st.json && st.json.result) {
  console.log("    status:", st.json.result.status, "| validação:", JSON.stringify(st.json.result.validation_data || st.json.result.verification_data || {}));
}
console.log("\n=== FIM. Me manda TODO esse texto. ===");
console.log("Se o status final for 'active', abra https://" + fqdn + " (aba anônima) em 1-3 min.");
