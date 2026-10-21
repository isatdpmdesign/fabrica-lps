"""
app.py — o CÉREBRO da Fábrica de LPs (FastAPI).

Fica num servidor sempre ligado (Oracle Cloud). Faz:
  1) recebe o briefing do cliente (POST /briefing) e cria o pagamento no Stripe;
  2) ouve o Stripe confirmar o pagamento (POST /webhook/stripe) e marca "pago";
  3) a Fábrica (no PC da Isa) puxa os leads PAGOS (GET /api/leads) -> viram card na fila.
  (WhatsApp entra na Fase 2.)

Rodar local:  uvicorn app:app --reload
Rodar no servidor:  uvicorn app:app --host 0.0.0.0 --port 8000
"""
import os
import re
import json
import time
import secrets

from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware

import requests  # vem junto com o stripe

import db

VERSAO = 1

# ---- configuração (tudo por variável de ambiente, nada de segredo no código) ----
SEGREDO = os.environ.get("SEGREDO", "troque-esta-senha")          # a Fábrica usa pra puxar os leads
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")        # sk_live_... ou sk_test_...
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")  # whsec_...
PRECO_CENTAVOS = int(os.environ.get("PRECO_CENTAVOS", "9700"))     # R$ 97,00 (preço de lançamento)
PRECO_CHEIO_CENTAVOS = int(os.environ.get("PRECO_CHEIO_CENTAVOS", "19700"))  # R$ 197,00
# janela do preço de lançamento: até este dia (inclusive, horário de Brasília) vale o
# PRECO_CENTAVOS; a partir do dia seguinte o checkout passa sozinho pro cheio
FUNDADORAS_ATE = os.environ.get("FUNDADORAS_ATE", "2026-11-30")


def preco_atual():
    """(centavos, nome no checkout) conforme a data, sem a Isa precisar trocar nada."""
    from datetime import datetime, timedelta, timezone
    hoje = datetime.now(timezone(timedelta(hours=-3))).strftime("%Y-%m-%d")
    if FUNDADORAS_ATE and hoje <= FUNDADORAS_ATE:
        return PRECO_CENTAVOS, "Landing page — Fábrica de LPs (preço de lançamento)"
    return PRECO_CHEIO_CENTAVOS, "Landing page — Fábrica de LPs"
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")      # endereço público do cérebro

# o briefing é servido por aqui (no domínio da Isa) e repassado ao Apps Script,
# que guarda as respostas no Google Sheets e os arquivos no Drive.
BRIEFING_APPS_URL = os.environ.get("BRIEFING_APPS_URL", "")        # o /exec do Apps Script
BRIEFING_APPS_TOKEN = os.environ.get("BRIEFING_APPS_TOKEN", "")    # a SEGREDO do Apps Script
FORM_HTML = os.path.join(os.path.dirname(__file__), "briefing_form.html")
ACOMP_HTML = os.path.join(os.path.dirname(__file__), "acompanhar.html")
AVAL_HTML = os.path.join(os.path.dirname(__file__), "avaliar.html")

stripe = None
if STRIPE_SECRET_KEY:
    import stripe as _stripe
    _stripe.api_key = STRIPE_SECRET_KEY
    stripe = _stripe

app = FastAPI(title="Cérebro da Fábrica de LPs")

# O modal da página de vendas (fabricadelps.com.br) chama o /contato pelo navegador.
# Como o cérebro mora noutro subdomínio (cerebro.fabricadelps.com.br), precisa liberar o CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://([a-z0-9-]+\.)?fabricadelps\.com\.br",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

db.iniciar()


def so_digitos(texto):
    return re.sub(r"\D", "", texto or "")


def exige_token(token):
    if token != SEGREDO:
        raise HTTPException(status_code=401, detail="token inválido")


@app.get("/health")
def health():
    return {"ok": True, "versao": VERSAO, "stripe": bool(stripe)}


