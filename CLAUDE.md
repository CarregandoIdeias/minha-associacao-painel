# CLAUDE.md — painel

Contexto rápido para sessões de IA. Ver `README.md` deste repositório para
mais detalhes do front-end, e o `README.md`/`CLAUDE.md` do repositório do
backend (`../minha-associacao-backend`, ou `CarregandoIdeias/minha-associacao-backend`
no GitHub) para o sistema completo — é lá que vive a documentação de
segurança, RLS, modelo de dados e rotas da API.

## O que é

Front-end da plataforma de gestão de associações — dois arquivos HTML
autocontidos (`index.html`: painel da associação; `superadmin.html`:
painel do Super Admin), sem build step, publicados direto no Vercel.

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

## Painel da associação — reestruturação do menu (25/07/2026)

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
