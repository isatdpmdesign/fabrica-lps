"""
robo.py — o ROBÔ de WhatsApp da Fábrica de LPs (Open Design).

O que ele faz (Fase 1, o essencial pro lançamento):
  1) A pessoa preenche o modal do site -> vira um "contato" no cérebro.
  2) O ROBÔ puxa a conversa: de tempos em tempos ele pergunta ao cérebro se
     tem contato novo e, quando tem, manda sozinho a 1ª mensagem com o LINK
     DO BRIEFING. O cliente não precisa saber o número da Fábrica nem mandar
     nada primeiro.
  3) Marca o contato como "contatado" no cérebro (pra não mandar de novo).

Rede de segurança (modo antigo): se mesmo assim alguém mandar uma mensagem
pra Fábrica, o robô reconhece o contato novo e responde na hora.

Como a gente já tem o número certo (veio do formulário), o envio ativo não
depende do WhatsApp revelar o número de quem escreveu (o tal do @lid).

Motor de WhatsApp: Evolution API (self-hosted, no mesmo servidor ARM).
Não usa IA paga: é regra simples (contato novo -> manda o link).

Rodar:  uvicorn robo:app --host 127.0.0.1 --port 8100
"""
import os
import re
import time
import logging
import threading
import urllib.parse

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

BRIEFING_URL = os.environ.get("BRIEFING_URL", "")             # link público do briefing

# De quanto em quanto tempo o robô olha o cérebro atrás de contato novo.
# 0 desliga o modo ativo (fica só o reativo, como antes).
POLL_SEGUNDOS = int(os.environ.get("POLL_SEGUNDOS", "15"))
# Respiro entre um envio e outro, pra não disparar muita mensagem de uma vez
# (proteção do número da Fábrica).
ENVIO_PAUSA_SEGUNDOS = float(os.environ.get("ENVIO_PAUSA_SEGUNDOS", "4"))

# mensagem que o robô manda quando reconhece um contato novo.
# {nome} vira o primeiro nome da pessoa.
MSG_BRIEFING = os.environ.get(
    "MSG_BRIEFING",
    "Oii, {nome}! Que alegria que você quer sua landing page 💗\n\n"
    "Pra eu começar, me conta tudo sobre seu projeto nesse formulário rapidinho:\n{link}\n\n"
    "Assim que você preencher, eu já te mando o link do pagamento e sua página entra na fila de produção. 🚀",
)

# número PESSOAL da Isa (pra avisar quando um cliente pede atendimento).
# É diferente do número da Fábrica — o robô não avisa a si mesmo.
ISA_WHATSAPP = os.environ.get("ISA_WHATSAPP", "")

# --- resgate de lead (cutuca quem recebeu o briefing e não preencheu) ---
MSG_RESGATE1 = os.environ.get("MSG_RESGATE1",
    "Oi, {nome}! 💗 Vi aqui que você pediu sua landing page mas ainda não preencheu o briefing. "
    "Se você travou em alguma pergunta, me fala que eu te ajudo! Responder o briefing é rapidinho, "
    "e é por ele que eu começo a criar sua página: {link}")

MSG_RESGATE2 = os.environ.get("MSG_RESGATE2",
    "Oi, {nome}! 💗 Passando só pra lembrar da sua página, enquanto a condição de fundador ainda tá valendo. "
    "Vai mesmo perder essa oportunidade? Se quiser seguir, é só terminar o briefing aqui:\n{link}")

# --- menu quando o cliente manda mensagem ---
MSG_MENU = os.environ.get("MSG_MENU",
    "Oi, {nome}! 💗 Como posso te ajudar?\n\n"
    "Responde com o número:\n*1* pra ver o status da sua página\n*2* pra falar comigo")

MSG_STATUS = os.environ.get("MSG_STATUS",
    "Olha aqui o status da sua página, {nome}! 💗\nÉ só abrir aqui:\n{link}\n\n"
    "Pode acompanhar por aí quando quiser. Quando ficar pronta, eu te aviso.")

MSG_ATENDIMENTO_CLIENTE = os.environ.get("MSG_ATENDIMENTO_CLIENTE",
    "Prontinho, {nome}! Já avisei a Isa e ela te responde pessoalmente por aqui, tá? 💗")

