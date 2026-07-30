# Painel — Plataforma para Associações

Front-end da plataforma SaaS de gestão de associações. HTML/CSS/JS puro,
sem framework e sem build step — os dois arquivos deste repositório são
publicados exatamente como estão.

Backend (API): repositório separado, `CarregandoIdeias/minha-associacao-backend`.
Ver o `README.md` de lá para o quadro completo do sistema (rotas, modelo
de dados, segurança). Este README cobre só o front-end.

## Arquivos

- `index.html` — painel da associação (admin/diretoria). Login, dashboard,
  associados, financeiro, comunicados, acessos (usuários + auditoria),
  meu perfil. Header fixo no topo (saudação, avatar, dropdown de perfil)
  acima do conteúdo de cada seção — ver "Header e Meu Perfil" abaixo. Menu
  lateral: Dashboard (tela inicial) → Associados → Financeiro →
  Comunicados → **Acessos** (reestruturado 27/07/2026 — antes eram dois
  itens separados, "Usuários" e "Configurações"; ver seção própria
  "Acessos: Usuários + Auditoria" abaixo). Em tablet/celular a sidebar
  vira um menu off-canvas com botão hambúrguer (☰), ver seção "Layout e
  responsividade". Login rejeita contas com papel `associado` (mensagem
  aponta para `portal.html`) — ver seção "Separação do Portal do
  Associado" abaixo.
- `portal.html` — Portal do Associado, arquivo próprio desde 25/07/2026
  (ver seção "Separação do Portal do Associado" abaixo). Login separado
  (rejeita papéis que não sejam `associado`), sessão própria
  (`sessao_portal` no `localStorage`, isolada de `sessao_painel`). Sidebar
  enxuta: Meus Dados (tela inicial — cadastro, foto, cobranças, pagamento
  via Pix com upload de comprovante) e Comunicados (mural só leitura, sem
  botão de publicar). Mesmo sistema visual do `index.html` (cores,
  tipografia, sidebar off-canvas no mobile), CSS trimado do que é
  específico do painel administrativo (KPIs, gráficos, tabela de
  associados etc.) — não tem Chart.js, só o gerador de QR Pix.
- `superadmin.html` — painel do Super Admin (dono da plataforma). Login
  separado dos outros arquivos. Sidebar navegável: Dashboard, Associações,
  Administradores (gated por papel), Auditoria, Contratações, Config. Pix,
  Meu Perfil. Dashboard compacto com KPIs, gráficos de crescimento/novos
  associados e grade de "últimas" (associações/admins/atividades). Tela de
  Associações com CRUD completo, filtros e formulário estendido (plano
  contratado, trial, vencimento, forma de cobrança, logo/CEP/site, CPF
  responsável, dias de alerta de renovação).
- `landing.html` — página de vendas pública (marca **ASSOCIA PLUS**, novo
  posicionamento comercial, 25/07/2026). Sem login, sem chamada à API —
  só HTML/CSS/JS estático. Ver seção própria "Landing page (ASSOCIA
  PLUS)" abaixo.
- `manual.html` — guia passo a passo de como usar o Super Admin, o Painel
  da Associação e o Portal do Associado. Estático, sem login.
- `sprint.html` — backlog interno de melhorias/bugs da plataforma (não é
  voltado a clientes). Login reaproveita `POST /superadmin/login`. Sem
  sidebar, página única com KPIs + tabela filtrável + modal de
  criar/editar/detalhe.
- `intranet.html` — "Painel Central", hub de acesso rápido a todos os
  arquivos acima + cards de infraestrutura (GitHub/Vercel/Supabase/Render).
  Abas Produção/Homologação — ver "Intranet" abaixo.

## Separação do Portal do Associado (25/07/2026)

Antes dessa mudança, o associado fazia login pelo mesmo `index.html` do
admin/diretoria — o JS escondia/mostrava abas em runtime conforme
`estado.papel === 'associado'` (`entrarNoDashboard()`). Isso significava
que todo associado baixava e executava o código inteiro de administração
(associados, financeiro, usuários, configurações) mesmo sem acesso a
nada disso, e qualquer mudança no painel admin arriscava quebrar por
engano a tela do associado por estarem no mesmo arquivo.

Passou a seguir o mesmo padrão que `superadmin.html` já usava: arquivo
próprio (`portal.html`), com login e sessão isolados. `index.html` agora
recusa login de contas com papel `associado` (mensagem de erro aponta
para o portal); `portal.html` recusa login de qualquer papel que não
seja `associado`. Sessões salvas antes da mudança (`sessao_painel` com
`papel: 'associado'`) são detectadas e limpas na restauração de sessão
do `index.html`, forçando novo login (que agora vai barrar e orientar a
pessoa a usar `portal.html`).

