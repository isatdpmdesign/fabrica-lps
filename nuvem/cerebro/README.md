# 🧠 Cérebro da Fábrica de LPs

O servidor sempre-ligado (Python/FastAPI) que recebe briefing + pagamento e alimenta a Fábrica.
Roda na Oracle Cloud (Always Free). Sem Make, sem terceiros frágeis.

## O que ele faz (Fase 1)
1. **Recebe o briefing** do cliente → cria um "lead" e gera o **link de pagamento do Stripe**.
2. **Ouve o Stripe** confirmar o pagamento (webhook) → marca o lead como **pago**.
3. A **Fábrica** (no PC da Isa) **puxa os leads pagos** de tempos em tempos → viram card na fila, sozinhos.

Fase 2 (depois): WhatsApp automático (convite/briefing → "pronta pra revisão" → "link final").

## Arquivos
- `app.py` — a API (os endpoints).
- `db.py` — o banco (SQLite, uma tabela `leads`).
- `requirements.txt` — dependências.
- `.env.example` — modelo das variáveis (copie para `.env` e preencha no servidor).

## Endpoints
| Método | Rota | Pra quê |
|---|---|---|
| GET | `/health` | testar se está no ar |
| POST | `/briefing` | o formulário manda o briefing; devolve o link de pagamento |
| POST | `/webhook/stripe` | o Stripe avisa que pagou |
| GET | `/api/leads?token=SEGREDO` | a Fábrica puxa os leads pagos |
| POST | `/api/leads/status` | a Fábrica avisa produzindo/entregue (Fase 2) |

## Rodar na sua máquina (teste)
```bash
cd nuvem/cerebro
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencha
uvicorn app:app --reload
# abre http://localhost:8000/health
```

## Subir na Oracle (passo a passo — a gente faz junto)
1. Criar a VM ARM Always Free (Ubuntu) no OCI Console.
2. Instalar Python + o código, criar o `.env`.
3. Rodar como serviço (systemd) pra ligar sozinho.
4. Expor com HTTPS via **Cloudflare Tunnel** (a Isa já tem Cloudflare) → vira `https://cerebro.seudominio...`.
5. Cadastrar esse endereço `/webhook/stripe` no painel do Stripe.
6. Na Fábrica: apontar pro cérebro e ligar o auto-puxar.

> O `.env` e o `cerebro.db` NUNCA vão pro GitHub (têm segredo e dados de cliente).