@app.post("/briefing")
async def receber_briefing(req: Request):
    """
    O formulário de briefing manda pra cá. Cria o lead e devolve o link de pagamento.
    Espera JSON: { nome, telefone, area, respostas: {...} }
    """
    dados = await req.json()
    nome = (dados.get("nome") or "").strip() or "Cliente"
    telefone = (dados.get("telefone") or "").strip()
    area = (dados.get("area") or "").strip() or "Geral"
    respostas = dados.get("respostas") or {}

    chave = "lead_" + time.strftime("%Y%m%d") + "_" + secrets.token_hex(4)
    db.criar_lead(chave, nome, telefone, area, respostas)

    pagamento_url = ""
    if stripe:
        sessao = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency": "brl",
                    "unit_amount": preco_atual()[0],
                    "product_data": {"name": preco_atual()[1]},
                },
            }],
            metadata={"chave": chave},
            allow_promotion_codes=True,   # campo de cupom no checkout (promoções, teste 100%)
            success_url=BASE_URL + "/obrigado?c=" + chave,
            cancel_url=BASE_URL + "/pagamento-cancelado?c=" + chave,
        )
        db.set_stripe_id(chave, sessao.id)
        pagamento_url = sessao.url

    return {"ok": True, "chave": chave, "pagamento_url": pagamento_url}


@app.post("/webhook/stripe")
async def webhook_stripe(req: Request):
    """O Stripe chama aqui quando o cliente paga. A gente confere a assinatura e marca 'pago'."""
    payload = await req.body()
    sig = req.headers.get("stripe-signature", "")
    # sem a chave de assinatura não dá pra saber se o aviso veio mesmo do Stripe:
    # recusa, senão qualquer um marcaria um pedido como "pago"
    if not (stripe and STRIPE_WEBHOOK_SECRET):
        raise HTTPException(status_code=503, detail="webhook do Stripe não configurado (falta STRIPE_WEBHOOK_SECRET)")
    try:
        evento = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(status_code=400, detail="assinatura inválida: " + str(e))

    tipo = evento["type"]
    obj = evento["data"]["object"]
    # cartão: o checkout termina já pago. Pix/boleto: o checkout termina com o
    # pagamento PENDENTE e o dinheiro cai depois (async_payment_succeeded). Só
    # marca "pago" quando o dinheiro entrou de verdade.
    pago = (
        # cupom de 100%: o Stripe fecha o checkout com "no_payment_required"
        (tipo == "checkout.session.completed" and obj.get("payment_status") in ("paid", "no_payment_required"))
        or tipo == "checkout.session.async_payment_succeeded"
    )
    if pago:
        chave = (obj.get("metadata") or {}).get("chave")
        db.marcar_pago(chave=chave, stripe_id=obj.get("id"))

    return {"recebido": True}


@app.get("/api/leads")
def api_leads(token: str = ""):
    """A Fábrica chama de tempos em tempos. Devolve os leads PAGOS que ainda não foram pro quadro."""
    exige_token(token)
    pagos = db.leads_pagos_ativos()
    saida = []
    for l in pagos:
        try:
            respostas = json.loads(l.get("respostas") or "{}")
        except Exception:
            respostas = {}
        saida.append({
            "chave": l["chave"], "nome": l["nome"], "telefone": l["telefone"],
            "area": l["area"], "respostas": respostas,
            "pago_em": l["pago_em"], "criado_em": l["criado_em"],
        })
    # Devolve SEMPRE todos os pagos não descartados: a Fábrica cria só os que faltam
    # no quadro. Se um card sumir (Drive, dois PCs, resposta perdida), ele volta.
    return {"ok": True, "leads": saida}


