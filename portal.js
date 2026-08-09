  // Detecta o ambiente pelo hostname em vez de valor fixo -- ver
  // painel/CLAUDE.md, seção "Ambiente de homologação".
  var API_URL = (function() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.indexOf('staging') !== -1) {
      return 'https://minha-associacao-backend-staging.onrender.com';
    }
    return 'https://minha-associacao-backend.onrender.com';
  })();
  var estado = { token: null, nome: null, email: null, plano: null };

  function decodificarEmailDoToken(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.email || '';
    } catch (e) {
      return '';
    }
  }

  // Gating de funcionalidades por plano (29/07/2026) — mesmo padrão de
  // painel/index.html: plano vem embutido no token (backend/routes/auth.js),
  // decodificado sem verificar assinatura porque é só pra decisão de UI
  // (esconder a carteirinha se o plano da associação não incluir). Não tem
  // rota própria protegida por trás da carteirinha (é montada com dado que
  // o associado já recebe em /portal/meus-dados), então esse gate é só de
  // UI mesmo — não há dado sensível adicional pra bloquear no backend aqui.
  function decodificarPlanoDoToken(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.plano || null;
    } catch (e) {
      return null;
    }
  }

  var NIVEL_PLANO = { trial: 99, basico: 1, intermediario: 2, avancado: 3 };
  function planoAtende(nivelMinimo) {
    var nivelAtual = NIVEL_PLANO[estado.plano] != null ? NIVEL_PLANO[estado.plano] : 0;
    var nivelExigido = NIVEL_PLANO[nivelMinimo] != null ? NIVEL_PLANO[nivelMinimo] : 0;
    return nivelAtual >= nivelExigido;
  }

  var tokenRedefinicao = null;

  // Se o link tiver ?reset=<token>, já abre a tela de definir nova senha
  (function detectarTokenRedefinicao() {
    var params = new URLSearchParams(window.location.search);
    var token = params.get('reset');
    if (token) {
      tokenRedefinicao = token;
      document.getElementById('tela-login').style.display = 'none';
      document.getElementById('tela-redefinir-senha').style.display = 'block';
    }
  })();

  // ---------- Gerador de Pix estático (BR Code / EMV) ----------
  function campoEMV(id, valor) {
    var tamanho = String(valor.length).padStart(2, '0');
    return id + tamanho + valor;
  }

  function removerAcentos(texto) {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function crc16(payload) {
    var polinomio = 0x1021;
    var resultado = 0xFFFF;

    for (var i = 0; i < payload.length; i++) {
      resultado ^= (payload.charCodeAt(i) << 8);
      for (var j = 0; j < 8; j++) {
        if ((resultado & 0x8000) !== 0) {
          resultado = ((resultado << 1) ^ polinomio) & 0xFFFF;
        } else {
          resultado = (resultado << 1) & 0xFFFF;
        }
      }
    }
    return resultado.toString(16).toUpperCase().padStart(4, '0');
  }

  function gerarPayloadPix(config, valor, txid) {
    var chave = config.chave_pix;
    var nome = removerAcentos(config.nome_recebedor_pix).toUpperCase().substring(0, 25);
    var cidade = removerAcentos(config.cidade_pix).toUpperCase().substring(0, 15);
    var txidLimpo = ('COB' + txid).replace(/[^a-zA-Z0-9]/g, '').substring(0, 25);
    var valorFormatado = Number(valor).toFixed(2);

    var merchantAccountInfo = campoEMV('00', 'br.gov.bcb.pix') + campoEMV('01', chave);
    var additionalData = campoEMV('05', txidLimpo);

    var payload =
      campoEMV('00', '01') +
      campoEMV('26', merchantAccountInfo) +
      campoEMV('52', '0000') +
      campoEMV('53', '986') +
      campoEMV('54', valorFormatado) +
      campoEMV('58', 'BR') +
      campoEMV('59', nome) +
      campoEMV('60', cidade) +
      campoEMV('62', additionalData) +
      '6304';

    return payload + crc16(payload);
  }

  function renderizarQrCode(containerId, texto) {
    var qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    document.getElementById(containerId).innerHTML = qr.createSvgTag({ scalable: true });
  }

  // ---------- Tema ----------
  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    document.getElementById('btn-tema').textContent = tema === 'dark' ? '☾' : '☀';
    localStorage.setItem('tema-preferido', tema);
  }
  var temaSalvo = localStorage.getItem('tema-preferido') || 'light';
  aplicarTema(temaSalvo);

  document.getElementById('btn-tema').onclick = function() {
    var atual = document.documentElement.getAttribute('data-theme');
    aplicarTema(atual === 'dark' ? 'light' : 'dark');
  };

  // ---------- Toast ----------
  function mostrarToast(mensagem, erro) {
    var toast = document.getElementById('toast');
    toast.textContent = mensagem;
    toast.className = 'toast show' + (erro ? ' erro' : '');
    setTimeout(function() { toast.className = 'toast'; }, 3000);
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

  // Espelha utils/validacao.js no backend -- ver comentário lá. Nunca montar
  // <img src="..."> por concatenação com valor vindo do banco: aspas no valor
  // escapam do atributo e viram XSS armazenado.
  var RE_IMAGEM_SEGURA = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  function renderizarFotoBase64(container, dataUrl) {
    container.textContent = '';
    if (!dataUrl || !RE_IMAGEM_SEGURA.test(dataUrl)) return;
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Foto de perfil';
    container.appendChild(img);
  }

  function formatarData(iso) {
    if (!iso) return '—';
    var partes = iso.substring(0, 10).split('-');
    return partes[2] + '/' + partes[1] + '/' + partes[0];
  }

  function formatarDataHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var dia = String(d.getDate()).padStart(2, '0');
    var mes = String(d.getMonth() + 1).padStart(2, '0');
    var hora = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return dia + '/' + mes + '/' + d.getFullYear() + ' às ' + hora + ':' + min;
  }

  // Espelha a política de senha forte do backend, só para dar feedback rápido
  // (o backend valida de novo e é quem manda de verdade).
  function senhaForteClient(senha) {
    return !!senha && senha.length >= 8 && /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /[0-9]/.test(senha);
  }

  // ---------- Navegação entre telas de autenticação ----------
  document.getElementById('link-esqueci-senha').onclick = function(e) {
    e.preventDefault();
    document.getElementById('recuperar-email').value = document.getElementById('login-email').value;
    document.getElementById('resultado-recuperacao').style.display = 'none';
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-esqueci-senha').style.display = 'block';
  };
  document.getElementById('link-voltar-login').onclick = function(e) {
    e.preventDefault();
    document.getElementById('tela-esqueci-senha').style.display = 'none';
    document.getElementById('tela-login').style.display = 'block';
  };

  // ---------- Solicitar redefinição ----------
  document.getElementById('btn-gerar-recuperacao').onclick = function() {
    var email = document.getElementById('recuperar-email').value.trim();
    var erroEl = document.getElementById('erro-recuperar');
    erroEl.style.display = 'none';

    if (!email) {
      erroEl.textContent = 'Preencha o e-mail.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/auth/esqueci-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao gerar link de redefinição';
        erroEl.style.display = 'block';
        return;
      }
      if (!res.data.token) {
        mostrarToast(res.data.mensagem || 'Se o e-mail existir, um link foi gerado.');
        return;
      }
      var link = window.location.origin + window.location.pathname + '?reset=' + res.data.token;
      document.getElementById('link-recuperacao').value = link;
      document.getElementById('resultado-recuperacao').style.display = 'block';
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  document.getElementById('btn-copiar-link-recuperacao').onclick = function() {
    var campo = document.getElementById('link-recuperacao');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Link copiado!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  // ---------- Confirmar nova senha ----------
  document.getElementById('btn-confirmar-redefinicao').onclick = function() {
    var novaSenha = document.getElementById('redefinir-senha-nova').value;
    var erroEl = document.getElementById('erro-redefinir');
    erroEl.style.display = 'none';

    if (!senhaForteClient(novaSenha)) {
      erroEl.textContent = 'A nova senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula e número.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/auth/redefinir-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenRedefinicao, senha_nova: novaSenha })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao redefinir senha';
        erroEl.style.display = 'block';
        return;
      }
      mostrarToast('Senha redefinida! Faça login com a nova senha.');
      document.getElementById('tela-redefinir-senha').style.display = 'none';
      document.getElementById('tela-login').style.display = 'block';
      window.history.replaceState({}, '', window.location.pathname);
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  // ---------- Login ----------
  function iniciaisNome(nome) {
    if (!nome) return '--';
    var partes = nome.trim().split(/\s+/);
    var iniciais = partes[0].charAt(0);
    if (partes.length > 1) iniciais += partes[partes.length - 1].charAt(0);
    return iniciais.toUpperCase();
  }

  function saudacaoPorHorario() {
    var hora = new Date().getHours();
    if (hora < 12) return 'Bom dia';
    if (hora < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function renderizarHeader() {
    var primeiroNome = (estado.nome || '').trim().split(/\s+/)[0] || '';
    document.getElementById('app-header-saudacao').innerHTML =
      saudacaoPorHorario() + (primeiroNome ? ', <span>' + escapeHtml(primeiroNome) + '</span>!' : '!');
    document.getElementById('app-header-nome-associacao').textContent = estado.nomeAssociacao || '';
    document.getElementById('app-header-nome').textContent = estado.nome || 'Associado';
    document.getElementById('app-header-avatar').textContent = iniciaisNome(estado.nome);
  }

  // Nome da associação, exibido abaixo da saudação no lugar do e-mail --
  // GET /configuracoes/identidade é liberado pra qualquer usuário
  // autenticado do tenant, não só admin/diretoria (ver backend/CLAUDE.md).
  function carregarNomeAssociacao() {
    fetch(API_URL + '/configuracoes/identidade', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(dados) {
      estado.nomeAssociacao = dados.nome || '';
      document.getElementById('app-header-nome-associacao').textContent = estado.nomeAssociacao;
    })
    .catch(function() {});
  }

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

  function abrirModalAlterarSenha() {
    document.getElementById('senha-atual-voluntaria').value = '';
    document.getElementById('senha-nova-voluntaria').value = '';
    document.getElementById('senha-confirmar-voluntaria').value = '';
    document.getElementById('erro-senha-voluntaria').style.display = 'none';
    document.getElementById('overlay-modal-alterar-senha').style.display = 'flex';
  }
  document.getElementById('btn-fechar-modal-alterar-senha').onclick = function() {
    document.getElementById('overlay-modal-alterar-senha').style.display = 'none';
  };
  document.getElementById('btn-confirmar-alterar-senha').onclick = function() {
    var senhaAtual = document.getElementById('senha-atual-voluntaria').value;
    var senhaNova = document.getElementById('senha-nova-voluntaria').value;
    var senhaConfirmar = document.getElementById('senha-confirmar-voluntaria').value;
    var erroEl = document.getElementById('erro-senha-voluntaria');
    erroEl.style.display = 'none';

    if (!senhaAtual) {
      erroEl.textContent = 'Informe a senha atual.';
      erroEl.style.display = 'block';
      return;
    }
    if (!senhaForteClient(senhaNova)) {
      erroEl.textContent = 'A nova senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula e número.';
      erroEl.style.display = 'block';
      return;
    }
    if (senhaNova !== senhaConfirmar) {
      erroEl.textContent = 'As senhas não coincidem.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/auth/senha', {
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
      estado.plano = decodificarPlanoDoToken(res.data.token);
      salvarSessao();
      document.getElementById('overlay-modal-alterar-senha').style.display = 'none';
      mostrarToast('Senha alterada com sucesso.');
    })
    .catch(function() {
      erroEl.textContent = 'Erro ao conectar ao servidor';
      erroEl.style.display = 'block';
    });
  };
  document.getElementById('btn-menu-alterar-senha').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    abrirModalAlterarSenha();
  };

  // Modal de boas-vindas do primeiro acesso do associado -- mesma flag do
  // painel da associação (usuarios.boas_vindas_visto_em), gravada no banco
  // via PATCH /auth/boas-vindas-visto pra não reaparecer ao trocar de
  // navegador/limpar cache.
  function abrirModalBoasVindasPortal(d) {
    document.getElementById('boas-vindas-titulo').textContent =
      'Bem-vindo' + (estado.nome ? ', ' + estado.nome.split(' ')[0] : '') + '!';
    document.getElementById('boas-vindas-nome-associacao').textContent = d.nome_associacao || '';
    document.getElementById('boas-vindas-item-carteirinha').style.display = planoAtende('intermediario') ? '' : 'none';
    document.getElementById('overlay-modal-boas-vindas').style.display = 'flex';
  }

  document.getElementById('btn-comecar-usar-portal').onclick = function() {
    document.getElementById('overlay-modal-boas-vindas').style.display = 'none';
    fetch(API_URL + '/auth/boas-vindas-visto', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + estado.token }
    }).catch(function() {});
  };

  function entrarNoPortal() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-esqueci-senha').style.display = 'none';
    document.getElementById('tela-trocar-senha-obrigatoria').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'flex';
    renderizarHeader();
    // Carteirinha digital é recurso do plano Intermediário+ da associação
    // (gating por plano, 29/07/2026) -- só de UI, ver comentário em
    // decodificarPlanoDoToken acima.
    document.getElementById('btn-ver-carteirinha').style.display = planoAtende('intermediario') ? '' : 'none';
    carregarNomeAssociacao();
    ativarAba('inicio');
    carregarInicio();
  }

  function salvarSessao() {
    localStorage.setItem('sessao_portal', JSON.stringify({
      token: estado.token,
      nome: estado.nome
    }));
  }

  function limparSessao() {
    localStorage.removeItem('sessao_portal');
  }

  // Ao carregar a página, tenta restaurar a sessão salva (evita logout ao atualizar/F5)
  (function restaurarSessao() {
    if (tokenRedefinicao) return;
    var salva = localStorage.getItem('sessao_portal');
    if (!salva) return;

    try {
      var dados = JSON.parse(salva);
      if (!dados.token) return;

      estado.token = dados.token;
      estado.nome = dados.nome || '';
      estado.email = decodificarEmailDoToken(dados.token);
      estado.plano = decodificarPlanoDoToken(dados.token);

      // Valida o token com uma chamada leve antes de assumir a sessão como válida
      fetch(API_URL + '/portal/meus-dados', {
        headers: { 'Authorization': 'Bearer ' + estado.token },
        cache: 'no-store'
      })
      .then(function(resp) {
        if (!resp.ok && resp.status === 401) {
          limparSessao();
          return;
        }
        entrarNoPortal();
      })
      .catch(function() {
        // Sem conexão momentânea — mantém a sessão e tenta mostrar o portal mesmo assim
        entrarNoPortal();
      });
    } catch (e) {
      limparSessao();
    }
  })();

  document.getElementById('btn-login').onclick = function() {
    var email = document.getElementById('login-email').value.trim();
    var senha = document.getElementById('login-senha').value;
    var erroEl = document.getElementById('erro-login');
    erroEl.style.display = 'none';

    if (!email || !senha) {
      erroEl.textContent = 'Preencha todos os campos.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, senha: senha })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao entrar';
        erroEl.style.display = 'block';
        return;
      }

      if (res.data.usuario.papel !== 'associado') {
        erroEl.textContent = 'Esta área é exclusiva para associados. Administradores e diretoria devem acessar pelo painel da associação.';
        erroEl.style.display = 'block';
        return;
      }

      estado.token = res.data.token;
      estado.nome = res.data.usuario.nome || '';
      estado.email = decodificarEmailDoToken(res.data.token);
      estado.plano = decodificarPlanoDoToken(res.data.token);

      if (res.data.deve_trocar_senha) {
        document.getElementById('login-senha').value = '';
        document.getElementById('tela-login').style.display = 'none';
        document.getElementById('tela-trocar-senha-obrigatoria').style.display = 'block';
        return;
      }

      salvarSessao();
      entrarNoPortal();
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor. Verifique se o backend está rodando.';
      erroEl.style.display = 'block';
    });
  };

  // ---------- Troca de senha obrigatória (primeiro acesso) ----------
  document.getElementById('btn-confirmar-troca-obrigatoria').onclick = function() {
    var senhaAtual = document.getElementById('troca-senha-atual').value;
    var senhaNova = document.getElementById('troca-senha-nova').value;
    var senhaConfirmar = document.getElementById('troca-senha-confirmar').value;
    var erroEl = document.getElementById('erro-troca-obrigatoria');
    erroEl.style.display = 'none';

    if (!senhaAtual) {
      erroEl.textContent = 'Informe a senha provisória.';
      erroEl.style.display = 'block';
      return;
    }
    if (!senhaForteClient(senhaNova)) {
      erroEl.textContent = 'A nova senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula e número.';
      erroEl.style.display = 'block';
      return;
    }
    if (senhaNova !== senhaConfirmar) {
      erroEl.textContent = 'As senhas não coincidem.';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/auth/senha', {
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
      estado.plano = decodificarPlanoDoToken(res.data.token);
      document.getElementById('troca-senha-atual').value = '';
      document.getElementById('troca-senha-nova').value = '';
      document.getElementById('troca-senha-confirmar').value = '';
      salvarSessao();
      mostrarToast('Senha definida com sucesso!');
      entrarNoPortal();
    })
    .catch(function() {
      erroEl.textContent = 'Não foi possível conectar ao servidor.';
      erroEl.style.display = 'block';
    });
  };

  function fazerLogout() {
    if (estado.token) {
      fetch(API_URL + '/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + estado.token }
      }).catch(function() { /* logout é best-effort, não bloqueia a saída */ });
    }
    estado.token = null;
    limparSessao();
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-trial-expirado').style.display = 'none';
    document.getElementById('tela-login').style.display = 'block';
  }
  document.getElementById('btn-sair').onclick = fazerLogout;
  document.getElementById('link-sair-trial-expirado').onclick = function(e) {
    e.preventDefault();
    fazerLogout();
  };

  // ---------- Navegação (sidebar) ----------
  function ativarAba(idAtiva) {
    ['inicio', 'meus-dados', 'financeiro', 'comunicados'].forEach(function(nome) {
      var item = document.getElementById('aba-' + nome);
      if (item) item.classList.toggle('ativa', nome === idAtiva);
      var secao = document.getElementById('secao-' + nome);
      if (secao) secao.style.display = (nome === idAtiva) ? 'block' : 'none';
    });

    fecharSidebarMobile();
  }

  document.getElementById('aba-inicio').onclick = function() { ativarAba('inicio'); carregarInicio(); };
  document.getElementById('aba-meus-dados').onclick = function() { ativarAba('meus-dados'); carregarMeusDados(); };
  document.getElementById('aba-financeiro').onclick = function() { ativarAba('financeiro'); carregarFinanceiro(); };
  document.getElementById('aba-comunicados').onclick = function() { ativarAba('comunicados'); carregarComunicados(); };

  // ---------- Menu hambúrguer (mobile) ----------
  function abrirSidebarMobile() {
    document.getElementById('sidebar-principal').classList.add('aberta');
    document.getElementById('sidebar-overlay').classList.add('aberto');
  }
  function fecharSidebarMobile() {
    document.getElementById('sidebar-principal').classList.remove('aberta');
    document.getElementById('sidebar-overlay').classList.remove('aberto');
  }
  document.getElementById('btn-hamburguer').onclick = abrirSidebarMobile;
  document.getElementById('sidebar-overlay').onclick = fecharSidebarMobile;

  // ---------- Comunicados (somente leitura) ----------
  function atualizarIndicadorComunicados(naoLidos) {
    document.getElementById('ponto-notificacao-comunicados').style.display = naoLidos > 0 ? 'block' : 'none';
  }

  function carregarComunicados() {
    fetch(API_URL + '/comunicados', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao carregar comunicados', true);
        return;
      }
      renderizarComunicados(res.data);
      marcarComunicadosVisiveisComoLidos(res.data);
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  // Abrir o mural já conta como "ver" os comunicados -- marca os ainda não
  // lidos em segundo plano, sem bloquear a renderização. É o que faz o
  // contador de não lidos do Início e o ponto da sidebar zerarem depois
  // que o associado passa por aqui. O zeramento do indicador é otimista
  // (não espera as chamadas de marcar-lido terminarem).
  function marcarComunicadosVisiveisComoLidos(lista) {
    var tinhaNaoLido = false;
    lista.forEach(function(c) {
      if (c.lido) return;
      tinhaNaoLido = true;
      fetch(API_URL + '/comunicados/' + c.id + '/marcar-lido', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + estado.token }
      }).catch(function() {});
    });
    if (tinhaNaoLido) atualizarIndicadorComunicados(0);
  }

  function renderizarComunicados(lista) {
    var container = document.getElementById('lista-comunicados-container');

    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum comunicado publicado ainda.</div>';
      return;
    }

    var html = '';
    lista.forEach(function(c) {
      html += '<div class="comunicado-card">' +
        '<div class="comunicado-header">' +
          '<span class="comunicado-titulo">' + escapeHtml(c.titulo) + '</span>' +
          '<span class="comunicado-data">' + formatarDataHora(c.publicado_em) + '</span>' +
        '</div>' +
        '<div class="comunicado-conteudo">' + escapeHtml(c.conteudo) + '</div>' +
        (c.categoria_alvo ? '<span class="comunicado-categoria">' + escapeHtml(c.categoria_alvo) + '</span>' : '') +
        (c.origem_plataforma ? '<span class="comunicado-oficial">Comunicado oficial</span>' : '') +
        '</div>';
    });
    container.innerHTML = html;
  }

  // ---------- Início (mini-dashboard) ----------
  function carregarInicio() {
    fetch(API_URL + '/portal/meus-dados', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        if (tratarTrialExpirado(res.data)) return;
        return;
      }
      var badge = document.getElementById('inicio-badge-situacao');
      badge.className = 'badge ' + res.data.status;
      badge.textContent = (res.data.status || '').replace(/_/g, ' ');

      if (res.data.boas_vindas_pendente) {
        abrirModalBoasVindasPortal(res.data);
      }
    })
    .catch(function() {});

    fetch(API_URL + '/portal/minhas-cobrancas', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) { renderizarResumoFinanceiro(lista); })
    .catch(function() { mostrarToast('Erro ao carregar suas cobranças', true); });

    fetch(API_URL + '/comunicados', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) { renderizarResumoComunicados(lista); })
    .catch(function() { mostrarToast('Erro ao carregar comunicados', true); });
  }

  function renderizarResumoFinanceiro(lista) {
    var container = document.getElementById('inicio-proxima-cobranca-container');
    if (!Array.isArray(lista)) lista = [];
    // abrirModalPix() busca a cobrança em minhasCobrancasCache -- precisa
    // estar povoado mesmo se o associado nunca abriu a aba "Meus Dados".
    minhasCobrancasCache = lista;

    var pendentes = lista.filter(function(c) { return c.status === 'pendente'; });
    var atrasadas = pendentes.filter(function(c) { return c.status_exibicao === 'atrasado'; });
    document.getElementById('inicio-contador-pendentes').textContent = pendentes.length;
    document.getElementById('inicio-contador-atrasadas').textContent = atrasadas.length;

    if (pendentes.length === 0) {
      container.innerHTML = '<div class="vazio" style="padding:20px 0;">Nenhuma cobrança pendente. Tudo em dia!</div>';
      return;
    }

    var ordenadas = pendentes.slice().sort(function(a, b) { return new Date(a.vencimento) - new Date(b.vencimento); });
    var proxima = ordenadas[0];
    var valorFormatado = 'R$ ' + parseFloat(proxima.valor).toFixed(2).replace('.', ',');
    var statusTexto = proxima.status_exibicao.replace(/_/g, ' ');
    if (proxima.status_exibicao === 'vencendo_em_breve' && proxima.dias_restantes != null) {
      statusTexto = proxima.dias_restantes === 0 ? 'vence hoje' : 'vence em ' + proxima.dias_restantes + 'd';
    } else if (proxima.status_exibicao === 'atrasado' && proxima.dias_restantes != null) {
      statusTexto = 'atrasada há ' + Math.abs(proxima.dias_restantes) + 'd';
    }

    container.innerHTML =
      '<div class="proxima-cobranca">' +
        '<div>' +
          '<div class="proxima-cobranca-desc">' + escapeHtml(proxima.descricao) + ' — ' + valorFormatado + '</div>' +
          '<div class="proxima-cobranca-sub">Vencimento ' + formatarData(proxima.vencimento) + ' · <span class="badge ' + escapeHtml(proxima.status_exibicao) + '">' + escapeHtml(statusTexto) + '</span></div>' +
        '</div>' +
        '<button class="btn-pequeno" id="btn-inicio-pagar">Pagar com Pix</button>' +
      '</div>';
    document.getElementById('btn-inicio-pagar').onclick = function() { abrirModalPix(proxima.id); };
  }

  function renderizarResumoComunicados(lista) {
    var container = document.getElementById('inicio-comunicados-container');
    var badge = document.getElementById('inicio-badge-comunicados');
    if (!Array.isArray(lista)) lista = [];

    var naoLidos = lista.filter(function(c) { return !c.lido; }).length;
    if (naoLidos > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = naoLidos;
    } else {
      badge.style.display = 'none';
    }
    atualizarIndicadorComunicados(naoLidos);

    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum comunicado publicado ainda.</div>';
      return;
    }

    var html = '<div style="padding:6px 22px;">';
    lista.slice(0, 3).forEach(function(c) {
      html += '<div class="comunicado-mini">' +
        '<div class="comunicado-mini-header">' +
          (!c.lido ? '<span class="ponto-nao-lido"></span>' : '') +
          '<span class="comunicado-mini-titulo">' + escapeHtml(c.titulo) + '</span>' +
        '</div>' +
        '<div class="comunicado-mini-data">' + formatarDataHora(c.publicado_em) + '</div>' +
        '</div>';
    });
    html += '</div><div style="padding:14px 22px; border-top:1px solid var(--border);"><button class="btn-pequeno" id="btn-inicio-ver-comunicados">Ver todos</button></div>';
    container.innerHTML = html;
    document.getElementById('btn-inicio-ver-comunicados').onclick = function() { ativarAba('comunicados'); carregarComunicados(); };
  }

  // ---------- Meus Dados ----------
  // Se qualquer rota do portal responder com esse código (trial da
  // associação expirado -- ver middleware/auth.js bloquearTrialExpirado),
  // troca a tela inteira por um aviso simples. O associado não gerencia
  // plano, então não tem fluxo de contratação aqui, só uma explicação.
  // Mesmo tratamento pros dois códigos de bloqueio de acesso -- trial
  // vencido (TRIAL_EXPIRADO) e assinatura paga vencida além da tolerância
  // (ASSINATURA_VENCIDA, auditoria de segurança Fase 3, 08/08/2026 --
  // SEC-015). O texto da tela já é genérico o bastante pros dois casos
  // ("regularizar o plano"), não precisou de texto dinâmico aqui como em
  // painel/index.html.
  function tratarTrialExpirado(dadosResposta) {
    if (dadosResposta && (dadosResposta.codigo === 'TRIAL_EXPIRADO' || dadosResposta.codigo === 'ASSINATURA_VENCIDA')) {
      document.getElementById('tela-dashboard').style.display = 'none';
      document.getElementById('tela-trial-expirado').style.display = 'flex';
      return true;
    }
    return false;
  }

  // Cache do último /portal/meus-dados carregado -- a carteirinha digital
  // reaproveita esses dados em vez de buscar de novo (ver abrirCarteirinha()).
  var associadoAtual = null;

  function carregarMeusDados() {
    fetch(API_URL + '/portal/meus-dados', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      var container = document.getElementById('perfil-associado-container');
      if (!res.ok) {
        if (tratarTrialExpirado(res.data)) return;
        container.innerHTML = '<div class="vazio">' + escapeHtml(res.data.erro || 'Erro ao carregar seus dados') + '</div>';
        return;
      }
      associadoAtual = res.data;
      renderizarFichaAssociado(res.data);

      var avatar = document.getElementById('avatar-associado');
      if (res.data.foto_base64) {
        renderizarFotoBase64(avatar, res.data.foto_base64);
      }
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function campoFicha(rotulo, valor) {
    return '<div class="ficha-item"><span class="ficha-label">' + escapeHtml(rotulo) + '</span><span class="ficha-valor">' + escapeHtml(valor || '—') + '</span></div>';
  }

  function renderizarFichaAssociado(a) {
    var container = document.getElementById('perfil-associado-container');
    var enderecoLinha = [a.endereco_logradouro, a.endereco_numero].filter(Boolean).join(', ');
    if (a.endereco_complemento) enderecoLinha = [enderecoLinha, a.endereco_complemento].filter(Boolean).join(' - ');
    var cidadeUf = [a.endereco_cidade, a.endereco_estado].filter(Boolean).join('/');

    container.innerHTML =
      '<div class="ficha-secao">' +
        '<h4 class="ficha-secao-titulo">Dados pessoais</h4>' +
        '<div class="ficha-grid">' +
          campoFicha('Nome completo', a.nome_completo) +
          campoFicha('CPF', a.cpf) +
          campoFicha('RG', a.rg) +
          campoFicha('Telefone', a.telefone) +
          campoFicha('E-mail', estado.email) +
        '</div>' +
      '</div>' +
      '<div class="ficha-secao">' +
        '<h4 class="ficha-secao-titulo">Endereço</h4>' +
        '<div class="ficha-grid">' +
          campoFicha('CEP', a.endereco_cep) +
          campoFicha('Logradouro', enderecoLinha) +
          campoFicha('Bairro', a.endereco_bairro) +
          campoFicha('Cidade/UF', cidadeUf) +
        '</div>' +
      '</div>' +
      '<div class="ficha-secao">' +
        '<h4 class="ficha-secao-titulo">Plano e situação</h4>' +
        '<div class="ficha-grid">' +
          campoFicha('Plano/Categoria', a.categoria) +
          '<div class="ficha-item"><span class="ficha-label">Situação</span><span class="ficha-valor"><span class="badge ' + escapeHtml(a.status) + '">' + escapeHtml(a.status) + '</span></span></div>' +
          campoFicha('Associado desde', formatarData(a.data_ingresso)) +
          campoFicha('Cadastro em', formatarData(a.criado_em)) +
        '</div>' +
      '</div>';
  }

  // ---------- Carteirinha digital ----------
  // Versão simples: um cartão gerado na hora a partir dos dados já
  // carregados (associadoAtual), pra mostrar na tela do celular em
  // eventos. O QR é só cosmético/identificador (id do associado) -- não
  // há endpoint de verificação por scan ainda, se isso for pedido depois
  // é um endpoint público novo que valida o id e devolve só status
  // ativo/inadimplente, sem dado pessoal.
  function abrirCarteirinha() {
    if (!associadoAtual) {
      mostrarToast('Aguarde seus dados carregarem e tente de novo.', true);
      return;
    }
    var a = associadoAtual;

    document.getElementById('carteirinha-nome').textContent = a.nome_completo || '';
    document.getElementById('carteirinha-associacao').textContent = estado.nomeAssociacao || '';
    document.getElementById('carteirinha-categoria').textContent = a.categoria || 'Associado';

    var statusEl = document.getElementById('carteirinha-status');
    statusEl.className = 'badge ' + a.status;
    statusEl.textContent = a.status;

    var fotoEl = document.getElementById('carteirinha-foto');
    if (a.foto_base64) {
      renderizarFotoBase64(fotoEl, a.foto_base64);
    } else {
      fotoEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }

    renderizarQrCode('carteirinha-qr', 'ASSOCIADO:' + a.id);
    document.getElementById('overlay-modal-carteirinha').style.display = 'flex';
  }

  document.getElementById('btn-ver-carteirinha').onclick = abrirCarteirinha;
  document.getElementById('btn-fechar-carteirinha').onclick = function() {
    document.getElementById('overlay-modal-carteirinha').style.display = 'none';
  };

  // ---------- Financeiro ----------
  function carregarFinanceiro() {
    fetch(API_URL + '/portal/minhas-cobrancas', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        if (tratarTrialExpirado(res.data)) return;
        document.getElementById('tabela-minhas-cobrancas-container').innerHTML =
          '<div class="vazio">' + escapeHtml(res.data.erro || 'Erro ao carregar suas cobranças') + '</div>';
        return;
      }
      renderizarMinhasCobrancas(res.data);
    })
    .catch(function() { mostrarToast('Erro ao carregar suas cobranças', true); });
  }

  var minhasCobrancasCache = [];

  function renderizarMinhasCobrancas(lista) {
    minhasCobrancasCache = lista;
    var container = document.getElementById('tabela-minhas-cobrancas-container');
    if (!Array.isArray(lista) || lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhuma cobrança encontrada.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead><tbody>';
    lista.forEach(function(c) {
      var statusExibicao = c.status_exibicao || c.status;
      var statusTexto = statusExibicao.replace(/_/g, ' ');
      if (statusExibicao === 'vencendo_em_breve' && c.dias_restantes != null) {
        statusTexto = c.dias_restantes === 0 ? 'vence hoje' : 'vence em ' + c.dias_restantes + 'd';
      }
      var valorFormatado = 'R$ ' + parseFloat(c.valor).toFixed(2).replace('.', ',');
      var acao = '';
      if (c.status === 'pendente' || statusExibicao === 'atrasado' || statusExibicao === 'vencendo_em_breve') {
        acao = '<button class="btn-pequeno" data-acao="abrirModalPix" data-id="' + c.id + '">Pagar com Pix</button>';
      } else if (c.status === 'aguardando_confirmacao') {
        acao = '<span style="font-size:12px; color:var(--text-muted);">Comprovante enviado</span>';
      }
      html += '<tr>' +
        '<td>' + escapeHtml(c.descricao) + '</td>' +
        '<td>' + valorFormatado + '</td>' +
        '<td>' + formatarData(c.vencimento) + '</td>' +
        '<td><span class="badge ' + escapeHtml(statusExibicao) + '">' + escapeHtml(statusTexto) + '</span></td>' +
        '<td>' + acao + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ---------- Modal Pagar com Pix ----------
  var comprovanteSelecionadoBase64 = null;

  function abrirModalPix(cobrancaId) {
    var cobranca = minhasCobrancasCache.find(function(c) { return c.id === cobrancaId; });
    if (!cobranca) return;

    document.getElementById('pix-cobranca-id').value = cobrancaId;
    document.getElementById('pix-descricao-valor').textContent =
      cobranca.descricao + ' — R$ ' + parseFloat(cobranca.valor).toFixed(2).replace('.', ',');
    document.getElementById('nome-arquivo-comprovante').textContent = '';
    comprovanteSelecionadoBase64 = null;

    fetch(API_URL + '/configuracoes/pix', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(config) {
      if (!config.chave_pix) {
        document.getElementById('pix-qrcode-container').innerHTML = '<p class="vazio">A diretoria ainda não configurou a chave Pix.</p>';
        document.getElementById('pix-copia-cola').value = '';
        document.getElementById('overlay-modal-pix').style.display = 'flex';
        return;
      }
      var payload = gerarPayloadPix(config, cobranca.valor, cobranca.id);
      renderizarQrCode('pix-qrcode-container', payload);
      document.getElementById('pix-copia-cola').value = payload;
      document.getElementById('overlay-modal-pix').style.display = 'flex';
    })
    .catch(function() { mostrarToast('Erro ao carregar dados do Pix', true); });
  }

  document.getElementById('btn-fechar-modal-pix').onclick = function() {
    document.getElementById('overlay-modal-pix').style.display = 'none';
  };

  document.getElementById('btn-copiar-pix').onclick = function() {
    var campo = document.getElementById('pix-copia-cola');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Código Pix copiado!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  document.getElementById('btn-selecionar-comprovante').onclick = function() {
    document.getElementById('input-comprovante').click();
  };

  document.getElementById('input-comprovante').onchange = function(e) {
    var arquivo = e.target.files[0];
    if (!arquivo) return;

    document.getElementById('nome-arquivo-comprovante').textContent = arquivo.name;

    if (arquivo.type === 'application/pdf') {
      var leitorPdf = new FileReader();
      leitorPdf.onload = function(evt) { comprovanteSelecionadoBase64 = evt.target.result; };
      leitorPdf.readAsDataURL(arquivo);
      return;
    }

    var leitor = new FileReader();
    leitor.onload = function(evt) {
      var img = new Image();
      img.onload = function() {
        var TAMANHO_MAX = 1000;
        var largura = img.width;
        var altura = img.height;
        if (largura > altura && largura > TAMANHO_MAX) {
          altura = Math.round(altura * (TAMANHO_MAX / largura));
          largura = TAMANHO_MAX;
        } else if (altura > TAMANHO_MAX) {
          largura = Math.round(largura * (TAMANHO_MAX / altura));
          altura = TAMANHO_MAX;
        }
        var canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        canvas.getContext('2d').drawImage(img, 0, 0, largura, altura);
        comprovanteSelecionadoBase64 = canvas.toDataURL('image/jpeg', 0.85);
      };
      img.src = evt.target.result;
    };
    leitor.readAsDataURL(arquivo);
  };

  document.getElementById('btn-enviar-comprovante').onclick = function() {
    var cobrancaId = document.getElementById('pix-cobranca-id').value;

    if (!comprovanteSelecionadoBase64) {
      mostrarToast('Escolha o arquivo do comprovante antes de enviar', true);
      return;
    }

    fetch(API_URL + '/portal/minhas-cobrancas/' + cobrancaId + '/comprovante', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ comprovante_base64: comprovanteSelecionadoBase64 })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao enviar comprovante', true);
        return;
      }
      document.getElementById('overlay-modal-pix').style.display = 'none';
      mostrarToast('Comprovante enviado! Aguarde a confirmação da diretoria.');
      carregarMeusDados();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Foto do associado ----------
  document.getElementById('btn-trocar-foto').onclick = function() {
    document.getElementById('input-foto-associado').click();
  };

  document.getElementById('input-foto-associado').onchange = function(e) {
    var arquivo = e.target.files[0];
    if (!arquivo) return;

    if (!arquivo.type.startsWith('image/')) {
      mostrarToast('Selecione um arquivo de imagem (JPG ou PNG)', true);
      return;
    }

    var leitor = new FileReader();
    leitor.onload = function(evt) {
      var img = new Image();
      img.onload = function() {
        var TAMANHO_MAX = 300;
        var largura = img.width;
        var altura = img.height;

        if (largura > altura && largura > TAMANHO_MAX) {
          altura = Math.round(altura * (TAMANHO_MAX / largura));
          largura = TAMANHO_MAX;
        } else if (altura > TAMANHO_MAX) {
          largura = Math.round(largura * (TAMANHO_MAX / altura));
          altura = TAMANHO_MAX;
        }

        var canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, largura, altura);

        var fotoRedimensionada = canvas.toDataURL('image/jpeg', 0.85);
        salvarFotoAssociado(fotoRedimensionada);
      };
      img.src = evt.target.result;
    };
    leitor.readAsDataURL(arquivo);
  };

  function salvarFotoAssociado(fotoBase64) {
    fetch(API_URL + '/portal/minha-foto', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ foto_base64: fotoBase64 })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar foto', true);
        return;
      }
      renderizarFotoBase64(document.getElementById('avatar-associado'), fotoBase64);
      mostrarToast('Foto atualizada!');
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

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
    abrirModalPix: abrirModalPix,
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
