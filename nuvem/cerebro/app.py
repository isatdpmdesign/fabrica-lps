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
import json
import time
import secrets

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse

import db

VERSAO = 1

# ---- configuração (tudo por variável de ambiente, nada de segredo no código) ----
SEGREDO = os.environ.get("SEGREDO", "troque-esta-senha")          # a Fábrica usa pra puxar os leads
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")        # sk_live_... ou sk_test_...
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")  # whsec_...
PRECO_CENTAVOS = int(os.environ.get("PRECO_CENTAVOS", "9700"))     # R$ 97,00
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")      # endereço público do cérebro

stripe = None
if STRIPE_SECRET_KEY:
    import stripe as _stripe
    _stripe.api_key = STRIPE_SECRET_KEY
    stripe = _stripe

app = FastAPI(title="Cérebro da Fábrica de LPs")
db.iniciar()


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
    if chave and status:
        db.set_status(chave, status)
    return {"ok": True}


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