MSG_AVISO_ISA = os.environ.get("MSG_AVISO_ISA",
    "👋 {nome} ({telefone}) pediu pra falar com você. O robô já parou de responder essa conversa, é só você assumir.")

MSG_REENVIO = os.environ.get("MSG_REENVIO",
    "Oi, {nome}! 💗 Que bom te ver por aqui. Pra eu começar a sua página, é só preencher o briefing rapidinho:\n{link}")

# mandada sozinha assim que o pagamento é confirmado (pós-pagamento).
MSG_PAGO = os.environ.get("MSG_PAGO",
    "Oi, {nome}! 💗 Seu pagamento caiu certinho, muito obrigada pela confiança! Já tô começando a cuidar da sua página.\n"
    "Você pode acompanhar como ela tá ficando por aqui:\n{link}\n\n"
    "Quando ela ficar pronta, eu te chamo. Qualquer coisa, é só me responder por aqui.")

app = FastAPI(title="Robô WhatsApp — Fábrica de LPs")

# memória do processo: ids de contatos pra quem o robô já mandou o link.
# serve de trava: se marcar "contatado" no cérebro falhar, o robô não fica
# reenviando a mesma mensagem a cada volta do loop.
_ja_enviei = set()


def so_digitos(texto):
    return re.sub(r"\D", "", texto or "")


def numero_whatsapp(telefone):
    """Deixa o número no formato que a Evolution entende (com o DDI 55).
    - 10 dígitos (fixo: DDD + 8) ou 11 (celular: DDD + 9) -> põe o 55 na frente.
    - 12/13 dígitos (já tem o 55) -> mantém como está.
    O modal do site às vezes salva o número sem o 55; aqui a gente conserta
    antes de enviar, pra Evolution não recusar a entrega."""
    d = so_digitos(telefone)
    if len(d) in (10, 11):
        d = "55" + d
    return d


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
def listar_contatos_novos():
    """Todos os contatos NOVOS (ainda não contatados) que estão no cérebro."""
    try:
        r = requests.get(
            f"{CEREBRO_URL}/api/contatos",
            params={"token": CEREBRO_TOKEN}, timeout=15,
        )
        if r.status_code != 200:
            log.warning("cérebro /api/contatos HTTP %s", r.status_code)
            return []
        return r.json().get("contatos") or []
    except Exception as e:
        log.warning("erro consultando o cérebro: %s", e)
        return []


def contato_novo_por_numero(numero):
    """Procura, entre os contatos NOVOS do cérebro, um com este número."""
    numero = so_digitos(numero)
    for c in listar_contatos_novos():
        tel = so_digitos(c.get("telefone"))
        # compara pelos últimos 8 dígitos (ignora DDI/9 extra que o WhatsApp às vezes muda)
        if tel and numero and tel[-8:] == numero[-8:]:
            return c
    return None


def marcar_contatado(contato_id):
    try:
        requests.post(
            f"{CEREBRO_URL}/api/contatos/status",
            json={"token": CEREBRO_TOKEN, "ids": [contato_id]}, timeout=15,
        )
    except Exception as e:
        log.warning("não marquei contatado (%s): %s", contato_id, e)


# ---------------- a regra: atender um contato novo ----------------
def montar_link_briefing(nome, numero):
    """Link do briefing com o telefone no CAMINHO (sem ?/=). O WhatsApp no celular
    corta links com query string (perde o ?nome=&tel=), então vai pelo caminho:
    .../briefing/<telefone>. O telefone é a CHAVE que costura briefing e pagamento;
    o nome o cérebro busca sozinho pelo contato."""
    base = BRIEFING_URL.rstrip("/")
    return base + "/" + urllib.parse.quote(so_digitos(numero), safe="")


def atender(contato, numero):
    """Manda o link do briefing pro contato e, se der certo, marca contatado.
    Devolve True se enviou."""
    if not BRIEFING_URL:
        log.warning("BRIEFING_URL não configurado — não consigo mandar o link do briefing")
        return False
    cid = contato.get("id")
    if cid in _ja_enviei:
        # já mandei nesta sessão: não repito, mesmo que ainda apareça como "novo".
        return False
    numero = numero_whatsapp(numero)  # garante o 55 na frente
    nome_completo = contato.get("nome") or ""
    link = montar_link_briefing(nome_completo, numero)
    enviou = enviar_whatsapp(numero, MSG_BRIEFING.format(nome=primeiro_nome(nome_completo), link=link))
    if enviou:
        _ja_enviei.add(cid)
        marcar_contatado(cid)
        log.info("atendi %s (%s) com o link do briefing ✓", primeiro_nome(nome_completo), numero)
    return enviou


