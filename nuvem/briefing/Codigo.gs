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
// a ordem das perguntas do formulário (vira o cabeçalho da planilha)
var CAMPOS = ['negocio', 'vende', 'objetivo', 'publico', 'oferta', 'diferencial',
  'provas', 'tom', 'cores', 'fotos', 'amo', 'evitar', 'contato'];
var TITULOS = {
  negocio: 'Negócio', vende: 'O que vende', objetivo: 'Objetivo da página',
  publico: 'Público', oferta: 'Oferta', diferencial: 'Diferencial',
  provas: 'Provas', tom: 'Tom', cores: 'Cores', fotos: 'Fotos',
  amo: 'Referência que ama', evitar: 'O que evitar', contato: 'Contatos'
};

// serve o formulário
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('briefing');
  t.nome = (e && e.parameter && e.parameter.nome) ? e.parameter.nome : '';
  t.tel  = (e && e.parameter && e.parameter.tel)  ? e.parameter.tel  : '';
  return t.evaluate()
    .setTitle('Briefing · Fábrica de LPs')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

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
  if (aba.getLastRow() === 0) {
    aba.appendRow(['Data', 'Nome', 'WhatsApp', 'Status']
      .concat(CAMPOS.map(function (c) { return TITULOS[c] || c; }))
      .concat(['Arquivos']));
  }

  // uma subpasta por cliente, com os arquivos anexados
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
    .concat([links.join('\n')]);
  aba.appendRow(linha);
  return { ok: true };
}

function fmt(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
