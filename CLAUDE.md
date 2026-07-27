# CLAUDE.md — painel

Contexto rápido para sessões de IA. Ver `README.md` deste repositório para
mais detalhes do front-end, e o `README.md`/`CLAUDE.md` do repositório do
backend (`../minha-associacao-backend`, ou `CarregandoIdeias/minha-associacao-backend`
no GitHub) para o sistema completo — é lá que vive a documentação de
segurança, RLS, modelo de dados e rotas da API.

## O que é

Front-end da plataforma de gestão de associações — três arquivos HTML
autocontidos (`index.html`: painel da associação/admin-diretoria;
`portal.html`: Portal do Associado; `superadmin.html`: painel do Super
Admin), sem build step, publicados direto no Vercel. Cada um tem login,
sessão (`localStorage`) e layout próprios — nenhum depende de import ou
build dos outros.

## API_URL detecta o ambiente pelo hostname (27/07/2026)

Não é mais um valor fixo apontando pra produção — cada arquivo (`index.html`,
`portal.html`, `superadmin.html`, `sprint.html`) resolve `API_URL` em tempo
de execução por `location.hostname`: `localhost`/`127.0.0.1` e qualquer
domínio contendo a palavra `staging` usam o backend de staging; qualquer
outro hostname (produção) usa o backend de produção. Isso existe
de propósito pra eliminar o risco antigo ("trocar pra testar local e
esquecer de reverter antes de commitar", já tinha acontecido) — o código é
**idêntico** em `main` e na branch `staging`, não tem nada pra lembrar de
reverter. Se copiar esse padrão pra um arquivo novo, manter a mesma função
— nunca voltar a um valor fixo.

## Ambiente de homologação (staging)

Existe uma branch `staging` neste repositório (e no `backend`), publicada
num projeto Vercel próprio (Production Branch = `staging`, domínio
`minha-associacao-painel-staging.vercel.app` — qualquer domínio contendo
a palavra "staging" serve, a detecção não depende do nome exato do
projeto) apontando pro backend de staging no Render e
pro projeto Supabase de staging — três serviços totalmente isolados dos de
produção, sem dado nem credencial compartilhada. Fluxo: mudar/testar em
`staging` primeiro, só mesclar em `main` (produção) depois de validado ali.
Detalhe completo (como recriar o schema de staging do zero) em
`backend/supabase/README.md` e `backend/CLAUDE.md`.

**`vercel.json` precisa liberar os dois backends na CSP** — `connect-src`
lista tanto `https://minha-associacao-backend.onrender.com` quanto
`https://minha-associacao-backend-staging.onrender.com`. Sem isso, o login
em staging falha com "Não foi possível conectar ao servidor" **sem erro
nenhum de CORS** — é a CSP do próprio navegador bloqueando a chamada antes
mesmo de chegar ao backend (bug real encontrado ao montar o staging: a
mensagem de erro engana, parece problema de rede/CORS, mas o Console do
navegador mostra claramente "violates the following Content Security
Policy directive: connect-src"). Se criar um domínio de staging novo no
futuro (ex. terceiro ambiente), lembrar de adicionar aqui também.

**Runbook resumido pra recriar o painel de staging no Vercel:**
1. Novo projeto Vercel, mesmo repositório, nome contendo "staging" (o
   domínio gerado precisa ter essa palavra, não precisa ser exato).
2. Settings → Environments → Production → trocar "Branch Tracking" de
   `main` para `staging` (esse campo **não fica** em Settings → Git nem em
   Build and Deployment, mudou de lugar na Vercel — fica em
   "Environments"). Salvar.
3. Isso não promove sozinho o deploy já existente — ir em Deployments,
   achar o deploy da branch `staging` (badge "Preview") e usar "Promote to
   Production" nos "...". Deploys seguintes da branch `staging` já vão
   direto como Production automaticamente.

## Contrato com o backend

- Login é só e-mail + senha (sem código de associação). Resposta de
  `/auth/login` pode trazer `deve_trocar_senha: true` — nesse caso a UI
  precisa forçar a tela de troca antes de liberar o dashboard (já
  implementado, ver `tela-trocar-senha-obrigatoria` em `index.html`).
- Qualquer resposta 403 com `codigo: 'SENHA_PROVISORIA_PENDENTE'` (de
  qualquer rota autenticada) indica que o back-end bloqueou porque a
  senha provisória ainda não foi trocada.
- Sessão fica em `localStorage` (`sessao_painel`: `{ token, papel }`) e é
  revalidada contra o backend a cada carregamento de página.

## Super Admin — mudanças recentes (24/07/2026)

Reformulação completa do painel Super Admin com sidebar navegável (Dashboard
+ Associações). Backend ganha `utils/precos.js` com tabela de planos
(trial/basico/profissional/enterprise) e cálculo de MRR por associação.
Migration aditiva no banco: `cep, site, valor_mensalidade_manual,
vencimento_assinatura, forma_cobranca` em `associacoes`; `cpf` em `usuarios`.
Dashboard novo com 7 KPIs + 4 gráficos + alertas em tempo real. Formulário
de associação estendido.

## Painel da associação — mudanças recentes (24/07/2026)

`index.html` foi alinhado visualmente ao Super Admin: fonte Poppins em
tudo (era Playfair Display + Inter + JetBrains Mono), `confirmarAcao()`
substituindo os 5 `confirm()` nativos (associado, cobrança, estorno,
comunicado, usuário), `.content-area` sem `max-width` (usa toda a largura
da tela), breakpoints responsivos reforçados (1200/900/768/640/480/360px).
Novo mini-dashboard na tela Associados: KPI "Novos (7 dias)" + gráfico de
barras dos últimos 7 dias (Chart.js, novo `<script>` adicionado ao
`<head>`), calculado no front-end a partir de `data_ingresso` — não exigiu
mudança de backend. Ver seção própria no `README.md` para os dois cuidados
não-óbvios desse gráfico (fuso horário no cálculo dos baldes diários,
`maintainAspectRatio: false` para não esticar em telas largas).

## Painel da associação — reforma do header, sidebar e Dashboard (25/07/2026, continuação)

Reforma grande em cima da reestruturação de menu do mesmo dia (ver seção
abaixo) — só `index.html`, `superadmin.html` não foi tocado.

- **Marca "Minha Associação" removida por completo** (era só branding, o
  usuário decidiu não usar mais): saiu do `<title>`, do `.sidebar .logo` e
  do `.mobile-topbar .logo`. No lugar, um `.logo-mark` só com ícone (sem
  texto de produto) — reaproveitar esse padrão se precisar de um espaço de
  marca de novo no futuro, não reintroduzir texto fixo "Minha Associação".
- **Header novo** (`.app-header`, sempre visível no topo do
  `.content-area`, acima do `.page-header` de cada seção): saudação por
  horário (`saudacaoPorHorario()`) + primeiro nome, e-mail, avatar de
  iniciais (`.avatar-iniciais`, `iniciaisNome()`), dropdown
  (`.dropdown-perfil`) com Meu Perfil / Alterar Senha / Sair. O botão
  "Sair" (`#btn-sair`) **saiu do `.sidebar-footer`** (que agora só tem o
  toggle de tema) **e foi pro dropdown** — mesmo id, mesmo handler, só
  mudou de lugar no HTML.
  - `nome`: já vinha em `res.data.usuario.nome` no login mas não era
    persistido — agora vai também em `sessao_painel` no `localStorage`
    (`estado.nome`).
  - `email`: **não** veio de uma rota nova — é decodificado do próprio JWT
    no cliente (`decodificarEmailDoToken()`, só `atob()` no payload, sem
    verificar assinatura porque é só pra exibição) já que `assinarToken()`
    no backend inclui `email` no payload.
  - "Alterar Senha" reaproveita a rota já existente `PUT /auth/senha`
    (mesma usada pela troca obrigatória de senha), num modal próprio
    (`abrirModalAlterarSenha()`) — não é rota nova.
- **Sidebar sem submenu de Associados**: o grupo expansível
  (`.nav-grupo`, `#menu-associados`, `#toggle-associados`,
  `#submenu-associados`, `.nav-item-pai`, `.icone-chevron`) foi removido —
  agora é um `nav-item` único `#aba-associados` que cai direto na tela que
  já tinha lista/busca/filtro/botão de novo associado. Sidebar final:
  Dashboard, Associados, Financeiro, Comunicados, Usuários,
  Configurações — só isso.
- **Dashboard reconstruído** (`secao-dashboard`): 7 KPIs com ícone, cor e
  comparativo vs. mês anterior (`renderizarKpiDelta()`) — Total, Ativos,
  Novos no mês (era "Novos 7 dias", trocado pro mês), Inadimplentes,
  Receita do mês, Mensalidades vencidas, Mensalidades a vencer. 4 gráficos
  Chart.js: crescimento acumulado 12 meses (`atualizarGraficosAssociados`,
  linha), novos associados por mês (mesma função, barra), receita mensal
  recebido-vs-emitido (`atualizarDashboardFinanceiro`, barras agrupadas),
  situação financeira (mesma função, pizza/doughnut). 4 cards de apoio:
  atividades recentes (`carregarAtividades()`, consome `GET /atividades`,
  novo no backend), próximos vencimentos (7 dias, computado de
  `cobrancasCache`), últimos associados cadastrados
  (`atualizarUltimosAssociados()`, avatar de iniciais — **não** carrega
  `foto_base64` em massa, de propósito, pra não pesar a resposta de
  `/associados`), comunicados recentes (`atualizarComunicadosRecentes()`,
  reaproveita `comunicadosCache` já buscado por `carregarComunicados()`).
  O gráfico antigo de "novos associados (últimos 7 dias)" e o KPI
  `kpi-novos-semana` foram **removidos**, substituídos pelos gráficos
  mensais.
- **Meu Perfil** (novo, `secao-meu-perfil`): nome, e-mail (só leitura),
  avatar de iniciais, botão de alterar senha. Só admin/diretoria (a tela
  "Meus Dados" do associado, com foto, continua separada e não mudou).
  Acessível só pelo dropdown do header — **não** é item da sidebar
  principal.
- **Padrões novos reutilizáveis** (além dos já existentes
  `.texto-ajuda`/`.campo-linha`/`.form-footer`): `.kpi-icone`/`.kpi-delta`
  (ícone colorido + comparativo num KPI card), `.dashboard-cards-apoio`
  (grid responsivo pra cards de largura livre), `.atividade-item` (linha
  de atividade com ícone), `.mini-item`/`.avatar-mini` (linha compacta
  com avatar — usado em "últimos associados" e "comunicados recentes"),
  `.avatar-iniciais` (círculo com iniciais, usado no header e no Meu
  Perfil), `.dropdown-perfil` (menu suspenso com click-fora-fecha, mesmo
  princípio do `#sidebar-overlay`).
- **Backend ganhou uma tabela nova** (`atividades`) e uma rota nova
  (`GET /atividades`) só pra isso — ver `CLAUDE.md` do repo do backend,
  seção "Log de atividades", se for mexer nesse fluxo.

## Painel da associação — reestruturação do menu (25/07/2026)

**Superseded pela reforma descrita na seção acima, no mesmo dia**: o
submenu expansível de Associados (`#menu-associados`,
`#toggle-associados`, `#submenu-associados`, `#aba-novo-associado`)
descrito abaixo **não existe mais** — virou um `nav-item` único. Fica
registrado aqui só como histórico de como chegamos no estado atual.

Sidebar reorganizada: **Dashboard** (novo, `secao-dashboard`) virou a tela
inicial — ganhou os KPIs e o gráfico "Novos associados" que antes ficavam
dentro de Associados. **Associados** virou um grupo expansível
(`#menu-associados`, `#toggle-associados`, `#submenu-associados`) com dois
itens: "Lista de Associados" (`#aba-associados`, mesmo id/comportamento de
antes) e "Novo Associado" (`#aba-novo-associado`, atalho que ativa a aba e
clica em `#btn-novo-associado` — reaproveita o modal existente, não é uma
tela própria). `ativarAba(idAtiva)` ganhou `'dashboard'` na lista de seções
geridas e expande o submenu automaticamente quando `'associados'` está
ativo.

**Menu hambúrguer (mobile/tablet)**: abaixo de 768px a sidebar agora é
off-canvas (`position: fixed`, `transform: translateX(-100%)` por padrão,
classe `.aberta` mostra) com um botão `☰` (`#btn-hamburguer`) numa barra
fixa no topo (`.mobile-topbar`) e um overlay escurecido
(`#sidebar-overlay`) que fecha ao clicar fora. Isso **substituiu** o
comportamento anterior de "sidebar vira barra horizontal com scroll" nesse
breakpoint. `ativarAba()` chama `fecharSidebarMobile()` ao final, então
qualquer navegação já fecha o menu sozinha.

**Configurações reformulada**: campos relacionados (Nome do recebedor +
Cidade do Pix) agora ficam lado a lado via `.campo-linha` (grid/flex,
quebra sozinho em telas estreitas), texto de ajuda padronizado em
`.texto-ajuda` (era `style` inline repetido), botão Salvar em
`.form-footer` (alinhado à direita, com separador). Reaproveitar esses
três padrões (`.texto-ajuda`, `.campo-linha`, `.form-footer`) em qualquer
tela de formulário nova em vez de inventar espaçamento/alinhamento do
zero.

**Se o "Erro ao carregar" voltar a acontecer**: antes de assumir que é bug
de front-end, checar o backend primeiro — em 25/07/2026 esse sintoma
(Financeiro/Comunicados/Usuários/Configurações todos com "Erro ao
carregar") era 100% causado por instabilidade no backend (ver
`CLAUDE.md`/`README.md` do repo do backend, seção sobre o pooler do
Supabase), não por nada neste arquivo. `carregarCobrancas`,
`carregarComunicados` e `carregarUsuarios` agora checam `resp.ok` e
mostram a mensagem de erro real do backend (em vez de um genérico "Erro ao
carregar X") — usar essa mensagem como primeira pista.

## Portal do Associado virou arquivo próprio (25/07/2026)

O associado fazia login pelo mesmo `index.html` do admin/diretoria —
`entrarNoDashboard()` escondia as abas administrativas em runtime
(`estado.papel === 'associado'`) e mostrava só "Meus Dados". Isso
significava baixar/executar o código inteiro de administração
(associados, financeiro, usuários, configurações) sem acesso a nada
disso, e qualquer mudança no dashboard admin arriscava quebrar por
engano a tela do associado por estarem no mesmo arquivo.

Passou a seguir o padrão que `superadmin.html` já usava: **`portal.html`
novo**, autocontido, login e sessão próprios (`sessao_portal`, isolada de
`sessao_painel`). `index.html` agora rejeita login de papel `associado`
(mensagem aponta pro portal) e limpa qualquer `sessao_painel` antiga
salva com esse papel ao restaurar sessão. `portal.html` rejeita login de
qualquer papel que não seja `associado`. Backend não mudou — já era
separado (`routes/portal.js`, `autorizar('associado')`), a separação foi
só de front-end.

O que saiu de `index.html` e foi pra `portal.html`: `secao-meus-dados`
(cadastro, foto, cobranças), `carregarMeusDados()`,
`renderizarMinhasCobrancas()`, upload de foto (`salvarFotoAssociado`) e
o fluxo de pagamento Pix com upload de comprovante (bloco
`bloco-envio-comprovante-pix` do modal, `btn-enviar-comprovante`). O que
ficou em `index.html` mas foi simplificado: `abrirModalPix()` perdeu o
parâmetro `modoAdmin` (só sobrou o uso pela diretoria, visualização de QR
sem upload — a assinatura antiga `abrirModalPix(id, true)` virou
`abrirModalPix(id)`); `renderizarComunicados()` perdeu o ternário
`estado.papel !== 'associado'` nos botões Editar/Excluir (agora sempre
aparecem, só admin/diretoria chegam nesse arquivo).

`portal.html` reaproveita o mesmo sistema visual (cores, Poppins, sidebar
off-canvas no mobile) mas com CSS reduzido — sem KPIs/gráficos/Chart.js,
sem os estilos específicos da lista de associados. Sidebar enxuta: Meus
Dados (tela inicial) e Comunicados (mural só leitura, sem botão de
publicar).

## Landing page ASSOCIA PLUS (25/07/2026)

Novo arquivo `landing.html`, página de vendas pública — separado por
completo de `index.html`/`portal.html`/`superadmin.html` (não importa
nada deles, não foi tocado por eles). Marca nova só para essa página
(**ASSOCIA PLUS**, slogan "Organize. Comunique. Evolua.") — o resto do
painel continua sem nome de produto, decisão já tomada antes. Reaproveita
a paleta/fonte do `index.html` (dourado `#C9A84C`, Poppins, tema
claro/escuro) a pedido do usuário, em vez de uma identidade nova. Preços
mostrados por **porte** (pequeno/médio/grande) usam os mesmos valores de
`backend/utils/precos.js` (básico/profissional/enterprise), só
reapresentados — não são preços novos. Página 100% estática, sem
`API_URL`/sessão/login — é a porta de entrada antes de qualquer
autenticação. Trial "15 dias sem cartão" é só texto de marketing por
enquanto, **não tem fluxo automatizado no backend** ainda.

**Dois bugs de especificidade CSS já corrigidos** (guardar para não
repetir o padrão em telas novas): (1) nunca duplicar em `style=` inline
uma propriedade que uma media query mais adiante precisa sobrescrever —
inline sempre ganha, não importa a especificidade da classe; (2) evitar
`padding`/`margin` como shorthand (`padding: 16px 0`) em duas classes
diferentes no mesmo elemento quando as duas mexem nos mesmos lados — a
que vem depois no CSS vence a propriedade inteira e "cancela" a outra
silenciosamente; usar longhand (`padding-top`, `padding-bottom`) quando
uma classe só deve controlar parte do espaçamento. Detalhe completo de
como cada bug se manifestou em `README.md`, seção "Landing page (ASSOCIA
PLUS)".

## Super Admin — gerenciamento de administradores (Fase 1 da melhoria do Super Admin, 26/07/2026)

`superadmin.html` ganhou duas telas novas na sidebar: **Administradores** (`secao-administradores`, só visível se `estado.papel === 'super_admin'` — CRUD completo: criar/editar/ativar-desativar/redefinir senha, reaproveitando o `overlay-modal-credenciais` já existente, agora com título/texto dinâmicos via `abrirModalCredenciais()` em vez de texto fixo de associação) e **Meu Perfil** (`secao-meu-perfil`, sempre visível — troca da própria senha via `overlay-modal-alterar-senha`, que também é reaproveitado em modo forçado sem botão cancelar quando `deve_trocar_senha` vem `true` no login).

`estado` ganhou `id`/`papel` (persistidos em `sessao_superadmin`). Padrão novo: `#tabela-administradores-container` precisou do mesmo `overflow-x: auto` que `#tabela-associacoes-container` já tinha — qualquer tabela nova em `superadmin.html` precisa desse container, senão colunas somem sem scroll em telas estreitas (bug real encontrado e corrigido nesta sessão).

## Super Admin — tela de Auditoria (Fase 2 da melhoria do Super Admin, 26/07/2026)

Nova tela `secao-auditoria` em `superadmin.html`, acessível a qualquer nível de permissão (não gated por papel, diferente de "Administradores"): filtros (usuário, associação, módulo, tipo de ação, período, ordenação), tabela paginada (`carregarLogs()`, `GET /superadmin/logs`), modal de detalhes (`abrirDetalhesLog()`, mostra `dados_anteriores`/`dados_novos` lado a lado como JSON formatado) e exportação Excel/PDF (`exportarLogs()`, baixa via `fetch` + blob porque a rota exige `Authorization: Bearer` — não dá pra só navegar pra URL/usar `<a href>` direto).

Padrão novo: paginação com texto "Mostrando X–Y de Z" + botões Anterior/Próxima desabilitados via `.disabled` (novo `.btn-pequeno:disabled`/`.btn:disabled` no CSS, opacidade + `cursor: not-allowed`) — reaproveitar em qualquer lista paginada nova.

## Super Admin — Dashboard compacto e menu mobile (Fase 3 da melhoria do Super Admin, 26/07/2026)

Dashboard (`secao-dashboard`) reestruturado: cards de KPI mais compactos (rótulos menores, sem emoji), removidos os gráficos de "Receita recebida por mês" e "Distribuição por plano" (mantém só crescimento de associações e novos associados), e trocado o antigo painel único "Últimas associações cadastradas" + "Alertas" por uma grade de 3 cards (`.grid-resumos`, `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` — já vira 1 coluna sozinho em mobile, sem precisar de media query): **Últimas associações**, **Últimos admins** e **Últimas atividades** (esta última reaproveita `GET /superadmin/logs?limite=5`, criado na Fase 2). Cada card usa `.lista-resumo` (container com scroll próprio, `max-height: 280px`) e `.item-lista`/`.item-lista-titulo`/`.item-lista-sub`/`.item-lista-badge` para as linhas — funções `carregarUltimasAssociacoes()`, `carregarUltimosAdmins()`, `carregarUltimasAtividades()`, todas chamadas ao final de `carregarDashboard()`.

**Menu mobile**: `superadmin.html` ganhou o mesmo padrão de `index.html` (`.mobile-topbar` + `.btn-hamburguer` + `.sidebar-overlay`, sidebar vira `position: fixed` off-canvas abaixo de 768px, abre com classe `.aberto` em vez do `.recolhida` usado no desktop). Diferença importante do padrão do `index.html`: aqui o botão de recolher desktop (`.btn-recolher-sidebar`) e o hamburger mobile controlam **classes diferentes** na mesma sidebar (`recolhida` vs `aberto`) — não reaproveitar a lógica de toggle de uma pro outro. Clique em qualquer `.nav-item` fecha a sidebar mobile automaticamente (`fecharSidebarMobile()`).

**Dois bugs reais introduzidos pela própria reforma, achados e corrigidos logo em seguida** (branch de commits separados, ver histórico do repo) — vale ler antes de remover qualquer elemento do Dashboard de novo:
1. `desenharGraficos()` continuou tentando criar `new Chart(document.getElementById('grafico-receita'), ...)` e `...('grafico-planos')` depois que os `<canvas>` correspondentes já tinham sido removidos do HTML — `getElementById` retorna `null`, `new Chart(null, ...)` lança exceção *dentro* do `.then()` de `carregarDashboard()`, e como não tem `try/catch` ali, tudo que vem depois na mesma callback (`renderizarAlertas`, as 3 chamadas de `carregarUltimas*`) nunca executava. Sintoma: cards de KPI e os 2 gráficos que sobraram carregavam normalmente, mas as 3 listas novas ficavam presas em "Carregando..." pra sempre e um toast de erro genérico aparecia. **Lição**: sempre que remover um elemento do DOM que tem uma referência de `Chart`/`getElementById` em outro lugar do JS, `grep` pelo id antes de considerar terminado.
2. `renderizarAlertas()` também escrevia em `document.getElementById('lista-alertas').innerHTML` — elemento que era o painel grande "Alertas" removido nessa mesma reforma (só sobrou `#lista-alertas-dropdown`, o dropdown do sininho). Mesmo efeito em cascata que o bug 1.

**Espaçamento**: `.item-lista` originalmente só tinha `padding: 10px 0` (vertical, sem lateral) e os containers das 3 listas não tinham padding nenhum — texto e badge ficavam colados nas bordas do card. Corrigido com `.lista-resumo { padding: 6px 0 }` + `.item-lista { padding: 12px 22px }` (22px pra bater com o padding lateral de `.painel-header`). Ao criar qualquer card de lista/resumo novo em `superadmin.html`, reaproveitar `.lista-resumo`/`.item-lista`, não estilo inline.

Backend: `GET /superadmin/admins` e `GET /superadmin/associacoes` aceitam `?limite=N` (cap 1000) pra listagens curtas tipo essa; `GET /superadmin/logs` aceita `?limite=N` como atalho pra listagem simples sem paginação (se vier junto com `pagina`/`por_pagina`, esses dois têm prioridade).

## Plano Trial com expiração + contratação self-service (26/07/2026)

**`index.html` (painel da associação)**: Dashboard ganhou um bloco novo logo abaixo do `page-header`, `#bloco-plano-dashboard`, renderizado por `carregarPlano()`/`renderizarBlocoPlano()` — card `.card-plano.trial` com contador ao vivo (dias/horas/minutos, `iniciarContadorTrial()`, atualiza a cada 60s via `setInterval`, recalcula do zero a cada chamada porque é baseado em `new Date(trial_expira_em) - new Date()`, não em decremento) quando `plano === 'trial'`, ou `.card-plano.pago` ("Seu Plano Atual") quando já é um plano pago. Só chama `GET /plano` se acabou de logar (dentro de `entrarNoDashboard()`) — se der 403 (diretoria, que não tem acesso a essa rota), falha silenciosamente e o bloco nem aparece, não quebra o resto do Dashboard.

**Tela de bloqueio** (`#tela-trial-expirado`, sibling de `#tela-login`/`.app-layout`): substitui a tela inteira quando `GET /plano` retorna `status: 'trial_expirado'` — a mesma ideia de "Avalia Plus" pedida, com ícone, mensagem de dados preservados, botão "Contratar Plano" e link "Sair". Isso é só uma camada de UX — a segurança de verdade é o middleware `bloquearTrialExpirado` no backend (ver `backend/CLAUDE.md`); mesmo que alguém bypasse esse check no front, toda rota de dado real continua bloqueada.

**Modal "Contratar/Gerenciar Plano"** (`#overlay-modal-contratar-plano`): dois blocos que alternam (`#bloco-escolha-plano` → `#bloco-pagamento-plano`). Escolha mostra as 3 opções pagas com preço base + simulação usando `total_associados` real (vindo de `GET /plano`); ao confirmar, gera o QR Pix com `gerarPayloadPix()` (já existente, reaproveitado) mas usando **`pix_plataforma`** (chave da Carregando Ideias) em vez de `pix_associacao` — são chaves diferentes, não confundir. Upload de comprovante copiado literalmente do fluxo de `portal.html` (compressão de imagem via canvas, máx. 1000px, jpeg 0.85; PDF passa direto). O mesmo modal serve tanto pro botão "Contratar Plano" (trial) quanto "Gerenciar Plano" (plano pago, upgrade) — não existe tela separada pra upgrade ainda, é o mesmo fluxo de solicitação + aprovação do zero.

**`portal.html` (associado)**: tratamento bem mais simples — `tratarTrialExpirado()` verifica `codigo === 'TRIAL_EXPIRADO'` na primeira resposta de erro (`carregarMeusDados()`) e troca a tela inteira por um aviso genérico sem botão de ação (associado não gerencia plano/pagamento da plataforma, só a diretoria/admin). `#tela-trial-expirado` aqui é bem mais enxuta que a de `index.html`.

**`superadmin.html`**: duas seções novas na sidebar — **Contratações** (`aba-contratacoes`, visível pra qualquer papel, com badge de pendentes igual ao padrão de notificação já usado, `atualizarBadgeContratacoesPendentes()`) lista solicitações com filtro pendente/todas, modal de detalhes mostra o comprovante (imagem inline ou link de PDF) e botões Aprovar/Rejeitar reaproveitando `confirmarAcao()`; **Config. Pix** (`aba-config-plataforma`, gated a `papel === 'super_admin'`, mesmo padrão de `aba-administradores`) — formulário pra chave/nome/cidade Pix da plataforma, é isso que aparece no QR que as associações escaneiam. Formulário de criar/editar associação ganhou o campo "Duração do trial (dias)" (`assoc-trial-dias`).

**Bug real cometido e corrigido nesta sessão**: esqueci `overflow-x: auto` em `#tabela-contratacoes-container` (mesmo bug documentado em `feedback` anteriores sobre `#tabela-administradores-container`) — toda tabela nova em `superadmin.html` precisa entrar na lista de seletores dessa regra, é fácil esquecer.

**Bug real, achado pelo usuário depois do deploy**: o QR Code do modal de contratação estourava a largura da tela. A regra de tamanho do SVG (`#pix-qrcode-container svg { width: 220px; height: 220px; }`) só cobria o container antigo de cobrança do associado — o container novo do plano (`#pix-qrcode-container-plano`) ficou de fora, e o `qrcode-generator` sem essa regra renderiza no tamanho natural do SVG. Corrigido cobrindo os dois seletores, com `width/height: min(220px, 60vw)` pra também não estourar em tela estreita. **Lição**: qualquer novo container de QR Code (ou qualquer elemento que reaproveita uma função de render existente) precisa entrar explicitamente nos seletores CSS que a função original dependia — copiar a chamada da função não copia o CSS de suporte.

## XSS armazenado corrigido — parar de montar HTML por concatenação com dado do banco (27/07/2026)

Achado numa auditoria de segurança pedida pelo usuário (confirmado com PoC antes de corrigir — detalhe completo em `backend/CLAUDE.md`). Os pontos abaixo montavam `<img src="...">`/`<a href="...">` por concatenação de string com um valor vindo direto do banco (comprovante, foto, logo). Como o backend só validava o prefixo (`startsWith('data:image/')`), um valor com aspas escapava do atributo e executava script na sessão de quem abrisse a tela — ex.: um comprovante enviado por um admin de associação rodava script na sessão do **Super Admin** ao ele abrir a tela de aprovação.

Corrigido nos 3 arquivos, sempre com o mesmo padrão — validar com regex estrita (`RE_DATA_URL_SEGURA`/`RE_IMAGEM_SEGURA`, espelha `utils/validacao.js` do backend) e atribuir via `createElement` + `.src`/`.href`, nunca `innerHTML` com o valor interpolado:

- `superadmin.html`: `renderizarArquivoBase64()` (comprovante de contratação de plano, logo da associação — antes tinha 3 pontos diferentes de `<img src="...">`, unificados nessa função).
- `index.html`: `renderizarComprovanteBase64()` (comprovante de cobrança do associado, cobre imagem e PDF via iframe/blob).
- `portal.html`: `renderizarFotoBase64()` (foto de perfil do associado).

**Se for adicionar um novo lugar que renderiza imagem/PDF vindo do banco**: reaproveitar uma dessas funções (ou copiar o padrão), nunca voltar a escrever `'<img src="' + valor + '">'`. A validação de formato no backend é a primeira camada, mas o front não pode confiar cegamente nela — as duas existem de propósito.

Também: `painel/vercel.json` (novo) adiciona cabeçalhos de segurança via headers da Vercel, incluindo uma CSP. Ela mantém `'unsafe-inline'` em `script-src` porque todo o JS é inline nos HTML (tirar isso exigiria mover pra arquivo externo, mudança maior, não feita); o que a CSP resolve de verdade é restringir `connect-src`/`img-src`/`frame-ancestors`, cortando exfiltração de dado pra domínio externo caso algum XSS novo apareça no futuro.

## Dashboard — identidade da associação no cabeçalho (27/07/2026, item de sprint)

`.app-header` ganhou `.app-header-identidade` (wrapper novo em torno do bloco
saudação/e-mail, com `#app-header-logo-associacao`, `<img>` escondida por
padrão). Só na aba Dashboard o cabeçalho muda pro modo "identidade da
associação": logo (se existir) + `Você está no painel da associação "Nome"`,
escondendo `#app-header-email` — nas outras abas continua igual (saudação
por horário + nome/e-mail do administrador). Alternância feita em
`atualizarHeaderDashboard(exibir)`, chamada de dentro de `ativarAba()` a
cada troca de aba — **não** duplicar a lógica de decidir "é dashboard ou
não" em outro lugar, sempre passar por `ativarAba`.

Dados vêm de `GET /configuracoes/identidade` (novo, `backend/routes/configuracoes.js`,
retorna `nome`/`logo_url` da própria associação — `logo_url` é o nome real
da coluna no banco mesmo guardando um data URL base64, não confundir com
`logo_base64`, que é só o nome do campo usado nos formulários do Super
Admin). Buscado uma vez em `carregarIdentidadeAssociacao()`, chamada de
`entrarNoDashboard()`, cache em `estado.nomeAssociacao`/`estado.logoAssociacao`.
Logo é validada com o mesmo `RE_DATA_URL_SEGURA` já usado em
`renderizarComprovanteBase64` antes de ir pro `.src` — defesa em profundidade,
mesmo já validado na gravação (Super Admin).

## Sprint (backlog de melhorias/bugs) — novo (27/07/2026)

Arquivo novo `sprint.html`, autocontido, mesmo padrão dos outros
(`superadmin.html`/`portal.html`): login e sessão próprios
(`sessao_sprint`, isolada das demais). Login reaproveita
`POST /superadmin/login` (mesma conta de super-admin) — não é rota nova
de autenticação, só um novo consumidor da existente. Card novo em
`intranet.html` linkando pra cá. Sem sidebar (página única, não precisou
do padrão de navegação das outras) — header simples + KPIs + tabela
filtrável + modal de criar/editar + modal de detalhe/mudança de status,
reaproveitando os padrões visuais existentes (`.badge`, `.painel`,
`confirmarAcao()`, `.toast`). Consome `GET/POST/PUT/DELETE /sprint` e
`PATCH /sprint/:id/status` (ver `backend/CLAUDE.md`).

## Menu de perfil reorganizado + alerta inteligente de renovação (27/07/2026, itens de sprint 1.2 e 1.4)

`index.html`: tema saiu da sidebar (`.sidebar-footer`/`.theme-toggle`
removidos) e entrou no dropdown do header (`#dropdown-perfil`), que agora
tem Meu Perfil / Alterar Senha / Preferências (atalho pra
`ativarAba('configuracoes')`, só visível pra `admin`, mesmo `style.display`
gating de `#aba-configuracoes`) / Alternar Tema (ícones sol/lua
alternando, `#icone-tema-claro`/`#icone-tema-escuro`) / Sair. O botão do
avatar (`#btn-abrir-perfil`) manteve nome/papel visíveis — `.app-header-avatar-btn
.nome` precisou de `color: var(--text)` explícito porque, por estar dentro
de um `<button>`, o navegador não herdava a cor do tema (ficava preto
ilegível no tema escuro até essa correção).

`#bloco-plano-dashboard` (`renderizarBlocoPlano()`) ganhou destaque
crescente quando `GET /plano` devolve `alerta` (ver `backend/CLAUDE.md`,
seção "Alerta inteligente de renovação do plano"): classes
`.card-plano.alerta-atencao`/`.alerta-alerta`/`.alerta-critico`
(`classeAlertaPlano()`), as duas últimas com animação de pulse
(`pulseAlertaAmarelo`/`pulseAlertaVermelho`, cor combina com o nível).
Título e texto do card mudam pra mensagem de alerta ("⚠️ Sua assinatura
vence em N dias" / "venceu há N dias", ou a versão de trial "Sua avaliação
termina em N dias") e o botão vira "Renovar Plano" (mesmo modal de
contratação de sempre, só texto/estilo mudam). Sem alerta, o card continua
exatamente como antes (informativo, sem urgência).

## Convenções

- Sem framework/bundler — tudo inline (CSS e JS dentro do próprio HTML).
- Estilo consistente: `var`/`function() {}`, não `const`/arrow — manter
  ao editar.
- Padrão de modal "credenciais geradas" (senha provisória mostrada uma
  única vez, com botão de copiar) se repete em vários fluxos — reaproveitar
  o mesmo padrão visual/JS ao criar um novo, não inventar outro.
- `confirmarAcao({ titulo, mensagem, textoConfirmar, perigo, aoConfirmar })`
  (implementada em ambos os arquivos) centraliza confirmações — qualquer
  nova ação destrutiva deve usar isso, não `confirm()` nativo.
- `.content-area` não deve ganhar `max-width` de volta — foi removido de
  propósito nos dois arquivos pra evitar espaço vazio em monitores largos;
  tabelas largas usam `overflow-x: auto` no próprio container em vez disso.
- Padrões do header/Dashboard (25/07/2026, só `index.html` por enquanto):
  `.avatar-iniciais` (avatar de iniciais), `.kpi-icone`/`.kpi-delta` (ícone
  colorido + comparativo num KPI card), `.dashboard-cards-apoio` (grid de
  cards de largura livre), `.atividade-item` e `.mini-item`/`.avatar-mini`
  (linhas de lista compactas com avatar) — reaproveitar em vez de criar
  variações novas se `superadmin.html` ganhar Dashboard equivalente algum
  dia.