O backend não mudou nada — `routes/portal.js` já era um módulo à parte,
só consumido pelo papel `associado` (`autorizar('associado')`), então
essa separação foi só de front-end.

`abrirModalPix()` em `index.html` foi simplificada: antes tinha um modo
duplo (`modoAdmin`) que também servia o fluxo de autoatendimento do
associado (upload de comprovante); agora serve só a visualização do QR
pela diretoria (sem upload — isso já era escondido em modo admin, só que
agora o bloco de upload nem existe mais no HTML). O fluxo de pagamento
completo (QR + copia-e-cola + upload de comprovante) vive só em
`portal.html`.

## Hospedagem

Vercel, mesmo domínio para todos os arquivos deste repositório:
- `https://minha-associacao-painel.vercel.app/` → `index.html`
- `https://minha-associacao-painel.vercel.app/portal.html`
- `https://minha-associacao-painel.vercel.app/superadmin.html`
- `https://minha-associacao-painel.vercel.app/landing.html`
- `https://minha-associacao-painel.vercel.app/manual.html`
- `https://minha-associacao-painel.vercel.app/sprint.html`
- `https://minha-associacao-painel.vercel.app/intranet.html`

Deploy automático a cada push no GitHub (branch `main`). A raiz do
domínio continua sendo o login do painel administrativo (`index.html`) —
`landing.html` foi adicionada como página nova, sem virar a home do
domínio (decisão consciente, ver seção "Landing page" abaixo).

**Ambiente de homologação (staging, desde 27/07/2026)**: mesmo conjunto de
arquivos, projeto Vercel próprio, branch `staging` —
`https://minha-associacao-painel-staging.vercel.app/...`. Ver
`backend/README.md` para o quadro completo do ambiente de staging
(banco/backend próprios também).

## Configuração

Nenhum arquivo tem mais `API_URL` fixo — desde 27/07/2026, cada um resolve
o valor em tempo de execução pelo hostname (`localhost`/domínio contendo
"staging" → backend de staging; qualquer outro → produção):

```js
var API_URL = (function() {
  var h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.indexOf('staging') !== -1) {
    return 'https://minha-associacao-backend-staging.onrender.com';
  }
  return 'https://minha-associacao-backend.onrender.com';
})();
```

Isso existe de propósito pra eliminar o risco antigo de "trocar pra
testar local e esquecer de reverter antes de commitar" — o código é
idêntico em `main` e `staging`, não tem nada pra lembrar de reverter.

## Login

Só e-mail + senha (não usa mais código/ID da associação). Contas novas
(criadas pelo Super Admin ou por um admin de associação) recebem senha
provisória e são obrigadas a trocar no primeiro login — ver a tela
`tela-trocar-senha-obrigatoria` em `index.html`.

## Layout e responsividade

Ambos os arquivos usam o mesmo padrão visual: sidebar fixa recolhível
(`.app-layout`, `.sidebar`, `.content-area`), fonte Poppins em tudo (título,
corpo, números), tema claro/escuro. `.content-area` não tem `max-width` —
usa toda a largura disponível ao lado da sidebar (evita espaço vazio em
monitores largos enquanto tabelas ainda precisavam de scroll horizontal).

Breakpoints escalonados em ambos os arquivos: 1200px (sidebar/padding
reduzidos), 900px, 640px (KPIs em 2 colunas, tabelas/modais compactados),
480px (KPIs em 1 coluna, fontes reduzidas), 360px (telas muito pequenas).
Ajustar qualquer novo componente com esses mesmos pontos de corte para
manter consistência.

Em `index.html`, abaixo de 768px o comportamento muda: em vez de
"sidebar vira barra horizontal com scroll" (que ainda é o que
`superadmin.html` faz), a sidebar vira um **menu off-canvas**
(`position: fixed`, escondida por `transform: translateX(-100%)`, classe
`.aberta` revela) acionado por um botão hambúrguer `☰` numa barra fixa no
topo (`.mobile-topbar` / `#btn-hamburguer`), com overlay escurecido
(`#sidebar-overlay`) que fecha o menu ao clicar fora. Qualquer navegação
pelo menu já fecha a sidebar sozinha (`ativarAba()` chama
`fecharSidebarMobile()` no final).