@app.post("/api/leads/aviso")
async def api_aviso(req: Request):
    """A Fábrica pede pro robô avisar o cliente no WhatsApp: link de revisão (quando a
    Isa clica 'Enviar') ou página no ar (1ª publicação)."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    chave = str(dados.get("chave") or "").strip()
    tipo = str(dados.get("tipo") or "").strip()
    link = str(dados.get("link") or "").strip()
    if not chave or tipo not in ("revisao", "entregue") or not link.startswith("http"):
        return JSONResponse({"ok": False, "erro": "aviso incompleto (chave, tipo e link)"}, status_code=400)
    lead = db.get_lead(chave)
    if not lead:
        return JSONResponse({"ok": False, "erro": "não achei esse cliente no cérebro"}, status_code=404)
    if not (lead.get("telefone") or "").strip():
        return JSONResponse({"ok": False, "erro": "esse cliente não tem WhatsApp salvo no cérebro"}, status_code=409)
    db.criar_aviso(chave, tipo, link, bool(dados.get("ajustes")))
    if tipo == "entregue":
        db.set_status(chave, "entregue")
    return {"ok": True}


@app.get("/api/avisos/pendentes")
def api_avisos_pendentes(token: str = ""):
    """O robô pergunta: tem aviso pra mandar?"""
    exige_token(token)
    return {"ok": True, "avisos": db.avisos_pendentes()}


@app.post("/api/avisos/enviado")
async def api_aviso_enviado(req: Request):
    dados = await req.json()
    exige_token(dados.get("token", ""))
    if dados.get("id"):
        db.marcar_aviso_enviado(int(dados["id"]))
    return {"ok": True}


@app.post("/api/leads/descartar")
async def api_descartar(req: Request):
    """A Isa apagou o card no Estúdio: esse lead não volta mais pro quadro."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    chaves = dados.get("chaves") or []
    if isinstance(chaves, str):
        chaves = [chaves]
    chaves = [str(c) for c in chaves if c]
    if chaves:
        db.marcar_descartado(chaves)
    return {"ok": True, "descartados": len(chaves)}


@app.post("/api/leads/recebido")
async def api_recebido(req: Request):
    """A Fábrica confirma que já criou o card desses leads. SÓ então marcamos 'puxado'."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    chaves = dados.get("chaves") or []
    if isinstance(chaves, str):
        chaves = [chaves]
    chaves = [str(c) for c in chaves if c]
    if chaves:
        db.marcar_puxado(chaves)
    return {"ok": True, "marcados": len(chaves)}


@app.post("/api/leads/status")
async def api_status(req: Request):
    """A Fábrica avisa o cérebro quando muda o estado (produzindo/entregue) — útil pro WhatsApp na Fase 2."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    chave = dados.get("chave", "")
    status = dados.get("status", "")
    entrega = dados.get("entrega", None)   # opcional: "YYYY-MM-DD" (ou "" pra limpar a data)
    if chave and (status or entrega is not None):
        db.set_status(chave, status=status or None, entrega=entrega)
    return {"ok": True}


@app.get("/api/leads/notificar")
def api_leads_notificar(token: str = ""):
    """Leads que já pagaram e o robô ainda não confirmou no WhatsApp (pós-pagamento)."""
    exige_token(token)
    pend = db.leads_pagos_nao_notificados()
    return {"ok": True, "leads": [
        {"chave": l["chave"], "nome": l.get("nome") or "", "telefone": l.get("telefone") or ""}
        for l in pend
    ]}


