"""
db.py — banco do cérebro (SQLite, sem firula).

Uma tabela só: leads. Cada briefing que o cliente responde vira uma linha.
O status conta a história: aguardando_pagamento -> pago -> (a Fábrica puxa) -> produzindo -> entregue.
"""
import sqlite3
import json
import os
import re
import time

# o arquivo do banco fica ao lado deste código (ou onde a env mandar)
DB_PATH = os.environ.get("CEREBRO_DB", os.path.join(os.path.dirname(__file__), "cerebro.db"))


def conectar():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def iniciar():
    """Cria a tabela na primeira vez. Chamado no boot do app."""
    con = conectar()
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            chave          TEXT UNIQUE,         -- id único do lead (vai no pagamento e no card)
            nome           TEXT,                -- nome do negócio/cliente
            telefone       TEXT,                -- WhatsApp
            area           TEXT,                -- tipo de negócio (vira a tag do card)
            respostas      TEXT,                -- o briefing inteiro, em JSON
            status         TEXT DEFAULT 'aguardando_pagamento',
            stripe_id      TEXT,                -- id da sessão de checkout do Stripe
            criado_em      TEXT,                -- quando respondeu o briefing (ISO)
            pago_em        TEXT,                -- quando o pagamento confirmou (ISO)
            puxado         INTEGER DEFAULT 0,   -- 1 = a Fábrica já trouxe pro quadro
            entrega        TEXT                 -- data de entrega (YYYY-MM-DD) que a Isa define
        )
        """
    )
    # migração: bancos antigos não têm a coluna 'entrega' — adiciona se faltar
    cols = [r[1] for r in con.execute("PRAGMA table_info(leads)").fetchall()]
    if "entrega" not in cols:
        con.execute("ALTER TABLE leads ADD COLUMN entrega TEXT")
    # tabela separada: CONTATOS (quem clicou "Quero minha LP" no modal da página).
    # É a porta de entrada, antes do briefing. O robô do WhatsApp lê daqui.
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS contatos (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            nome           TEXT,                -- nome de quem pediu
            telefone       TEXT,                -- WhatsApp (só dígitos)
            area           TEXT,                -- tipo de negócio / nicho (ex.: 'confeitaria')
            origem         TEXT,                -- de onde veio (ex.: 'site')
            mensagem       TEXT,                -- recado opcional que a pessoa deixou
            status         TEXT DEFAULT 'novo', -- novo -> contatado -> virou_lead
            criado_em      TEXT,                -- quando preencheu o modal (ISO)
            contatado_em   TEXT                 -- quando o robô falou no WhatsApp (ISO)
        )
        """
    )
    # migração: campos do resgate de lead e do atendimento humano
    cols_c = [r[1] for r in con.execute("PRAGMA table_info(contatos)").fetchall()]
    for col, ddl in [("preencheu", "INTEGER DEFAULT 0"),      # 1 = terminou o briefing
                     ("lembretes", "INTEGER DEFAULT 0"),      # quantos lembretes de resgate já foram
                     ("ultimo_lembrete", "TEXT"),             # quando foi o último lembrete
                     ("atendimento", "INTEGER DEFAULT 0")]:   # 1 = pediu atendimento, robô calado
        if col not in cols_c:
            con.execute("ALTER TABLE contatos ADD COLUMN " + col + " " + ddl)
    con.commit()
    con.close()


def agora():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def criar_lead(chave, nome, telefone, area, respostas):
    con = conectar()
    con.execute(
        "INSERT OR REPLACE INTO leads (chave, nome, telefone, area, respostas, status, criado_em) "
        "VALUES (?,?,?,?,?,'aguardando_pagamento',?)",
        (chave, nome, telefone, area, json.dumps(respostas, ensure_ascii=False), agora()),
    )
    con.commit()
    con.close()


