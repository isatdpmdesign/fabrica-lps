# 🏭 Estúdio — o app da Fábrica de LPs

O Estúdio é a metade **local** do produto: roda na máquina da Isadora e usa o
**Claude Code CLI da assinatura** para gerar e editar as landing pages
(custo de API: R$ 0).

## Como rodar

Pré-requisito pra gerar/editar: o **Claude Code** logado. (No app de desktop o Node já vem
embutido; nos modos abaixo, precisa do **Node** instalado.)

### App de desktop (o jeito recomendado)
Um aplicativo de verdade — ícone com a logo, na barra de tarefas e no menu Iniciar, janela
própria, sem terminal e sem navegador.

- **Instalar (Windows):** baixe o instalador `.exe` na página de **Releases** do GitHub
  (gerado automaticamente pela esteira `Instalador do Estúdio`), execute e instale.
- **Rodar/empacotar você mesmo** (precisa de Node): na pasta `estudio/`, `npm install` e depois
  `npm start` (abre o app) ou `npm run dist` (gera o instalador em `estudio/instaladores/`).

Os seus dados ficam numa pasta do usuário (fora do app), então atualizar o app não apaga nada.

### Modo pasta (sem instalar)
Dê **dois cliques** no atalho dentro da pasta `estudio/`:
- Windows → `Iniciar Estudio.bat`
- Mac/Linux → `Iniciar Estudio.command` (no Mac, na 1ª vez: botão direito → Abrir)

Ele liga o servidor e **abre o navegador sozinho**. Pra desligar, feche a janela preta.

**Pelo terminal**, se preferir:
```bash
node estudio/app/server.js   # abra http://localhost:4321
```
O servidor avisa no terminal se encontrou o comando `claude`. Sem ele, o app
abre e mostra as páginas já geradas — só a geração/edição fica indisponível.

### Como o CLI se conecta
Nada pra configurar: o app roda o comando `claude` da sua assinatura por baixo
(sem chave de API, custo R$ 0). Basta ter o Claude Code instalado e logado na máquina.

### Sua logo
Largue o arquivo da logo em `estudio/app/public/` com o nome `logo.svg` (ou `logo.png`).
O cabeçalho passa a usá-la automaticamente; sem arquivo, mostra o ícone padrão.

### Usar em vários computadores
O Estúdio é local, e os dados ficam em `estudio/app/data/`. Pra trabalhar de máquinas
diferentes, o mais simples é deixar a pasta do app dentro de uma **nuvem que sincroniza**
(Google Drive / Dropbox / OneDrive): abra e rode o atalho de qualquer PC — os projetos,
versões e comentários acompanham. (Cada PC precisa ter o Node e o Claude Code logado.)
Não abra nos dois ao mesmo tempo, pra não conflitar os arquivos.
> Quando o produto virar um serviço online com login (área do cliente), o Estúdio pode
> passar a rodar num servidor só e ser acessado de qualquer lugar — é o próximo passo grande.

## O que o app faz

**Solicitações** (Kanban + Tabela)
- Fila por status: **Nova → Em produção → Em revisão → Alteração solicitada → Entregue**.
  "Em revisão" é você revisando; "Alteração solicitada" é pedido do cliente.
- **Busca por nome**, filtro por status e ordenação (mais recentes / mais antigas / A–Z).
- **Arquivar** tira do Kanban; a aba **Arquivados** guarda os concluídos. Reabrir um
  arquivado o traz de volta como "Alteração solicitada" — mesmo projeto, histórico junto.
- **+ Nova solicitação** cadastra manualmente clientes de fora do funil (indicação).

**Editor** (chat à esquerda, preview à direita)
- **Gerar LP** — o Claude Code preenche o template com o briefing.
- **Chat com três modos**: **Plano** (descreve sem mexer), **Perguntar** (só responde)
  e **Design** (edita a página de verdade).
- **Preview** Mobile/Desktop, com botão de **recarregar**.
- **Comentar** — ative e clique num elemento: inspetor (tamanho, cor, fonte, entrelinha)
  e comentário ancorado ali.