## Header e Meu Perfil (`index.html`)

Header fixo (`.app-header`) acima do conteúdo de cada seção, presente em
todas as telas: saudação por horário (Bom dia/Boa tarde/Boa noite,
`saudacaoPorHorario()`) + primeiro nome, e-mail, avatar de iniciais
(`.avatar-iniciais`, `iniciaisNome()`). Clicar no avatar abre um dropdown
(`.dropdown-perfil`) com **Meu Perfil**, **Alterar Senha**,
**Preferências** (atalho pra "Parametrização", só admin — ver seção
"Acessos: Usuários + Auditoria" abaixo), **Alternar Tema** (27/07/2026 —
saiu da sidebar, centralizado só aqui) e **Sair** (fecha ao clicar fora,
mesmo princípio do `#sidebar-overlay` da sidebar mobile).

`nome` vem do login (`res.data.usuario.nome`) e é persistido em
`sessao_painel` no `localStorage` junto com token/papel. `email` **não**
tem rota própria — é decodificado do payload do próprio JWT no cliente
(`decodificarEmailDoToken()`, `atob()` sem verificar assinatura, só pra
exibição). **Meu Perfil** (`secao-meu-perfil`) é uma tela simples (nome,
e-mail só leitura, avatar) só para admin/diretoria, acessível apenas pelo
dropdown — não é item da sidebar principal. **Alterar Senha** é um modal
que reaproveita a rota já existente `PUT /auth/senha` (mesma da troca
obrigatória de senha no primeiro acesso).

## Menu lateral e Dashboard (`index.html`)

A tela inicial após login (admin/diretoria) é o **Dashboard**
(`secao-dashboard`), reconstruído em 25/07/2026:

- **7 KPIs** com ícone, cor e comparativo vs. mês anterior
  (`renderizarKpiDelta()`): Total de associados, Ativos, Novos no mês,
  Inadimplentes, Receita do mês, Mensalidades vencidas, Mensalidades a
  vencer.
- **4 gráficos** Chart.js (mesmo padrão visual do Super Admin,
  `coresGrafico()` + `.grafico-card`): crescimento de associados
  acumulado (linha, 12 meses), novos associados por mês (barra, 12
  meses) — ambos em `atualizarGraficosAssociados()`, a partir de
  `data_ingresso` de `GET /associados`; receita mensal recebido-vs-emitido
  (barras agrupadas) e situação financeira (pizza) — ambos em
  `atualizarDashboardFinanceiro()`, a partir de `GET /cobrancas` (que
  agora também retorna `pago_em`).
- **4 cards de apoio**: atividades recentes (`carregarAtividades()`,
  consome a rota nova `GET /atividades` do backend), próximos
  vencimentos (cobranças pendentes vencendo em 7 dias, computado de
  `cobrancasCache`), últimos associados cadastrados
  (`atualizarUltimosAssociados()` — mostra avatar de iniciais, **não**
  carrega `foto_base64` em massa, de propósito, pra não pesar a resposta
  de `/associados`), comunicados recentes
  (`atualizarComunicadosRecentes()`, reaproveita o cache já buscado por
  `carregarComunicados()`).

A tela de **Associados** (`secao-associados`) tem só a lista/busca/filtro
e o botão de novo associado — chegar nela é direto pelo item "Associados"
da sidebar (sem submenu, desde 25/07/2026). Clicar num KPI do Dashboard
(Total/Ativos/Inadimplentes) navega para Associados e já aplica o filtro
correspondente; clicar em Mensalidades vencidas/a vencer navega para
Financeiro.

Cuidado ao mexer nesses cálculos de mês: os buckets usam string
`YYYY-MM`/`YYYY-MM-DD` (`chaveMesLocal()`, `chaveMesDeData()`,
comparação lexicográfica), nunca `new Date(a.data_ingresso) < ...` nem
`toISOString()` — `toISOString()` converte para UTC e desloca a data em
regiões UTC-negativas (Brasil, UTC-3), fazendo um registro do "mês atual"
cair no bucket errado perto da virada do mês/dia. Os gráficos também usam
`maintainAspectRatio: false` com altura fixa no container (`.grafico-card
canvas` dentro de uma `div` com `height` em CSS) — sem isso, em telas
largas o canvas do Chart.js estica verticalmente também (a proporção
padrão é largura/altura, e a largura do card cresce muito quando não há
mais `max-width` no `.content-area`).

## Alerta inteligente de renovação do plano (27/07/2026)

