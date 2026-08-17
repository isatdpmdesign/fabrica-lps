/**
 * blocos.js — quebra uma landing page em seções e monta de volta.
 *
 * A página deixa de ser um HTML solto e passa a ser uma lista de seções
 * identificadas (nav, hero, prova-social, …). O HTML final continua sendo
 * gerado a partir delas — auto-suficiente e leve, como antes.
 */

const VOID = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

/** Divide um trecho de HTML nos seus elementos de primeiro nível. */
function dividirTopo(html) {
  const out = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    while (i < n && /\s/.test(html[i])) i++;
    if (i >= n) break;
    if (html.startsWith("<!--", i)) { const e = html.indexOf("-->", i); i = e < 0 ? n : e + 3; continue; }
    if (html[i] !== "<") { const next = html.indexOf("<", i); i = next < 0 ? n : next; continue; }

    const m = /^<([a-zA-Z][\w-]*)([^>]*)>/.exec(html.slice(i));
    if (!m) { i++; continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const inicio = i;

    if (VOID.has(tag) || /\/\s*$/.test(attrs)) {
      i += m[0].length;
      out.push({ tag, attrs, html: html.slice(inicio, i) });
      continue;
    }

    // procura o fechamento correspondente, respeitando aninhamento da mesma tag
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = i;
    let depth = 0, fim = n, mm;
    while ((mm = re.exec(html))) {
      if (mm[1] === "/") { depth--; if (depth === 0) { fim = mm.index + mm[0].length; break; } }
      else if (!/\/\s*>$/.test(mm[0])) depth++;
    }
    out.push({ tag, attrs, html: html.slice(inicio, fim) });
    i = fim;
  }
  return out;
}

const classeDe = (attrs) => (/class\s*=\s*["']([^"']*)/i.exec(attrs || "") || [])[1] || "";

/** Adivinha o tipo da seção pelo tag, pela classe e pelo conteúdo. */
function tipoDe(el) {
  const c = classeDe(el.attrs), t = el.tag;
  if (t === "nav") return "nav";
  if (t === "footer") return "footer";
  if (t === "header" || /\bhero\b/i.test(c)) return "hero";

  // classe da raiz primeiro; se não disser nada, olha as classes de dentro
  const dentro = el.html.slice(0, 1200);
  const teste = (re) => re.test(c) || re.test(dentro);
  if (teste(/proof|prova|logos/i)) return "prova-social";
  if (teste(/about|sobre|bio|portrait/i)) return "sobre";
  if (teste(/ctaband|\bcta\b/i)) return "cta";
  if (teste(/galer|gallery|portfolio/i)) return "galeria";
  if (teste(/depoim|testimon|review/i)) return "depoimentos";
  if (teste(/faq|duvida/i)) return "faq";
  if (teste(/preco|price|plano/i)) return "precos";
  if (teste(/feature|diferen|\bcards?\b|servi/i)) return "diferenciais";
  return "secao";
}

const NOMES = {
  nav: "Navegação", hero: "Hero", "prova-social": "Prova social", diferenciais: "Diferenciais",
  sobre: "Sobre", galeria: "Galeria", depoimentos: "Depoimentos", faq: "Perguntas frequentes",
  precos: "Preços", cta: "Chamada final", footer: "Rodapé", secao: "Seção",
};

/**
 * Quebra o HTML completo de uma página em { shell, blocos }.
 * shell guarda tudo que não é seção (doctype, head, aberturas) para remontar igual.
 */
function parse(html) {
  const doctype = (/^\s*<!DOCTYPE[^>]*>/i.exec(html) || [""])[0];
  const htmlOpen = (/<html[^>]*>/i.exec(html) || ['<html lang="pt-BR">'])[0];
  const head = (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(html) || ["", ""])[1];
  const bodyOpen = (/<body[^>]*>/i.exec(html) || ["<body>"])[0];
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  let corpo = bodyMatch ? bodyMatch[1] : html;

  // scripts/estilos soltos no fim do body vão pro rodapé do shell, não viram seção
  const tail = [];
  corpo = corpo.replace(/<(script|style)\b[\s\S]*?<\/\1>\s*$/gi, (m) => { tail.unshift(m); return ""; });

  // se tudo está dentro de um único wrapper, entra nele
  let wrapOpen = "", wrapClose = "";
  for (let guard = 0; guard < 4; guard++) {
    const topo = dividirTopo(corpo);
    if (topo.length !== 1) break;
    const unico = topo[0];
    if (VOID.has(unico.tag)) break;
    const interno = unico.html.replace(/^<[^>]*>/, "").replace(/<\/[^>]*>\s*$/, "");
    if (dividirTopo(interno).length < 2) break;
    wrapOpen += (/^<[^>]*>/.exec(unico.html) || [""])[0];
    wrapClose = (/<\/[^>]*>\s*$/.exec(unico.html) || [""])[0] + wrapClose;
    corpo = interno;
  }

  const usados = {};
  const blocos = dividirTopo(corpo).map((el) => {
    const tipo = tipoDe(el);
    usados[tipo] = (usados[tipo] || 0) + 1;
    const suf = usados[tipo] > 1 ? "-" + usados[tipo] : "";
    return {
      id: tipo + suf,
      tipo,
      nome: NOMES[tipo] + (usados[tipo] > 1 ? " " + usados[tipo] : ""),
      html: el.html.trim(),
    };
  });

  return { shell: { doctype, htmlOpen, head, bodyOpen, wrapOpen, wrapClose, tail: tail.join("\n") }, blocos };
}

/** Remonta o HTML final a partir de { shell, blocos }. */
function render({ shell, blocos }) {
  const s = shell || {};
  const corpo = (blocos || [])
    .map((b) => `<!-- bloco:${b.id} -->\n${b.html}`)
    .join("\n\n");
  return [
    s.doctype || "<!DOCTYPE html>",
    s.htmlOpen || '<html lang="pt-BR">',
    "<head>", s.head || "", "</head>",
    s.bodyOpen || "<body>",
    s.wrapOpen || "",
    corpo,
    s.wrapClose || "",
    s.tail || "",
    "</body></html>",
  ].filter(Boolean).join("\n");
}

module.exports = { parse, render, dividirTopo, NOMES };
