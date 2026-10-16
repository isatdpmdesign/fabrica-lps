"""
db.py — banco do cérebro (SQLite, sem firula).

Uma tabela só: leads. Cada briefing que o cliente responde vira uma linha.
O status conta a história: aguardando_pagamento -> pago -> (a Fábrica puxa) -> produzindo -> entregue.
"""
import sqlite3
import json
import os
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
            puxado         INTEGER DEFAULT 0    -- 1 = a Fábrica já trouxe pro quadro
        )
        """
    )
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


def set_status(chave, status):
    con = conectar()
    con.execute("UPDATE leads SET status=? WHERE chave=?", (status, chave))
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
