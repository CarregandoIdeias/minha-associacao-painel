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

## Convenções

- Sem framework/bundler — tudo inline (CSS e JS dentro do próprio HTML).
- Estilo consistente: `var`/`function() {}`, não `const`/arrow — manter
  ao editar.
- Padrão de modal "credenciais geradas" (senha provisória mostrada uma
  única vez, com botão de copiar) se repete em vários fluxos — reaproveitar
  o mesmo padrão visual/JS ao criar um novo, não inventar outro.
