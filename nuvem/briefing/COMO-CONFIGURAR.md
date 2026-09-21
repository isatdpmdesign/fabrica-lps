# Briefing ligado ao Google Sheets — como colocar no ar

Isa, esse é o passo a passo pra ligar o briefing ao Google Sheets. Leva uns 10 minutos e é tudo no seu Google. Você não precisa criar planilha nem pasta na mão: o próprio script cria sozinho no primeiro envio.

## O que você vai ter no fim
- Um **link** do briefing pra mandar no WhatsApp do cliente.
- Cada envio vira uma **linha** numa planilha (que aparece no seu Drive).
- Os arquivos do cliente (logo, fotos, depoimentos) vão pra uma **pasta no Drive**, e o link deles fica na planilha.

## Passo a passo

1. Entre em **script.google.com** com a conta **isaduarte.design@gmail.com** e clique em **Novo projeto**.

2. No arquivo `Código.gs` que já vem aberto, apague tudo e cole o conteúdo do arquivo **`Codigo.gs`** (o que está aqui nesta pasta).

3. Crie o formulário: clique no **`+`** ao lado de "Arquivos" → **HTML** → dê o nome exato **`briefing`** (sem `.html`). Apague o conteúdo de exemplo e cole o conteúdo do arquivo **`briefing.html`**.

4. Clique em **Salvar** (o ícone de disquete).

5. Clique em **Implantar** (canto superior direito) → **Nova implantação** → engrenagem → **App da Web**. Configure:
   - **Executar como:** Eu (você)
   - **Quem pode acessar:** Qualquer pessoa
   - Clique em **Implantar** e **autorize** o acesso (vai pedir permissão pra mexer na sua planilha e no Drive — é esperado, é o script fazendo o trabalho por você).

   > **Vai aparecer uma tela "Google hasn't verified this app" (Google não verificou este app).** É normal e seguro: o Google só "verifica" apps de empresas, e o seu é um script pessoal seu. Faça assim:
   > - **Não clique no e-mail** `isaduarte.design@gmail.com` (aquilo é um link de e-mail e abre o Outlook à toa; ignore).
   > - Clique em **"Advanced" / "Avançado"** e depois no link **"Go to Projeto sem título (unsafe)" / "Ir para Projeto sem título (não seguro)"**.
   > - Na tela seguinte, clique em **Allow / Permitir**.
   > O "unsafe" é só o padrão do Google pra apps não revisados. Como o app é seu, pode seguir.

6. Copie o **URL do app da Web** que aparece. Esse é o link do briefing. 🎉

## Como usar o link
- Link simples: cole o URL direto.
- Com o nome do cliente já preenchido: adicione `?nome=Juliana` no fim do link. Exemplo:
  `https://script.google.com/.../exec?nome=Juliana`
  (o robô do WhatsApp vai montar isso sozinho quando a gente ligar o WhatsApp).

## Onde ver os briefings
Depois do primeiro envio, procure no seu Google Drive por:
- **Planilha:** "Fábrica de LPs — Briefings"
- **Pasta:** "Fábrica de LPs — Arquivos dos briefings"

## Coisas que ficam pra depois (anotadas no Notion)
- O botão de WhatsApp da tela final ainda usa um link de exemplo. Trocar pelo número real da Fábrica.
- A **ponte com o Estúdio** (o briefing virar card na fila, com o botão "Criar LP com esse briefing") é o próximo passo depois que isso estiver no ar.
- Se um cliente clicar em "Corrigir minhas respostas" e reenviar, entra uma **linha nova** na planilha (a mais recente é a que vale). Dá pra melhorar depois.

Qualquer passo que travar, me chama que a gente resolve junto. 💗