- **Marcar** — ative e desenhe sobre a página (caneta, retângulo, texto).
- **Comentários** — separa **pedidos do cliente** das **suas anotações**. Cada um pode ser
  **resolvido**, **refutado** (com resposta que o cliente vê), mandado **pro chat** ou excluído.
  Selecione vários e **aplique com a IA** de uma vez.
- **Editar** — o editor visual, com a lógica do Figma traduzida para HTML: clique num elemento
  e ajuste no painel da direita (tamanho, peso, entrelinha, alinhamento, cor, fundo, espaçamento,
  cantos e **autolayout** — direção, espaço entre itens, alinhamento, distribuição, **espaçamento
  interno (padding) horizontal e vertical** e recortar o que passa da borda). Um bloco **Vidro**
  aplica efeito glassmorphism no elemento (Luz, Refração, Profundidade, Dispersão, Gelo e Splay),
  ótimo sobre imagem ou fundo colorido — vira estilo embutido, então acompanha a página em
  qualquer lugar. **Shift + clique** soma
  elementos; **Shift + A** junta a seleção num **autolayout** (é o "criar botão" do Figma);
  **Ctrl/Cmd + Shift + G** desfaz o grupo. **Arrastar o elemento na própria página** muda a ordem
  dele: uma linha azul mostra onde vai cair (vertical quando o autolayout é em linha, horizontal
  quando é em coluna) e ele só pode ser solto dentro da mesma seção. O elemento selecionado ganha **alças** para redimensionar
  (largura em %, altura em px) e uma alça azul para **girar** — segurando Shift trava em passos de
  5% / 15°. **Enter** entra no filho (ou edita o texto), **Esc** sobe pro pai, **Ctrl/Cmd + D**
  duplica e **Delete** apaga. Uma fileira de botões controla a **ordem de empilhamento** (z-order):
  trazer para frente, avançar, recuar e enviar para trás — útil quando os elementos se sobrepõem.
  Imagens podem ser trocadas por um arquivo do computador, e o botão
  **Inserir imagem / SVG** joga um arquivo dentro do elemento selecionado (SVG entra como marcação
  escalável; PNG/JPG entram embutidos como data URI, mantendo a página auto-suficiente) — e o que
  é inserido se move, agrupa e recebe autolayout como qualquer elemento. **Duplo clique** num texto
  edita ali mesmo. Dá pra **trocar a fonte** (puxa do Google Fonts) e **desfazer/refazer** cada edição
  manual com `Ctrl/Cmd + Z` / `Shift + Z`. O ícone de teclado no topo do painel abre a lista de atalhos.
  A lista de
  **seções** permite **arrastar para reordenar**, remover e inserir uma seção salva; clicar numa
  seção rola o preview até ela. Cada mudança vira uma versão.
- **Histórico** — todas as versões ficam guardadas; dá pra **restaurar** qualquer uma.
- **Skills** — jeitos de trabalhar salvos. Três já vêm prontas (variação do hero, revisar contraste,
  importar site como referência). Cada uma tem um escopo — **na página aberta** (a IA aplica a rotina
  na LP e salva uma versão) ou **na biblioteca** (ações como importar, que abrem a tela certa). Você
  cria, edita e exclui as suas escrevendo as instruções como pediria pro Claude; as nativas ficam
  protegidas. É o mesmo motor CLI: custo de API R$ 0.

**Atalhos**
- **Duplo clique** num texto edita ali mesmo · `Shift + clique` soma à seleção
- `Shift + A` agrupa em autolayout · `Ctrl/Cmd + Shift + G` desagrupa
- `Ctrl/Cmd + D` duplica · `Delete` apaga · `Ctrl/Cmd + Z` desfaz · `+ Shift` refaz
- `Esc` sobe pro elemento pai · `Enter` entra no filho
- (o ícone de teclado no topo do painel de edição mostra esta lista)
- `F5` recarrega o app (funciona mesmo com o foco no preview)
- `Ctrl/Cmd + Shift + R` recarrega só o preview
- `Ctrl/Cmd + B` recolhe e abre o chat, deixando o preview em tela cheia
- `Esc` fecha painéis e modais