@app.post("/api/leads/notificado")
async def api_leads_notificado(req: Request):
    """O robô avisa que já mandou a confirmação de pagamento pra esse lead."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    chave = dados.get("chave", "")
    if chave:
        db.marcar_notificado(chave)
    return {"ok": True}


# ---------- PORTA DE ENTRADA: o modal "Quero minha LP" do site ----------

@app.post("/contato")
async def receber_contato(req: Request):
    """
    O modal da página de vendas manda pra cá (nome + WhatsApp).
    Guarda o contato pro robô puxar depois. Rota pública (sem token).
    Espera JSON: { nome, telefone, mensagem?, origem?, website? }
    ("website" é armadilha anti-robô: se vier preenchido, é bot.)
    """
    try:
        dados = await req.json()
    except Exception:
        dados = {}

    # armadilha pra bot: campo escondido que humano nunca preenche
    if (dados.get("website") or "").strip():
        return {"ok": True}  # finge que deu certo e ignora

    nome = (dados.get("nome") or "").strip()
    telefone = so_digitos(dados.get("telefone"))
    area = (dados.get("area") or "").strip()[:80]
    mensagem = (dados.get("mensagem") or "").strip()[:500]
    origem = (dados.get("origem") or "site").strip()[:40]

    if not nome or len(telefone) < 10:
        raise HTTPException(status_code=400, detail="preencha nome e um WhatsApp válido")

    # não duplica se a pessoa apertar enviar duas vezes
    if db.contato_recente_mesmo_numero(telefone):
        return {"ok": True, "repetido": True}

    novo_id = db.criar_contato(nome, telefone, area, origem, mensagem)
    return {"ok": True, "id": novo_id}


@app.get("/api/contatos")
def api_contatos(token: str = ""):
    """O robô do WhatsApp puxa os contatos novos (os que ele ainda não falou)."""
    exige_token(token)
    novos = db.contatos_novos()
    return {"ok": True, "contatos": novos}


@app.post("/api/contatos/status")
async def api_contatos_status(req: Request):
    """O robô avisa quais contatos ele já puxou no WhatsApp."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    ids = dados.get("ids") or []
    db.marcar_contatado([int(i) for i in ids if str(i).isdigit()])
    return {"ok": True}


# ---------- RESGATE DE LEAD + ATENDIMENTO (o robô cutuca quem não preencheu) ----------

@app.get("/api/contatos/resgate")
def api_resgate(token: str = ""):
    """Contatos que receberam o link do briefing e não preencheram, prontos pra lembrete."""
    exige_token(token)
    due = db.contatos_para_resgate()
    return {"ok": True, "contatos": [
        {"id": c["id"], "nome": c.get("nome") or "", "telefone": c.get("telefone") or "",
         "lembretes": c.get("lembretes") or 0}
        for c in due
    ]}