`#bloco-plano-dashboard` no Dashboard mostra o card de plano/trial de
sempre, mas agora com destaque visual crescente (`renderizarBlocoPlano()`)
quando `GET /plano` devolve um campo `alerta`: classes
`.card-plano.alerta-atencao`/`.alerta-alerta`/`.alerta-critico` (as duas
últimas com animação de pulse), título e mensagem viram um aviso ("⚠️ Sua
assinatura vence em N dias" / "venceu há N dias", ou a versão de trial
"Sua avaliação termina em N dias"), botão vira "Renovar Plano" (mesmo
modal de contratação de sempre). Nível calculado no backend
(`utils/precos.js`, `alertaAssinatura`), janela configurável pelo Super
Admin por associação (`dias_alerta_assinatura`, select fechado
30/20/15/10/7/3 dias no formulário de associação do `superadmin.html`).
Sem alerta, o card continua exatamente como antes (informativo).

## Ficha completa do associado (27/07/2026)

O modal de Novo/Editar Associado (`#overlay-modal`) virou `.modal-ficha`
(mais largo, com scroll próprio), reorganizado em seções (Dados pessoais,
Endereço, Plano e situação, Observações — mais RG e endereço estruturado,
campos novos no backend) e, no modo edição, ganha 3 abas:

- **Dados**: o formulário acima, mais "Data de cadastro" (só leitura)
- **Financeiro**: histórico de cobranças desse associado
  (`GET /cobrancas?associado_id=X`, já existia), com filtro por
  status/ano e acesso ao comprovante
- **Comunicados**: quais comunicados esse associado leu/não leu, com data
  e tempo até a leitura (`GET /associados/:id/comunicados`, novo)

A listagem de associados tem dois botões separados por linha: **"Ver
ficha"** (mesmo modal, mas todos os campos em `readOnly`/`disabled`, sem
botão Salvar — só visualização) e **"Editar"** (formulário editável
normal). `abrirFichaAssociado(id, modo)` (`modo: 'ver'|'editar'`)
substitui a antiga `abrirEdicaoAssociado`.

## Confirmação de leitura dos comunicados (27/07/2026)

Cada card de comunicado mostra estatísticas de leitura — Enviado para /
Lido por / Pendente / Taxa de leitura (cor muda conforme a taxa) — e um
botão **"Ver leituras"**, que abre um modal com 2 abas: "Associados que
leram" (nome, data, hora) e "Associados que não leram" (nome/e-mail),
busca por nome, exportação em PDF (Excel removido em 29/07 — ver
"Auditoria de segurança" no `CLAUDE.md`, ~10 vulnerabilidades sem
correção na cadeia de dependência do `exceljs`). Consome `GET
/comunicados/:id/leituras` e `/leituras/exportar/:formato`, novos no
backend. Cada comunicado enviado pelo Super Admin (broadcast, 28/07 —
ver seção própria abaixo) ganha o selo **"Comunicado oficial"** e não
mostra os botões Editar/Excluir, mesmo para admin/diretoria.

## Acessos: Usuários + Auditoria (27/07/2026)

Sidebar perdeu os itens separados "Usuários" e "Configurações" — viraram
**"Acessos"**, com 2 sub-abas internas (mesmo padrão visual `.abas-ficha`
da ficha do associado):

