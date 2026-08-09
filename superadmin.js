  // Detecta o ambiente pelo hostname em vez de valor fixo -- ver
  // painel/CLAUDE.md, seção "Ambiente de homologação".
  var API_URL = (function() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.indexOf('staging') !== -1) {
      return 'https://minha-associacao-backend-staging.onrender.com';
    }
    return 'https://minha-associacao-backend.onrender.com';
  })();
  var estado = { token: null, nome: null, id: null, papel: null };
  var associacoesCache = [];
  var administradoresCache = [];
  var ROTULOS_PAPEL_SUPERADMIN = { super_admin: 'Super Admin', administrador: 'Administrador', suporte: 'Suporte' };
  var ROTULOS_MODULO_LOG = {
    associacoes: 'Associações', administradores: 'Administradores', associados: 'Associados',
    cobrancas: 'Cobranças', comunicados: 'Comunicados', usuarios: 'Usuários',
    configuracoes: 'Configurações', autenticacao: 'Autenticação', auditoria: 'Auditoria'
  };
  var ROTULOS_TIPO_ACAO_LOG = {
    login: 'Login', logout: 'Logout', criacao: 'Criação', edicao: 'Edição', exclusao: 'Exclusão',
    alteracao_senha: 'Alteração de senha', alteracao_permissoes: 'Alteração de permissões', exportacao: 'Exportação de dados'
  };
  var logsCache = [];
  var paginaAtualLogs = 1;
  var totalLogs = 0;
  var porPaginaLogs = 50;
  var graficoCrescimento = null;
  var graficoAssociados = null;
  var logoSelecionadaBase64 = null;

  // Espelho do backend/utils/precos.js — só pra sugerir o valor da
  // mensalidade no formulário antes de salvar (o cálculo real é sempre
  // feito no servidor).
  var PRECOS_PLANO = {
    trial: { base: 0, porAssociado: 0 },
    basico: { base: 49.90, porAssociado: 2.00 },
    intermediario: { base: 99.90, porAssociado: 1.50 },
    avancado: { base: 199.90, porAssociado: 1.00 }
  };
  var ROTULOS_PLANO = { trial: 'Trial', basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado' };
  // status_assinatura (backend) -> classe CSS do badge (reaproveita .badge.ativo/.inativo já existentes)
  var CLASSE_BADGE_STATUS = { ativa: 'ativo', bloqueada: 'inativo', trial: 'trial', trial_expirado: 'vencida', vencida: 'vencida', vencendo: 'vencendo' };
  var ROTULO_STATUS_ASSINATURA = { trial_expirado: 'trial expirado' };

  var MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  var DIAS_PT = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];

  function atualizarSaudacao() {
    var agora = new Date();
    var hora = agora.getHours();
    var periodo = hora < 12 ? 'Bom dia' : (hora < 18 ? 'Boa tarde' : 'Boa noite');
    var nome = estado.nome || 'Administrador';
    document.getElementById('texto-saudacao').textContent = periodo + ', ' + nome;
    var dataTexto = DIAS_PT[agora.getDay()] + ', ' + agora.getDate() + ' de ' + MESES_PT[agora.getMonth()] + ' de ' + agora.getFullYear();
    document.getElementById('texto-data').textContent = dataTexto.charAt(0).toUpperCase() + dataTexto.slice(1);
  }

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    document.getElementById('icone-tema-claro').style.display = tema === 'dark' ? 'none' : '';
    document.getElementById('icone-tema-escuro').style.display = tema === 'dark' ? '' : 'none';
    document.getElementById('texto-menu-tema').textContent = tema === 'dark' ? 'Tema Claro' : 'Tema Escuro';
    localStorage.setItem('tema-superadmin', tema);
  }
  aplicarTema(localStorage.getItem('tema-superadmin') || 'light');
  document.getElementById('btn-menu-tema').onclick = function() {
    aplicarTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    if (estado.token && graficoCrescimento) carregarDashboard();
  };

  // ---------- Menu do avatar (Meu Perfil / Alterar Senha / Preferências / Tema / Sair) ----------
  document.getElementById('btn-abrir-perfil').onclick = function(e) {
    e.stopPropagation();
    document.getElementById('dropdown-perfil').classList.toggle('aberto');
  };
  document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('dropdown-perfil');
    if (dropdown.classList.contains('aberto') && !e.target.closest('.app-header-perfil')) {
      dropdown.classList.remove('aberto');
    }
  });
  document.getElementById('btn-menu-meu-perfil').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    ativarSecaoSuperAdmin('meu-perfil');
  };
  document.getElementById('btn-menu-alterar-senha').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    abrirModalAlterarSenha(false);
  };
  document.getElementById('btn-menu-preferencias').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    ativarSecaoSuperAdmin('parametrizacao');
  };

  function mostrarToast(msg, erro) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (erro ? ' erro' : '');
    setTimeout(function() { t.className = 'toast'; }, 3000);
  }

  // Escapa também as ASPAS -- ver comentário completo em index.html
  // (a versão antiga, textContent->innerHTML, deixava " e ' passarem e
  // permitia escapar de um atributo HTML). Auditoria de 07/08/2026.
  function escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Só aceita data URL base64 com MIME conhecido e alfabeto base64 estrito.
  // Espelha utils/validacao.js no backend -- as duas camadas existem de
  // propósito (ver comentário lá).
  var RE_DATA_URL_SEGURA = /^data:(image\/(png|jpeg|jpg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

  // Renderiza imagem/PDF vindo do banco SEM montar HTML por concatenação.
  // Concatenar dentro de src="..." permitia que um valor com aspas escapasse
  // do atributo e virasse XSS armazenado (um comprovante enviado por um
  // cliente executava script na sessão de quem abrisse a tela). Aqui o valor
  // nunca é interpretado como HTML: vai direto na propriedade .src/.href.
  function renderizarArquivoBase64(container, dataUrl, rotulo) {
    container.textContent = '';
    if (!dataUrl || !RE_DATA_URL_SEGURA.test(dataUrl)) {
      container.innerHTML = '<p class="vazio">Arquivo em formato inválido ou não suportado.</p>';
      return;
    }
    // Mesma ideia de painel/index.html (renderizarComprovanteBase64): PDF
    // vira Blob local (não link direto pro data: URI, que trava/erra em
    // arquivo grande em alguns navegadores) exibido inline num iframe, com
    // link de apoio pra abrir em nova aba.
    if (dataUrl.indexOf('data:application/pdf') === 0) {
      var blobUrl = dataUrlParaBlobUrl(dataUrl);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%; height:480px; border:1px solid var(--border); border-radius:10px;';
      container.appendChild(iframe);
      var p = document.createElement('p');
      p.style.marginTop = '10px';
      var link = document.createElement('a');
      link.href = blobUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.cssText = 'color:var(--accent); font-size:13px;';
      link.textContent = 'Abrir ' + rotulo + ' em nova aba';
      p.appendChild(link);
      container.appendChild(p);
      return;
    }
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = rotulo;
    img.style.maxWidth = '100%';
    img.style.borderRadius = '10px';
    container.appendChild(img);
  }

  function dataUrlParaBlobUrl(dataUrl) {
    var partes = dataUrl.split(',');
    var mimeMatch = partes[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    var binario = atob(partes[1]);
    var tamanho = binario.length;
    var bytes = new Uint8Array(tamanho);
    for (var i = 0; i < tamanho; i++) {
      bytes[i] = binario.charCodeAt(i);
    }
    var blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  }

  // Modal de confirmação genérico — substitui o confirm() nativo do navegador
  // em qualquer ação (excluir, redefinir senha, etc). Uso:
  // confirmarAcao({ mensagem: '...', aoConfirmar: function() { ... } })
  // Opcional: titulo, textoConfirmar, perigo (deixa o botão de confirmar vermelho).
  function confirmarAcao(opcoes) {
    document.getElementById('titulo-modal-confirmacao').textContent = opcoes.titulo || 'Confirmar ação';
    document.getElementById('texto-modal-confirmacao').textContent = opcoes.mensagem;
    var btnConfirmar = document.getElementById('btn-confirmar-confirmacao');
    btnConfirmar.textContent = opcoes.textoConfirmar || 'Confirmar';
    btnConfirmar.className = 'btn' + (opcoes.perigo ? ' btn-perigo' : '');
    btnConfirmar.onclick = function() {
      document.getElementById('overlay-modal-confirmacao').style.display = 'none';
      opcoes.aoConfirmar();
    };
    document.getElementById('overlay-modal-confirmacao').style.display = 'flex';
  }
  document.getElementById('btn-cancelar-confirmacao').onclick = function() {
    document.getElementById('overlay-modal-confirmacao').style.display = 'none';
  };

  function decodificarEmailDoToken(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.email || '';
    } catch (e) {
      return '';
    }
  }

  // Reaproveitado por criação/redefinição de senha de admin de associação E
  // de administrador da plataforma -- só o título/texto muda por contexto.
  function abrirModalCredenciais(email, senhaProvisoria, titulo, mensagem) {
    document.getElementById('titulo-modal-credenciais').textContent = titulo;
    document.getElementById('texto-modal-credenciais').textContent = mensagem;
    document.getElementById('cred-email-admin').value = email;
    document.getElementById('cred-senha-provisoria').value = senhaProvisoria;
    document.getElementById('overlay-modal-credenciais').style.display = 'flex';
  }

  function salvarSessao() {
    localStorage.setItem('sessao_superadmin', JSON.stringify({ token: estado.token, nome: estado.nome, id: estado.id, papel: estado.papel }));
  }
  function limparSessao() { localStorage.removeItem('sessao_superadmin'); }

  // ---------- Menu mobile (hamburger) ----------
  function abrirSidebarMobile() {
    document.getElementById('sidebar-superadmin').classList.add('aberto');
    document.getElementById('sidebar-overlay').classList.add('aberto');
  }
  function fecharSidebarMobile() {
    document.getElementById('sidebar-superadmin').classList.remove('aberto');
    document.getElementById('sidebar-overlay').classList.remove('aberto');
  }
  document.getElementById('btn-hamburguer').onclick = abrirSidebarMobile;
  document.getElementById('sidebar-overlay').onclick = fecharSidebarMobile;
  document.querySelectorAll('.sidebar .nav-item').forEach(function(item) {
    item.addEventListener('click', fecharSidebarMobile);
  });

  // ---------- Carregar "Últimas" pro Dashboard ----------
  function carregarUltimasAssociacoes() {
    fetch(API_URL + '/superadmin/associacoes?limite=3', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) return;
      var html = '';
      if (res.data.length === 0) {
        html = '<div class="vazio">Nenhuma associação ainda.</div>';
      } else {
        res.data.slice(0, 3).forEach(function(a) {
          var statusClass = a.ativo ? 'ativo' : 'inativo';
          html += '<div class="item-lista">' +
            '<div class="item-lista-titulo">' + escapeHtml(a.nome) + '</div>' +
            '<div class="item-lista-sub">' + escapeHtml(a.cidade || '—') + ', ' + escapeHtml(a.estado || '?') + '</div>' +
            '<span class="item-lista-badge">' + (ROTULOS_PLANO[a.plano] || a.plano) + '</span>' +
            '</div>';
        });
      }
      document.getElementById('lista-ultimas-associacoes').innerHTML = html;
    })
    .catch(function() { document.getElementById('lista-ultimas-associacoes').innerHTML = '<div class="vazio">Erro ao carregar.</div>'; });
  }

  function carregarUltimosAdmins() {
    fetch(API_URL + '/superadmin/admins?limite=3', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) return;
      var html = '';
      if (res.data.length === 0) {
        html = '<div class="vazio">Nenhum admin ainda.</div>';
      } else {
        res.data.slice(0, 3).forEach(function(a) {
          html += '<div class="item-lista">' +
            '<div class="item-lista-titulo">' + escapeHtml(a.nome) + '</div>' +
            '<div class="item-lista-sub">' + escapeHtml(a.email) + '</div>' +
            '<span class="item-lista-badge">' + (ROTULOS_PAPEL_SUPERADMIN[a.papel] || a.papel) + '</span>' +
            '</div>';
        });
      }
      document.getElementById('lista-ultimos-admins').innerHTML = html;
    })
    .catch(function() { document.getElementById('lista-ultimos-admins').innerHTML = '<div class="vazio">Erro ao carregar.</div>'; });
  }

  function carregarUltimasAtividades() {
    fetch(API_URL + '/superadmin/logs?limite=5&ordenar=desc', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) return;
      var html = '';
      var registros = res.data.registros || [];
      if (registros.length === 0) {
        html = '<div class="vazio">Nenhuma atividade ainda.</div>';
      } else {
        registros.slice(0, 5).forEach(function(log) {
          var nomeAtor = log.super_admin_nome || log.usuario_nome || log.usuario_email || log.super_admin_email || '—';
          html += '<div class="item-lista">' +
            '<div class="item-lista-titulo">' + (ROTULOS_TIPO_ACAO_LOG[log.tipo_acao] || log.tipo_acao) + '</div>' +
            '<div class="item-lista-sub">' + escapeHtml(nomeAtor) + ' • ' + new Date(log.criado_em).toLocaleDateString('pt-BR') + '</div>' +
            '</div>';
        });
      }
      document.getElementById('lista-ultimas-atividades').innerHTML = html;
    })
    .catch(function() { document.getElementById('lista-ultimas-atividades').innerHTML = '<div class="vazio">Erro ao carregar.</div>'; });
  }

  // ---------- Navegação (sidebar) ----------
  function ativarSecaoSuperAdmin(nome) {
    // 'parametrizacao', 'meu-perfil' e 'cadastro-associacao' não têm item
    // próprio na sidebar (as duas primeiras só são alcançáveis pelo menu do
    // avatar, ver dropdown-perfil; a última pelos botões de nova/editar
    // associação) -- por isso o "if (item)" antes de mexer na classe .ativa.
    ['dashboard', 'associacoes', 'cadastro-associacao', 'acessos', 'contratacoes', 'comunicados-plataforma', 'parametrizacao', 'meu-perfil'].forEach(function(secao) {
      var item = document.getElementById('aba-' + secao);
      if (item) item.classList.toggle('ativa', secao === nome);
      document.getElementById('secao-' + secao).classList.toggle('ativa', secao === nome);
    });
    // A tela de cadastro fica "dentro" de Associações pra sidebar não ficar
    // sem nenhum item aceso enquanto ela está aberta.
    if (nome === 'cadastro-associacao') document.getElementById('aba-associacoes').classList.add('ativa');
    if (nome === 'associacoes') carregarAssociacoes();
    // "Acessos" tem 2 sub-abas internas: Administradores e Auditoria (mesmo
    // padrão do Painel da Associação). Administradores só existe pra quem é
    // super_admin -- se não for, abre direto em Auditoria.
    if (nome === 'acessos') ativarAbaAcessos(estado.papel === 'super_admin' ? 'administradores' : 'auditoria');
    if (nome === 'contratacoes') carregarContratacoes();
    if (nome === 'parametrizacao') carregarConfigPlataforma();
    if (nome === 'meu-perfil') preencherMeuPerfil();
  }
  document.getElementById('aba-dashboard').onclick = function() { ativarSecaoSuperAdmin('dashboard'); };
  document.getElementById('aba-associacoes').onclick = function() { ativarSecaoSuperAdmin('associacoes'); };
  document.getElementById('aba-acessos').onclick = function() { ativarSecaoSuperAdmin('acessos'); };
  document.getElementById('aba-contratacoes').onclick = function() { ativarSecaoSuperAdmin('contratacoes'); };
  document.getElementById('aba-comunicados-plataforma').onclick = function() { ativarSecaoSuperAdmin('comunicados-plataforma'); };

  function ativarAbaAcessos(nome) {
    ['administradores', 'auditoria'].forEach(function(aba) {
      document.getElementById('conteudo-aba-acessos-' + aba).style.display = aba === nome ? 'block' : 'none';
      document.getElementById('btn-aba-acessos-' + aba).classList.toggle('ativa', aba === nome);
    });
    if (nome === 'administradores') carregarAdministradores();
    if (nome === 'auditoria') { paginaAtualLogs = 1; carregarLogs(); }
  }
  document.getElementById('btn-aba-acessos-administradores').onclick = function() { ativarAbaAcessos('administradores'); };
  document.getElementById('btn-aba-acessos-auditoria').onclick = function() { ativarAbaAcessos('auditoria'); };

  document.getElementById('btn-enviar-comunicado-plataforma').onclick = function() {
    var titulo = document.getElementById('comunicado-plataforma-titulo').value.trim();
    var conteudo = document.getElementById('comunicado-plataforma-conteudo').value.trim();
    if (!titulo || !conteudo) {
      mostrarToast('Preencha título e conteúdo', true);
      return;
    }
    confirmarAcao({
      titulo: 'Enviar comunicado da plataforma',
      mensagem: 'Isso publica o aviso no mural de Comunicados de TODAS as associações ativas agora. Confirma?',
      textoConfirmar: 'Enviar',
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/comunicados-plataforma', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
          body: JSON.stringify({ titulo: titulo, conteudo: conteudo })
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao enviar comunicado', true);
            return;
          }
          document.getElementById('comunicado-plataforma-titulo').value = '';
          document.getElementById('comunicado-plataforma-conteudo').value = '';
          mostrarToast('Enviado para ' + res.data.total_associacoes + ' associação(ões)!');
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  };

  document.getElementById('btn-recolher-sidebar').onclick = function() {
    var recolhida = document.getElementById('sidebar-superadmin').classList.toggle('recolhida');
    localStorage.setItem('sidebar-recolhida-superadmin', recolhida ? '1' : '0');
  };
  if (localStorage.getItem('sidebar-recolhida-superadmin') === '1') {
    document.getElementById('sidebar-superadmin').classList.add('recolhida');
  }

  document.getElementById('btn-notificacoes').onclick = function(e) {
    e.stopPropagation();
    document.getElementById('dropdown-notificacoes').classList.toggle('aberto');
  };
  document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('dropdown-notificacoes');
    if (dropdown.classList.contains('aberto') && !dropdown.contains(e.target) && e.target.id !== 'btn-notificacoes') {
      dropdown.classList.remove('aberto');
    }
  });

  function entrarNoDashboard() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'flex';
    document.getElementById('nome-superadmin').textContent = estado.nome || 'Administrador';
    document.getElementById('avatar-superadmin').textContent = (estado.nome || 'A').charAt(0).toUpperCase();
    document.getElementById('papel-superadmin').textContent = ROTULOS_PAPEL_SUPERADMIN[estado.papel] || estado.papel || '—';
    // Administradores (sub-aba de Acessos) e Preferências (Config. Pix, no
    // menu do avatar) só existem pra quem é super_admin.
    document.getElementById('btn-aba-acessos-administradores').style.display = (estado.papel === 'super_admin') ? '' : 'none';
    document.getElementById('btn-menu-preferencias').style.display = (estado.papel === 'super_admin') ? 'flex' : 'none';
    // Comunicados da plataforma: nível "gestão" (super_admin + administrador),
    // mesmo critério do backend (GESTAO em routes/superadmin.js) -- suporte
    // continua só leitura.
    document.getElementById('aba-comunicados-plataforma').style.display = (estado.papel !== 'suporte') ? 'flex' : 'none';
    atualizarSaudacao();
    ativarSecaoSuperAdmin('dashboard');
    carregarDashboard();
    atualizarBadgeContratacoesPendentes();
  }

  (function restaurarSessao() {
    var salva = localStorage.getItem('sessao_superadmin');
    if (!salva) return;
    try {
      var dados = JSON.parse(salva);
      if (!dados.token) return;
      estado.token = dados.token;
      estado.nome = dados.nome;
      estado.id = dados.id;
      estado.papel = dados.papel;
    } catch (e) { return; }

    fetch(API_URL + '/superadmin/dashboard', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
      .then(function(resp) {
        if (!resp.ok) { limparSessao(); return; }
        entrarNoDashboard();
      })
      .catch(function() { entrarNoDashboard(); });
  })();

  document.getElementById('btn-login').onclick = function() {
    var email = document.getElementById('login-email').value.trim();
    var senha = document.getElementById('login-senha').value;
    var erroEl = document.getElementById('erro-login');
    erroEl.style.display = 'none';

    if (!email || !senha) {
      erroEl.textContent = 'Preencha e-mail e senha.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/superadmin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, senha: senha })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao entrar';
        erroEl.style.display = 'block';
        return;
      }
      estado.token = res.data.token;
      estado.nome = res.data.nome;
      estado.id = res.data.id;
      estado.papel = res.data.papel;
      salvarSessao();
      entrarNoDashboard();
      if (res.data.deve_trocar_senha) {
        abrirModalAlterarSenha(true);
      }
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  // POST /superadmin/logout (auditoria de segurança Fase 2, 08/08/2026 --
  // SEC-004): antes o botão só limpava o localStorage, sem nunca chamar a
  // API -- o token continuava válido até expirar (até 8h) mesmo depois de
  // "sair". Best-effort (mesmo padrão de fazerLogout em index.html): a
  // saída não fica bloqueada esperando a resposta.
  function fazerLogout() {
    if (estado.token) {
      fetch(API_URL + '/superadmin/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + estado.token }
      }).catch(function() { /* logout é best-effort, não bloqueia a saída */ });
    }
    estado.token = null;
    estado.nome = null;
    limparSessao();
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-login').style.display = 'block';
  }
  document.getElementById('btn-sair').onclick = fazerLogout;

  function formatarMoeda(valor) {
    return 'R$ ' + parseFloat(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatarMesLabel(mesIso) {
    var partes = mesIso.split('-');
    return MESES_PT[parseInt(partes[1], 10) - 1].substring(0, 3).replace(/^./, function(c) { return c.toUpperCase(); });
  }

  function coresGrafico() {
    var estiloEscuro = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      grade: estiloEscuro ? '#2a2a2a' : '#E4E0D2',
      texto: estiloEscuro ? '#888888' : '#6B6558',
      linha: '#C9A84C'
    };
  }

  function carregarDashboard() {
    fetch(API_URL + '/superadmin/dashboard', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(d) {
      document.getElementById('kpi-total-associacoes').textContent = d.total_associacoes || 0;
      document.getElementById('kpi-associacoes-ativas').textContent = d.associacoes_ativas || 0;
      document.getElementById('kpi-associacoes-bloqueadas').textContent = d.associacoes_bloqueadas || 0;
      document.getElementById('kpi-total-associados').textContent = d.total_associados || 0;
      document.getElementById('kpi-total-atrasadas').textContent = d.total_atrasadas || 0;
      document.getElementById('kpi-mrr').textContent = formatarMoeda(d.receita_mrr);
      desenharGraficos(d.crescimento_associacoes || [], d.novos_associados || []);
      renderizarAlertas(d.alertas || []);
      carregarUltimasAssociacoes();
      carregarUltimosAdmins();
      carregarUltimasAtividades();
    })
    .catch(function() { mostrarToast('Erro ao carregar dashboard', true); });
  }

  function renderizarAlertas(alertas) {
    var badge = document.getElementById('badge-notificacoes');
    if (alertas.length > 0) {
      badge.textContent = alertas.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }

    var html = alertas.length === 0
      ? '<div class="vazio">Nenhum alerta no momento.</div>'
      : alertas.map(function(a) {
          return '<div class="alerta-item"><span class="alerta-ponto ' + a.nivel + '"></span><span>' + escapeHtml(a.texto) + '</span></div>';
        }).join('');

    document.getElementById('lista-alertas-dropdown').innerHTML = html;
  }

  function desenharGraficos(crescimento, novosAssociados) {
    var cores = coresGrafico();
    var labels = crescimento.map(function(l) { return formatarMesLabel(l.mes); });

    if (graficoCrescimento) graficoCrescimento.destroy();
    graficoCrescimento = new Chart(document.getElementById('grafico-crescimento'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: crescimento.map(function(l) { return parseInt(l.total, 10); }),
          borderColor: cores.linha, backgroundColor: 'rgba(201,168,76,0.15)',
          fill: true, tension: 0.3, pointRadius: 3
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: cores.texto }, grid: { color: cores.grade } },
          y: { ticks: { color: cores.texto, precision: 0 }, grid: { color: cores.grade }, beginAtZero: true }
        }
      }
    });

    if (graficoAssociados) graficoAssociados.destroy();
    graficoAssociados = new Chart(document.getElementById('grafico-associados'), {
      type: 'bar',
      data: {
        labels: novosAssociados.map(function(l) { return formatarMesLabel(l.mes); }),
        datasets: [{
          data: novosAssociados.map(function(l) { return parseInt(l.total, 10); }),
          backgroundColor: cores.linha, borderRadius: 6
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: cores.texto }, grid: { display: false } },
          y: { ticks: { color: cores.texto, precision: 0 }, grid: { color: cores.grade }, beginAtZero: true }
        }
      }
    });

  }

  function carregarAssociacoes() {
    var params = [];
    var busca = document.getElementById('filtro-busca-assoc').value.trim();
    var cidade = document.getElementById('filtro-cidade-assoc').value.trim();
    var uf = document.getElementById('filtro-estado-assoc').value.trim();
    var plano = document.getElementById('filtro-plano-assoc').value;
    var status = document.getElementById('filtro-status-assoc').value;
    if (busca) params.push('busca=' + encodeURIComponent(busca));
    if (cidade) params.push('cidade=' + encodeURIComponent(cidade));
    if (uf) params.push('estado=' + encodeURIComponent(uf));
    if (plano) params.push('plano=' + encodeURIComponent(plano));
    if (status) params.push('status=' + encodeURIComponent(status));
    var url = API_URL + '/superadmin/associacoes' + (params.length ? '?' + params.join('&') : '');

    fetch(url, { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) { renderizarAssociacoes(lista); })
    .catch(function() { mostrarToast('Erro ao carregar associações', true); });
  }

  ['filtro-busca-assoc', 'filtro-cidade-assoc', 'filtro-estado-assoc'].forEach(function(id) {
    document.getElementById(id).oninput = function() { carregarAssociacoes(); };
  });
  ['filtro-plano-assoc', 'filtro-status-assoc'].forEach(function(id) {
    document.getElementById(id).onchange = function() { carregarAssociacoes(); };
  });

  function renderizarAssociacoes(lista) {
    associacoesCache = lista;
    var container = document.getElementById('tabela-associacoes-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhuma associação encontrada.</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>Nome</th><th>Cidade</th><th>Responsável</th><th>Plano</th><th>Associados</th>' +
      '<th>Mensalidade</th><th>Status</th><th>Cadastro</th><th>Próx. vencimento</th><th></th>' +
      '</tr></thead><tbody>';
    lista.forEach(function(a) {
      html += '<tr>' +
        '<td style="cursor:pointer;" data-acao="abrirDetalheAssociacao" data-id="' + a.id + '"><strong>' + escapeHtml(a.nome) + '</strong></td>' +
        '<td>' + escapeHtml((a.cidade || '—') + (a.estado ? '/' + a.estado : '')) + '</td>' +
        '<td>' + escapeHtml(a.responsavel_nome || '—') + '</td>' +
        '<td>' + (ROTULOS_PLANO[a.plano] || a.plano) + '</td>' +
        '<td>' + a.total_associados + '</td>' +
        '<td>' + formatarMoeda(a.valor_mensalidade) + '</td>' +
        '<td><span class="badge ' + (CLASSE_BADGE_STATUS[a.status_assinatura] || '') + '">' + escapeHtml(ROTULO_STATUS_ASSINATURA[a.status_assinatura] || a.status_assinatura) + '</span></td>' +
        '<td>' + new Date(a.criado_em).toLocaleDateString('pt-BR') + '</td>' +
        '<td>' + (a.vencimento_assinatura ? new Date(a.vencimento_assinatura).toLocaleDateString('pt-BR') : '—') + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-pequeno" data-acao="abrirDetalheAssociacao" data-id="' + a.id + '">Ver</button> ' +
          '<button class="btn-pequeno" data-acao="abrirEdicaoAssociacao" data-id="' + a.id + '">Editar</button> ' +
          '<button class="btn-pequeno" data-acao="excluirAssociacao" data-id="' + a.id + '">Excluir</button>' +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function resetarLogoPreview(logoUrl) {
    logoSelecionadaBase64 = null;
    var preview = document.getElementById('logo-preview');
    if (logoUrl) {
      renderizarArquivoBase64(preview, logoUrl, 'Logo');
    } else {
      preview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24" style="color:var(--accent);"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
    }
  }

  var totalAssociadosFormAtual = 0;
  function atualizarPlaceholderMensalidade(totalAssociadosAtual) {
    if (totalAssociadosAtual !== undefined) totalAssociadosFormAtual = totalAssociadosAtual;
    var plano = document.getElementById('assoc-plano').value;
    var precos = PRECOS_PLANO[plano] || PRECOS_PLANO.trial;
    var sugestao = precos.base + precos.porAssociado * totalAssociadosFormAtual;
    document.getElementById('assoc-valor-mensalidade').placeholder = 'sugerido: ' + formatarMoeda(sugestao);
  }
  document.getElementById('assoc-plano').onchange = function() { atualizarPlaceholderMensalidade(); };

  document.getElementById('btn-selecionar-logo').onclick = function() {
    document.getElementById('input-logo-associacao').click();
  };
  document.getElementById('input-logo-associacao').onchange = function(e) {
    var arquivo = e.target.files[0];
    if (!arquivo) return;
    var leitor = new FileReader();
    leitor.onload = function(evt) {
      var img = new Image();
      img.onload = function() {
        var TAMANHO_MAX = 400;
        var largura = img.width, altura = img.height;
        if (largura > altura && largura > TAMANHO_MAX) {
          altura = Math.round(altura * (TAMANHO_MAX / largura)); largura = TAMANHO_MAX;
        } else if (altura > TAMANHO_MAX) {
          largura = Math.round(largura * (TAMANHO_MAX / altura)); altura = TAMANHO_MAX;
        }
        var canvas = document.createElement('canvas');
        canvas.width = largura; canvas.height = altura;
        canvas.getContext('2d').drawImage(img, 0, 0, largura, altura);
        logoSelecionadaBase64 = canvas.toDataURL('image/png');
        renderizarArquivoBase64(document.getElementById('logo-preview'), logoSelecionadaBase64, 'Logo');
      };
      img.src = evt.target.result;
    };
    leitor.readAsDataURL(arquivo);
  };

  // ---------- Tela de cadastro/edição de associação ----------
  // Era um modal; virou tela própria porque o formulário é grande demais pra
  // preencher dentro de um overlay. 'origemCadastroAssociacao' guarda de onde
  // o usuário veio, pra o Voltar/salvar devolverem pro lugar certo.
  var origemCadastroAssociacao = 'lista';

  function abrirTelaCadastroAssociacao(origem) {
    origemCadastroAssociacao = origem || 'lista';
    // Vindo da tela de detalhe (que fica fora do .app-layout), é preciso
    // devolver o layout com sidebar antes de trocar de seção.
    document.getElementById('tela-detalhe-associacao').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'flex';
    ativarSecaoSuperAdmin('cadastro-associacao');
    window.scrollTo(0, 0);
  }

  function voltarDoCadastroAssociacao() {
    if (origemCadastroAssociacao === 'detalhe' && associacaoDetalheAtual) {
      abrirDetalheAssociacao(associacaoDetalheAtual);
      return;
    }
    ativarSecaoSuperAdmin('associacoes');
  }

  document.getElementById('btn-voltar-cadastro-associacao').onclick = voltarDoCadastroAssociacao;
  document.getElementById('btn-cancelar-cadastro-associacao').onclick = voltarDoCadastroAssociacao;

  document.getElementById('btn-nova-associacao').onclick = function() {
    document.getElementById('titulo-cadastro-associacao').textContent = 'Nova associação';
    document.getElementById('subtitulo-cadastro-associacao').textContent = 'Preencha os dados da associação e do admin inicial.';
    document.getElementById('editar-associacao-id').value = '';
    [
      'assoc-nome', 'assoc-email', 'assoc-telefone', 'assoc-endereco', 'assoc-cidade', 'assoc-estado',
      'assoc-cnpj', 'assoc-site', 'assoc-cep', 'assoc-nome-admin', 'assoc-cpf-responsavel',
      'assoc-valor-mensalidade', 'assoc-vencimento-assinatura'
    ].forEach(function(id) { document.getElementById(id).value = ''; });
    document.getElementById('assoc-tipo').value = 'outra';
    document.getElementById('assoc-plano').value = 'trial';
    document.getElementById('assoc-trial-dias').value = '15';
    document.getElementById('assoc-dias-alerta-assinatura').value = '30';
    document.getElementById('assoc-forma-cobranca').value = '';
    resetarLogoPreview(null);
    atualizarPlaceholderMensalidade(0);
    document.getElementById('bloco-admin-inicial').style.display = 'block';
    document.getElementById('ajuda-admin-inicial').style.display = 'block';
    document.getElementById('campo-ativo-associacao').style.display = 'none';
    document.getElementById('btn-salvar-associacao').textContent = 'Criar associação';
    abrirTelaCadastroAssociacao('lista');
  };

  function abrirEdicaoAssociacao(id, origem) {
    fetch(API_URL + '/superadmin/associacoes/' + id, { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(a) {
      document.getElementById('titulo-cadastro-associacao').textContent = 'Editar associação';
      document.getElementById('subtitulo-cadastro-associacao').textContent = a.nome;
      document.getElementById('editar-associacao-id').value = a.id;
      document.getElementById('assoc-nome').value = a.nome;
      document.getElementById('assoc-tipo').value = a.tipo || 'outra';
      document.getElementById('assoc-email').value = a.email || '';
      document.getElementById('assoc-telefone').value = a.telefone || '';
      document.getElementById('assoc-endereco').value = a.endereco || '';
      document.getElementById('assoc-cidade').value = a.cidade || '';
      document.getElementById('assoc-estado').value = a.estado || '';
      document.getElementById('assoc-cnpj').value = a.cnpj || '';
      document.getElementById('assoc-site').value = a.site || '';
      document.getElementById('assoc-cep').value = a.cep || '';
      document.getElementById('assoc-cpf-responsavel').value = (a.admin && a.admin.cpf) || '';
      document.getElementById('assoc-plano').value = a.plano || 'trial';
      document.getElementById('assoc-trial-dias').value = a.trial_dias || 15;
      document.getElementById('assoc-dias-alerta-assinatura').value = a.dias_alerta_assinatura || 30;
      document.getElementById('assoc-valor-mensalidade').value = a.valor_mensalidade_manual != null ? a.valor_mensalidade_manual : '';
      document.getElementById('assoc-vencimento-assinatura').value = a.vencimento_assinatura ? a.vencimento_assinatura.substring(0, 10) : '';
      document.getElementById('assoc-forma-cobranca').value = a.forma_cobranca || '';
      document.getElementById('assoc-ativo').checked = !!a.ativo;
      // Logo buscada à parte (auditoria de segurança Fase 3, 08/08/2026 --
      // SEC-018): GET /superadmin/associacoes/:id não devolve mais logo_url
      // (era a logo inteira em base64 numa resposta que quase nunca precisa
      // dela). Não bloqueia o preenchimento do resto do formulário -- a
      // prévia só aparece quando essa chamada separada responder.
      resetarLogoPreview(null);
      fetch(API_URL + '/superadmin/associacoes/' + id + '/logo', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
        .then(function(resp) { return resp.ok ? resp.json() : null; })
        .then(function(logoResp) { if (logoResp) resetarLogoPreview(logoResp.logo_url); })
        .catch(function() {});
      atualizarPlaceholderMensalidade(a.total_associados);
      document.getElementById('bloco-admin-inicial').style.display = 'none';
      document.getElementById('ajuda-admin-inicial').style.display = 'none';
      document.getElementById('campo-ativo-associacao').style.display = 'block';
      document.getElementById('btn-salvar-associacao').textContent = 'Salvar';
      abrirTelaCadastroAssociacao(origem);
    })
    .catch(function() { mostrarToast('Erro ao carregar dados da associação', true); });
  }

  function excluirAssociacao(id) {
    confirmarAcao({
      titulo: 'Excluir associação',
      mensagem: 'Excluir essa associação? Isso remove PERMANENTEMENTE todos os associados, cobranças, comunicados e usuários dela. Não pode ser desfeito.',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/associacoes/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + estado.token } })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao excluir', true); return; }
          mostrarToast('Associação excluída.');
          carregarAssociacoes();
          carregarDashboard();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  document.getElementById('btn-salvar-associacao').onclick = function() {
    var idEdicao = document.getElementById('editar-associacao-id').value;
    var nome = document.getElementById('assoc-nome').value.trim();
    var tipo = document.getElementById('assoc-tipo').value;
    var email = document.getElementById('assoc-email').value.trim();
    var telefone = document.getElementById('assoc-telefone').value.trim();
    var endereco = document.getElementById('assoc-endereco').value.trim();
    var cidade = document.getElementById('assoc-cidade').value.trim();
    var uf = document.getElementById('assoc-estado').value.trim().toUpperCase();
    var cnpj = document.getElementById('assoc-cnpj').value.trim();
    var site = document.getElementById('assoc-site').value.trim();
    var cep = document.getElementById('assoc-cep').value.trim();
    var cpf = document.getElementById('assoc-cpf-responsavel').value.trim();
    var plano = document.getElementById('assoc-plano').value;
    var valorMensalidadeManual = document.getElementById('assoc-valor-mensalidade').value;
    var vencimentoAssinatura = document.getElementById('assoc-vencimento-assinatura').value;
    var formaCobranca = document.getElementById('assoc-forma-cobranca').value;
    var trialDias = document.getElementById('assoc-trial-dias').value;
    var diasAlertaAssinatura = document.getElementById('assoc-dias-alerta-assinatura').value;

    if (!nome) { mostrarToast('Informe o nome da associação', true); return; }
    if (!idEdicao && !email) { mostrarToast('Informe o e-mail da associação (será o login do admin)', true); return; }

    var dadosPlano = {
      cep: cep, site: site, logo_base64: logoSelecionadaBase64,
      plano: plano, valor_mensalidade_manual: valorMensalidadeManual ? parseFloat(valorMensalidadeManual) : null,
      vencimento_assinatura: vencimentoAssinatura || null, forma_cobranca: formaCobranca || null,
      cpf: cpf || null, trial_dias: trialDias ? parseInt(trialDias, 10) : null,
      dias_alerta_assinatura: diasAlertaAssinatura ? parseInt(diasAlertaAssinatura, 10) : null
    };

    if (idEdicao) {
      var ativo = document.getElementById('assoc-ativo').checked;
      fetch(API_URL + '/superadmin/associacoes/' + idEdicao, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
        body: JSON.stringify(Object.assign({
          nome: nome, tipo: tipo, email: email, telefone: telefone, endereco: endereco, cidade: cidade, estado: uf, cnpj: cnpj, ativo: ativo
        }, dadosPlano))
      })
      .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
      .then(function(res) {
        if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao salvar', true); return; }
        mostrarToast('Associação atualizada!');
        carregarDashboard();
        voltarDoCadastroAssociacao();
      })
      .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      return;
    }

    var nomeAdmin = document.getElementById('assoc-nome-admin').value.trim();

    if (!nomeAdmin) {
      mostrarToast('Preencha o nome do admin inicial', true);
      return;
    }

    fetch(API_URL + '/superadmin/associacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify(Object.assign({
        nome_associacao: nome, tipo: tipo, email: email, telefone: telefone, endereco: endereco, cidade: cidade, estado: uf, cnpj: cnpj,
        nome_admin: nomeAdmin
      }, dadosPlano))
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao criar associação', true); return; }
      voltarDoCadastroAssociacao();
      abrirModalCredenciais(
        res.data.admin.email, res.data.senha_provisoria,
        'Associação criada!',
        'Essa senha só aparece agora — copie e envie para o responsável pela associação. No primeiro login, o sistema vai pedir para ele definir uma senha nova.'
      );
      carregarDashboard();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  document.getElementById('btn-copiar-credenciais').onclick = function() {
    var campo = document.getElementById('cred-senha-provisoria');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Senha copiada!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  document.getElementById('btn-fechar-credenciais').onclick = function() {
    document.getElementById('overlay-modal-credenciais').style.display = 'none';
  };

  // ---------- Tela de detalhe da associação ----------
  var associacaoDetalheAtual = null;
  var rotuloTipo = { moradores: 'Moradores', classe_profissional: 'Classe profissional', esportiva_recreativa: 'Esportiva/recreativa', ong_beneficente: 'ONG/beneficente', outra: 'Outra' };

  function abrirDetalheAssociacao(id) {
    associacaoDetalheAtual = id;
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-detalhe-associacao').style.display = 'block';
    ativarAbaDetalhe('informacoes');

    fetch(API_URL + '/superadmin/associacoes/' + id, { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(a) {
      document.getElementById('detalhe-nome-associacao').textContent = a.nome;
      var badge = document.getElementById('detalhe-badge-status');
      badge.textContent = ROTULO_STATUS_ASSINATURA[a.status_assinatura] || a.status_assinatura;
      badge.className = 'badge ' + (CLASSE_BADGE_STATUS[a.status_assinatura] || '');

      // Agrupado em blocos temáticos (era uma lista única de 14 linhas,
      // difícil de escanear) -- mesma info de sempre, só reorganizada.
      document.getElementById('lista-informacoes').innerHTML =
        blocoInfo('Identificação', linhaInfo('Nome', a.nome) + linhaInfo('Tipo', rotuloTipo[a.tipo] || a.tipo) + linhaInfo('CNPJ / nº cadastro', a.cnpj)) +
        blocoInfo('Contato', linhaInfo('E-mail', a.email) + linhaInfo('Telefone', a.telefone) + linhaInfo('Site', a.site)) +
        blocoInfo('Endereço', linhaInfo('Endereço', a.endereco) + linhaInfo('Cidade/UF', (a.cidade || '—') + (a.estado ? '/' + a.estado : '')) + linhaInfo('CEP', a.cep)) +
        blocoInfo('Plano e assinatura',
          linhaInfo('Plano', ROTULOS_PLANO[a.plano] || a.plano) + linhaInfo('Associados', String(a.total_associados)) +
          linhaInfo('Valor da mensalidade', formatarMoeda(a.valor_mensalidade)) +
          linhaInfo('Vencimento da assinatura', a.vencimento_assinatura ? new Date(a.vencimento_assinatura).toLocaleDateString('pt-BR') : null) +
          linhaInfo('Cadastrada em', new Date(a.criado_em).toLocaleDateString('pt-BR')));

      if (a.admin) {
        document.getElementById('usuario-detalhe-avatar').textContent = (a.admin.nome || 'A').charAt(0).toUpperCase();
        document.getElementById('usuario-detalhe-nome').textContent = a.admin.nome;
        document.getElementById('usuario-detalhe-email').textContent = a.admin.email;
        var statusEl = document.getElementById('usuario-detalhe-status');
        statusEl.textContent = a.admin.ativo ? 'ativo' : 'inativo';
        statusEl.className = 'badge ' + (a.admin.ativo ? 'ativo' : 'inativo');
        document.getElementById('usuario-detalhe-criado').textContent = new Date(a.admin.criado_em).toLocaleDateString('pt-BR');
      }

      document.getElementById('fin-total-recebido').textContent = formatarMoeda(a.financeiro.total_recebido);
      document.getElementById('fin-total-a-receber').textContent = formatarMoeda(a.financeiro.total_a_receber);
      document.getElementById('fin-proximo-vencimento').textContent = a.financeiro.proximo_vencimento
        ? new Date(a.financeiro.proximo_vencimento).toLocaleDateString('pt-BR') : 'Nenhuma cobrança pendente';
    })
    .catch(function() { mostrarToast('Erro ao carregar detalhes', true); });
  }

  function linhaInfo(rotulo, valor) {
    return '<div class="info-linha"><span>' + rotulo + '</span><span>' + escapeHtml(valor || '—') + '</span></div>';
  }

  function blocoInfo(titulo, linhasHtml) {
    return '<div class="painel"><div class="painel-header"><h3>' + titulo + '</h3></div><div style="padding:0 22px;">' + linhasHtml + '</div></div>';
  }

  document.getElementById('btn-voltar-lista').onclick = function() {
    document.getElementById('tela-detalhe-associacao').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'flex';
    // Precisa reativar a seção, não só mostrar o layout: quem veio da ficha
    // pro formulário de edição deixou 'cadastro-associacao' como seção ativa,
    // e sem isso o Voltar cairia de novo no formulário em vez da lista.
    ativarSecaoSuperAdmin('associacoes');
  };

  document.querySelectorAll('.aba-detalhe').forEach(function(btn) {
    btn.onclick = function() { ativarAbaDetalhe(btn.getAttribute('data-aba')); };
  });

  function ativarAbaDetalhe(nome) {
    document.querySelectorAll('.aba-detalhe').forEach(function(b) {
      b.classList.toggle('ativa', b.getAttribute('data-aba') === nome);
    });
    document.querySelectorAll('.conteudo-aba-detalhe').forEach(function(c) {
      c.style.display = (c.id === 'conteudo-aba-' + nome) ? 'block' : 'none';
    });
    if (nome === 'associados') carregarAssociadosDetalhe();
    if (nome === 'cobrancas') carregarCobrancasDetalhe();
  }

  function carregarAssociadosDetalhe() {
    var container = document.getElementById('tabela-detalhe-associados');
    container.innerHTML = '<div class="vazio">Carregando...</div>';
    fetch(API_URL + '/superadmin/associacoes/' + associacaoDetalheAtual + '/associados', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) {
      if (lista.length === 0) { container.innerHTML = '<div class="vazio">Nenhum associado cadastrado.</div>'; return; }
      var html = '<table><thead><tr><th>Nome</th><th>CPF</th><th>Categoria</th><th>Status</th></tr></thead><tbody>';
      lista.forEach(function(a) {
        html += '<tr><td>' + escapeHtml(a.nome_completo) + '</td><td>' + escapeHtml(a.cpf || '—') + '</td><td>' + escapeHtml(a.categoria || '—') + '</td><td><span class="badge ' + (a.status === 'ativo' ? 'ativo' : 'inativo') + '">' + escapeHtml(a.status) + '</span></td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })
    .catch(function() { container.innerHTML = '<div class="vazio">Erro ao carregar associados.</div>'; });
  }

  function carregarCobrancasDetalhe() {
    var container = document.getElementById('tabela-detalhe-cobrancas');
    container.innerHTML = '<div class="vazio">Carregando...</div>';
    fetch(API_URL + '/superadmin/associacoes/' + associacaoDetalheAtual + '/cobrancas', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) {
      if (lista.length === 0) { container.innerHTML = '<div class="vazio">Nenhuma cobrança cadastrada.</div>'; return; }
      var html = '<table><thead><tr><th>Associado</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>';
      lista.forEach(function(c) {
        html += '<tr><td>' + escapeHtml(c.associado_nome) + '</td><td>' + escapeHtml(c.descricao) + '</td><td>' + formatarMoeda(c.valor) + '</td><td>' + new Date(c.vencimento).toLocaleDateString('pt-BR') + '</td><td><span class="badge ' + (c.status === 'pago' ? 'ativo' : 'inativo') + '">' + escapeHtml(c.status.replace(/_/g,' ')) + '</span></td></tr>';
      });
      html += '</tbody></table>';
      container.innerHTML = html;
    })
    .catch(function() { container.innerHTML = '<div class="vazio">Erro ao carregar cobranças.</div>'; });
  }

  document.getElementById('btn-resetar-senha-admin').onclick = function() {
    confirmarAcao({
      titulo: 'Redefinir senha do admin',
      mensagem: 'Gerar uma nova senha provisória para esse admin? A senha atual dele deixa de funcionar.',
      textoConfirmar: 'Gerar nova senha',
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/associacoes/' + associacaoDetalheAtual + '/resetar-senha-admin', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao redefinir senha', true); return; }
          abrirModalCredenciais(
            res.data.email, res.data.senha_provisoria,
            'Senha redefinida!',
            'Essa senha só aparece agora — copie e envie para o responsável pela associação. No próximo login, o sistema vai pedir para ele definir uma senha nova.'
          );
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  };

  document.getElementById('btn-editar-associacao-detalhe').onclick = function() {
    abrirEdicaoAssociacao(associacaoDetalheAtual, 'detalhe');
  };

  // ---------- Administradores da plataforma ----------
  function carregarAdministradores() {
    fetch(API_URL + '/superadmin/admins', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao carregar administradores', true); return; }
      renderizarAdministradores(res.data);
    })
    .catch(function() { mostrarToast('Erro ao carregar administradores', true); });
  }

  function renderizarAdministradores(lista) {
    administradoresCache = lista;
    var container = document.getElementById('tabela-administradores-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum administrador cadastrado.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Status</th><th>Cadastro</th><th></th></tr></thead><tbody>';
    lista.forEach(function(a) {
      var souEu = a.id === estado.id;
      html += '<tr>' +
        '<td><strong>' + escapeHtml(a.nome) + '</strong>' + (souEu ? ' <span style="color:var(--text-muted); font-size:12px;">(você)</span>' : '') + '</td>' +
        '<td>' + escapeHtml(a.email) + '</td>' +
        '<td>' + (ROTULOS_PAPEL_SUPERADMIN[a.papel] || a.papel) + '</td>' +
        '<td><span class="badge ' + (a.ativo ? 'ativo' : 'inativo') + '">' + (a.ativo ? 'ativo' : 'inativo') + '</span></td>' +
        '<td>' + new Date(a.criado_em).toLocaleDateString('pt-BR') + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-pequeno" data-acao="abrirEdicaoAdministrador" data-id="' + a.id + '">Editar</button> ' +
          '<button class="btn-pequeno" data-acao="redefinirSenhaAdministrador" data-id="' + a.id + '">Redefinir senha</button> ' +
          (souEu ? '' : '<button class="btn-pequeno" data-acao="alternarStatusAdministrador" data-id="' + a.id + '" data-arg="' + !a.ativo + '">' + (a.ativo ? 'Desativar' : 'Ativar') + '</button>') +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  document.getElementById('btn-novo-administrador').onclick = function() {
    document.getElementById('titulo-modal-administrador').textContent = 'Novo administrador';
    document.getElementById('editar-administrador-id').value = '';
    document.getElementById('admin-nome').value = '';
    document.getElementById('admin-email').value = '';
    document.getElementById('admin-papel').value = 'administrador';
    document.getElementById('btn-salvar-administrador').textContent = 'Criar administrador';
    document.getElementById('overlay-modal-administrador').style.display = 'flex';
  };

  document.getElementById('btn-cancelar-modal-administrador').onclick = function() {
    document.getElementById('overlay-modal-administrador').style.display = 'none';
  };

  function abrirEdicaoAdministrador(id) {
    var admin = administradoresCache.find(function(a) { return a.id === id; });
    if (!admin) return;
    document.getElementById('titulo-modal-administrador').textContent = 'Editar administrador';
    document.getElementById('editar-administrador-id').value = admin.id;
    document.getElementById('admin-nome').value = admin.nome;
    document.getElementById('admin-email').value = admin.email;
    document.getElementById('admin-papel').value = admin.papel;
    document.getElementById('btn-salvar-administrador').textContent = 'Salvar';
    document.getElementById('overlay-modal-administrador').style.display = 'flex';
  }

  document.getElementById('btn-salvar-administrador').onclick = function() {
    var idEdicao = document.getElementById('editar-administrador-id').value;
    var nome = document.getElementById('admin-nome').value.trim();
    var email = document.getElementById('admin-email').value.trim();
    var papel = document.getElementById('admin-papel').value;

    if (!nome) { mostrarToast('Informe o nome', true); return; }
    if (!email) { mostrarToast('Informe o e-mail', true); return; }

    var url = API_URL + '/superadmin/admins' + (idEdicao ? '/' + idEdicao : '');
    fetch(url, {
      method: idEdicao ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify({ nome: nome, email: email, papel: papel })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao salvar administrador', true); return; }
      document.getElementById('overlay-modal-administrador').style.display = 'none';
      if (idEdicao) {
        mostrarToast('Administrador atualizado!');
        carregarAdministradores();
      } else {
        abrirModalCredenciais(
          res.data.admin.email, res.data.senha_provisoria,
          'Administrador criado!',
          'Essa senha só aparece agora — copie e envie para o novo administrador. No primeiro login, o sistema vai pedir para ele definir uma senha nova.'
        );
        carregarAdministradores();
      }
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  function alternarStatusAdministrador(id, novoAtivo) {
    // Normaliza porque a chamada vem da delegação de evento (SEC-010, etapa
    // 2), e atributo data-* é sempre string -- sem isso, `"false"` (que é
    // truthy em JS) inverteria os textos do modal e ainda mandaria
    // `ativo: "false"` pro backend, que exige boolean de verdade e
    // responderia 400. Aceita boolean também, pra função continuar
    // funcionando se algum dia for chamada direto do código.
    novoAtivo = (novoAtivo === true || novoAtivo === 'true');
    confirmarAcao({
      titulo: novoAtivo ? 'Ativar administrador' : 'Desativar administrador',
      mensagem: novoAtivo
        ? 'Reativar o acesso desse administrador à plataforma?'
        : 'Desativar esse administrador? O acesso dele à plataforma é bloqueado imediatamente.',
      textoConfirmar: novoAtivo ? 'Ativar' : 'Desativar',
      perigo: !novoAtivo,
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/admins/' + id + '/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
          body: JSON.stringify({ ativo: novoAtivo })
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao alterar status', true); return; }
          mostrarToast('Status atualizado!');
          carregarAdministradores();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  function redefinirSenhaAdministrador(id) {
    confirmarAcao({
      titulo: 'Redefinir senha',
      mensagem: 'Gerar uma nova senha provisória para esse administrador? A senha atual dele deixa de funcionar.',
      textoConfirmar: 'Gerar nova senha',
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/admins/' + id + '/senha', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao redefinir senha', true); return; }
          abrirModalCredenciais(
            res.data.email, res.data.senha_provisoria,
            'Senha redefinida!',
            'Essa senha só aparece agora — copie e envie para o administrador. No próximo login, o sistema vai pedir para ele definir uma senha nova.'
          );
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  // ---------- Auditoria ----------
  function filtrosLogsQueryString() {
    var params = [];
    var usuario = document.getElementById('filtro-log-usuario').value.trim();
    var associacao = document.getElementById('filtro-log-associacao').value.trim();
    var modulo = document.getElementById('filtro-log-modulo').value;
    var tipoAcao = document.getElementById('filtro-log-tipo-acao').value;
    var dataInicio = document.getElementById('filtro-log-data-inicio').value;
    var dataFim = document.getElementById('filtro-log-data-fim').value;
    var ordenar = document.getElementById('filtro-log-ordenar').value;
    if (usuario) params.push('usuario=' + encodeURIComponent(usuario));
    if (associacao) params.push('associacao=' + encodeURIComponent(associacao));
    if (modulo) params.push('modulo=' + encodeURIComponent(modulo));
    if (tipoAcao) params.push('tipo_acao=' + encodeURIComponent(tipoAcao));
    if (dataInicio) params.push('data_inicio=' + encodeURIComponent(dataInicio));
    if (dataFim) params.push('data_fim=' + encodeURIComponent(dataFim));
    if (ordenar) params.push('ordenar=' + encodeURIComponent(ordenar));
    return params;
  }

  function carregarLogs() {
    var params = filtrosLogsQueryString();
    params.push('pagina=' + paginaAtualLogs);
    params.push('por_pagina=' + porPaginaLogs);
    var container = document.getElementById('tabela-logs-container');
    container.innerHTML = '<div class="vazio">Carregando...</div>';

    fetch(API_URL + '/superadmin/logs?' + params.join('&'), { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao carregar logs', true); return; }
      logsCache = res.data.registros;
      totalLogs = res.data.total;
      renderizarLogs(logsCache);
      atualizarPaginacaoLogs();
    })
    .catch(function() { mostrarToast('Erro ao carregar logs', true); });
  }

  ['filtro-log-usuario', 'filtro-log-associacao'].forEach(function(id) {
    document.getElementById(id).oninput = function() { paginaAtualLogs = 1; carregarLogs(); };
  });
  ['filtro-log-modulo', 'filtro-log-tipo-acao', 'filtro-log-data-inicio', 'filtro-log-data-fim', 'filtro-log-ordenar'].forEach(function(id) {
    document.getElementById(id).onchange = function() { paginaAtualLogs = 1; carregarLogs(); };
  });

  function renderizarLogs(lista) {
    var container = document.getElementById('tabela-logs-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum registro encontrado.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Associação</th><th>Módulo</th><th>Ação</th><th>Descrição</th><th></th></tr></thead><tbody>';
    lista.forEach(function(l) {
      var nomeAtor = l.super_admin_nome || l.usuario_nome || l.usuario_email || l.super_admin_email || '—';
      html += '<tr>' +
        '<td style="white-space:nowrap;">' + new Date(l.criado_em).toLocaleString('pt-BR') + '</td>' +
        '<td>' + escapeHtml(nomeAtor) + '</td>' +
        '<td>' + escapeHtml(l.associacao_nome || '—') + '</td>' +
        '<td>' + (ROTULOS_MODULO_LOG[l.modulo] || l.modulo) + '</td>' +
        '<td>' + (ROTULOS_TIPO_ACAO_LOG[l.tipo_acao] || l.tipo_acao) + '</td>' +
        '<td>' + escapeHtml(l.descricao) + '</td>' +
        '<td><button class="btn-pequeno" data-acao="abrirDetalhesLog" data-id="' + l.id + '">Detalhes</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function atualizarPaginacaoLogs() {
    var inicio = totalLogs === 0 ? 0 : (paginaAtualLogs - 1) * porPaginaLogs + 1;
    var fim = Math.min(paginaAtualLogs * porPaginaLogs, totalLogs);
    document.getElementById('texto-paginacao-logs').textContent = totalLogs === 0
      ? 'Nenhum registro'
      : ('Mostrando ' + inicio + '–' + fim + ' de ' + totalLogs);
    document.getElementById('btn-pagina-anterior-logs').disabled = paginaAtualLogs <= 1;
    document.getElementById('btn-pagina-proxima-logs').disabled = (paginaAtualLogs * porPaginaLogs) >= totalLogs;
  }

  document.getElementById('btn-pagina-anterior-logs').onclick = function() {
    if (paginaAtualLogs > 1) { paginaAtualLogs--; carregarLogs(); }
  };
  document.getElementById('btn-pagina-proxima-logs').onclick = function() {
    if ((paginaAtualLogs * porPaginaLogs) < totalLogs) { paginaAtualLogs++; carregarLogs(); }
  };

  function abrirDetalhesLog(id) {
    var log = logsCache.find(function(l) { return l.id === id; });
    if (!log) return;
    var nomeAtor = log.super_admin_nome || log.usuario_nome || log.usuario_email || log.super_admin_email || '—';
    var emailAtor = log.usuario_email || log.super_admin_email || '—';

    document.getElementById('lista-detalhes-log').innerHTML =
      linhaInfo('Data/Hora', new Date(log.criado_em).toLocaleString('pt-BR')) +
      linhaInfo('Usuário', nomeAtor) +
      linhaInfo('E-mail', emailAtor) +
      linhaInfo('Associação', log.associacao_nome) +
      linhaInfo('Módulo', ROTULOS_MODULO_LOG[log.modulo] || log.modulo) +
      linhaInfo('Tipo de ação', ROTULOS_TIPO_ACAO_LOG[log.tipo_acao] || log.tipo_acao) +
      linhaInfo('Descrição', log.descricao) +
      linhaInfo('IP', log.ip) +
      linhaInfo('Dispositivo/Navegador', log.user_agent);

    var blocoDiff = document.getElementById('bloco-diff-log');
    if (log.dados_anteriores || log.dados_novos) {
      blocoDiff.innerHTML =
        '<p style="font-size:13px; font-weight:600; margin-bottom:8px;">Valor anterior / novo</p>' +
        '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
          '<pre style="flex:1; min-width:220px; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; font-size:12px; overflow-x:auto;">' + escapeHtml(log.dados_anteriores ? JSON.stringify(log.dados_anteriores, null, 2) : '—') + '</pre>' +
          '<pre style="flex:1; min-width:220px; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; font-size:12px; overflow-x:auto;">' + escapeHtml(log.dados_novos ? JSON.stringify(log.dados_novos, null, 2) : '—') + '</pre>' +
        '</div>';
    } else {
      blocoDiff.innerHTML = '';
    }

    document.getElementById('overlay-modal-log').style.display = 'flex';
  }

  document.getElementById('btn-fechar-modal-log').onclick = function() {
    document.getElementById('overlay-modal-log').style.display = 'none';
  };

  function exportarLogs() {
    var params = filtrosLogsQueryString();
    fetch(API_URL + '/superadmin/logs/exportar/pdf?' + params.join('&'), {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) {
      if (!resp.ok) { return resp.json().then(function(d) { throw new Error(d.erro || 'Erro ao exportar'); }); }
      return resp.blob();
    })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'logs-auditoria.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch(function(err) { mostrarToast(err.message || 'Erro ao exportar logs', true); });
  }

  document.getElementById('btn-exportar-pdf').onclick = function() { exportarLogs(); };

  // ---------- Contratações de plano ----------
  var contratacoesCache = [];

  function atualizarBadgeContratacoesPendentes() {
    fetch(API_URL + '/superadmin/solicitacoes-plano?status=pendente', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) {
      var badge = document.getElementById('badge-contratacoes-pendentes');
      if (Array.isArray(lista) && lista.length > 0) {
        badge.textContent = lista.length;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    })
    .catch(function() {});
  }

  function carregarContratacoes() {
    var status = document.getElementById('filtro-contratacoes-status').value;
    var container = document.getElementById('tabela-contratacoes-container');
    container.innerHTML = '<div class="vazio">Carregando...</div>';

    fetch(API_URL + '/superadmin/solicitacoes-plano?status=' + status, { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao carregar contratações', true); return; }
      contratacoesCache = res.data;
      renderizarContratacoes(res.data);
    })
    .catch(function() { mostrarToast('Erro ao carregar contratações', true); });
  }
  document.getElementById('filtro-contratacoes-status').onchange = carregarContratacoes;

  var ROTULOS_STATUS_CONTRATACAO = { pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada' };
  var CLASSE_BADGE_CONTRATACAO = { pendente: 'vencendo', aprovada: 'ativo', rejeitada: 'inativo' };

  function renderizarContratacoes(lista) {
    var container = document.getElementById('tabela-contratacoes-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhuma solicitação encontrada.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Associação</th><th>Plano solicitado</th><th>Valor</th><th>Solicitado por</th><th>Data</th><th>Status</th><th></th></tr></thead><tbody>';
    lista.forEach(function(s) {
      html += '<tr>' +
        '<td><strong>' + escapeHtml(s.associacao_nome) + '</strong></td>' +
        '<td>' + (ROTULOS_PLANO[s.plano_solicitado] || s.plano_solicitado) + '</td>' +
        '<td>' + formatarMoeda(s.valor_referencia) + '</td>' +
        '<td>' + escapeHtml(s.solicitado_por_nome || '—') + '</td>' +
        '<td>' + new Date(s.solicitado_em).toLocaleDateString('pt-BR') + '</td>' +
        '<td><span class="badge ' + (CLASSE_BADGE_CONTRATACAO[s.status] || '') + '">' + escapeHtml(ROTULOS_STATUS_CONTRATACAO[s.status] || s.status) + '</span></td>' +
        '<td><button class="btn-pequeno" data-acao="abrirDetalhesContratacao" data-id="' + s.id + '">Detalhes</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function abrirDetalhesContratacao(id) {
    var s = contratacoesCache.find(function(x) { return x.id === id; });
    if (!s) return;

    document.getElementById('contratacao-id').value = id;
    document.getElementById('contratacao-motivo-rejeicao').value = '';
    document.getElementById('lista-detalhes-contratacao').innerHTML =
      linhaInfo('Associação', s.associacao_nome) +
      linhaInfo('Plano solicitado', ROTULOS_PLANO[s.plano_solicitado] || s.plano_solicitado) +
      linhaInfo('Valor de referência', formatarMoeda(s.valor_referencia)) +
      linhaInfo('Solicitado por', s.solicitado_por_nome) +
      linhaInfo('Data da solicitação', new Date(s.solicitado_em).toLocaleString('pt-BR')) +
      linhaInfo('Status', ROTULOS_STATUS_CONTRATACAO[s.status] || s.status) +
      (s.respondido_em ? linhaInfo('Respondido em', new Date(s.respondido_em).toLocaleString('pt-BR')) : '') +
      (s.observacao_resposta ? linhaInfo('Motivo da rejeição', s.observacao_resposta) : '');

    var conteudo = document.getElementById('comprovante-contratacao-conteudo');
    conteudo.innerHTML = '<p class="vazio">Carregando comprovante...</p>';
    fetch(API_URL + '/superadmin/solicitacoes-plano/' + id + '/comprovante', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { conteudo.innerHTML = '<p class="vazio">Comprovante não encontrado.</p>'; return; }
      renderizarArquivoBase64(conteudo, res.data.comprovante_base64, 'Comprovante');
    })
    .catch(function() { conteudo.innerHTML = '<p class="vazio">Erro ao carregar comprovante.</p>'; });

    var podeResponder = s.status === 'pendente';
    document.getElementById('campo-motivo-rejeicao').style.display = podeResponder ? 'block' : 'none';
    document.getElementById('btn-aprovar-contratacao').style.display = podeResponder ? 'inline-block' : 'none';
    document.getElementById('btn-rejeitar-contratacao').style.display = podeResponder ? 'inline-block' : 'none';

    document.getElementById('overlay-modal-contratacao').style.display = 'flex';
  }

  document.getElementById('btn-fechar-modal-contratacao').onclick = function() {
    document.getElementById('overlay-modal-contratacao').style.display = 'none';
  };

  document.getElementById('btn-aprovar-contratacao').onclick = function() {
    var id = document.getElementById('contratacao-id').value;
    confirmarAcao({
      titulo: 'Aprovar contratação',
      mensagem: 'Confirma que o pagamento foi recebido? Isso ativa o plano imediatamente para a associação.',
      textoConfirmar: 'Aprovar',
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/solicitacoes-plano/' + id + '/aprovar', { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + estado.token } })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao aprovar', true); return; }
          document.getElementById('overlay-modal-contratacao').style.display = 'none';
          mostrarToast('Contratação aprovada!');
          carregarContratacoes();
          atualizarBadgeContratacoesPendentes();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  };

  document.getElementById('btn-rejeitar-contratacao').onclick = function() {
    var id = document.getElementById('contratacao-id').value;
    var motivo = document.getElementById('contratacao-motivo-rejeicao').value.trim();
    confirmarAcao({
      titulo: 'Rejeitar contratação',
      mensagem: 'Confirma que quer rejeitar essa solicitação de contratação?',
      textoConfirmar: 'Rejeitar',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/superadmin/solicitacoes-plano/' + id + '/rejeitar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
          body: JSON.stringify({ motivo: motivo || null })
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao rejeitar', true); return; }
          document.getElementById('overlay-modal-contratacao').style.display = 'none';
          mostrarToast('Contratação rejeitada.');
          carregarContratacoes();
          atualizarBadgeContratacoesPendentes();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  };

  // ---------- Configuração de Pix da plataforma ----------
  function carregarConfigPlataforma() {
    fetch(API_URL + '/superadmin/configuracoes-plataforma', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json(); })
    .then(function(d) {
      document.getElementById('plataforma-chave-pix').value = d.chave_pix || '';
      document.getElementById('plataforma-nome-recebedor').value = d.nome_recebedor_pix || '';
      document.getElementById('plataforma-cidade').value = d.cidade_pix || '';
    })
    .catch(function() { mostrarToast('Erro ao carregar configuração da plataforma', true); });
  }

  document.getElementById('btn-salvar-config-plataforma').onclick = function() {
    var chavePix = document.getElementById('plataforma-chave-pix').value.trim();
    var nomeRecebedor = document.getElementById('plataforma-nome-recebedor').value.trim();
    var cidade = document.getElementById('plataforma-cidade').value.trim();

    if (!chavePix || !nomeRecebedor || !cidade) {
      mostrarToast('Preencha chave Pix, nome do recebedor e cidade', true);
      return;
    }

    fetch(API_URL + '/superadmin/configuracoes-plataforma', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify({ chave_pix: chavePix, nome_recebedor_pix: nomeRecebedor, cidade_pix: cidade })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao salvar', true); return; }
      mostrarToast('Configuração de Pix da plataforma salva!');
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Meu Perfil ----------
  function preencherMeuPerfil() {
    document.getElementById('perfil-nome').textContent = estado.nome || '—';
    document.getElementById('perfil-avatar').textContent = (estado.nome || 'A').charAt(0).toUpperCase();
    document.getElementById('perfil-papel').textContent = ROTULOS_PAPEL_SUPERADMIN[estado.papel] || estado.papel || '—';
    var admin = administradoresCache.find(function(a) { return a.id === estado.id; });
    document.getElementById('perfil-email').textContent = admin ? admin.email : (decodificarEmailDoToken(estado.token) || '—');
    document.getElementById('perfil-criado-em').textContent = admin ? new Date(admin.criado_em).toLocaleDateString('pt-BR') : '—';
  }

  var trocaSenhaForcada = false;
  function abrirModalAlterarSenha(forcado) {
    trocaSenhaForcada = !!forcado;
    document.getElementById('senha-atual-superadmin').value = '';
    document.getElementById('senha-nova-superadmin').value = '';
    document.getElementById('senha-nova-confirmar-superadmin').value = '';
    document.getElementById('erro-alterar-senha').style.display = 'none';
    document.getElementById('aviso-troca-obrigatoria').style.display = forcado ? 'block' : 'none';
    document.getElementById('btn-cancelar-alterar-senha').style.display = forcado ? 'none' : 'inline-block';
    document.getElementById('overlay-modal-alterar-senha').style.display = 'flex';
  }

  document.getElementById('btn-abrir-alterar-senha').onclick = function() { abrirModalAlterarSenha(false); };
  document.getElementById('btn-cancelar-alterar-senha').onclick = function() {
    document.getElementById('overlay-modal-alterar-senha').style.display = 'none';
  };

  document.getElementById('btn-confirmar-alterar-senha').onclick = function() {
    var senhaAtual = document.getElementById('senha-atual-superadmin').value;
    var senhaNova = document.getElementById('senha-nova-superadmin').value;
    var senhaConfirmar = document.getElementById('senha-nova-confirmar-superadmin').value;
    var erroEl = document.getElementById('erro-alterar-senha');
    erroEl.style.display = 'none';

    if (!senhaAtual || !senhaNova || !senhaConfirmar) {
      erroEl.textContent = 'Preencha todos os campos.';
      erroEl.style.display = 'block';
      return;
    }
    if (senhaNova !== senhaConfirmar) {
      erroEl.textContent = 'A confirmação não confere com a nova senha.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/superadmin/perfil/senha', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify({ senha_atual: senhaAtual, senha_nova: senhaNova })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao trocar senha';
        erroEl.style.display = 'block';
        return;
      }
      estado.token = res.data.token;
      salvarSessao();
      document.getElementById('overlay-modal-alterar-senha').style.display = 'none';
      trocaSenhaForcada = false;
      mostrarToast('Senha alterada com sucesso!');
    })
    .catch(function() {
      erroEl.textContent = 'Erro ao conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  // ---------- Delegação de evento para os botões de ação ----------
  // Auditoria de segurança Fase 4, 08/08/2026 (SEC-010, etapa 2). Antes,
  // cada botão gerado por string carregava `onclick="funcao('id')"` -- e
  // handler inline em atributo é bloqueado por CSP sem 'unsafe-inline',
  // que é exatamente o que a etapa 3 remove do vercel.json.
  //
  // O mapa abaixo é explícito DE PROPÓSITO: nunca usar `window[nome]()`
  // aqui. Um dispatch genérico transformaria qualquer `data-acao` injetado
  // numa chamada a função global arbitrária -- trocaria um vetor de XSS por
  // outro. Só o que está listado pode ser chamado.
  //
  // data-arg é sempre string (é atributo HTML). Quem precisa de outro tipo
  // converte na própria função -- ver alternarStatusAdministrador em
  // superadmin.js. E o 2º argumento só é passado quando o atributo existe,
  // pra manter a aridade idêntica à das chamadas antigas.
  var ACOES_DELEGADAS = {
    abrirDetalheAssociacao: abrirDetalheAssociacao,
    abrirDetalhesContratacao: abrirDetalhesContratacao,
    abrirDetalhesLog: abrirDetalhesLog,
    abrirEdicaoAdministrador: abrirEdicaoAdministrador,
    abrirEdicaoAssociacao: abrirEdicaoAssociacao,
    alternarStatusAdministrador: alternarStatusAdministrador,
    excluirAssociacao: excluirAssociacao,
    redefinirSenhaAdministrador: redefinirSenhaAdministrador,
  };

  document.addEventListener('click', function(ev) {
    var alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    var acao = ACOES_DELEGADAS[alvo.getAttribute('data-acao')];
    if (!acao) return;
    var id = alvo.getAttribute('data-id');
    var arg = alvo.getAttribute('data-arg');
    if (arg === null) acao(id);
    else acao(id, arg);
  });
