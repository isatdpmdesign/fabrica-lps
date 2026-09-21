/**
 * Fábrica de LPs — Briefing do cliente (Google Apps Script)
 *
 * O que este script faz:
 *  1) Serve o formulário de briefing (o arquivo "briefing.html").
 *  2) Recebe as respostas e guarda cada envio como uma LINHA numa planilha.
 *  3) Salva os arquivos anexados (logo, fotos, depoimentos) numa pasta do Drive.
 *
 * Você NÃO precisa criar a planilha nem a pasta na mão. Na primeira vez que
 * um briefing for enviado, o script cria as duas sozinho, na sua conta Google,
 * e guarda os IDs. Elas aparecem no seu Google Drive com estes nomes:
 *   • Planilha: "Fábrica de LPs — Briefings"
 *   • Pasta:    "Fábrica de LPs — Arquivos dos briefings"
 *
 * Passo a passo de instalação: veja o arquivo COMO-CONFIGURAR.md.
 */

var ABA = 'Briefings';
// senha pra o Estúdio buscar os briefings (troque por algo só seu e use a mesma no app)
var SEGREDO = 'troque-esta-senha';
// a ordem das perguntas do formulário (vira o cabeçalho da planilha)
var CAMPOS = ['negocio', 'vende', 'objetivo', 'publico', 'oferta', 'diferencial',
  'provas', 'tom', 'cores', 'fotos', 'amo', 'evitar', 'contato'];
var TITULOS = {
  negocio: 'Negócio', vende: 'O que vende', objetivo: 'Objetivo da página',
  publico: 'Público', oferta: 'Oferta', diferencial: 'Diferencial',
  provas: 'Provas', tom: 'Tom', cores: 'Cores', fotos: 'Fotos',
  amo: 'Referência que ama', evitar: 'O que evitar', contato: 'Contatos'
};

// serve o formulário OU devolve os briefings em JSON (quando o Estúdio pede ?listar=1)
function doGet(e) {
  if (e && e.parameter && e.parameter.listar) {
    var ok = String(e.parameter.token || '') === SEGREDO;
    var payload = ok ? { ok: true, briefings: listarBriefings() } : { ok: false, erro: 'senha invalida' };
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  }
  var nome = (e && e.parameter && e.parameter.nome) ? String(e.parameter.nome) : '';
  var tel  = (e && e.parameter && e.parameter.tel)  ? String(e.parameter.tel)  : '';
  var html = HtmlService.createHtmlOutputFromFile('briefing').getContent();
  html = html.replace('__NOME__', limpa(nome)).replace('__TEL__', limpa(tel));
  return HtmlService.createHtmlOutput(html)
    .setTitle('Briefing · Fábrica de LPs')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
function limpa(s) { return String(s).replace(/["\\<>]/g, ''); }

// cria (uma vez) a planilha e a pasta, e guarda os IDs
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var pastaId = props.getProperty('PASTA_ID');
  if (!sheetId) {
    var ss = SpreadsheetApp.create('Fábrica de LPs — Briefings');
    sheetId = ss.getId();
    props.setProperty('SHEET_ID', sheetId);
  }
  if (!pastaId) {
    var f = DriveApp.createFolder('Fábrica de LPs — Arquivos dos briefings');
    pastaId = f.getId();
    props.setProperty('PASTA_ID', pastaId);
  }
  return { sheetId: sheetId, pastaId: pastaId };
}

// chamado pelo formulário (via google.script.run) quando o cliente envia
function salvarBriefing(dados) {
  var cfg = getConfig();
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var aba = ss.getSheetByName(ABA) || ss.insertSheet(ABA);

  // garante o cabeçalho (inclui Chave e PastaId; migra planilhas antigas)
  var header = ['Data', 'Nome', 'WhatsApp', 'Status']
    .concat(CAMPOS.map(function (c) { return TITULOS[c] || c; }))
    .concat(['Arquivos', 'Chave', 'PastaId']);
  aba.getRange(1, 1, 1, header.length).setValues([header]);
  var COL_CHAVE = header.length - 1; // penúltima coluna

  var chave = String(dados.chave || '');

  // procura um envio anterior com a mesma chave (mesmo cliente corrigindo)
  var linhaExistente = -1, pastaAntiga = '';
  if (chave && aba.getLastRow() > 1) {
    var vals = aba.getRange(2, COL_CHAVE, aba.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === chave) { linhaExistente = i + 2; pastaAntiga = String(vals[i][1] || ''); break; }
    }
  }

  // se for correção, joga a pasta antiga na lixeira (não duplica)
  if (pastaAntiga) {
    try { DriveApp.getFolderById(pastaAntiga).setTrashed(true); } catch (e) {}
  }

  // pasta nova com os arquivos anexados
  var raiz = DriveApp.getFolderById(cfg.pastaId);
  var nomeCli = (dados.nome || 'cliente') + ' - ' + new Date().toLocaleDateString('pt-BR');
  var pasta = raiz.createFolder(nomeCli);
  var links = [];
  (dados.arquivos || []).forEach(function (f) {
    try {
      var partes = String(f.dataUrl || '').split(',');
      var tipo = (String(partes[0] || '').match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
      var blob = Utilities.newBlob(Utilities.base64Decode(partes[1] || ''), tipo, f.name || 'arquivo');
      var arq = pasta.createFile(blob);
      arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      links.push((f.campo || 'arquivo') + ': ' + arq.getUrl());
    } catch (err) { /* ignora um arquivo com problema, não derruba o envio */ }
  });

  var r = dados.respostas || {};
  var linha = [new Date(), dados.nome || '', dados.tel || '', 'Novo']
    .concat(CAMPOS.map(function (c) { return fmt(r[c]); }))
    .concat([links.join('\n'), chave, pasta.getId()]);

  // atualiza a linha do mesmo cliente, ou cria uma nova
  if (linhaExistente > 0) {
    aba.getRange(linhaExistente, 1, 1, linha.length).setValues([linha]);
  } else {
    aba.appendRow(linha);
  }
  return { ok: true };
}

function fmt(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

// lê a planilha e devolve os briefings organizados (pro Estúdio montar os cards)
function listarBriefings() {
  var cfg = getConfig();
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var aba = ss.getSheetByName(ABA);
  if (!aba || aba.getLastRow() < 2) return [];
  var dados = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
  var iArq = 4 + CAMPOS.length;      // coluna "Arquivos"
  var iChave = iArq + 1;             // coluna "Chave"
  return dados.map(function (row) {
    var respostas = {};
    for (var i = 0; i < CAMPOS.length; i++) respostas[CAMPOS[i]] = row[4 + i];
    var arquivos = [];
    String(row[iArq] || '').split('\n').forEach(function (l) {
      var m = String(l).match(/^\s*([^:]+):\s*(https?:\/\/\S+)/);
      if (m) arquivos.push({ campo: m[1].trim(), url: m[2].trim() });
    });
    var data = '';
    try { data = Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); } catch (e) {}
    return { data: data, nome: row[1], tel: row[2], status: row[3], respostas: respostas, arquivos: arquivos, chave: row[iChave] };
  });
}