def salvar_briefing_lead(chave, nome, telefone, respostas):
    """Guarda/atualiza o lead com o briefing no momento em que o cliente ENVIA
    (antes do pagamento). Assim o card na Fábrica já nasce com nome + respostas,
    e o lead já tem telefone pro robô reconhecer o cliente depois do pagamento.
    As respostas são sempre atualizadas; nome/telefone só preenchem se vazios."""
    resp_json = json.dumps(respostas or {}, ensure_ascii=False)
    con = conectar()
    row = con.execute("SELECT nome, telefone FROM leads WHERE chave=?", (chave,)).fetchone()
    if not row:
        con.execute(
            "INSERT INTO leads (chave, nome, telefone, area, respostas, status, criado_em) "
            "VALUES (?,?,?,?,?, 'aguardando_pagamento', ?)",
            (chave, nome or "Cliente", telefone, "", resp_json, agora()),
        )
    else:
        campos, valores = ["respostas=?"], [resp_json]
        if nome and (not (row["nome"] or "").strip() or row["nome"] == "Cliente"):
            campos.append("nome=?"); valores.append(nome)
        if telefone and not (row["telefone"] or "").strip():
            campos.append("telefone=?"); valores.append(telefone)
        valores.append(chave)
        con.execute("UPDATE leads SET " + ", ".join(campos) + " WHERE chave=?", valores)
    con.commit()
    con.close()


def set_stripe_id(chave, stripe_id):
    con = conectar()
    con.execute("UPDATE leads SET stripe_id=? WHERE chave=?", (stripe_id, chave))
    con.commit()
    con.close()


def marcar_pago(chave=None, stripe_id=None):
    """Marca como pago pela chave OU pelo id da sessão do Stripe (o webhook usa o stripe_id)."""
    con = conectar()
    if chave:
        con.execute("UPDATE leads SET status='pago', pago_em=? WHERE chave=? AND status!='pago'", (agora(), chave))
    elif stripe_id:
        con.execute("UPDATE leads SET status='pago', pago_em=? WHERE stripe_id=? AND status!='pago'", (agora(), stripe_id))
    con.commit()
    mud = con.total_changes
    con.close()
    return mud > 0


def leads_pagos_nao_puxados():
    """O que a Fábrica ainda não trouxe pro quadro (pagos)."""
    con = conectar()
    rows = con.execute("SELECT * FROM leads WHERE status='pago' AND puxado=0 ORDER BY pago_em").fetchall()
    con.close()
    return [dict(r) for r in rows]


def marcar_puxado(chaves):
    if not chaves:
        return
    con = conectar()
    con.executemany("UPDATE leads SET puxado=1 WHERE chave=?", [(c,) for c in chaves])
    con.commit()
    con.close()


def get_lead(chave):
    con = conectar()
    r = con.execute("SELECT * FROM leads WHERE chave=?", (chave,)).fetchone()
    con.close()
    return dict(r) if r else None


def set_status(chave, status=None, entrega=None):
    """Atualiza status e/ou data de entrega do lead. Passa só o que quer mudar."""
    campos, valores = [], []
    if status is not None:
        campos.append("status=?"); valores.append(status)
    if entrega is not None:
        campos.append("entrega=?"); valores.append(entrega)
    if not campos:
        return
    valores.append(chave)
    con = conectar()
    con.execute("UPDATE leads SET " + ", ".join(campos) + " WHERE chave=?", valores)
    con.commit()
    con.close()


def garantir_lead(chave, nome="", telefone="", area=""):
    """
    Garante que existe uma linha de lead pra essa chave, pra o pagamento poder
    marcar 'pago' depois. Se já existe, PREENCHE (backfill) nome/telefone/área
    só nos campos que estiverem vazios — nunca sobrescreve o que já tem. Assim o
    elo telefone↔lead se forma mesmo que o telefone chegue num evento posterior.
    """
    con = conectar()
    row = con.execute("SELECT nome, telefone, area FROM leads WHERE chave=?", (chave,)).fetchone()
    if not row:
        con.execute(
            "INSERT INTO leads (chave, nome, telefone, area, respostas, status, criado_em) "
            "VALUES (?,?,?,?, '{}', 'aguardando_pagamento', ?)",
            (chave, nome or "Cliente", telefone, area, agora()),
        )
    else:
        campos, valores = [], []
        # nome: preenche se estava vazio OU se era só o placeholder "Cliente"
        if nome and (not (row["nome"] or "").strip() or row["nome"] == "Cliente"):
            campos.append("nome=?"); valores.append(nome)
        if telefone and not (row["telefone"] or "").strip():
            campos.append("telefone=?"); valores.append(telefone)
        if area and not (row["area"] or "").strip():
            campos.append("area=?"); valores.append(area)
        if campos:
            valores.append(chave)
            con.execute("UPDATE leads SET " + ", ".join(campos) + " WHERE chave=?", valores)
    con.commit()
    con.close()


# ---------- CONTATOS (porta de entrada: o modal "Quero minha LP") ----------

