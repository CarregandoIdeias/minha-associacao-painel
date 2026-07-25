# Painel — Plataforma para Associações

Front-end da plataforma SaaS de gestão de associações. HTML/CSS/JS puro,
sem framework e sem build step — os dois arquivos deste repositório são
publicados exatamente como estão.

Backend (API): repositório separado, `CarregandoIdeias/minha-associacao-backend`.
Ver o `README.md` de lá para o quadro completo do sistema (rotas, modelo
de dados, segurança). Este README cobre só o front-end.

## Arquivos

- `index.html` — painel da associação (admin/diretoria/associado). Login,
  dashboard, associados, financeiro, comunicados, usuários, configurações,
  meu perfil, portal do associado — tudo num arquivo só, com abas
  mostradas/escondidas por papel. Header fixo no topo (saudação, e-mail,
  avatar, menu de perfil) acima do conteúdo de cada seção — ver "Header e
  Meu Perfil" abaixo. Menu lateral, sem submenus: Dashboard (tela inicial,
  ver seção própria abaixo) → Associados → Financeiro → Comunicados →
  Usuários → Configurações. Em tablet/celular a sidebar vira um menu
  off-canvas com botão hambúrguer (☰), ver seção "Layout e
  responsividade".
- `superadmin.html` — painel do Super Admin (dono da plataforma). Login
  separado do painel da associação. Layout com sidebar navegável
  (Dashboard + Associações). Dashboard agregado com 7 KPIs, 4 gráficos
  (crescimento, novos associados, receita, distribuição por plano),
  últimas associações e alertas em tempo real (vencimentos, mensalidades
  atrasadas). Tela de Associações com CRUD completo, filtros (nome,
  cidade, UF, plano, status) e formulário estendido (plano contratado,
  vencimento, forma de cobrança, logo/CEP/site, CPF responsável).

## Hospedagem

Vercel, mesmo domínio para os dois arquivos:
- `https://minha-associacao-painel.vercel.app/` → `index.html`
- `https://minha-associacao-painel.vercel.app/superadmin.html`

Deploy automático a cada push no GitHub (branch `main`).

## Configuração

Cada arquivo tem, no topo do `<script>`, uma constante:

```js
var API_URL = 'https://minha-associacao-backend.onrender.com';
```

Ao testar contra um backend local, trocar para `http://localhost:3000` —
**e lembrar de reverter antes de commitar/dar push**, senão a produção
fica apontando para localhost.

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
(`.dropdown-perfil`) com **Meu Perfil**, **Alterar Senha** e **Sair**
(fecha ao clicar fora, mesmo princípio do `#sidebar-overlay` da sidebar
mobile).

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

## Super Admin — funcionalidades específicas

**Dashboard**: KPIs de associações totais, associados agregados, MRR
(receita mensal recorrente calculada pelo plano), mensalidades vencendo,
ativas e bloqueadas. Gráficos Chart.js de crescimento (12 meses),
associados novos, receita recebida (histórico real, não projeção) e
distribuição de clientes por plano. Alertas gerados automaticamente no
backend: assinaturas vencidas/vencendo (customizável por associação via
`dias_alerta_vencimento`), clientes novos (últimos 7 dias), mensalidades
atrasadas agregadas.

**Associações**: Tabela com filtros (nome, cidade/UF, plano, status da
assinatura). Colunas: Nome, Cidade/UF, Responsável (nome do admin da
associação), Plano, Qtd. Associados, Valor Mensalidade, Status
(bloqueada/trial/vencida/vencendo/ativa — calculado, não gravado),
Data de Cadastro, Próximo Vencimento, Ações (Ver/Editar/Excluir).

**Formulário de Associação**: Dados básicos (nome, tipo, email, telefone,
endereço) + Dados de Cadastro (CEP, site, logo em base64). Plano
Contratado (select de plano, campo numérico de valor da mensalidade com
sugestão automática da fórmula, data de vencimento, forma de cobrança).
CPF do Responsável (admin da associação). Confirmação de ações destrutivas
via modal próprio (não `confirm()` nativo) — padrão visual consistente com
o painel da associação.

**Cálculo de MRR**: Centralizado em `backend/utils/precos.js`. Cada plano
tem preço-base + preço por associado ativo; fórmula aplicada no backend
(GET `/superadmin/dashboard`, GET `/superadmin/associacoes`,
POST/PUT `/superadmin/associacoes/:id`). Campo `valor_mensalidade_manual`
na associação permite sobrescrever — útil para negociações customizadas.

## Convenções

- Sem framework, sem bundler — CSS e JS inline no próprio HTML.
- Estilo consistente em todo o arquivo: `var` e `function() {}` em vez de
  `const`/`let`/arrow functions — manter esse padrão ao editar.
- Toda chamada à API inclui `Authorization: Bearer <token>` a partir de
  `estado.token`; sessão persiste em `localStorage` (`sessao_painel`).
- Modais de confirmação para ações destrutivas usam `confirmarAcao()`
  reutilizável — implementada nos dois arquivos (`index.html` e
  `superadmin.html`), não `confirm()` nativo. Assinatura:
  `confirmarAcao({ titulo, mensagem, textoConfirmar, perigo, aoConfirmar })`;
  `perigo: true` deixa o botão de confirmação vermelho (`.btn-perigo`).