# ---------------- Parte B: menu, resgate e atendimento ----------------
def link_acompanhar(chave):
    # URL de caminho (sem ?/=): o WhatsApp no celular reconhece o link inteiro
    # melhor do que com query string. A rota ?chave= continua valendo também.
    return CEREBRO_URL + "/acompanhar/" + urllib.parse.quote(chave or "", safe="")


def cliente_info(numero):
    """Pergunta ao cérebro quem é esse número: pediu atendimento? tem projeto? tem contato?"""
    try:
        r = requests.get(f"{CEREBRO_URL}/api/cliente",
                         params={"token": CEREBRO_TOKEN, "tel": numero}, timeout=15)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        log.warning("erro consultando cliente %s: %s", numero, e)
    return {}


def interpretar(texto):
    """Lê a escolha do menu (1 = status, 2 = atendimento). Aceita número ou palavra."""
    t = (texto or "").strip().lower()
    if not t:
        return None
    if t[0] == "2" or "atend" in t or "falar" in t or "humano" in t:
        return "2"
    if t[0] == "1" or "status" in t or "acompanh" in t:
        return "1"
    return None


def pedir_atendimento(numero, nome_curto, nome_completo):
    """Cliente quer falar com a Isa: marca no cérebro (robô cala), confirma pro
    cliente e avisa a Isa no WhatsApp pessoal dela."""
    try:
        requests.post(f"{CEREBRO_URL}/api/cliente/atendimento",
                      json={"token": CEREBRO_TOKEN, "tel": numero}, timeout=15)
    except Exception as e:
        log.warning("não consegui marcar atendimento (%s): %s", numero, e)
    enviar_whatsapp(numero, MSG_ATENDIMENTO_CLIENTE.format(nome=nome_curto))
    if ISA_WHATSAPP:
        enviar_whatsapp(numero_whatsapp(ISA_WHATSAPP),
                        MSG_AVISO_ISA.format(nome=(nome_completo or nome_curto), telefone=numero))
    log.info("%s (%s) pediu atendimento — robô calado, Isa avisada", nome_curto, numero)


def enviar_confirmacoes_pagamento():
    """Assim que alguém paga, manda a confirmação no WhatsApp com o link de
    acompanhamento. Uma vez só por cliente."""
    try:
        r = requests.get(f"{CEREBRO_URL}/api/leads/notificar",
                         params={"token": CEREBRO_TOKEN}, timeout=15)
        if r.status_code != 200:
            return
        for l in (r.json().get("leads") or []):
            numero = numero_whatsapp(l.get("telefone"))
            if not numero:
                continue
            nome = primeiro_nome(l.get("nome"))
            link = link_acompanhar(l.get("chave"))
            if enviar_whatsapp(numero, MSG_PAGO.format(nome=nome, link=link)):
                try:
                    requests.post(f"{CEREBRO_URL}/api/leads/notificado",
                                  json={"token": CEREBRO_TOKEN, "chave": l.get("chave")}, timeout=15)
                except Exception:
                    pass
                log.info("confirmei pagamento -> %s (%s)", nome, numero)
                time.sleep(ENVIO_PAUSA_SEGUNDOS)
    except Exception as e:
        log.warning("erro nas confirmações de pagamento: %s", e)


