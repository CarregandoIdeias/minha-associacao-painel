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
  separado do painel da associação, CRUD de associações, dashboard
  agregado.

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

## Convenções

- Sem framework, sem bundler — CSS e JS inline no próprio HTML.
- Estilo consistente em todo o arquivo: `var` e `function() {}` em vez de
  `const`/`let`/arrow functions — manter esse padrão ao editar.
- Toda chamada à API inclui `Authorization: Bearer <token>` a partir de
  `estado.token`; sessão persiste em `localStorage` (`sessao_painel`).
