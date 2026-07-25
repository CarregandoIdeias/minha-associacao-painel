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

## Cuidado ao testar localmente

`API_URL` (topo do `<script>` de cada arquivo) aponta para produção por
padrão. Se trocar para testar contra um backend local
(`http://localhost:3000`), **reverter antes de commitar** — é fácil
esquecer e dar push com a produção apontando para localhost.

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