@app.post("/api/contatos/lembrete")
async def api_lembrete(req: Request):
    """O robô avisa que mandou mais um lembrete de resgate pra esse contato."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    cid = dados.get("id")
    if cid is not None and str(cid).isdigit():
        db.registrar_lembrete(int(cid))
    return {"ok": True}


@app.get("/api/cliente")
def api_cliente(token: str = "", tel: str = ""):
    """Retrato do cliente por telefone: se pediu atendimento (robô calado), se tem
    projeto (lead) e se tem contato. O robô usa isso pra decidir o que responder."""
    exige_token(token)
    lead = db.lead_por_telefone(tel)
    contato = db.contato_por_telefone(tel)
    atendimento = db.atendimento_ativo(contato)
    if contato and (contato.get("atendimento") or 0) and not atendimento:
        db.liberar_atendimento(tel)   # passaram 24h sem a Isa falar: volta pro robô
    return {
        "ok": True,
        "atendimento": atendimento,
        "lead": ({"chave": lead["chave"], "nome": lead.get("nome") or "",
                  "status": lead.get("status") or "pago"} if lead else None),
        "contato": ({"id": contato["id"], "nome": contato.get("nome") or "",
                     "status": contato.get("status") or "",
                     "preencheu": bool(contato.get("preencheu") or 0)} if contato else None),
    }


@app.post("/api/cliente/atendimento")
async def api_cliente_atendimento(req: Request):
    """Atendimento humano. acao: "pedir" (cliente pediu, robô cala), "tocar" (a Isa
    mandou mensagem, renova as 24h) ou "liberar" (#robo: devolve pro robô)."""
    dados = await req.json()
    exige_token(dados.get("token", ""))
    tel = dados.get("tel", "")
    acao = dados.get("acao") or "pedir"
    if acao == "tocar":
        n = db.tocar_atendimento(tel)
    elif acao == "liberar":
        n = db.liberar_atendimento(tel)
    else:
        n = db.marcar_atendimento(tel)
    return {"ok": True, "acao": acao, "marcados": n}


# ---------- BRIEFING servido pelo domínio da Isa (sem Google na frente) ----------

def _limpa(s):
    return re.sub(r'["\\<>]', "", s or "")


@app.get("/briefing", response_class=HTMLResponse)
def briefing_form(nome: str = "", tel: str = ""):
    """Serve o formulário de briefing. nome/tel vêm do link que o robô mandou."""
    try:
        html = open(FORM_HTML, encoding="utf-8").read()
    except Exception:
        return HTMLResponse(_pagina("Ops", "Não consegui abrir o briefing agora. Tenta de novo em instantes."),
                            status_code=500)
    html = html.replace("__NOME__", _limpa(nome)).replace("__TEL__", so_digitos(tel))
    return HTMLResponse(html)


@app.get("/briefing/{tel}", response_class=HTMLResponse)
def briefing_form_path(tel: str = ""):
    """Mesma tela, com o telefone no CAMINHO (sem ?/=). O WhatsApp no celular
    corta links com query string, então o robô manda assim. O nome a gente busca
    sozinho pelo contato (não precisa ir na URL)."""
    nome = ""
    try:
        c = db.contato_por_telefone(tel)
        if c:
            nome = c.get("nome") or ""
    except Exception:
        pass
    return briefing_form(nome=nome, tel=tel)


# ---------- ACOMPANHAR: a página onde o cliente vê o status do projeto ----------

@app.get("/acompanhar", response_class=HTMLResponse)
def acompanhar_page(chave: str = ""):
    """Serve a página de acompanhamento. A 'chave' (que o robô manda no link) é
    o próprio segredo: só quem tem o link do projeto consegue abrir."""
    try:
        html = open(ACOMP_HTML, encoding="utf-8").read()
    except Exception:
        return HTMLResponse(_pagina("Ops", "Não consegui abrir o acompanhamento agora. Tenta de novo em instantes."),
                            status_code=500)
    html = html.replace("__CHAVE__", _limpa(chave))
    return HTMLResponse(html)


@app.get("/acompanhar/{chave}", response_class=HTMLResponse)
def acompanhar_page_path(chave: str = ""):
    """Mesma página, com a chave no CAMINHO (sem ?/=). O WhatsApp no celular
    reconhece melhor o link inteiro assim. A rota ?chave= continua valendo."""
    return acompanhar_page(chave)


# ---------- AVALIAR: depois da entrega, o cliente dá de 0 a 5 estrelas + comentário ----------

@app.get("/avaliar", response_class=HTMLResponse)
def avaliar_page(chave: str = ""):
    """Página de avaliação. Como no acompanhar, a chave do link é o segredo."""
    try:
        html = open(AVAL_HTML, encoding="utf-8").read()
    except Exception:
        return HTMLResponse(_pagina("Ops", "Não consegui abrir a avaliação agora. Tenta de novo em instantes."),
                            status_code=500)
    return HTMLResponse(html.replace("__CHAVE__", _limpa(chave)))


@app.get("/avaliar/{chave}", response_class=HTMLResponse)
def avaliar_page_path(chave: str = ""):
    """Mesma página, com a chave no caminho (o WhatsApp não corta o link)."""
    return avaliar_page(chave)


@app.get("/api/avaliacao")
def api_avaliacao_get(chave: str = ""):
    """Nome do cliente e a avaliação que ele já deixou (se deixou)."""
    lead = db.get_lead((chave or "").strip())
    if not lead:
        return JSONResponse({"ok": False, "erro": "projeto não encontrado"}, status_code=404)
    av = db.get_avaliacao(lead["chave"])
    return {"ok": True, "nome": lead.get("nome") or "",
            "nota": av["nota"] if av else None, "comentario": (av or {}).get("comentario") or "",
            "autoriza": bool((av or {}).get("autoriza"))}


@app.post("/api/avaliacao")
async def api_avaliacao_post(req: Request):
    """O cliente envia a nota (0 a 5) e o comentário. O robô avisa a Isa no WhatsApp."""
    try:
        dados = await req.json()
    except Exception:
        dados = {}
    lead = db.get_lead(str(dados.get("chave") or "").strip())
    if not lead:
        return JSONResponse({"ok": False, "erro": "projeto não encontrado"}, status_code=404)
    try:
        nota = int(dados.get("nota"))
    except Exception:
        nota = -1
    if not 0 <= nota <= 5:
        return JSONResponse({"ok": False, "erro": "escolha de 0 a 5 estrelas"}, status_code=400)
    comentario = str(dados.get("comentario") or "").strip()[:2000]
    db.salvar_avaliacao(lead["chave"], nota, comentario, bool(dados.get("autoriza")))
    return {"ok": True}


@app.post("/api/revisao/evento")
async def api_revisao_evento(req: Request):
    """A página de revisão avisa: o cliente enviou os ajustes ou aprovou. Vem do
    navegador do cliente (sem senha); a chave do cliente é o segredo."""
    try:
        dados = json.loads((await req.body()) or b"{}")
    except Exception:
        dados = {}
    lead = db.get_lead(str(dados.get("lead") or "").strip())
    if not lead:
        return JSONResponse({"ok": False, "erro": "cliente não encontrado"}, status_code=404)
    tipo = str(dados.get("tipo") or "")
    if tipo not in ("ajustes", "aprovado"):
        return JSONResponse({"ok": False, "erro": "tipo inválido"}, status_code=400)
    try:
        n = max(0, min(99, int(dados.get("n") or 0)))
    except Exception:
        n = 0
    rodada = re.sub(r"[^0-9a-zA-Z_-]", "", str(dados.get("rodada") or ""))[:40] or "0"
    projeto = re.sub(r"[\x00-\x1f]", " ", str(dados.get("projeto") or "")).strip()[:80]
    entrou = db.salvar_evento_revisao(lead["chave"], rodada, tipo, n, projeto)
    return {"ok": True, "novo": entrou}


@app.get("/api/revisao/eventos/pendentes")
def api_revisao_eventos_pendentes(token: str = ""):
    """O robô pergunta: algum cliente mandou ajustes ou aprovou?"""
    exige_token(token)
    return {"ok": True, "eventos": db.eventos_revisao_pendentes()}


@app.post("/api/revisao/eventos/notificado")
async def api_revisao_evento_notificado(req: Request):
    dados = await req.json()
    exige_token(dados.get("token", ""))
    if dados.get("id"):
        db.marcar_evento_revisao(int(dados["id"]))
    return {"ok": True}


@app.get("/api/avaliacoes/pendentes")
def api_avaliacoes_pendentes(token: str = ""):
    """O robô pergunta: tem avaliação nova pra avisar a Isa?"""
    exige_token(token)
    return {"ok": True, "avaliacoes": db.avaliacoes_para_notificar()}


@app.post("/api/avaliacoes/notificada")
async def api_avaliacao_notificada(req: Request):
    dados = await req.json()
    exige_token(dados.get("token", ""))
    if dados.get("id"):
        db.marcar_avaliacao_notificada(int(dados["id"]))
    return {"ok": True}


@app.get("/api/acompanhar")
def api_acompanhar(chave: str = ""):
    """Devolve o status do projeto pela chave (público: a chave é o segredo)."""
    lead = db.get_lead((chave or "").strip())
    if not lead:
        return JSONResponse({"ok": False, "erro": "projeto não encontrado"}, status_code=404)
    return {
        "ok": True,
        "nome": lead.get("nome") or "",
        "status": lead.get("status") or "pago",
        "entrega": lead.get("entrega") or "",
    }


@app.post("/briefing/salvar")
def briefing_salvar(dados: dict = Body(...)):
    """
    Recebe o briefing do formulário (mesmo domínio, sem CORS) e REPASSA pro
    Apps Script salvar no Google Sheets + Drive. A senha do Apps Script fica
    só aqui no servidor, nunca aparece pro cliente.
    """
    if not BRIEFING_APPS_URL:
        return JSONResponse({"ok": False, "erro": "briefing ainda não configurado no servidor"}, status_code=503)
    corpo = dict(dados or {})
    corpo["tipo"] = "briefing"
    corpo["token"] = BRIEFING_APPS_TOKEN
    try:
        r = requests.post(BRIEFING_APPS_URL, json=corpo, timeout=90, allow_redirects=True)
    except Exception:
        return JSONResponse({"ok": False, "erro": "não consegui falar com o Apps Script"}, status_code=502)
    ok = (r.status_code == 200)
    try:
        j = r.json()
        if isinstance(j, dict) and j.get("ok") is False:
            ok = False
    except Exception:
        pass
    if not ok:
        return JSONResponse({"ok": False, "erro": "o Apps Script não confirmou o salvamento"}, status_code=502)
    # terminou o briefing: guarda nome + telefone + respostas no lead (pro card na
    # Fábrica já nascer completo e o robô reconhecer o cliente), e para o resgate.
    try:
        nome = (dados.get("nome") or "").strip()
        tel = so_digitos(dados.get("tel") or dados.get("TEL") or dados.get("telefone")
                         or dados.get("whatsapp") or "")
        chave = str(dados.get("chave") or "").strip() or tel
        respostas = dados.get("respostas") or {}
        if chave:
            db.salvar_briefing_lead(chave, nome, tel, respostas)
        if tel or chave:
            db.marcar_preencheu(tel or chave)
    except Exception:
        pass
    return {"ok": True}


# ---------- PAGAMENTO: o briefing (Apps Script) manda o cliente pra cá pela chave ----------

@app.get("/pagar")
def pagar(chave: str = "", nome: str = "", tel: str = ""):
    """
    O cliente termina o briefing (que foi salvo no Google Sheets/Drive) e cai aqui
    pra pagar. A gente garante um lead com essa 'chave' (pro webhook marcar pago)
    e redireciona pro checkout do Stripe. Briefing e pagamento se juntam pela chave.
    """
    chave = (chave or "").strip()
    if not chave:
        return HTMLResponse(
            _pagina("Link incompleto", "Faltou identificar o seu pedido. Volte ao briefing e tente de novo."),
            status_code=400,
        )

    db.garantir_lead(chave, (nome or "").strip(), so_digitos(tel))

    if not stripe:
        return HTMLResponse(_pagina(
            "Pagamento sendo ativado",
            "Seu briefing já está guardado! O pagamento ainda está sendo ligado — já já a gente te manda o link. 💗"))

    try:
        sessao = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency": "brl",
                    "unit_amount": preco_atual()[0],
                    "product_data": {"name": preco_atual()[1]},
                },
            }],
            metadata={"chave": chave},
            allow_promotion_codes=True,   # campo de cupom no checkout (promoções, teste 100%)
            success_url=BASE_URL + "/obrigado?c=" + chave,
            cancel_url=BASE_URL + "/pagamento-cancelado?c=" + chave,
        )
        db.set_stripe_id(chave, sessao.id)
        return RedirectResponse(sessao.url, status_code=303)
    except Exception as e:
        return HTMLResponse(_pagina(
            "Não consegui abrir o pagamento",
            "Deu um tropeço aqui. Tenta de novo em instantes — seu briefing está guardado."),
            status_code=502)


@app.get("/obrigado", response_class=HTMLResponse)
def obrigado():
    return _pagina("Pagamento confirmado! 💗",
                   "Recebemos tudo. Sua landing page entrou na fila de produção — a gente te chama no WhatsApp quando ela estiver pronta pra revisão.")


@app.get("/pagamento-cancelado", response_class=HTMLResponse)
def cancelado():
    return _pagina("Pagamento não concluído",
                   "Tudo bem! Seu briefing ficou guardado. Quando quiser, é só concluir o pagamento pelo mesmo link.")


def _pagina(titulo, texto):
    return (
        "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>" + titulo + "</title></head>"
        "<body style='margin:0;min-height:100vh;display:grid;place-items:center;"
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf7f9;color:#1e2430'>"
        "<div style='max-width:460px;text-align:center;padding:40px 24px'>"
        "<h1 style='font-size:24px;color:#d6246e'>" + titulo + "</h1>"
        "<p style='font-size:16px;line-height:1.5;color:#555'>" + texto + "</p></div></body></html>"
    )