## Como a página é guardada

A LP não é um HTML solto: ela é uma **lista de seções** (`nav`, `hero`, `prova-social`,
`diferenciais`, `sobre`, `galeria`, `cta`, `footer`). O HTML final é montado a partir
delas — auto-suficiente e leve. Isso é o que permite histórico, templates por seção e,
mais pra frente, reordenar arrastando.

## Estrutura

```
estudio/
├── app/
│   ├── server.js              # servidor local (Node puro, sem dependências)
│   ├── lib/blocos.js          # quebra a página em seções e monta de volta
│   ├── public/index.html      # interface do app
│   ├── public/editor.js       # editor visual injetado no preview
│   └── data/
│       ├── db.json            # índice dos projetos (seu CRM local)
│       ├── projetos/<id>.json # blocos, versões e comentários de cada projeto
│       ├── sites/<id>/        # o HTML publicado
│       ├── secoes/<id>.json   # templates de seção
│       └── pastas.json        # pastas da biblioteca
├── templates/
│   └── servico-premium/
│       ├── template.html      # esqueleto com slots {{...}} e DESIGN TOKENS
│       └── template.json      # manifesto: nicho, seções, slots, regras pra IA
├── briefings/                 # briefings de exemplo (JSON)
├── exemplos/                  # LPs de referência
└── README.md
```

## Templates

| Template | Bom para | Origem |
|----------|----------|--------|
| `servico-premium` | clínicas, advogados, consultores, coaches, marcas pessoais | LP da Dra. Sofia |

> Próximos templates virão dos outros modelos curados
> (Payrot → fintech/produto; Conscellence → consultoria B2B; Creatix → agência).

## Publicar em subdomínio

O botão **Publicar** congela a versão atual num endereço público (`cliente.fabricadelps.com.br`)
e serve o HTML **final e limpo** (sem o editor, auto-suficiente). Cada site ganha um **slug**
editável; dá pra ter um **domínio próprio** da cliente, **republicar** quando houver edições novas,
**tirar do ar** e **baixar o HTML** pra hospedar em qualquer lugar. A tela **Publicados** (na fila)
lista tudo que está no ar. Localmente o site abre em `/s/<slug>`.

Como o Estúdio roda **na sua máquina** (localhost), o site publicado precisa ir pra um host
público pra abrir na internet. Com o domínio já na **Hostinger**, há dois caminhos:

**Automático, de graça (recomendado):** o Estúdio manda o arquivo pra Hostinger sozinho por
**FTP** (usa o `curl` do sistema, sem instalar nada). No painel de **Publicar**, abra
*Envio automático pra Hostinger*, preencha host/usuário/senha do FTP (hPanel → **Arquivos →
Contas FTP**), defina a pasta (`public_html/{slug}` por padrão) e ligue *Enviar sozinho ao
publicar*. A senha fica **só na sua máquina** (`app/data/config.json`, no `.gitignore`), nunca
vai pro GitHub. Crie o subdomínio (ou um curinga) uma vez em **Domínios → Subdomínios**; depois
é só clicar em Publicar.

**Manual (sem configurar nada):** clique em **Baixar HTML** e suba o arquivo como `index.html`
na pasta do subdomínio pelo **Gerenciador de Arquivos** da Hostinger. Ela emite o HTTPS sozinha.

**Automático total via VPS:** rodar o app num servidor 24h + curinga `*.fabricadelps.com.br` —
passo de infra maior, junto da área do cliente.

O domínio-base é configurável: rode com `FABRICA_DOMINIO=fabricadelps.com.br node estudio/app/server.js`
(ou já é o padrão). Enquanto isso, o **Baixar HTML** entrega o arquivo pronto.

## Princípio

O template é **trilho, não gaiola**: garante estrutura boa; a IA adapta;
a Isadora refina. Nada sai sem o crivo humano.

## Próximos passos

- **Área do cliente** (mobile) com briefing, status e preview + marcação.
- **Cobrança das edições** do cliente antes de entrar na fila.
