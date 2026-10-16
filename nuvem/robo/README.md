# Robô de WhatsApp — Fábrica de LPs (Open Design)

Serviço Python que responde o cliente no WhatsApp com o **link do briefing**,
sozinho. Roda no mesmo servidor ARM do cérebro.

## Como funciona (o cliente fala primeiro)

1. Cliente preenche o modal do site → vira um **contato** no cérebro.
2. Cliente clica em **"Falar no WhatsApp"** e te manda a 1ª mensagem.
3. A **Evolution API** (ligada no seu número por QR) recebe a mensagem e
   chama este robô no endpoint `POST /whatsapp`.
4. O robô confere no cérebro se o número é um **contato novo**. Se for,
   responde com o link do briefing e marca o contato como *contatado*
   (pra não responder de novo). Se não for, fica quieto — você cuida na mão.

Quem inicia a conversa é sempre o cliente, então não há risco de spam nem
precisa de template de WhatsApp.

## Peças

- **Evolution API** — o motor de WhatsApp (self-hosted, Docker). Conecta no
  seu número via QR Code e expõe uma API REST + webhook.
- **robo.py** — este serviço. Recebe o webhook da Evolution e responde.
- **cérebro** — guarda os contatos (`/api/contatos`) e é quem o robô consulta.

## Configuração

Copie `.env.example` para `.env` e preencha (`CEREBRO_TOKEN` é a mesma
`SEGREDO` do cérebro; `EVOLUTION_KEY` é a apikey da Evolution; `BRIEFING_URL`
é o link público do briefing).

Rodar:

```
uvicorn robo:app --host 127.0.0.1 --port 8100
```

No servidor fica como serviço systemd (ver o passo a passo da instalação).

## Fase 2 (depois do lançamento)

- Pedir **feedback** no WhatsApp quando a LP é marcada como *entregue*.
- Lembrar quem preencheu o briefing mas não pagou.
