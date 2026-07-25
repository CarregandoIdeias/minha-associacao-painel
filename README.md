# Painel — Plataforma para Associações

Front-end da plataforma SaaS de gestão de associações. HTML/CSS/JS puro,
sem framework e sem build step — os dois arquivos deste repositório são
publicados exatamente como estão.

Backend (API): repositório separado, `CarregandoIdeias/minha-associacao-backend`.
Ver o `README.md` de lá para o quadro completo do sistema (rotas, modelo
de dados, segurança). Este README cobre só o front-end.

## Arquivos

- `index.html` — painel da associação (admin/diretoria/associado). Login,
  associados, financeiro, comunicados, usuários, configurações, portal do
  associado — tudo num arquivo só, com abas mostradas/escondidas por papel.
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
  reutilizável (função genérica no Super Admin), não `confirm()` nativo.
