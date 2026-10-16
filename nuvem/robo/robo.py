"""
robo.py — o ROBÔ de WhatsApp da Fábrica de LPs (Open Design).

O que ele faz (Fase 1, o essencial pro lançamento):
  1) A pessoa preenche o modal do site -> vira um "contato" no cérebro.
  2) A pessoa clica em "Falar no WhatsApp" e te manda a 1ª mensagem.
  3) O robô (ligado no SEU número via Evolution API) recebe essa mensagem,
     reconhece que é um contato novo e responde sozinho com o LINK DO BRIEFING.
  4) Marca o contato como "contatado" no cérebro (pra não responder de novo).

Quem fala primeiro é sempre o CLIENTE (ele clica no WhatsApp). O robô só
responde. Isso evita bloqueio e não precisa de template nenhum.

Motor de WhatsApp: Evolution API (self-hosted, no mesmo servidor ARM).
Não usa IA paga: é regra simples (recebeu -> manda o link).

Rodar:  uvicorn robo:app --host 127.0.0.1 --port 8100
"""
import os
import re
import logging

import requests
from fastapi import FastAPI, Request

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("robo")

# ---------------- configuração (tudo por variável de ambiente) ----------------
CEREBRO_URL   = os.environ.get("CEREBRO_URL", "http://127.0.0.1:8000").rstrip("/")
CEREBRO_TOKEN = os.environ.get("CEREBRO_TOKEN", "")            # a mesma SEGREDO do cérebro

EVOLUTION_URL      = os.environ.get("EVOLUTION_URL", "http://127.0.0.1:8080").rstrip("/")
EVOLUTION_KEY      = os.environ.get("EVOLUTION_KEY", "")       # apikey da Evolution
EVOLUTION_INSTANCE = os.environ.get("EVOLUTION_INSTANCE", "fabrica")

BRIEFING_URL = os.environ.get("BRIEFING_URL", "")             # link público do briefing (artifact)

# mensagem que o robô manda quando reconhece um contato novo.
# {nome} vira o primeiro nome da pessoa.
MSG_BRIEFING = os.environ.get(
    "MSG_BRIEFING",
    "Oii, {nome}! Que alegria que você quer sua landing page 💗\n\n"
    "Pra eu começar, me conta tudo sobre seu projeto nesse formulário rapidinho:\n{link}\n\n"
    "Assim que você preencher, eu já te mando o link do pagamento e sua página entra na fila de produção. 🚀",
)

app = FastAPI(title="Robô WhatsApp — Fábrica de LPs")


def so_digitos(texto):
    return re.sub(r"\D", "", texto or "")


def primeiro_nome(nome):
    nome = (nome or "").strip()
    return nome.split(" ")[0] if nome else "tudo bem?"


# ---------------- Evolution API (enviar mensagem) ----------------
def enviar_whatsapp(numero, texto):
    """Manda uma mensagem de texto pelo número conectado na Evolution."""
    url = f"{EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}"
    try:
        r = requests.post(
            url,
            headers={"apikey": EVOLUTION_KEY, "Content-Type": "application/json"},
            json={"number": numero, "text": texto},
            timeout=20,
        )
        ok = r.status_code in (200, 201)
        log.info("enviar p/ %s -> HTTP %s %s", numero, r.status_code, "" if ok else r.text[:200])
        return ok
    except Exception as e:
        log.warning("falha ao enviar p/ %s: %s", numero, e)
        return False


# ---------------- Cérebro (achar e marcar o contato) ----------------
def contato_novo_por_numero(numero):
    """Procura, entre os contatos NOVOS do cérebro, um com este número."""
    numero = so_digitos(numero)
    try:
        r = requests.get(
            f"{CEREBRO_URL}/api/contatos",
            params={"token": CEREBRO_TOKEN}, timeout=15,
        )
        if r.status_code != 200:
            log.warning("cérebro /api/contatos HTTP %s", r.status_code)
            return None
        for c in (r.json().get("contatos") or []):
            tel = so_digitos(c.get("telefone"))
            # compara pelos últimos 8 dígitos (ignora DDI/9 extra que o WhatsApp às vezes muda)
            if tel and numero and tel[-8:] == numero[-8:]:
                return c
    except Exception as e:
        log.warning("erro consultando o cérebro: %s", e)
    return None


def marcar_contatado(contato_id):
    try:
        requests.post(
            f"{CEREBRO_URL}/api/contatos/status",
            json={"token": CEREBRO_TOKEN, "ids": [contato_id]}, timeout=15,
        )
    except Exception as e:
        log.warning("não marquei contatado (%s): %s", contato_id, e)


# ---------------- extrair número + texto do evento da Evolution ----------------
def extrair_mensagem(corpo):
    """
    A Evolution manda o evento 'messages.upsert'. O 'data' pode vir como dict
    ou lista. Tira daí: número de quem mandou, texto, e se fui eu que mandei.
    """
    data = corpo.get("data")
    if isinstance(data, list):
        data = data[0] if data else {}
    data = data or {}

    key = data.get("key") or {}
    from_me = bool(key.get("fromMe"))
    remote = key.get("remoteJid") or ""
    numero = so_digitos(remote.split("@")[0])

    msg = data.get("message") or {}
    texto = (
        msg.get("conversation")
        or (msg.get("extendedTextMessage") or {}).get("text")
        or (msg.get("imageMessage") or {}).get("caption")
        or (msg.get("videoMessage") or {}).get("caption")
        or ""
    )
    nome_push = data.get("pushName") or ""
    return numero, texto, from_me, remote, nome_push


# ---------------- rotas ----------------
@app.get("/health")
def health():
    return {
        "ok": True,
        "cerebro": CEREBRO_URL,
        "evolution": EVOLUTION_URL,
        "instancia": EVOLUTION_INSTANCE,
        "tem_briefing": bool(BRIEFING_URL),
        "tem_token": bool(CEREBRO_TOKEN),
    }


@app.post("/whatsapp")
async def webhook_whatsapp(req: Request):
    """A Evolution chama aqui a cada mensagem recebida."""
    try:
        corpo = await req.json()
    except Exception:
        return {"ok": True}

    evento = corpo.get("event") or corpo.get("type") or ""
    # só nos interessa mensagem nova chegando
    if "messages.upsert" not in str(evento):
        return {"ok": True}

    numero, texto, from_me, remote, nome_push = extrair_mensagem(corpo)

    # ignora o que EU mesma mando, grupos e mensagens sem número
    if from_me or not numero or "@g.us" in (remote or ""):
        return {"ok": True}

    contato = contato_novo_por_numero(numero)
    if not contato:
        # número que não preencheu o modal (ou já foi atendido): o robô não responde,
        # deixa pra você cuidar na mão. Nada de spam.
        log.info("mensagem de %s (%s) — sem contato novo, deixo pra você", numero, nome_push)
        return {"ok": True}

    nome = primeiro_nome(contato.get("nome") or nome_push)
    if not BRIEFING_URL:
        log.warning("BRIEFING_URL não configurado — não consigo mandar o link do briefing")
        return {"ok": True}

    enviou = enviar_whatsapp(numero, MSG_BRIEFING.format(nome=nome, link=BRIEFING_URL))
    if enviou:
        marcar_contatado(contato.get("id"))
        log.info("respondi %s (%s) com o link do briefing ✓", nome, numero)
    return {"ok": True}
