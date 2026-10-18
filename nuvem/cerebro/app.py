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
PRECO_CENTAVOS = int(os.environ.get("PRECO_CENTAVOS", "9700"))     # R$ 97,00
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")      # endereço público do cérebro

# o briefing é servido por aqui (no domínio da Isa) e repassado ao Apps Script,
# que guarda as respostas no Google Sheets e os arquivos no Drive.
BRIEFING_APPS_URL = os.environ.get("BRIEFING_APPS_URL", "")        # o /exec do Apps Script
BRIEFING_APPS_TOKEN = os.environ.get("BRIEFING_APPS_TOKEN", "")    # a SEGREDO do Apps Script
FORM_HTML = os.path.join(os.path.dirname(__file__), "briefing_form.html")
ACOMP_HTML = os.path.join(os.path.dirname(__file__), "acompanhar.html")

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
                    "unit_amount": PRECO_CENTAVOS,
                    "product_data": {"name": "Landing page — Fábrica de LPs"},
                },
            }],
            metadata={"chave": chave},
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
    if stripe and STRIPE_WEBHOOK_SECRET:
        try:
            evento = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        except Exception as e:
            raise HTTPException(status_code=400, detail="assinatura inválida: " + str(e))
    else:
        evento = json.loads(payload or b"{}")

    tipo = evento.get("type") if isinstance(evento, dict) else evento["type"]
    if tipo == "checkout.session.completed":
        obj = (evento["data"]["object"] if isinstance(evento, dict) else evento.data.object)
        chave = (obj.get("metadata") or {}).get("chave")
        stripe_id = obj.get("id")
        db.marcar_pago(chave=chave, stripe_id=stripe_id)

    return {"recebido": True}


@app.get("/api/leads")
def api_leads(token: str = ""):
    """A Fábrica chama de tempos em tempos. Devolve os leads PAGOS que ainda não foram pro quadro."""
    exige_token(token)
    pagos = db.leads_pagos_nao_puxados()
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
    # marca como puxados só depois de montar a resposta (se a Fábrica confirmar o recebimento)
    db.marcar_puxado([l["chave"] for l in pagos])
    return {"ok": True, "leads": saida}


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
                    "unit_amount": PRECO_CENTAVOS,
                    "product_data": {"name": "Landing page — Fábrica de LPs"},
                },
            }],
            metadata={"chave": chave},
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