def enviar_resgates():
    """Cutuca quem recebeu o link do briefing e não preencheu (máx 2 lembretes)."""
    try:
        r = requests.get(f"{CEREBRO_URL}/api/contatos/resgate",
                         params={"token": CEREBRO_TOKEN}, timeout=15)
        if r.status_code != 200:
            return
        for c in (r.json().get("contatos") or []):
            numero = numero_whatsapp(c.get("telefone"))
            if not numero:
                continue
            nome = primeiro_nome(c.get("nome"))
            link = montar_link_briefing(c.get("nome") or "", numero)
            msg = MSG_RESGATE1 if (c.get("lembretes") or 0) == 0 else MSG_RESGATE2
            if enviar_whatsapp(numero, msg.format(nome=nome, link=link)):
                try:
                    requests.post(f"{CEREBRO_URL}/api/contatos/lembrete",
                                  json={"token": CEREBRO_TOKEN, "id": c.get("id")}, timeout=15)
                except Exception:
                    pass
                log.info("lembrete de resgate %d -> %s (%s)", (c.get("lembretes") or 0) + 1, nome, numero)
                time.sleep(ENVIO_PAUSA_SEGUNDOS)
    except Exception as e:
        log.warning("erro no resgate: %s", e)


# ---------------- modo ATIVO: o robô vigia o cérebro e puxa a conversa ----------------
def _loop_vigia():
    log.info("modo ativo ligado: olhando o cérebro a cada %ss", POLL_SEGUNDOS)
    while True:
        try:
            for contato in listar_contatos_novos():
                numero = so_digitos(contato.get("telefone"))
                if not numero:
                    continue
                if atender(contato, numero):
                    time.sleep(ENVIO_PAUSA_SEGUNDOS)  # respiro entre envios
            enviar_confirmacoes_pagamento()  # avisa quem acabou de pagar
            enviar_resgates()  # cutuca quem recebeu o briefing e não preencheu
        except Exception as e:
            log.warning("erro no loop do modo ativo: %s", e)
        time.sleep(POLL_SEGUNDOS)


@app.on_event("startup")
def ligar_modo_ativo():
    if POLL_SEGUNDOS > 0:
        threading.Thread(target=_loop_vigia, daemon=True).start()
    else:
        log.info("modo ativo desligado (POLL_SEGUNDOS=0) — só responde quem mandar mensagem")


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
    # o WhatsApp às vezes esconde o número real atrás de um @lid; nesse caso o
    # número de verdade vem em senderPn / remoteJidAlt.
    real = data.get("senderPn") or key.get("remoteJidAlt") or ""
    if "@lid" in remote and real:
        numero = so_digitos(real.split("@")[0])
    else:
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
        "modo_ativo": POLL_SEGUNDOS > 0,
        "poll_segundos": POLL_SEGUNDOS,
        "tem_isa_whatsapp": bool(ISA_WHATSAPP),
    }


@app.post("/whatsapp")
async def webhook_whatsapp(req: Request):
    """Rede de segurança: se alguém mandar mensagem pra Fábrica, o robô
    reconhece o contato novo e responde na hora."""
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

    info = cliente_info(numero)

    # cliente que pediu atendimento: o robô fica calado (a Isa assumiu a conversa)
    if info.get("atendimento"):
        log.info("%s está em atendimento humano — robô calado", numero)
        return {"ok": True}

    lead = info.get("lead")
    contato = info.get("contato")
    nome_completo = (lead and lead.get("nome")) or (contato and contato.get("nome")) or nome_push
    nome = primeiro_nome(nome_completo)

    # JÁ É CLIENTE (projeto pago): menu, ou responde a escolha (1 status / 2 atendimento)
    if lead:
        escolha = interpretar(texto)
        if escolha == "2":
            pedir_atendimento(numero, nome, nome_completo)
        elif escolha == "1":
            enviar_whatsapp(numero, MSG_STATUS.format(nome=nome, link=link_acompanhar(lead.get("chave"))))
        else:
            enviar_whatsapp(numero, MSG_MENU.format(nome=nome))
        return {"ok": True}

    # AINDA NÃO PAGOU, mas é um contato conhecido (preencheu o modal)
    if contato:
        if contato.get("status") == "novo":
            # mandou mensagem antes de o robô puxar: manda o briefing agora
            atender({"id": contato.get("id"), "nome": nome_completo}, numero)
        else:
            # recebeu o link e ainda não fechou: reenvia o briefing na hora
            link = montar_link_briefing(nome_completo, numero_whatsapp(numero))
            enviar_whatsapp(numero, MSG_REENVIO.format(nome=nome, link=link))
        return {"ok": True}

    # número desconhecido (não preencheu o modal): deixa pra Isa, sem spam
    log.info("mensagem de %s (%s) — desconhecido, deixo pra você", numero, nome_push)
    return {"ok": True}