def criar_contato(nome, telefone, area="", origem="site", mensagem=""):
    con = conectar()
    cur = con.execute(
        "INSERT INTO contatos (nome, telefone, area, origem, mensagem, status, criado_em) "
        "VALUES (?,?,?,?,?, 'novo', ?)",
        (nome, telefone, area, origem, mensagem, agora()),
    )
    con.commit()
    novo_id = cur.lastrowid
    con.close()
    return novo_id


def contatos_novos():
    """O que o robô ainda não puxou pra falar no WhatsApp."""
    con = conectar()
    rows = con.execute(
        "SELECT * FROM contatos WHERE status='novo' ORDER BY criado_em"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def contato_recente_mesmo_numero(telefone, janela_seg=90):
    """Evita duplicar se a pessoa clicar enviar duas vezes seguidas."""
    if not telefone:
        return False
    limite = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - janela_seg))
    con = conectar()
    r = con.execute(
        "SELECT 1 FROM contatos WHERE telefone=? AND criado_em>=? LIMIT 1",
        (telefone, limite),
    ).fetchone()
    con.close()
    return r is not None


def marcar_contatado(ids):
    if not ids:
        return
    con = conectar()
    con.executemany(
        "UPDATE contatos SET status='contatado', contatado_em=? WHERE id=?",
        [(agora(), i) for i in ids],
    )
    con.commit()
    con.close()


# ---------- resgate de lead + atendimento (Fase 2 / Parte B) ----------

def _so8(telefone):
    return re.sub(r"\D", "", telefone or "")[-8:]


def _match_tel(rows, telefone):
    """Filtra linhas cujo telefone bate pelos últimos 8 dígitos (ignora DDI/9 extra)."""
    alvo = _so8(telefone)
    if not alvo:
        return []
    return [r for r in rows if _so8(r["telefone"]) == alvo]


def marcar_preencheu(telefone):
    """Quando o cliente termina o briefing: para de cutucar com lembrete de resgate."""
    con = conectar()
    rows = con.execute("SELECT id, telefone FROM contatos").fetchall()
    alvo = _match_tel(rows, telefone)
    for r in alvo:
        con.execute("UPDATE contatos SET preencheu=1 WHERE id=?", (r["id"],))
    con.commit()
    con.close()
    return len(alvo)


def contato_por_telefone(telefone):
    con = conectar()
    rows = con.execute("SELECT * FROM contatos ORDER BY id DESC").fetchall()
    con.close()
    alvo = _match_tel(rows, telefone)
    return dict(alvo[0]) if alvo else None


def lead_por_telefone(telefone):
    con = conectar()
    rows = con.execute("SELECT * FROM leads ORDER BY id DESC").fetchall()
    con.close()
    alvo = _match_tel(rows, telefone)
    return dict(alvo[0]) if alvo else None


def marcar_atendimento(telefone):
    """Cliente pediu atendimento humano: o robô se cala pra essa conversa."""
    con = conectar()
    rows = con.execute("SELECT id, telefone FROM contatos").fetchall()
    alvo = _match_tel(rows, telefone)
    for r in alvo:
        con.execute("UPDATE contatos SET atendimento=1 WHERE id=?", (r["id"],))
    con.commit()
    con.close()
    return len(alvo)


def contatos_para_resgate():
    """Contatos que receberam o link do briefing e não preencheram, prontos pra um
    lembrete. 1º lembrete ~24h depois de contatado; 2º ~72h depois. No máximo 2."""
    con = conectar()
    rows = con.execute(
        "SELECT * FROM contatos WHERE status='contatado' "
        "AND COALESCE(preencheu,0)=0 AND COALESCE(atendimento,0)=0 "
        "AND COALESCE(lembretes,0)<2"
    ).fetchall()
    con.close()
    agora_ts = time.time()
    due = []
    for r in rows:
        r = dict(r)
        base = r.get("contatado_em") or r.get("criado_em")
        if not base:
            continue
        try:
            t0 = time.mktime(time.strptime(base, "%Y-%m-%dT%H:%M:%S"))
        except Exception:
            continue
        horas = (agora_ts - t0) / 3600.0
        lem = r.get("lembretes") or 0
        if (lem == 0 and horas >= 24) or (lem == 1 and horas >= 72):
            due.append(r)
    return due


def registrar_lembrete(contato_id):
    con = conectar()
    con.execute(
        "UPDATE contatos SET lembretes=COALESCE(lembretes,0)+1, ultimo_lembrete=? WHERE id=?",
        (agora(), contato_id),
    )
    con.commit()
    con.close()
