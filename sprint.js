  // Detecta o ambiente pelo hostname em vez de valor fixo -- ver
  // painel/CLAUDE.md, seção "Ambiente de homologação".
  var API_URL = (function() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.indexOf('staging') !== -1) {
      return 'https://associa-plus-backend-staging.onrender.com';
    }
    return 'https://associa-plus-backend.onrender.com';
  })();
  var estado = { token: null, nome: null, id: null, papel: null };
  var itensCache = [];

  var ROTULOS_TIPO = { melhoria: 'Melhoria', bug: 'Bug' };
  var ROTULOS_STATUS = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado' };
  var ROTULOS_PRIORIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    document.getElementById('btn-tema').textContent = tema === 'dark' ? '☾' : '☀';
    localStorage.setItem('tema-sprint', tema);
  }
  aplicarTema(localStorage.getItem('tema-sprint') || localStorage.getItem('tema-preferido') || 'light');
  document.getElementById('btn-tema').onclick = function() {
    aplicarTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
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

  function salvarSessao() {
    localStorage.setItem('sessao_sprint', JSON.stringify({ token: estado.token, nome: estado.nome, id: estado.id, papel: estado.papel }));
  }
  function limparSessao() { localStorage.removeItem('sessao_sprint'); }

  function atualizarSaudacao() {
    document.getElementById('texto-saudacao').textContent = 'Logado como ' + (estado.nome || 'Administrador');
  }

  function entrarNoDashboard() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'block';
    atualizarSaudacao();
    carregarItens();
  }

  (function restaurarSessao() {
    var salva = localStorage.getItem('sessao_sprint');
    if (!salva) return;
    try {
      var dados = JSON.parse(salva);
      if (!dados.token) return;
      estado.token = dados.token;
      estado.nome = dados.nome;
      estado.id = dados.id;
      estado.papel = dados.papel;
    } catch (e) { return; }

    fetch(API_URL + '/sprint', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
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
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  document.getElementById('btn-sair').onclick = function() {
    estado.token = null;
    limparSessao();
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-login').style.display = 'block';
  };

  function carregarItens() {
    fetch(API_URL + '/sprint', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao carregar itens', true); return; }
      itensCache = res.data;
      atualizarKpis();
      renderizarLista();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function atualizarKpis() {
    var pendentes = 0, andamento = 0, concluidos = 0, bugsUrgentes = 0;
    itensCache.forEach(function(i) {
      if (i.status === 'pendente') pendentes++;
      if (i.status === 'em_andamento') andamento++;
      if (i.status === 'concluido') concluidos++;
      if (i.tipo === 'bug' && (i.prioridade === 'urgente' || i.prioridade === 'alta') && (i.status === 'pendente' || i.status === 'em_andamento')) bugsUrgentes++;
    });
    document.getElementById('kpi-pendentes').textContent = pendentes;
    document.getElementById('kpi-andamento').textContent = andamento;
    document.getElementById('kpi-concluidos').textContent = concluidos;
    document.getElementById('kpi-bugs-urgentes').textContent = bugsUrgentes;
  }

  function itensFiltrados() {
    var busca = document.getElementById('filtro-busca').value.trim().toLowerCase();
    var tipo = document.getElementById('filtro-tipo').value;
    var status = document.getElementById('filtro-status').value;
    var prioridade = document.getElementById('filtro-prioridade').value;
    return itensCache.filter(function(i) {
      if (tipo && i.tipo !== tipo) return false;
      if (status && i.status !== status) return false;
      if (prioridade && i.prioridade !== prioridade) return false;
      if (busca && (i.titulo + ' ' + (i.area || '')).toLowerCase().indexOf(busca) === -1) return false;
      return true;
    });
  }

  function renderizarLista() {
    var lista = itensFiltrados();
    var container = document.getElementById('tabela-sprint-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum item encontrado.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Tipo</th><th>Título</th><th>Área</th><th>Prioridade</th><th>Status</th><th>Criado em</th><th></th></tr></thead><tbody>';
    lista.forEach(function(i) {
      html += '<tr>' +
        '<td><span class="badge tipo-' + i.tipo + '">' + ROTULOS_TIPO[i.tipo] + '</span></td>' +
        '<td><strong>' + escapeHtml(i.titulo) + '</strong></td>' +
        '<td>' + escapeHtml(i.area || '—') + '</td>' +
        '<td><span class="badge prioridade-' + i.prioridade + '">' + ROTULOS_PRIORIDADE[i.prioridade] + '</span></td>' +
        '<td><span class="badge ' + i.status + '">' + ROTULOS_STATUS[i.status] + '</span></td>' +
        '<td>' + new Date(i.criado_em).toLocaleDateString('pt-BR') + '</td>' +
        '<td style="white-space:nowrap;"><button class="btn-pequeno" data-acao="abrirDetalheItem" data-id="' + i.id + '">Abrir</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  ['filtro-busca'].forEach(function(id) { document.getElementById(id).oninput = renderizarLista; });
  ['filtro-tipo', 'filtro-status', 'filtro-prioridade'].forEach(function(id) { document.getElementById(id).onchange = renderizarLista; });

  document.getElementById('btn-novo-item').onclick = function() {
    document.getElementById('titulo-modal-item').textContent = 'Novo item';
    document.getElementById('editar-item-id').value = '';
    document.getElementById('item-tipo').value = 'melhoria';
    document.getElementById('item-titulo').value = '';
    document.getElementById('item-descricao').value = '';
    document.getElementById('item-area').value = '';
    document.getElementById('item-prioridade').value = 'media';
    document.getElementById('btn-salvar-item').textContent = 'Adicionar à sprint';
    document.getElementById('overlay-modal-item').style.display = 'flex';
  };
  document.getElementById('btn-cancelar-modal-item').onclick = function() {
    document.getElementById('overlay-modal-item').style.display = 'none';
  };

  function abrirEdicaoItem(id) {
    var item = itensCache.find(function(i) { return i.id === id; });
    if (!item) return;
    document.getElementById('titulo-modal-item').textContent = 'Editar item';
    document.getElementById('editar-item-id').value = item.id;
    document.getElementById('item-tipo').value = item.tipo;
    document.getElementById('item-titulo').value = item.titulo;
    document.getElementById('item-descricao').value = item.descricao;
    document.getElementById('item-area').value = item.area || '';
    document.getElementById('item-prioridade').value = item.prioridade;
    document.getElementById('btn-salvar-item').textContent = 'Salvar';
    document.getElementById('overlay-modal-detalhe').style.display = 'none';
    document.getElementById('overlay-modal-item').style.display = 'flex';
  }

  document.getElementById('btn-salvar-item').onclick = function() {
    var idEdicao = document.getElementById('editar-item-id').value;
    var corpo = {
      tipo: document.getElementById('item-tipo').value,
      titulo: document.getElementById('item-titulo').value.trim(),
      descricao: document.getElementById('item-descricao').value.trim(),
      area: document.getElementById('item-area').value.trim(),
      prioridade: document.getElementById('item-prioridade').value
    };
    if (!corpo.titulo) { mostrarToast('Informe um título', true); return; }
    if (!corpo.descricao) { mostrarToast('Informe uma descrição', true); return; }

    var url = API_URL + '/sprint' + (idEdicao ? '/' + idEdicao : '');
    fetch(url, {
      method: idEdicao ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify(corpo)
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao salvar item', true); return; }
      document.getElementById('overlay-modal-item').style.display = 'none';
      mostrarToast(idEdicao ? 'Item atualizado!' : 'Item adicionado à sprint!');
      carregarItens();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  function abrirDetalheItem(id) {
    var item = itensCache.find(function(i) { return i.id === id; });
    if (!item) return;
    document.getElementById('detalhe-titulo').textContent = item.titulo;
    document.getElementById('detalhe-badge-tipo').className = 'badge tipo-' + item.tipo;
    document.getElementById('detalhe-badge-tipo').textContent = ROTULOS_TIPO[item.tipo];
    document.getElementById('detalhe-badge-prioridade').className = 'badge prioridade-' + item.prioridade;
    document.getElementById('detalhe-badge-prioridade').textContent = ROTULOS_PRIORIDADE[item.prioridade];
    document.getElementById('detalhe-badge-status').className = 'badge ' + item.status;
    document.getElementById('detalhe-badge-status').textContent = ROTULOS_STATUS[item.status];
    document.getElementById('detalhe-area').textContent = item.area ? ('Área: ' + item.area) : '';
    document.getElementById('detalhe-descricao').textContent = item.descricao;
    document.getElementById('detalhe-status-select').value = item.status;
    document.getElementById('detalhe-notas').value = item.notas_aplicacao || '';
    document.getElementById('overlay-modal-detalhe').dataset.itemId = item.id;
    document.getElementById('overlay-modal-detalhe').style.display = 'flex';
  }

  document.getElementById('btn-fechar-detalhe').onclick = function() {
    document.getElementById('overlay-modal-detalhe').style.display = 'none';
  };

  document.getElementById('btn-editar-item').onclick = function() {
    abrirEdicaoItem(document.getElementById('overlay-modal-detalhe').dataset.itemId);
  };

  document.getElementById('btn-salvar-status').onclick = function() {
    var id = document.getElementById('overlay-modal-detalhe').dataset.itemId;
    var status = document.getElementById('detalhe-status-select').value;
    var notas = document.getElementById('detalhe-notas').value.trim();

    fetch(API_URL + '/sprint/' + id + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify({ status: status, notas_aplicacao: notas })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao atualizar status', true); return; }
      document.getElementById('overlay-modal-detalhe').style.display = 'none';
      mostrarToast('Status atualizado!');
      carregarItens();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  document.getElementById('btn-excluir-item').onclick = function() {
    var id = document.getElementById('overlay-modal-detalhe').dataset.itemId;
    confirmarAcao({
      titulo: 'Excluir item de sprint',
      mensagem: 'Isso remove o item permanentemente. Confirmar exclusão?',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/sprint/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + estado.token } })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao excluir item', true); return; }
          document.getElementById('overlay-modal-detalhe').style.display = 'none';
          mostrarToast('Item excluído.');
          carregarItens();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
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
    abrirDetalheItem: abrirDetalheItem,
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