- **Usuários**: o CRUD de sempre (convidar, editar, desativar, excluir),
  mais colunas **Criado em**/**Último acesso** (derivado de `auth_logs`,
  sem coluna nova) e botões **Redefinir senha** (gera provisória nova,
  reaproveita o modal de credenciais que já existia pra usuário novo) e
  **Reativar** (antes, uma vez desativado não tinha como reverter pela
  UI). **Perfis de acesso granulares** (28/07): além de admin/diretoria/
  associado, `#usuario-papel` ganhou 4 opções novas — Financeiro,
  Atendimento, Operador, Somente Consulta — cada um com uma matriz
  própria de permissões (ver `PERMISSOES`/`podeFazer()`, novo padrão
  reutilizável, espelha exatamente o que cada `autorizar(...)` do
  backend aceita pra não haver divergência entre "o botão aparece" e "a
  chamada funciona"). Atribuir um desses 4 papéis exige plano
  Intermediário+ (gating por plano, 29/07) — as opções ficam desabilitadas
  no `<select>` quando o plano não atende, exceto se já é o papel atual
  de quem está sendo editado (grandfathering)
- **Auditoria**: mesma experiência da tela "Auditoria" do
  `superadmin.html` (filtros de usuário/módulo/tipo de ação/período,
  paginação, modal de detalhes com diff antes/depois, exportação em
  PDF — Excel removido em 29/07), só que já filtrada pra essa associação —
  consome `GET /auditoria`, novo no backend, sem filtro de "associação"
  nem módulo "administradores" (não fazem sentido num tenant só). Exige
  plano Avançado (`#btn-aba-acessos-auditoria` some se o plano não
  atende, gating por plano, 29/07)

**"Parametrização"** (chave Pix + alertas de vencimento de cobrança —
mesmo conteúdo que já existia) saiu da sidebar por completo: só é
alcançável pelo item **"Preferências"** do dropdown do header. Isso é a
etapa 1-2 de um pedido maior de reorganização (unificar tudo relacionado
a configuração administrativa) — as demais seções (financeiro avançado,
alertas mais ricos, comunicação, cadastro de associados, sistema,
segurança, integrações) ficam pra sprints futuras, uma de cada vez.

## Intranet — "Painel Central" (27/07/2026)

`intranet.html` ganhou duas abas (`ativarAmbiente('producao'|
'homologacao')`, preferência salva em `localStorage`): os 6 cards de
sempre (Super Admin/Painel/Portal/Landing/Manual/Sprint), cada aba usando
URL absoluta do domínio certo (produção ou staging) em vez de link
relativo — como a página é servida nos dois ambientes, um link relativo
sempre apontaria pro ambiente atual, não necessariamente o desejado. Cada
aba também tem uma seção "Acesso rápido — infraestrutura": cards menores
linkando pros dashboards reais de GitHub (branch certa por ambiente),
Vercel, Supabase e Render.

## Super Admin — funcionalidades específicas

**Dashboard** (compactado 26/07/2026): KPIs de associações totais,
associados agregados, MRR, mensalidades vencendo/ativas/bloqueadas.
Gráficos Chart.js de crescimento (12 meses) e novos associados — os
gráficos de "receita recebida por mês" e "distribuição por plano" foram
removidos nessa reforma. Grade de 3 cards de "últimas" (associações,
admins, atividades — a última via `logs_auditoria`, ver seção de
Auditoria abaixo). Alertas automáticos: assinaturas vencidas/vencendo
(customizável por associação via `dias_alerta_assinatura`), clientes
novos (últimos 7 dias), mensalidades atrasadas agregadas, solicitações de
plano pendentes.

**Administradores** (26/07/2026, gated por papel `super_admin`): CRUD de
quem tem acesso ao Super Admin, com papel (super_admin/administrador/
suporte), ativar/desativar, redefinir senha.

**Auditoria** (26/07/2026): tela cross-tenant sobre `logs_auditoria` —
filtros (usuário, associação, módulo, tipo de ação, período, ordenação),
tabela paginada, modal de detalhes com diff `dados_anteriores`/
`dados_novos` lado a lado, exportação em PDF (Excel removido em 29/07,
ver "Removido: exportação Excel" abaixo). Mesma UX foi replicada
pra dentro de cada associação (só os próprios logs) em 27/07/2026 — ver
"Acessos: Usuários + Auditoria" acima.

**Comunicados** (28/07/2026, nova aba na sidebar, entre "Contratações" e
"Config. Pix", visível pra `super_admin`/`administrador`, oculta pra
`suporte`): formulário simples (título + conteúdo) que publica um aviso
no mural de **todas** as associações ativas de uma vez
(`POST /superadmin/comunicados-plataforma`) — confirmação via
`confirmarAcao()` antes de enviar (irreversível). Reaproveita o mural que
cada associação já tem, sem tela de leitura nova.

**Contratações** (26/07/2026): fila de aprovação de solicitações de
contratação de plano pago (Pix da própria plataforma + comprovante
enviado pela associação). Visualização de comprovante (27/07/2026,
`renderizarArquivoBase64()`) alinhada com o padrão que `index.html` já
usava: PDF vira Blob local exibido inline num iframe (com link de apoio
pra abrir em nova aba), em vez de um link direto pro `data:` URI (que
falhava com arquivo grande em alguns navegadores).

**Associações**: Tabela com filtros (nome, cidade/UF, plano, status da
assinatura). Colunas: Nome, Cidade/UF, Responsável, Plano, Qtd.
Associados, Valor Mensalidade, Status (bloqueada/trial/vencida/vencendo/
ativa — calculado, não gravado), Data de Cadastro, Próximo Vencimento,
Ações (Ver/Editar/Excluir).

**Formulário de Associação**: Dados básicos + Dados de Cadastro
(CEP/site/logo). Plano Contratado (select, valor com sugestão automática,
vencimento, forma de cobrança, duração do trial em dias, e — 27/07/2026 —
select de "Alertar vencimento da assinatura com quantos dias de
antecedência?", fechado em 30/20/15/10/7/3). CPF do Responsável.
Confirmação de ações destrutivas via modal próprio, não `confirm()`
nativo.

**Cálculo de MRR**: Centralizado em `backend/utils/precos.js`. Cada plano
tem preço-base + preço por associado ativo; fórmula aplicada no backend.
Campo `valor_mensalidade_manual` na associação permite sobrescrever —
útil para negociações customizadas.

## Landing page (ASSOCIA PLUS) — 25/07/2026

Página de vendas pública, arquivo próprio (`landing.html`), separado dos
outros três por completo — não importa nada deles, não é tocado por eles,
e eles não foram tocados por essa adição. Motivação: o usuário decidiu um
novo posicionamento comercial para o produto (marca **ASSOCIA PLUS**,
slogan "Organize. Comunique. Evolua.") e pediu uma landing para vender a
plataforma, mantendo a marca "sem nome" no restante do painel (decisão
já tomada antes, na reforma de header/sidebar de 25/07 — ver seção do
`CLAUDE.md`).

**Identidade visual**: pediu-se explicitamente para reaproveitar a
paleta e a fonte já usadas em `index.html`/`superadmin.html`, não criar
uma identidade nova — `--bg:#F7F5EF`, `--bg-card:#fff`, `--text:#1A1712`,
`--text-muted:#6B6558`, `--border:#E4E0D2`, `--accent:#C9A84C` (dourado),
Poppins (mesmo link do Google Fonts do painel). Tema claro/escuro
completo (`prefers-color-scheme` + `[data-theme]`, mesmos valores de
dark do `index.html`). Botões sempre dourado com texto `#0A0A0A` (mesmo
padrão do `.btn`/`.avatar-iniciais` do painel).

**Conteúdo**: hero com mini-dashboard ilustrativo (dado fictício, não é
print real) + rede de pontos animada em canvas (motivo: associados
conectados). Três "problemas que toda diretoria conhece" com
antes/depois. Os três pilares da marca (Organize/Comunique/Evolua)
tratados como sequência real (numerada 1/2/3), cada um ligado a
funcionalidades reais do produto. Bloco de segurança (RLS, senhas com
hash, conexão criptografada — mesmas garantias documentadas no
`README.md` do backend, em linguagem simples pro público leigo). Preços
em 3 planos por **porte** da associação (pequeno/médio/grande = mesmos
valores de básico/intermediário/avançado em
`backend/utils/precos.js` — planos renomeados de profissional/enterprise
em 29/07/2026, mesmos preços e faixas, só o rótulo — não são preços
novos, só reapresentados por porte em vez de nome de plano), com fórmula
visível (base + valor por associado) e exemplo de cálculo por card. Teste grátis de 15 dias sem
cartão de crédito (decisão de negócio do usuário, reduzir fricção de
entrada) — hoje é só texto de marketing, **não existe fluxo de trial
automatizado no backend ainda** (o botão de CTA não faz nada, é só link
âncora `#planos`; criar esse fluxo de verdade é trabalho futuro). FAQ em
acordeão.

**Sem chamada a API** — página 100% estática, sem `API_URL`, sem
`localStorage`, sem sessão. Isso é intencional: é a porta de entrada
pública, antes de qualquer login.

**Bugs de CSS encontrados e corrigidos depois do primeiro deploy** (não
óbvios, guardar aqui para não repetir):
- `.ap-nav-links-inner` tinha `style="display:flex"` **inline** no HTML,
  além da classe. Estilo inline sempre vence regra de `@media` (que
  tentava esconder esse bloco de links abaixo de 780px) — o menu
  "Recursos/Planos/Perguntas frequentes" nunca sumia no mobile e
  empurrava o botão "Teste grátis por 15 dias" pra fora da tela. Corrigido
  movendo o `display:flex` para dentro da classe no CSS, onde o `@media`
  consegue sobrescrever normalmente. **Lição**: nunca duplicar em `style=`
  inline uma propriedade que precisa ser sobrescrita por media query mais
  adiante — o inline sempre ganha, independente de especificidade de
  classe.
- `.ap-nav-row` usava o atalho `padding: 16px 0` (zera left/right) e
  `.ap-shell` definia `padding: 0 32px` (ou `24px` no mobile) — como as
  duas classes estão no mesmo elemento e têm a mesma especificidade
  (uma classe cada), a que vem **depois** no CSS vence a propriedade
  inteira, e `.ap-nav-row` vinha depois. Resultado: a margem lateral do
  cabeçalho nunca funcionava (logo e botão colados na borda da tela,
  mais visível no mobile). Corrigido trocando `.ap-nav-row` para
  `padding-top`/`padding-bottom` isolados, sem tocar em left/right, que
  ficam só por conta do `.ap-shell`. **Lição**: evitar `padding`/`margin`
  como atalho (shorthand) em duas classes diferentes aplicadas ao mesmo
  elemento quando ambas mexem nos mesmos lados — usar propriedades
  longhand (`padding-top`, etc.) quando for necessário que uma delas
  sobrescreva só parte do espaçamento.

## Gating de funcionalidades por plano + planos renomeados (29/07/2026)

Plano `profissional`/`enterprise` renomeados para `intermediario`/
`avancado` em todo o front (mesmos preços/faixas, só o rótulo — ver
`backend/CLAUDE.md` pra migration). `PRECOS_PLANO`/`INFO_PLANO`/
`ROTULOS_PLANO` atualizados em `index.html`/`superadmin.html`.

Novo helper `planoAtende(nivelMinimo)` em `index.html`/`portal.html`
(espelha `NIVEL_PLANO`/`planoAtendeNivel` do backend, `estado.plano`
decodificado do próprio JWT, só pra decisão de UI — o bloqueio real é
sempre o backend). Usado em 5 pontos: editar alertas de vencimento
(Intermediário+), atribuir perfil de acesso granular (Intermediário+,
ver "Acessos" acima), exportar leituras de comunicado (Intermediário+),
aba Auditoria (Avançado), botão "Ver carteirinha" no portal
(Intermediário+, ver "Portal do associado" abaixo).

## Removido: exportação Excel (29/07/2026)

Consequência de `exceljs` ter sido removido do backend inteiro (~10
vulnerabilidades sem correção disponível em nenhuma versão publicada,
decisão do usuário — ver `backend/CLAUDE.md`/`README.md`). Removidos os
3 botões "Exportar Excel" (`superadmin.html`, `index.html` × 2 —
auditoria e leituras de comunicado) e simplificadas as 3 funções JS
correspondentes (`exportarLogs`, `exportarAuditoria`,
`exportarLeiturasComunicado`) pra não receberem mais parâmetro
`formato` — só PDF existe agora.

## Portal do associado — mini-dashboard, ficha completa, carteirinha, logo (28/07/2026)

Vários pedidos do mesmo dia, todos em `portal.html` (exceto a logo, em
`index.html`):

- **Início** (novo item de sidebar, primeiro da lista, landing page do
  login): dois cards — "Situação financeira" (badge de status, próxima
  cobrança pendente com botão "Pagar com Pix") e "Comunicados" (badge de
  não lidos, 3 mais recentes). Só reaproveita rotas já existentes, nenhuma
  nova.
- **Meus Dados** virou ficha completa: 3 seções (Dados pessoais,
  Endereço, Plano e situação) em vez do resumo de 4 linhas de antes — só
  leitura, sem edição (associado não edita a própria ficha, só a foto).
- **Nova aba "Financeiro"**: a tabela "Minhas cobranças" saiu de dentro
  de "Meus Dados" e virou seção própria.
- **Carteirinha digital** (plano Intermediário+): botão "Ver carteirinha"
  abre um cartão com foto/nome/associação/categoria/status + QR code
  (`ASSOCIADO:<id>`, reaproveita a lib `qrcode-generator` já usada pro
  Pix) — cosmético/identificador, sem endpoint de verificação por scan
  ainda.
- **Header**: passou a mostrar o nome da associação (`GET
  /configuracoes/identidade`) no lugar do e-mail do associado.
- **Logo da associação** (`index.html`, dentro de "Parametrização"):
  admin pode trocar a própria logo (`PUT /configuracoes/logo`, novo no
  backend) — antes só o Super Admin conseguia.

## Modal de boas-vindas no primeiro acesso (30/07/2026)

Modal novo em `index.html` (admin/diretoria) e `portal.html` (associado),
mostrado uma única vez no primeiro login de cada usuário — mesmo padrão
visual `.overlay`/`.modal` de sempre.

- **`index.html`**: nome da associação, plano, limite de associados,
  dias restantes de trial (se aplicável). Aberto de dentro de
  `carregarPlano()` quando `GET /plano` devolve `boas_vindas_pendente:
  true` — reaproveita a chamada que `entrarNoDashboard()` já fazia.
- **`portal.html`**: nome da associação + lista do que dá pra fazer no
  portal (Pix, comunicados, foto, carteirinha — este último item some se
  o plano não for Intermediário+). Aberto de dentro de `carregarInicio()`
  (`GET /portal/meus-dados`).

Botão "Começar a usar a plataforma" fecha o modal na hora e dispara
`PATCH /auth/boas-vindas-visto` em paralelo (fire-and-forget) — a flag
fica gravada no banco (`usuarios.boas_vindas_visto_em`), não em
`localStorage`, então não reaparece ao trocar de navegador/limpar cache.

## Controle inteligente de limite de associados + sugestão de upgrade (30/07/2026, `index.html`)

Reverte a decisão anterior de "limite só avisa, nunca bloqueia" —
confirmado com o usuário antes de implementar (ver `backend/CLAUDE.md`
pros 3 pontos de conflito resolvidos com a spec original).

`renderizarBlocoPlano()` (card do Dashboard) ganhou, pra planos pagos:
barra de uso (associados X/Y, cor muda por faixa), aviso por faixa de uso
(80% neutro, 90% "restam N vagas", 100% crítico + botões "Conhecer Plano
X"/"Realizar Upgrade"), dias até o vencimento sempre visíveis (não só
dentro do alerta). Botão principal varia: dois botões ("Pagar Agora"/"Ver
Detalhes do Plano") quando há alerta de vencimento; um botão só, rótulo
"Pagar Plano" no Avançado (pula direto pro pagamento) ou "Gerenciar
Plano" nos demais.

`abrirModalContratarPlano(planoPreSelecionado)` ganhou um parâmetro
opcional — quando informado, pula a grade de escolha e vai direto pra
tela de pagamento. `renderizarOpcoesPlano()` usa
`planoAtualDados.planos_gerenciaveis` (do backend) em vez de sempre
mostrar os 3 planos — Intermediário só oferece Avançado, nunca
downgrade pelo cliente.

**Renovação inteligente**: banner novo dentro do modal
(`#aviso-renovacao-inteligente`) quando `plano_renovacao_sugerido` vem
preenchido (associação cresceu além do limite do plano atual) — sugere
migrar pro plano compatível.

**Bloqueio de cadastro**: `btn-salvar-associado` trata
`codigo: 'LIMITE_ASSOCIADOS_ATINGIDO'` (403) como caso especial — fecha a
ficha, mostra o erro e, se admin, já abre o modal de plano pré-selecionado
no próximo plano sugerido. O botão "+ Novo associado" também fica
desabilitado proativamente no nível crítico (só UX — a proteção real é
sempre o 403 do backend).

Todo o fluxo de upgrade/renovação continua usando a contratação manual já
existente (Pix + comprovante + aprovação do Super Admin) — nenhuma
infraestrutura de pagamento nova.

## Convenções

- Sem framework, sem bundler — CSS e JS inline no próprio HTML.
- Estilo consistente em todo o arquivo: `var` e `function() {}` em vez de
  `const`/`let`/arrow functions — manter esse padrão ao editar.
- Toda chamada à API inclui `Authorization: Bearer <token>` a partir de
  `estado.token`; sessão persiste em `localStorage` — cada arquivo com sua
  própria chave (`sessao_painel` em `index.html`, `sessao_portal` em
  `portal.html`, `sessao_superadmin` em `superadmin.html`), sem
  compartilhar sessão entre si.
- Modais de confirmação para ações destrutivas usam `confirmarAcao()`
  reutilizável — implementada em `index.html` e `superadmin.html` (não em
  `portal.html`, que não tem ações destrutivas), não `confirm()` nativo.
  Assinatura:
  `confirmarAcao({ titulo, mensagem, textoConfirmar, perigo, aoConfirmar })`;
  `perigo: true` deixa o botão de confirmação vermelho (`.btn-perigo`).
- Cada um dos três arquivos é autocontido (login, sessão, layout
  próprios) por papel de usuário — não por associação; o isolamento entre
  associações continua sendo feito pelo backend (RLS), não pelo
  front-end. Ao criar um padrão visual/JS novo num desses arquivos que
  fizer sentido nos outros, reaproveitar copiando o trecho (sem
  bundler/import, cada arquivo é independente).
