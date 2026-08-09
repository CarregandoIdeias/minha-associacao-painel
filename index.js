  // Detecta o ambiente pelo hostname em vez de valor fixo -- ver
  // painel/CLAUDE.md, seção "Ambiente de homologação": staging.vercel.app
  // (ou localhost, testes locais) aponta pro backend de staging; qualquer
  // outro domínio (produção) aponta pro backend de produção. Isso elimina o
  // risco de esquecer de reverter o API_URL antes de commitar, que já
  // aconteceu antes.
  var API_URL = (function() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.indexOf('staging') !== -1) {
      return 'https://minha-associacao-backend-staging.onrender.com';
    }
    return 'https://minha-associacao-backend.onrender.com';
  })();
  var estado = { token: null, papel: null, nome: null, email: null, plano: null };

  // Espelho do backend/utils/precos.js — só pra sugerir/exibir valores antes
  // de salvar (o cálculo real é sempre feito no servidor).
  var PRECOS_PLANO = {
    trial: { base: 0, porAssociado: 0 },
    basico: { base: 49.90, porAssociado: 2.00 },
    intermediario: { base: 99.90, porAssociado: 1.50 },
    avancado: { base: 199.90, porAssociado: 1.00 }
  };
  var INFO_PLANO = {
    basico: { nome: 'Básico', porte: 'Pequeno porte · até 50 associados' },
    intermediario: { nome: 'Intermediário', porte: 'Médio porte · 50 a 200 associados' },
    avancado: { nome: 'Avançado', porte: 'Grande porte · 200+ associados' }
  };
  var ROTULOS_PLANO = { trial: 'Trial', basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado' };
  var planoAtualDados = null;
  var planoEscolhidoContratacao = null;
  var comprovantePlanoSelecionadoBase64 = null;
  var intervaloContadorTrial = null;

  function decodificarEmailDoToken(token) {
    try {
      var payload = JSON.parse(atob(token.split('.')[1]));
      return payload.email || '';
    } catch (e) {
      return '';
    }
  }

  // Gating de funcionalidades por plano (29/07/2026) — plano vem embutido
  // no próprio token (backend/routes/auth.js, assinarToken), decodificado
  // do mesmo jeito que o e-mail acima, sem verificar assinatura porque é
  // só pra decisão de UI (esconder botão/aba de recurso não incluído no
  // plano). O bloqueio de verdade é sempre no backend (exigirPlano,
  // middleware/auth.js) — uma divergência aqui só esconderia/mostraria um
  // elemento errado, nunca abriria uma brecha real.
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
  var associadosCache = [];

  // Converte texto tipo "150,00" ou "150.00" em número
  function parseMoney(texto) {
    if (!texto) return 0;
    var limpo = texto.replace(/[^\d,.-]/g, '').replace(',', '.');
    var partes = limpo.split('.');
    if (partes.length > 2) {
      limpo = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
    }
    return parseFloat(limpo) || 0;
  }

  // ---------- Gerador de Pix estático (BR Code / EMV) ----------
  function campoEMV(id, valor) {
    var tamanho = String(valor.length).padStart(2, '0');
    return id + tamanho + valor;
  }

  function removerAcentos(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

  // ---------- Plano/Trial (card do Dashboard + tela de bloqueio + contratação) ----------
  function carregarPlano() {
    fetch(API_URL + '/plano', { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      // diretoria sem acesso (403) ou erro pontual não pode quebrar o resto
      // do dashboard -- só o admin realmente depende dessa tela.
      if (!res.ok) return;
      planoAtualDados = res.data;
      // bloqueio_assinatura_vencida (auditoria de segurança Fase 3,
      // 08/08/2026 -- SEC-015): diferente de status === 'vencida' (que já é
      // true no primeiro dia de atraso, só informativo/badge) -- este campo
      // vem calculado pelo backend com a tolerância de dias já aplicada, é
      // a fonte de verdade de quando bloquear de fato (mesmo cálculo que
      // bloquearAssinaturaVencida usa pra devolver 403 nas outras rotas).
      if (res.data.status === 'trial_expirado') {
        mostrarTelaBloqueio('trial_expirado');
      } else if (res.data.bloqueio_assinatura_vencida) {
        mostrarTelaBloqueio('assinatura_vencida');
      } else {
        document.getElementById('tela-trial-expirado').style.display = 'none';
        document.getElementById('tela-dashboard').style.display = 'flex';
        renderizarBlocoPlano(res.data);
      }
      if (res.data.boas_vindas_pendente) {
        abrirModalBoasVindas(res.data);
      }
    })
    .catch(function() {});
  }

  // Modal de boas-vindas do primeiro acesso (só admin/diretoria, que são os
  // únicos papéis com acesso a GET /plano). "Já viu" fica gravado no banco
  // (usuarios.boas_vindas_visto_em), não em localStorage, pra não reaparecer
  // ao trocar de navegador/limpar cache.
  function abrirModalBoasVindas(d) {
    document.getElementById('boas-vindas-titulo').textContent =
      'Bem-vindo' + (estado.nome ? ', ' + estado.nome.split(' ')[0] : '') + '!';
    document.getElementById('boas-vindas-nome-associacao').textContent = d.nome_associacao || '—';
    document.getElementById('boas-vindas-plano').textContent = ROTULOS_PLANO[d.plano] || d.plano;
    document.getElementById('boas-vindas-limite').textContent =
      d.limite_associados == null ? 'Ilimitado' : d.limite_associados + ' associados';

    var linhaTrial = document.getElementById('boas-vindas-trial-linha');
    if (d.plano === 'trial' && d.trial_expira_em) {
      var diasRestantes = Math.max(0, Math.ceil((new Date(d.trial_expira_em) - new Date()) / 86400000));
      document.getElementById('boas-vindas-trial').textContent =
        diasRestantes + (diasRestantes === 1 ? ' dia restante' : ' dias restantes');
      linhaTrial.style.display = 'flex';
    } else {
      linhaTrial.style.display = 'none';
    }

    document.getElementById('overlay-modal-boas-vindas').style.display = 'flex';
  }

  document.getElementById('btn-comecar-usar-plataforma').onclick = function() {
    document.getElementById('overlay-modal-boas-vindas').style.display = 'none';
    fetch(API_URL + '/auth/boas-vindas-visto', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + estado.token }
    }).catch(function() {});
  };

  // Classe de destaque crescente conforme o nível vindo de GET /plano
  // (d.alerta.nivel: 'atencao'/'alerta'/'critico') -- ver utils/precos.js
  // (alertaAssinatura) no backend. '' quando não há alerta (fora da janela
  // configurada, ver item de sprint 1.4).
  function classeAlertaPlano(alerta) {
    if (!alerta) return '';
    return ' alerta-' + alerta.nivel;
  }

  function renderizarBlocoPlano(d) {
    var bloco = document.getElementById('bloco-plano-dashboard');
    bloco.style.display = 'block';
    var alerta = d.alerta;

    if (d.plano === 'trial') {
      var tituloTrial = 'Você está utilizando o Plano Trial';
      var infoTrial = 'Data de expiração: <strong>' + new Date(d.trial_expira_em).toLocaleDateString('pt-BR') + '</strong>. Após esse período será necessário contratar um plano para continuar utilizando a plataforma.';
      if (alerta) {
        tituloTrial = '⚠️ Sua avaliação termina em ' + alerta.dias_restantes + (alerta.dias_restantes === 1 ? ' dia' : ' dias');
        infoTrial = 'Evite a suspensão do acesso à plataforma contratando um plano antes do fim do período de avaliação.';
      }
      bloco.innerHTML =
        '<div class="card-plano trial' + classeAlertaPlano(alerta) + '">' +
          '<div>' +
            '<div class="card-plano-titulo">' + tituloTrial + '<span class="badge-plano">Trial</span></div>' +
            '<div class="card-plano-contador" id="contador-trial"></div>' +
            '<div class="card-plano-info">' + infoTrial + '</div>' +
          '</div>' +
          (estado.papel === 'admin' ? '<button class="btn" id="btn-contratar-dashboard">Contratar Plano</button>' : '') +
        '</div>';
      if (estado.papel === 'admin') {
        document.getElementById('btn-contratar-dashboard').onclick = function() { abrirModalContratarPlano(); };
      }
      iniciarContadorTrial(d.trial_expira_em);
      return;
    }

    pararContadorTrial();
    var rotulosStatus = { ativa: 'Plano ativo', vencendo: 'Vencendo em breve', vencida: 'Vencida', bloqueada: 'Bloqueado' };
    var info = INFO_PLANO[d.plano] || { nome: d.plano, porte: '' };

    // Dias restantes até o vencimento, mostrado sempre (card do Dashboard,
    // item 8, 30/07/2026) -- antes só aparecia embutido na mensagem quando
    // já dentro da janela de alerta.
    var diasVencimento = null;
    if (d.vencimento_assinatura) {
      diasVencimento = Math.round((new Date(d.vencimento_assinatura).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    }

    var tituloPago = 'Seu Plano Atual';
    var infoPago = info.porte + '<br>' +
      'Status: <strong>' + (rotulosStatus[d.status] || d.status) + '</strong> · ' +
      'Próxima renovação: <strong>' + (d.vencimento_assinatura ? new Date(d.vencimento_assinatura).toLocaleDateString('pt-BR') : '—') +
      (diasVencimento != null ? ' (' + (diasVencimento < 0 ? 'venceu há ' + Math.abs(diasVencimento) + 'd' : diasVencimento + 'd restantes') + ')' : '') + '</strong> · ' +
      'Mensalidade: <strong>' + formatarMoeda(d.valor_mensalidade) + '</strong>';
    if (alerta) {
      tituloPago = alerta.dias_restantes <= 0
        ? '⚠️ Sua assinatura venceu' + (alerta.dias_restantes < 0 ? ' há ' + Math.abs(alerta.dias_restantes) + (Math.abs(alerta.dias_restantes) === 1 ? ' dia' : ' dias') : ' hoje')
        : '⚠️ Sua assinatura vence em ' + alerta.dias_restantes + (alerta.dias_restantes === 1 ? ' dia' : ' dias');
      infoPago = 'Evite a suspensão do acesso à plataforma realizando a renovação antes da data de vencimento.';
    }

    // Barra de uso + aviso por faixa (80/90/100%, item 2/3, 30/07/2026) --
    // substitui o aviso único de "perto do limite" por algo com as 3 faixas
    // e, no crítico, a sugestão automática de upgrade.
    var blocoUso = '';
    if (d.limite_associados != null) {
      var pct = Math.min(100, Math.round((d.total_associados / d.limite_associados) * 100));
      var nivelBarra = d.alerta_limite ? d.alerta_limite.nivel : '';
      blocoUso =
        '<div class="card-plano-info" style="margin-top:8px;">Associados: <strong>' + d.total_associados + ' / ' + d.limite_associados + '</strong></div>' +
        '<div class="barra-uso-plano"><div class="barra-uso-plano-preenchida' + (nivelBarra ? ' nivel-' + nivelBarra : '') + '" style="width:' + pct + '%;"></div></div>';

      if (d.alerta_limite) {
        var acoesLimite = '';
        if (d.alerta_limite.nivel === 'critico') {
          if (d.proximo_plano) {
            var proximoInfo = INFO_PLANO[d.proximo_plano] || { nome: d.proximo_plano };
            acoesLimite = '<div class="aviso-limite-acoes">' +
              '<button class="btn btn-ghost btn-pequeno" id="btn-conhecer-proximo-plano">Conhecer Plano ' + proximoInfo.nome + '</button>' +
              '<button class="btn btn-pequeno" id="btn-realizar-upgrade-limite">Realizar Upgrade</button>' +
            '</div>';
          } else {
            acoesLimite = '<div style="margin-top:4px;">Seu plano já é o mais completo disponível.</div>';
          }
        }
        blocoUso += '<div class="aviso-limite nivel-' + d.alerta_limite.nivel + '">' + d.alerta_limite.mensagem + acoesLimite + '</div>';
      }
    }

    // Botão(ões) principal(is) -- dois botões de renovação quando há alerta
    // de vencimento (item 5), senão um botão só cujo rótulo/ação varia
    // conforme o plano (item 4: avançado não tem "Gerenciar Plano", só
    // renovação direta via "Pagar Plano").
    var botoesAcao = '';
    if (estado.papel === 'admin') {
      if (alerta) {
        botoesAcao = '<div class="card-plano-acoes">' +
          '<button class="btn" id="btn-pagar-agora-plano">Pagar Agora</button>' +
          '<button class="btn btn-ghost" id="btn-ver-detalhes-plano">Ver Detalhes do Plano</button>' +
        '</div>';
      } else {
        var rotuloBotao = d.plano === 'avancado' ? 'Pagar Plano' : 'Gerenciar Plano';
        botoesAcao = '<button class="btn btn-ghost" id="btn-gerenciar-plano">' + rotuloBotao + '</button>';
      }
    }

    bloco.innerHTML =
      '<div class="card-plano pago' + classeAlertaPlano(alerta) + '">' +
        '<div>' +
          '<div class="card-plano-titulo">' + tituloPago + '<span class="badge-plano">' + info.nome + '</span></div>' +
          '<div class="card-plano-info">' + infoPago + '</div>' +
          blocoUso +
        '</div>' +
        botoesAcao +
      '</div>';

    if (estado.papel === 'admin') {
      if (alerta) {
        document.getElementById('btn-pagar-agora-plano').onclick = function() {
          abrirModalContratarPlano(d.plano_renovacao_sugerido || d.plano);
        };
        document.getElementById('btn-ver-detalhes-plano').onclick = function() { abrirModalContratarPlano(); };
      } else {
        document.getElementById('btn-gerenciar-plano').onclick = function() {
          abrirModalContratarPlano(d.plano === 'avancado' ? 'avancado' : null);
        };
      }
      if (d.alerta_limite && d.alerta_limite.nivel === 'critico' && d.proximo_plano) {
        document.getElementById('btn-conhecer-proximo-plano').onclick = function() {
          abrirModalContratarPlano();
          selecionarOpcaoPlano(d.proximo_plano);
        };
        document.getElementById('btn-realizar-upgrade-limite').onclick = function() {
          abrirModalContratarPlano(d.proximo_plano);
        };
      }
    }

    // Desabilita proativamente o "+ Novo associado" quando o limite já foi
    // atingido -- só cobre admin/diretoria (únicos que carregam esse card);
    // o bloqueio de verdade (item 7) é sempre o 403 do backend, isso é só
    // evitar abrir o formulário pra descobrir o erro depois.
    var btnNovoAssociado = document.getElementById('btn-novo-associado');
    if (btnNovoAssociado && btnNovoAssociado.style.display !== 'none') {
      var limiteAtingido = d.alerta_limite && d.alerta_limite.nivel === 'critico';
      btnNovoAssociado.disabled = !!limiteAtingido;
      btnNovoAssociado.title = limiteAtingido ? 'Limite de associados do plano atingido -- faça upgrade para cadastrar mais' : '';
    }
  }

  // Contador ao vivo (dias/horas/minutos) -- atualiza a cada minuto, não
  // precisa de segundo em segundo pra essa granularidade.
  function iniciarContadorTrial(trialExpiraEm) {
    pararContadorTrial();
    function atualizar() {
      var el = document.getElementById('contador-trial');
      if (!el) { pararContadorTrial(); return; }
      var diffMs = new Date(trialExpiraEm) - new Date();
      if (diffMs <= 0) {
        pararContadorTrial();
        carregarPlano();
        return;
      }
      var dias = Math.floor(diffMs / 86400000);
      var horas = Math.floor((diffMs % 86400000) / 3600000);
      var minutos = Math.floor((diffMs % 3600000) / 60000);
      el.innerHTML =
        '<div class="unidade"><div class="num">' + dias + '</div><div class="rot">dias</div></div>' +
        '<div class="unidade"><div class="num">' + horas + '</div><div class="rot">horas</div></div>' +
        '<div class="unidade"><div class="num">' + minutos + '</div><div class="rot">min</div></div>';
    }
    atualizar();
    intervaloContadorTrial = setInterval(atualizar, 60000);
  }
  function pararContadorTrial() {
    if (intervaloContadorTrial) { clearInterval(intervaloContadorTrial); intervaloContadorTrial = null; }
  }

  // Mesma tela/CSS pros dois motivos de bloqueio (trial vencido ou
  // assinatura paga vencida além da tolerância, SEC-015) -- só o texto
  // muda, via os ids adicionados no <h2>/<p> (painel/index.html).
  var TEXTOS_BLOQUEIO_ACESSO = {
    trial_expirado: {
      titulo: 'Seu período de avaliação terminou',
      texto: 'Todos os dados da sua associação foram preservados. Para continuar usando a plataforma, contrate um dos planos abaixo.',
    },
    assinatura_vencida: {
      titulo: 'Sua assinatura está vencida',
      texto: 'Todos os dados da sua associação foram preservados. Regularize o pagamento para continuar usando a plataforma.',
    },
  };
  function mostrarTelaBloqueio(motivo) {
    pararContadorTrial();
    var t = TEXTOS_BLOQUEIO_ACESSO[motivo] || TEXTOS_BLOQUEIO_ACESSO.trial_expirado;
    document.getElementById('titulo-bloqueio-acesso').textContent = t.titulo;
    document.getElementById('texto-bloqueio-acesso').textContent = t.texto;
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-trial-expirado').style.display = 'flex';
  }
  document.getElementById('btn-contratar-trial-expirado').onclick = function() { abrirModalContratarPlano(); };

  // ---------- Modal Contratar/Trocar de plano ----------
  // planoPreSelecionado (novo, item 4/5, 30/07/2026): quando informado,
  // pula direto pra tela de pagamento com esse plano já escolhido -- usado
  // por "Pagar Agora"/"Pagar Plano"/"Realizar Upgrade", que já sabem qual
  // plano usar e não precisam passar pela grade de escolha.
  function abrirModalContratarPlano(planoPreSelecionado) {
    if (estado.papel !== 'admin') return;
    planoEscolhidoContratacao = null;
    comprovantePlanoSelecionadoBase64 = null;
    document.getElementById('bloco-escolha-plano').style.display = 'block';
    document.getElementById('bloco-pagamento-plano').style.display = 'none';
    document.getElementById('btn-enviar-comprovante-plano').style.display = 'none';
    document.getElementById('erro-contratar-plano').style.display = 'none';
    document.getElementById('nome-arquivo-comprovante-plano').textContent = '';
    document.getElementById('aviso-renovacao-inteligente').style.display = 'none';

    if (planoAtualDados && planoAtualDados.solicitacao_pendente) {
      var s = planoAtualDados.solicitacao_pendente;
      document.getElementById('bloco-escolha-plano').innerHTML =
        '<p style="font-size:14px; line-height:1.6;">Você já enviou uma solicitação de contratação do plano <strong>' +
        (ROTULOS_PLANO[s.plano_solicitado] || s.plano_solicitado) + '</strong> em ' +
        new Date(s.solicitado_em).toLocaleDateString('pt-BR') + '. Aguarde a aprovação do pagamento.</p>';
    } else {
      renderizarOpcoesPlano();
      renderizarAvisoRenovacaoInteligente();
      if (planoPreSelecionado) {
        selecionarOpcaoPlano(planoPreSelecionado);
        avancarParaPagamentoPlano();
      }
    }

    document.getElementById('overlay-modal-contratar-plano').style.display = 'flex';
  }

  // Renovação inteligente (item 6, 30/07/2026): avisa quando a associação
  // cresceu além do limite do plano atual e reoferece continuar com o plano
  // sugerido em vez do atual, ou ver a grade de comparação normal.
  function renderizarAvisoRenovacaoInteligente() {
    var container = document.getElementById('aviso-renovacao-inteligente');
    var d = planoAtualDados;
    if (!d || !d.plano_renovacao_sugerido) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    var infoAtual = INFO_PLANO[d.plano] || { nome: d.plano };
    var infoSugerido = INFO_PLANO[d.plano_renovacao_sugerido] || { nome: d.plano_renovacao_sugerido };
    container.innerHTML =
      '<div class="aviso-limite nivel-alerta" style="margin-top:0; margin-bottom:14px;">' +
        'Sua associação possui ' + d.total_associados + ' associados cadastrados. O Plano ' + infoAtual.nome +
        ' não atende mais sua necessidade. Na renovação será utilizado o Plano ' + infoSugerido.nome + '.' +
        '<div class="aviso-limite-acoes">' +
          '<button class="btn btn-pequeno" id="btn-continuar-renovacao-sugerida">Continuar Renovação</button>' +
          '<button class="btn btn-ghost btn-pequeno" id="btn-ver-comparativo-planos">Ver Comparativo dos Planos</button>' +
        '</div>' +
      '</div>';
    container.style.display = 'block';
    document.getElementById('btn-continuar-renovacao-sugerida').onclick = function() {
      selecionarOpcaoPlano(d.plano_renovacao_sugerido);
      avancarParaPagamentoPlano();
    };
    document.getElementById('btn-ver-comparativo-planos').onclick = function() {
      container.style.display = 'none';
    };
  }

  function renderizarOpcoesPlano() {
    var totalAssociados = (planoAtualDados && planoAtualDados.total_associados) || 0;
    var container = document.getElementById('opcoes-plano');
    var html = '';
    var planosParaExibir = (planoAtualDados && planoAtualDados.planos_gerenciaveis) || ['basico', 'intermediario', 'avancado'];
    planosParaExibir.forEach(function(chave) {
      var info = INFO_PLANO[chave];
      var precos = PRECOS_PLANO[chave];
      var valorComAtual = precos.base + precos.porAssociado * totalAssociados;
      html += '<div class="opcao-plano" data-plano="' + chave + '" data-acao="selecionarOpcaoPlano" data-id="' + chave + '">' +
        '<div class="opcao-plano-topo"><span class="opcao-plano-nome">' + info.nome + '</span><span class="opcao-plano-preco">' + formatarMoeda(precos.base) + '/mês</span></div>' +
        '<div class="opcao-plano-porte">' + info.porte + '</div>' +
        '<div class="opcao-plano-simulacao">+ ' + formatarMoeda(precos.porAssociado) + ' por associado ativo' +
        (totalAssociados > 0 ? ' — com ' + totalAssociados + ' associados hoje: ' + formatarMoeda(valorComAtual) + '/mês' : '') +
        '</div>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  function selecionarOpcaoPlano(chave) {
    planoEscolhidoContratacao = chave;
    document.querySelectorAll('.opcao-plano').forEach(function(el) {
      el.classList.toggle('selecionada', el.getAttribute('data-plano') === chave);
    });
  }

  // Extraída pra função nomeada (30/07/2026) pra poder ser chamada tanto
  // pelo clique normal quanto programaticamente quando um plano já vem
  // pré-selecionado (ver abrirModalContratarPlano/renderizarAvisoRenovacaoInteligente).
  function avancarParaPagamentoPlano() {
    var erroEl = document.getElementById('erro-contratar-plano');
    erroEl.style.display = 'none';
    if (!planoEscolhidoContratacao) {
      erroEl.textContent = 'Escolha um plano para continuar';
      erroEl.style.display = 'block';
      return;
    }

    var totalAssociados = (planoAtualDados && planoAtualDados.total_associados) || 0;
    var precos = PRECOS_PLANO[planoEscolhidoContratacao];
    var valor = precos.base + precos.porAssociado * totalAssociados;

    var pix = (planoAtualDados && planoAtualDados.pix_plataforma) || {};
    if (!pix.chave_pix) {
      erroEl.textContent = 'A plataforma ainda não configurou uma chave Pix. Fale com o suporte para contratar.';
      erroEl.style.display = 'block';
      return;
    }

    document.getElementById('texto-valor-plano-escolhido').textContent = formatarMoeda(valor);
    var payload = gerarPayloadPix(pix, valor, 'PLANO' + planoEscolhidoContratacao.toUpperCase());
    renderizarQrCode('pix-qrcode-container-plano', payload);
    document.getElementById('pix-copia-cola-plano').value = payload;

    document.getElementById('bloco-escolha-plano').style.display = 'none';
    document.getElementById('bloco-pagamento-plano').style.display = 'block';
    document.getElementById('btn-enviar-comprovante-plano').style.display = 'inline-block';
  }
  document.getElementById('btn-avancar-pagamento-plano').onclick = avancarParaPagamentoPlano;

  document.getElementById('btn-copiar-pix-plano').onclick = function() {
    var campo = document.getElementById('pix-copia-cola-plano');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Código Pix copiado!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  document.getElementById('btn-selecionar-comprovante-plano').onclick = function() {
    document.getElementById('input-comprovante-plano').click();
  };

  document.getElementById('input-comprovante-plano').onchange = function(e) {
    var arquivo = e.target.files[0];
    if (!arquivo) return;
    document.getElementById('nome-arquivo-comprovante-plano').textContent = arquivo.name;

    if (arquivo.type === 'application/pdf') {
      var leitorPdf = new FileReader();
      leitorPdf.onload = function(evt) { comprovantePlanoSelecionadoBase64 = evt.target.result; };
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
        comprovantePlanoSelecionadoBase64 = canvas.toDataURL('image/jpeg', 0.85);
      };
      img.src = evt.target.result;
    };
    leitor.readAsDataURL(arquivo);
  };

  document.getElementById('btn-enviar-comprovante-plano').onclick = function() {
    var erroEl = document.getElementById('erro-contratar-plano');
    erroEl.style.display = 'none';
    if (!comprovantePlanoSelecionadoBase64) {
      erroEl.textContent = 'Escolha o arquivo do comprovante antes de enviar';
      erroEl.style.display = 'block';
      return;
    }

    fetch(API_URL + '/plano/solicitar-contratacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + estado.token },
      body: JSON.stringify({ plano_solicitado: planoEscolhidoContratacao, comprovante_base64: comprovantePlanoSelecionadoBase64 })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        erroEl.textContent = res.data.erro || 'Erro ao enviar comprovante';
        erroEl.style.display = 'block';
        return;
      }
      document.getElementById('overlay-modal-contratar-plano').style.display = 'none';
      mostrarToast('Comprovante enviado! Aguarde a aprovação do pagamento.');
      carregarPlano();
    })
    .catch(function() {
      erroEl.textContent = 'Erro ao enviar comprovante';
      erroEl.style.display = 'block';
    });
  };

  document.getElementById('btn-fechar-modal-contratar-plano').onclick = function() {
    document.getElementById('overlay-modal-contratar-plano').style.display = 'none';
  };

  // ---------- Tema ----------
  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    document.getElementById('icone-tema-claro').style.display = tema === 'dark' ? 'none' : '';
    document.getElementById('icone-tema-escuro').style.display = tema === 'dark' ? '' : 'none';
    document.getElementById('texto-menu-tema').textContent = tema === 'dark' ? 'Tema Claro' : 'Tema Escuro';
    localStorage.setItem('tema-preferido', tema);
  }
  var temaSalvo = localStorage.getItem('tema-preferido') || 'light';
  aplicarTema(temaSalvo);

  document.getElementById('btn-menu-tema').onclick = function() {
    var atual = document.documentElement.getAttribute('data-theme');
    aplicarTema(atual === 'dark' ? 'light' : 'dark');
    if (associadosCache.length) atualizarGraficosAssociados(associadosCache);
    if (cobrancasCache.length) atualizarDashboardFinanceiro(cobrancasCache);
  };

  // ---------- Toast ----------
  function mostrarToast(mensagem, erro) {
    var toast = document.getElementById('toast');
    toast.textContent = mensagem;
    toast.className = 'toast show' + (erro ? ' erro' : '');
    setTimeout(function() { toast.className = 'toast'; }, 3000);
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

  // Espelha a política de senha forte do backend, só para dar feedback rápido
  // (o backend valida de novo e é quem manda de verdade).
  function senhaForteClient(senha) {
    return !!senha && senha.length >= 8 && /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /[0-9]/.test(senha);
  }

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
  var PAPEL_LABEL = {
    admin: 'Administrador', diretoria: 'Diretoria', associado: 'Associado',
    financeiro: 'Financeiro', atendimento: 'Atendimento', operador: 'Operador', consulta: 'Somente Consulta',
  };

  // Matriz de permissões dos perfis granulares (item 5 do backlog de
  // sugestões, 28/07/2026) -- espelha exatamente o que o backend já
  // impõe em cada autorizar(...) de routes/*.js. Isso é só UX (esconder
  // botão que ia dar 403); a segurança de verdade já está no backend,
  // então uma divergência aqui só mostraria/esconderia um botão errado,
  // nunca abriria uma brecha.
  var PERMISSOES = {
    associados_criar: ['admin', 'diretoria', 'atendimento', 'operador'],
    associados_editar: ['admin', 'diretoria', 'atendimento', 'operador'],
    associados_excluir: ['admin'],
    cobrancas_criar: ['admin', 'diretoria', 'financeiro', 'operador'],
    cobrancas_editar: ['admin', 'diretoria', 'financeiro', 'operador'],
    cobrancas_pagar: ['admin', 'diretoria', 'financeiro', 'operador'],
    cobrancas_estornar: ['admin'],
    cobrancas_excluir: ['admin'],
    comunicados_criar: ['admin', 'diretoria', 'atendimento', 'operador'],
    comunicados_editar: ['admin', 'diretoria', 'atendimento', 'operador'],
    comunicados_excluir: ['admin', 'diretoria', 'atendimento', 'operador'],
  };
  function podeFazer(acao) {
    var permitidos = PERMISSOES[acao];
    return !permitidos || permitidos.indexOf(estado.papel) !== -1;
  }

  // Perfis de acesso granulares (Financeiro/Atendimento/Operador/Somente
  // Consulta) exigem plano Intermediário+ (gating por plano, 29/07/2026).
  // Grandfathering: se estiver editando um usuário que JÁ tem um desses
  // papéis, a opção continua disponível pra não obrigar a trocar de papel
  // só por causa dessa mudança — o backend também só bloqueia atribuir um
  // papel granular NOVO, nunca desfaz um já existente (ver PAPEIS_GRANULARES
  // em backend/routes/usuarios.js).
  var PAPEIS_GRANULARES = ['financeiro', 'atendimento', 'operador', 'consulta'];
  var LABEL_ORIGINAL_PAPEL = {};
  (function capturarLabelsOriginaisPapel() {
    var select = document.getElementById('usuario-papel');
    Array.prototype.forEach.call(select.options, function(opt) {
      LABEL_ORIGINAL_PAPEL[opt.value] = opt.textContent;
    });
  })();
  function atualizarOpcoesPapelUsuario(papelAtualSendoEditado) {
    var select = document.getElementById('usuario-papel');
    var podeAtribuirGranular = planoAtende('intermediario');
    Array.prototype.forEach.call(select.options, function(opt) {
      if (PAPEIS_GRANULARES.indexOf(opt.value) === -1) return;
      var eEssePapelJaAtribuido = papelAtualSendoEditado && opt.value === papelAtualSendoEditado;
      var bloqueado = !podeAtribuirGranular && !eEssePapelJaAtribuido;
      opt.disabled = bloqueado;
      opt.textContent = LABEL_ORIGINAL_PAPEL[opt.value] + (bloqueado ? ' (requer plano Intermediário+)' : '');
    });
  }

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
    document.getElementById('app-header-email').textContent = estado.email || '';
    document.getElementById('app-header-nome').textContent = estado.nome || 'Usuário';
    document.getElementById('app-header-papel').textContent = PAPEL_LABEL[estado.papel] || '';
    document.getElementById('app-header-avatar').textContent = iniciaisNome(estado.nome);
  }

  // Identidade da própria associação (nome + logo), usada só no cabeçalho do
  // Dashboard -- ali a saudação com nome/e-mail do administrador dá lugar a
  // "Você está no painel da associação X", já que nome/e-mail do
  // administrador já aparecem em Meu Perfil (sem precisar repetir aqui).
  function carregarIdentidadeAssociacao() {
    fetch(API_URL + '/configuracoes/identidade', { headers: { 'Authorization': 'Bearer ' + estado.token } })
    .then(function(resp) { return resp.json(); })
    .then(function(dados) {
      estado.nomeAssociacao = dados.nome || '';
      estado.logoAssociacao = dados.logo_url || '';
      if (document.getElementById('aba-dashboard').classList.contains('ativa')) {
        atualizarHeaderDashboard(true);
      }
    })
    .catch(function() {});
  }

  // Alterna o cabeçalho entre o modo "Dashboard" (logo + nome da associação)
  // e o modo normal (saudação + nome/e-mail do administrador, usado em
  // qualquer outra aba).
  function atualizarHeaderDashboard(exibir) {
    var logoEl = document.getElementById('app-header-logo-associacao');
    if (exibir) {
      if (estado.logoAssociacao && RE_DATA_URL_SEGURA.test(estado.logoAssociacao)) {
        logoEl.src = estado.logoAssociacao;
        logoEl.style.display = 'block';
      } else {
        logoEl.style.display = 'none';
      }
      document.getElementById('app-header-saudacao').textContent =
        'Você está no painel da associação "' + (estado.nomeAssociacao || '') + '".';
      document.getElementById('app-header-email').style.display = 'none';
    } else {
      logoEl.style.display = 'none';
      document.getElementById('app-header-email').style.display = '';
      renderizarHeader();
    }
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
  function carregarMeuPerfil() {
    document.getElementById('perfil-avatar').textContent = iniciaisNome(estado.nome);
    document.getElementById('perfil-nome').textContent = estado.nome || 'Usuário';
    document.getElementById('perfil-papel').textContent = PAPEL_LABEL[estado.papel] || '';
    document.getElementById('perfil-email').value = estado.email || '';
  }

  document.getElementById('btn-perfil-alterar-senha').onclick = function() { abrirModalAlterarSenha(); };

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

  document.getElementById('btn-menu-meu-perfil').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    ativarAba('meu-perfil');
    carregarMeuPerfil();
  };
  document.getElementById('btn-menu-preferencias').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    ativarAba('parametrizacao');
    carregarConfigLogo();
    carregarConfigPix();
    carregarConfigAlertas();
  };
  document.getElementById('btn-menu-alterar-senha').onclick = function() {
    document.getElementById('dropdown-perfil').classList.remove('aberto');
    abrirModalAlterarSenha();
  };

  function entrarNoDashboard() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-esqueci-senha').style.display = 'none';
    document.getElementById('tela-trocar-senha-obrigatoria').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'flex';
    renderizarHeader();

    if (estado.papel === 'admin') {
      document.getElementById('aba-acessos').style.display = 'flex';
      document.getElementById('btn-menu-preferencias').style.display = 'flex';
    } else {
      document.getElementById('btn-menu-preferencias').style.display = 'none';
    }
    // Auditoria completa é recurso exclusivo do plano Avançado (gating por
    // plano, 29/07/2026) -- ver GET /auditoria (backend/routes/auditoria.js).
    document.getElementById('btn-aba-acessos-auditoria').style.display = planoAtende('avancado') ? '' : 'none';
    document.getElementById('btn-novo-associado').style.display = podeFazer('associados_criar') ? 'flex' : 'none';
    document.getElementById('btn-nova-cobranca').style.display = podeFazer('cobrancas_criar') ? 'flex' : 'none';
    document.getElementById('btn-novo-comunicado').style.display = podeFazer('comunicados_criar') ? 'flex' : 'none';
    ativarAba('dashboard');
    carregarIdentidadeAssociacao();
    carregarAssociados();
    carregarCobrancas();
    carregarComunicados();
    carregarAtividades();
    carregarPlano();
  }

  function salvarSessao() {
    localStorage.setItem('sessao_painel', JSON.stringify({
      token: estado.token,
      papel: estado.papel,
      nome: estado.nome
    }));
  }

  function limparSessao() {
    localStorage.removeItem('sessao_painel');
  }

  // Ao carregar a página, tenta restaurar a sessão salva (evita logout ao atualizar/F5)
  (function restaurarSessao() {
    if (tokenRedefinicao) return;
    var salva = localStorage.getItem('sessao_painel');
    if (!salva) return;

    try {
      var dados = JSON.parse(salva);
      if (!dados.token || !dados.papel) return;
      if (dados.papel === 'associado') {
        // Sessão de associado salva antes da separação do Portal do Associado
        // (portal.html) — não é mais válida nesse arquivo.
        limparSessao();
        return;
      }

      estado.token = dados.token;
      estado.papel = dados.papel;
      estado.nome = dados.nome || '';
      estado.email = decodificarEmailDoToken(dados.token);
      estado.plano = decodificarPlanoDoToken(dados.token);

      // Valida o token com uma chamada leve antes de assumir a sessão como válida
      fetch(API_URL + '/configuracoes/pix', {
        headers: { 'Authorization': 'Bearer ' + estado.token },
        cache: 'no-store'
      })
      .then(function(resp) {
        if (!resp.ok && resp.status === 401) {
          limparSessao();
          return;
        }
        entrarNoDashboard();
      })
      .catch(function() {
        // Sem conexão momentânea — mantém a sessão e tenta mostrar o dashboard mesmo assim
        entrarNoDashboard();
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
      if (res.data.usuario.papel === 'associado') {
        erroEl.textContent = 'Esta é a área da diretoria. Associados devem acessar pelo Portal do Associado (portal.html).';
        erroEl.style.display = 'block';
        return;
      }

      estado.token = res.data.token;
      estado.papel = res.data.usuario.papel;
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
      entrarNoDashboard();
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
      document.getElementById('tela-trocar-senha-obrigatoria').style.display = 'none';
      salvarSessao();
      entrarNoDashboard();
      mostrarToast('Senha definida com sucesso!');
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
    estado.papel = null;
    limparSessao();
    pararContadorTrial();
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-trial-expirado').style.display = 'none';
    document.getElementById('tela-login').style.display = 'block';
  }
  document.getElementById('btn-sair').onclick = fazerLogout;
  document.getElementById('link-sair-trial-expirado').onclick = function(e) {
    e.preventDefault();
    fazerLogout();
  };

  // ---------- Carregar associados ----------
  function carregarAssociados() {
    fetch(API_URL + '/associados', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) { renderizarTabela(lista); })
    .catch(function() { mostrarToast('Erro ao carregar associados', true); });
  }

  var filtroStatusAtivo = '';

  function renderizarTabela(lista) {
    associadosCache = lista;
    document.getElementById('kpi-total').textContent = lista.length;
    document.getElementById('kpi-ativos').textContent = lista.filter(function(a) { return a.status === 'ativo'; }).length;
    document.getElementById('kpi-inadimplentes').textContent = lista.filter(function(a) { return a.status === 'inadimplente'; }).length;
    atualizarGraficosAssociados(lista);
    atualizarUltimosAssociados(lista);
    aplicarFiltroAssociados();
  }

  function coresGrafico() {
    var estiloEscuro = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      grade: estiloEscuro ? '#2a2a2a' : '#E4E0D2',
      texto: estiloEscuro ? '#888888' : '#6B6558',
      linha: '#C9A84C',
      secundaria: estiloEscuro ? '#4a4a4a' : '#D8D2BE'
    };
  }

  var MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  // Local (não UTC), evita o mesmo deslocamento de fuso já documentado para
  // buckets diários (ver chaveDataLocal do gráfico de 7 dias que existia
  // antes) — aqui o Date é sempre construído com ano/mês locais, nunca
  // parseado de uma string ISO, então não sofre esse problema.
  function chaveMesLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function ultimosNMeses(n) {
    var hoje = new Date();
    var meses = [];
    for (var i = n - 1; i >= 0; i--) {
      meses.push(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1));
    }
    return meses;
  }

  function renderizarKpiDelta(elId, atual, anterior, moeda) {
    var el = document.getElementById(elId);
    if (!el) return;
    var diff = atual - anterior;
    if (diff === 0) {
      el.textContent = '— igual ao mês anterior';
      el.className = 'kpi-delta neutro';
      return;
    }
    var seta = diff > 0 ? '▲' : '▼';
    var valorTexto = moeda ? formatarMoeda(Math.abs(diff)) : Math.abs(diff);
    el.textContent = seta + ' ' + valorTexto + ' vs mês anterior';
    el.className = 'kpi-delta ' + (diff > 0 ? 'up' : 'down');
  }

  function formatarMoeda(valor) {
    return 'R$ ' + parseFloat(valor || 0).toFixed(2).replace('.', ',');
  }

  var graficoCrescimento = null;
  var graficoNovosPorMes = null;

  function atualizarGraficosAssociados(lista) {
    var meses = ultimosNMeses(12);
    var chaves = meses.map(chaveMesLocal);
    var labels = meses.map(function(d) { return MESES_PT[d.getMonth()] + '/' + String(d.getFullYear()).slice(2); });

    var novosPorMes = chaves.map(function(chave) {
      return lista.filter(function(a) { return a.data_ingresso && a.data_ingresso.substring(0, 7) === chave; }).length;
    });
    // Total acumulado até o fim de cada mês (comparação de string YYYY-MM
    // funciona porque o formato é sempre zero-padded, sem risco de fuso).
    var acumulado = chaves.map(function(chave) {
      return lista.filter(function(a) { return a.data_ingresso && a.data_ingresso.substring(0, 7) <= chave; }).length;
    });

    var novosMesAtual = novosPorMes[novosPorMes.length - 1];
    var novosMesAnterior = novosPorMes[novosPorMes.length - 2] || 0;
    document.getElementById('kpi-novos-mes').textContent = novosMesAtual;
    renderizarKpiDelta('kpi-delta-novos', novosMesAtual, novosMesAnterior, false);

    var totalMesAnterior = acumulado[acumulado.length - 2] || 0;
    renderizarKpiDelta('kpi-delta-total', lista.length, totalMesAnterior, false);

    var cores = coresGrafico();

    if (graficoCrescimento) graficoCrescimento.destroy();
    graficoCrescimento = new Chart(document.getElementById('grafico-crescimento'), {
      type: 'line',
      data: { labels: labels, datasets: [{ data: acumulado, borderColor: cores.linha, backgroundColor: cores.linha, tension: 0.3, pointRadius: 2 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: cores.texto }, grid: { display: false } },
          y: { ticks: { color: cores.texto, precision: 0 }, grid: { color: cores.grade }, beginAtZero: true }
        }
      }
    });

    if (graficoNovosPorMes) graficoNovosPorMes.destroy();
    graficoNovosPorMes = new Chart(document.getElementById('grafico-novos-por-mes'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: novosPorMes, backgroundColor: cores.linha, borderRadius: 6 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: cores.texto }, grid: { display: false } },
          y: { ticks: { color: cores.texto, precision: 0 }, grid: { color: cores.grade }, beginAtZero: true }
        }
      }
    });
  }

  function atualizarUltimosAssociados(lista) {
    var container = document.getElementById('lista-ultimos-associados-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum associado cadastrado ainda.</div>';
      return;
    }
    var ultimos = lista.slice().sort(function(a, b) {
      return (b.data_ingresso || '').localeCompare(a.data_ingresso || '');
    }).slice(0, 5);

    var html = '';
    ultimos.forEach(function(a) {
      html += '<div class="mini-item">' +
        '<div class="avatar-mini">' + iniciaisNome(a.nome_completo) + '</div>' +
        '<div class="mini-item-info">' +
          '<div class="mini-item-nome">' + escapeHtml(a.nome_completo) + '</div>' +
          '<div class="mini-item-sub">' + formatarData(a.data_ingresso) + '</div>' +
        '</div>' +
        '<span class="badge ' + escapeHtml(a.status) + '">' + escapeHtml(a.status) + '</span>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  function aplicarFiltroAssociados() {
    var termo = document.getElementById('busca-associado').value.trim().toLowerCase();
    var statusFiltro = document.getElementById('filtro-status-associado').value;
    var container = document.getElementById('tabela-container');

    var filtrada = associadosCache.filter(function(a) {
      var bateStatus = !statusFiltro || a.status === statusFiltro;
      if (!termo) return bateStatus;

      var termoNumerico = termo.replace(/[^\d]/g, '');
      var nomeBate = a.nome_completo.toLowerCase().indexOf(termo) !== -1;
      var cpfBate = termoNumerico !== '' && (a.cpf || '').replace(/[^\d]/g, '').indexOf(termoNumerico) !== -1;

      return bateStatus && (nomeBate || cpfBate);
    });

    if (associadosCache.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum associado cadastrado ainda.</div>';
      return;
    }
    if (filtrada.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum associado encontrado com esse filtro.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th>Categoria</th><th>Status</th><th>Ingresso</th><th></th></tr></thead><tbody>';
    filtrada.forEach(function(a) {
      html += '<tr>' +
        '<td>' + escapeHtml(a.nome_completo) + (a.observacao ? ' <span title="' + escapeHtml(a.observacao) + '" style="cursor:help; color:var(--text-muted);">📝</span>' : '') + '</td>' +
        '<td>' + escapeHtml(a.cpf || '—') + '</td>' +
        '<td>' + escapeHtml(a.telefone || '—') + '</td>' +
        '<td>' + escapeHtml(a.categoria || '—') + '</td>' +
        '<td><span class="badge ' + escapeHtml(a.status) + '">' + escapeHtml(a.status) + '</span></td>' +
        '<td>' + formatarData(a.data_ingresso) + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-pequeno" data-acao="abrirFichaAssociado" data-id="' + a.id + '" data-arg="ver">Ver ficha</button> ' +
          (podeFazer('associados_editar') ? '<button class="btn-pequeno" data-acao="abrirFichaAssociado" data-id="' + a.id + '" data-arg="editar">Editar</button> ' : '') +
          (podeFazer('associados_excluir') ? '<button class="btn-pequeno" data-acao="excluirAssociado" data-id="' + a.id + '">Excluir</button>' : '') +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  document.getElementById('busca-associado').oninput = aplicarFiltroAssociados;
  document.getElementById('filtro-status-associado').onchange = aplicarFiltroAssociados;

  document.getElementById('kpi-card-total').onclick = function() {
    document.getElementById('filtro-status-associado').value = '';
    document.getElementById('busca-associado').value = '';
    ativarAba('associados');
    aplicarFiltroAssociados();
  };
  document.getElementById('kpi-card-ativos').onclick = function() {
    document.getElementById('filtro-status-associado').value = 'ativo';
    ativarAba('associados');
    aplicarFiltroAssociados();
  };
  document.getElementById('kpi-card-inadimplentes').onclick = function() {
    document.getElementById('filtro-status-associado').value = 'inadimplente';
    ativarAba('associados');
    aplicarFiltroAssociados();
  };
  document.getElementById('kpi-card-vencidas').onclick = function() { ativarAba('financeiro'); carregarCobrancas(); };
  document.getElementById('kpi-card-a-vencer').onclick = function() { ativarAba('financeiro'); carregarCobrancas(); };

  var CAMPOS_TEXTO_FICHA = [
    'novo-nome', 'novo-cpf', 'novo-rg', 'novo-telefone', 'novo-endereco-cep', 'novo-endereco-logradouro',
    'novo-endereco-numero', 'novo-endereco-complemento', 'novo-endereco-bairro', 'novo-endereco-cidade',
    'novo-endereco-estado', 'novo-categoria', 'novo-observacao'
  ];
  // Modo "ver" deixa os campos com readonly (dá pra selecionar/copiar o texto,
  // diferente de disabled) e desabilita o select -- sem esconder nada, só
  // impede edição. Reaproveita o mesmo formulário do modo "editar".
  function definirFichaSomenteLeitura(somenteLeitura) {
    CAMPOS_TEXTO_FICHA.forEach(function(id) { document.getElementById(id).readOnly = somenteLeitura; });
    document.getElementById('novo-status').disabled = somenteLeitura;
    document.getElementById('btn-salvar-associado').style.display = somenteLeitura ? 'none' : '';
    document.getElementById('btn-cancelar-modal').textContent = somenteLeitura ? 'Fechar' : 'Cancelar';
  }

  function abrirFichaAssociado(id, modo) {
    var associado = associadosCache.find(function(a) { return a.id === id; });
    if (!associado) return;
    var somenteLeitura = modo === 'ver';

    document.getElementById('titulo-modal-associado').textContent = somenteLeitura ? 'Ficha do associado' : 'Editar associado';
    document.getElementById('editar-associado-id').value = associado.id;
    document.getElementById('novo-nome').value = associado.nome_completo;
    document.getElementById('novo-cpf').value = associado.cpf || '';
    document.getElementById('novo-rg').value = associado.rg || '';
    document.getElementById('novo-telefone').value = associado.telefone || '';
    document.getElementById('novo-endereco-cep').value = associado.endereco_cep || '';
    document.getElementById('novo-endereco-logradouro').value = associado.endereco_logradouro || '';
    document.getElementById('novo-endereco-numero').value = associado.endereco_numero || '';
    document.getElementById('novo-endereco-complemento').value = associado.endereco_complemento || '';
    document.getElementById('novo-endereco-bairro').value = associado.endereco_bairro || '';
    document.getElementById('novo-endereco-cidade').value = associado.endereco_cidade || '';
    document.getElementById('novo-endereco-estado').value = associado.endereco_estado || '';
    document.getElementById('novo-categoria').value = associado.categoria || '';
    document.getElementById('novo-observacao').value = associado.observacao || '';
    document.getElementById('novo-status').value = associado.status;
    document.getElementById('campo-status-associado').style.display = 'block';
    document.getElementById('campo-novo-email').style.display = 'none';
    document.getElementById('novo-data-cadastro').value = formatarData(associado.data_ingresso);
    document.getElementById('campo-data-cadastro-associado').style.display = 'block';

    definirFichaSomenteLeitura(somenteLeitura);
    document.getElementById('abas-ficha-associado').style.display = 'flex';
    ativarAbaFicha('dados');
    fichaAssociadoAtual = associado;
    document.getElementById('overlay-modal').style.display = 'flex';
  }

  // ---------- Abas da ficha (Dados / Financeiro / Comunicados) ----------
  var fichaAssociadoAtual = null;
  function ativarAbaFicha(aba) {
    ['dados', 'financeiro', 'comunicados'].forEach(function(nome) {
      document.getElementById('conteudo-aba-ficha-' + nome).style.display = nome === aba ? 'block' : 'none';
      document.getElementById('btn-aba-ficha-' + nome).classList.toggle('ativa', nome === aba);
    });
    if (aba === 'financeiro' && fichaAssociadoAtual) carregarFichaFinanceiro(fichaAssociadoAtual.id);
    if (aba === 'comunicados' && fichaAssociadoAtual) carregarFichaComunicados(fichaAssociadoAtual.id, filtroFichaComunicadosAtivo);
  }
  document.getElementById('btn-aba-ficha-dados').onclick = function() { ativarAbaFicha('dados'); };
  document.getElementById('btn-aba-ficha-financeiro').onclick = function() { ativarAbaFicha('financeiro'); };
  document.getElementById('btn-aba-ficha-comunicados').onclick = function() { ativarAbaFicha('comunicados'); };

  // ---------- Aba Financeiro (item de sprint 2.2) ----------
  var fichaFinanceiroCache = [];
  function carregarFichaFinanceiro(associadoId) {
    var container = document.getElementById('lista-ficha-financeiro');
    container.innerHTML = '<div class="vazio">Carregando...</div>';
    fetch(API_URL + '/cobrancas?associado_id=' + associadoId, {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) {
      fichaFinanceiroCache = lista;
      var seletorAno = document.getElementById('filtro-ficha-financeiro-ano');
      var anoSelecionado = seletorAno.value;
      var anos = Array.from(new Set(lista.map(function(c) { return c.vencimento.substring(0, 4); }))).sort().reverse();
      seletorAno.innerHTML = '<option value="">Todos os anos</option>' +
        anos.map(function(a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
      seletorAno.value = anos.indexOf(anoSelecionado) >= 0 ? anoSelecionado : '';
      aplicarFiltroFichaFinanceiro();
    })
    .catch(function() { container.innerHTML = '<div class="vazio">Erro ao carregar histórico financeiro.</div>'; });
  }
  function aplicarFiltroFichaFinanceiro() {
    var status = document.getElementById('filtro-ficha-financeiro-status').value;
    var ano = document.getElementById('filtro-ficha-financeiro-ano').value;
    var filtrada = fichaFinanceiroCache.filter(function(c) {
      if (status && c.status !== status) return false;
      if (ano && c.vencimento.substring(0, 4) !== ano) return false;
      return true;
    });
    var container = document.getElementById('lista-ficha-financeiro');
    if (filtrada.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhuma cobrança encontrada.</div>';
      return;
    }
    var rotulosStatusCobranca = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado', atrasado: 'Vencido', vencendo_em_breve: 'Vencendo em breve' };
    container.innerHTML = filtrada.map(function(c) {
      var statusExibicao = c.status_exibicao || c.status;
      var sub = 'Vencimento: ' + formatarData(c.vencimento) +
        (c.pago_em ? ' · Pago em: ' + formatarData(c.pago_em) : '') +
        (c.metodo ? ' · ' + c.metodo : '');
      return '<div class="item-ficha">' +
        '<div>' +
          '<div class="item-ficha-titulo">' + escapeHtml(c.descricao) + ' — R$ ' + parseFloat(c.valor).toFixed(2).replace('.', ',') + '</div>' +
          '<div class="item-ficha-sub">' + sub + '</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<span class="badge ' + escapeHtml(statusExibicao) + '">' + escapeHtml(rotulosStatusCobranca[statusExibicao] || statusExibicao) + '</span>' +
          (c.tem_comprovante ? '<button class="btn-pequeno" data-acao="abrirComprovante" data-id="' + c.id + '">Comprovante</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }
  document.getElementById('filtro-ficha-financeiro-status').onchange = aplicarFiltroFichaFinanceiro;
  document.getElementById('filtro-ficha-financeiro-ano').onchange = aplicarFiltroFichaFinanceiro;

  // ---------- Aba Comunicados (item de sprint 2.3) ----------
  var filtroFichaComunicadosAtivo = '';
  function carregarFichaComunicados(associadoId, filtro) {
    var container = document.getElementById('lista-ficha-comunicados');
    container.innerHTML = '<div class="vazio">Carregando...</div>';
    var query = filtro === 'lidos' ? '?lido=lidos' : filtro === 'nao_lidos' ? '?lido=nao_lidos' : '';
    fetch(API_URL + '/associados/' + associadoId + '/comunicados' + query, {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(lista) {
      if (lista.length === 0) {
        container.innerHTML = '<div class="vazio">Nenhum comunicado encontrado.</div>';
        return;
      }
      container.innerHTML = lista.map(function(c) {
        var sub = 'Enviado em ' + formatarData(c.publicado_em);
        if (c.lido) {
          sub += ' · Lido em ' + formatarData(c.lido_em);
          var horas = Math.round((new Date(c.lido_em) - new Date(c.publicado_em)) / 3600000);
          if (horas >= 0) {
            sub += ' · levou ' + (horas < 24 ? horas + 'h' : Math.round(horas / 24) + 'd') + ' para visualizar';
          }
        }
        return '<div class="item-ficha">' +
          '<div>' +
            '<div class="item-ficha-titulo">' + escapeHtml(c.titulo) + '</div>' +
            '<div class="item-ficha-sub">' + sub + '</div>' +
          '</div>' +
          '<span class="badge ' + (c.lido ? 'pago' : 'pendente') + '">' + (c.lido ? '✅ Lido' : '⏳ Não lido') + '</span>' +
        '</div>';
      }).join('');
    })
    .catch(function() { container.innerHTML = '<div class="vazio">Erro ao carregar comunicados.</div>'; });
  }
  function selecionarFiltroFichaComunicados(filtro, botaoId) {
    filtroFichaComunicadosAtivo = filtro;
    ['todos', 'lidos', 'nao-lidos'].forEach(function(nome) {
      document.getElementById('btn-filtro-comunicados-' + nome).classList.remove('ativo');
    });
    document.getElementById(botaoId).classList.add('ativo');
    if (fichaAssociadoAtual) carregarFichaComunicados(fichaAssociadoAtual.id, filtro);
  }
  document.getElementById('btn-filtro-comunicados-todos').onclick = function() { selecionarFiltroFichaComunicados('', 'btn-filtro-comunicados-todos'); };
  document.getElementById('btn-filtro-comunicados-lidos').onclick = function() { selecionarFiltroFichaComunicados('lidos', 'btn-filtro-comunicados-lidos'); };
  document.getElementById('btn-filtro-comunicados-nao-lidos').onclick = function() { selecionarFiltroFichaComunicados('nao_lidos', 'btn-filtro-comunicados-nao-lidos'); };

  function excluirAssociado(id) {
    confirmarAcao({
      titulo: 'Excluir associado',
      mensagem: 'Tem certeza que deseja excluir esse associado? Isso também remove as cobranças relacionadas.',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/associados/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao excluir associado', true);
            return;
          }
          mostrarToast('Associado excluído.');
          carregarAssociados();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  // Escapa também as ASPAS, não só < > & (a versão antiga usava
  // textContent->innerHTML, que deixa " e ' passarem intactos). Sem isso o
  // valor fica seguro em contexto de texto mas ESCAPA de um atributo --
  // observacao do associado ia pra title="..." e um payload tipo
  // `x" onmouseover="..."` virava XSS armazenado, rodando na sessão de quem
  // abrisse a lista (com o JWT no localStorage). Ver auditoria de 07/08/2026.
  function escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Modal de confirmação genérico — substitui o confirm() nativo do navegador
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

  function formatarData(iso) {
    if (!iso) return '—';
    var partes = iso.substring(0, 10).split('-');
    return partes[2] + '/' + partes[1] + '/' + partes[0];
  }

  // ---------- Modal novo/editar associado ----------
  document.getElementById('btn-novo-associado').onclick = function() {
    document.getElementById('titulo-modal-associado').textContent = 'Novo associado';
    document.getElementById('editar-associado-id').value = '';
    document.getElementById('novo-nome').value = '';
    document.getElementById('novo-email').value = '';
    document.getElementById('novo-cpf').value = '';
    document.getElementById('novo-rg').value = '';
    document.getElementById('novo-telefone').value = '';
    document.getElementById('novo-endereco-cep').value = '';
    document.getElementById('novo-endereco-logradouro').value = '';
    document.getElementById('novo-endereco-numero').value = '';
    document.getElementById('novo-endereco-complemento').value = '';
    document.getElementById('novo-endereco-bairro').value = '';
    document.getElementById('novo-endereco-cidade').value = '';
    document.getElementById('novo-endereco-estado').value = '';
    document.getElementById('novo-categoria').value = '';
    document.getElementById('novo-observacao').value = '';
    document.getElementById('campo-status-associado').style.display = 'none';
    document.getElementById('campo-novo-email').style.display = 'block';
    document.getElementById('campo-data-cadastro-associado').style.display = 'none';
    document.getElementById('abas-ficha-associado').style.display = 'none';
    definirFichaSomenteLeitura(false);
    fichaAssociadoAtual = null;
    ativarAbaFicha('dados');
    document.getElementById('overlay-modal').style.display = 'flex';
  };
  document.getElementById('btn-cancelar-modal').onclick = function() {
    document.getElementById('overlay-modal').style.display = 'none';
  };

  document.getElementById('btn-salvar-associado').onclick = function() {
    var idEdicao = document.getElementById('editar-associado-id').value;
    var nome = document.getElementById('novo-nome').value.trim();
    var email = document.getElementById('novo-email').value.trim();
    var cpf = document.getElementById('novo-cpf').value.trim();
    var rg = document.getElementById('novo-rg').value.trim();
    var telefone = document.getElementById('novo-telefone').value.trim();
    var enderecoCep = document.getElementById('novo-endereco-cep').value.trim();
    var enderecoLogradouro = document.getElementById('novo-endereco-logradouro').value.trim();
    var enderecoNumero = document.getElementById('novo-endereco-numero').value.trim();
    var enderecoComplemento = document.getElementById('novo-endereco-complemento').value.trim();
    var enderecoBairro = document.getElementById('novo-endereco-bairro').value.trim();
    var enderecoCidade = document.getElementById('novo-endereco-cidade').value.trim();
    var enderecoEstado = document.getElementById('novo-endereco-estado').value.trim().toUpperCase();
    var categoria = document.getElementById('novo-categoria').value.trim();
    var observacao = document.getElementById('novo-observacao').value.trim();
    var status = document.getElementById('novo-status').value;

    if (!nome) {
      mostrarToast('Informe o nome completo', true);
      return;
    }
    if (!idEdicao && !email) {
      mostrarToast('Informe o e-mail do associado (será o login dele)', true);
      return;
    }

    var dadosEndereco = {
      rg: rg, endereco_cep: enderecoCep, endereco_logradouro: enderecoLogradouro, endereco_numero: enderecoNumero,
      endereco_complemento: enderecoComplemento, endereco_bairro: enderecoBairro, endereco_cidade: enderecoCidade,
      endereco_estado: enderecoEstado
    };
    var url = API_URL + '/associados' + (idEdicao ? '/' + idEdicao : '');
    var metodo = idEdicao ? 'PUT' : 'POST';
    var corpo = Object.assign(idEdicao
      ? { nome_completo: nome, cpf: cpf, telefone: telefone, categoria: categoria, status: status, observacao: observacao }
      : { nome_completo: nome, email: email, cpf: cpf, telefone: telefone, categoria: categoria, observacao: observacao }, dadosEndereco);

    fetch(url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify(corpo)
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        // Bloqueio por limite do plano (item 7, 30/07/2026) -- fecha a
        // ficha e já abre o modal de plano (só admin, que é quem consegue
        // fazer algo a respeito; atendimento/operador só veem o aviso).
        if (res.data.codigo === 'LIMITE_ASSOCIADOS_ATINGIDO') {
          document.getElementById('overlay-modal').style.display = 'none';
          mostrarToast(res.data.erro, true);
          if (estado.papel === 'admin') {
            abrirModalContratarPlano(planoAtualDados ? planoAtualDados.proximo_plano : null);
          }
          return;
        }
        mostrarToast(res.data.erro || 'Erro ao salvar', true);
        return;
      }
      document.getElementById('overlay-modal').style.display = 'none';
      carregarAssociados();

      if (idEdicao) {
        mostrarToast('Associado atualizado!');
        return;
      }
      document.getElementById('cred-associado-email').value = res.data.email;
      document.getElementById('cred-associado-senha').value = res.data.senha_provisoria;
      document.getElementById('overlay-modal-credenciais-associado').style.display = 'flex';
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  document.getElementById('btn-fechar-credenciais-associado').onclick = function() {
    document.getElementById('overlay-modal-credenciais-associado').style.display = 'none';
  };
  document.getElementById('btn-copiar-senha-associado').onclick = function() {
    var campo = document.getElementById('cred-associado-senha');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Senha copiada!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  // ---------- Navegação (sidebar) ----------
  function ativarAba(idAtiva) {
    ['dashboard', 'associados', 'financeiro', 'comunicados', 'acessos', 'parametrizacao', 'meu-perfil'].forEach(function(nome) {
      var item = document.getElementById('aba-' + nome);
      if (item) item.classList.toggle('ativa', nome === idAtiva);
      var secao = document.getElementById('secao-' + nome);
      if (secao) secao.style.display = (nome === idAtiva) ? 'block' : 'none';
    });

    atualizarHeaderDashboard(idAtiva === 'dashboard');
    fecharSidebarMobile();
  }

  // "Acessos" tem 2 sub-abas internas: Usuários e Auditoria (item de sprint
  // 4, etapa 2 -- "Parametrização" saiu daqui, agora só é alcançável pelo
  // "Preferências" do header, não tem item próprio na sidebar).
  function ativarAbaAcessos(nome) {
    ['usuarios', 'auditoria'].forEach(function(aba) {
      document.getElementById('conteudo-aba-acessos-' + aba).style.display = aba === nome ? 'block' : 'none';
      document.getElementById('btn-aba-acessos-' + aba).classList.toggle('ativa', aba === nome);
    });
    if (nome === 'usuarios') carregarUsuarios();
    if (nome === 'auditoria') { paginaAtualAuditoria = 1; carregarAuditoria(); }
  }
  document.getElementById('btn-aba-acessos-usuarios').onclick = function() { ativarAbaAcessos('usuarios'); };
  document.getElementById('btn-aba-acessos-auditoria').onclick = function() { ativarAbaAcessos('auditoria'); };

  document.getElementById('aba-dashboard').onclick = function() { ativarAba('dashboard'); };
  document.getElementById('aba-associados').onclick = function() { ativarAba('associados'); };
  document.getElementById('aba-financeiro').onclick = function() { ativarAba('financeiro'); carregarCobrancas(); };
  document.getElementById('aba-comunicados').onclick = function() { ativarAba('comunicados'); carregarComunicados(); };
  document.getElementById('aba-acessos').onclick = function() {
    ativarAba('acessos');
    ativarAbaAcessos('usuarios');
  };

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

  // ---------- Logo da associação ----------
  function carregarConfigLogo() {
    var preview = document.getElementById('config-logo-preview');
    var placeholder = document.getElementById('config-logo-placeholder');
    if (estado.logoAssociacao && RE_DATA_URL_SEGURA.test(estado.logoAssociacao)) {
      preview.src = estado.logoAssociacao;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
      placeholder.textContent = iniciaisNome(estado.nomeAssociacao || '');
    }
  }

  document.getElementById('btn-trocar-logo-associacao').onclick = function() {
    document.getElementById('input-logo-associacao').click();
  };

  document.getElementById('input-logo-associacao').onchange = function(e) {
    var arquivo = e.target.files[0];
    e.target.value = '';
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

        var logoRedimensionada = canvas.toDataURL('image/jpeg', 0.85);
        salvarLogoAssociacao(logoRedimensionada);
      };
      img.src = evt.target.result;
    };
    leitor.readAsDataURL(arquivo);
  };

  function salvarLogoAssociacao(logoBase64) {
    fetch(API_URL + '/configuracoes/logo', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ logo_base64: logoBase64 })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar logo', true);
        return;
      }
      estado.logoAssociacao = logoBase64;
      carregarConfigLogo();
      mostrarToast('Logo atualizada!');
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function carregarConfigAlertas() {
    // Personalizar o prazo é recurso do plano Intermediário+ (gating por
    // plano, 29/07/2026) -- no Básico o campo fica só leitura, travado no
    // default (3 dias), e o botão Salvar some. Ver PUT /configuracoes/alertas
    // (backend/routes/configuracoes.js), que rejeita a gravação de qualquer
    // forma -- isso aqui é só a UI refletindo o mesmo limite.
    var podeEditar = planoAtende('intermediario');
    document.getElementById('config-dias-alerta').readOnly = !podeEditar;
    document.getElementById('rodape-config-alertas').style.display = podeEditar ? '' : 'none';
    document.getElementById('aviso-plano-alertas').style.display = podeEditar ? 'none' : 'block';

    fetch(API_URL + '/configuracoes/alertas', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(config) {
      document.getElementById('config-dias-alerta').value = config.dias_alerta_vencimento != null ? config.dias_alerta_vencimento : 3;
    })
    .catch(function() { mostrarToast('Erro ao carregar configuração de alertas', true); });
  }

  document.getElementById('btn-salvar-config-alertas').onclick = function() {
    var dias = document.getElementById('config-dias-alerta').value;

    fetch(API_URL + '/configuracoes/alertas', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ dias_alerta_vencimento: dias })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar configuração', true);
        return;
      }
      mostrarToast('Configuração de alertas salva!');
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  function carregarConfigPix() {
    fetch(API_URL + '/configuracoes/pix', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json(); })
    .then(function(config) {
      document.getElementById('config-chave-pix').value = config.chave_pix || '';
      document.getElementById('config-nome-pix').value = config.nome_recebedor_pix || '';
      document.getElementById('config-cidade-pix').value = config.cidade_pix || '';
    })
    .catch(function() { mostrarToast('Erro ao carregar configuração de Pix', true); });
  }

  document.getElementById('btn-salvar-config-pix').onclick = function() {
    var chave = document.getElementById('config-chave-pix').value.trim();
    var nome = document.getElementById('config-nome-pix').value.trim();
    var cidade = document.getElementById('config-cidade-pix').value.trim();

    if (!chave || !nome || !cidade) {
      mostrarToast('Preencha todos os campos', true);
      return;
    }

    fetch(API_URL + '/configuracoes/pix', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ chave_pix: chave, nome_recebedor_pix: nome, cidade_pix: cidade })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar configuração', true);
        return;
      }
      mostrarToast('Configuração de Pix salva!');
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Financeiro: carregar cobranças ----------
  var cobrancasCache = [];

  function carregarCobrancas() {
    fetch(API_URL + '/cobrancas', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao carregar cobranças', true);
        return;
      }
      renderizarCobrancas(res.data);
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function chaveMesDeData(iso) {
    return iso ? iso.substring(0, 7) : null;
  }

  var graficoReceitaMensal = null;
  var graficoSituacaoFinanceira = null;

  function atualizarDashboardFinanceiro(lista) {
    var meses = ultimosNMeses(12);
    var chaves = meses.map(chaveMesLocal);
    var labels = meses.map(function(d) { return MESES_PT[d.getMonth()] + '/' + String(d.getFullYear()).slice(2); });

    var receitasPorMes = chaves.map(function(chave) {
      return lista.filter(function(c) { return chaveMesDeData(c.vencimento) === chave; })
                   .reduce(function(soma, c) { return soma + parseFloat(c.valor); }, 0);
    });
    var recebidoPorMes = chaves.map(function(chave) {
      return lista.filter(function(c) { return chaveMesDeData(c.pago_em) === chave; })
                   .reduce(function(soma, c) { return soma + parseFloat(c.valor); }, 0);
    });

    var receitaMesAtual = recebidoPorMes[recebidoPorMes.length - 1];
    var receitaMesAnterior = recebidoPorMes[recebidoPorMes.length - 2] || 0;
    document.getElementById('kpi-receita-mes').textContent = formatarMoeda(receitaMesAtual);
    renderizarKpiDelta('kpi-delta-receita', receitaMesAtual, receitaMesAnterior, true);

    var vencidas = lista.filter(function(c) { return c.status_exibicao === 'atrasado'; });
    var aVencer = lista.filter(function(c) { return c.status === 'pendente' && c.status_exibicao !== 'atrasado'; });
    document.getElementById('kpi-vencidas').textContent = vencidas.length;
    document.getElementById('kpi-a-vencer').textContent = aVencer.length;

    var proximos = lista.filter(function(c) {
      return c.status === 'pendente' && c.dias_restantes != null && c.dias_restantes >= 0 && c.dias_restantes <= 7;
    });
    document.getElementById('vencimentos-quantidade').textContent = proximos.length;
    document.getElementById('vencimentos-valor').textContent =
      formatarMoeda(proximos.reduce(function(soma, c) { return soma + parseFloat(c.valor); }, 0));

    var cores = coresGrafico();

    if (graficoReceitaMensal) graficoReceitaMensal.destroy();
    graficoReceitaMensal = new Chart(document.getElementById('grafico-receita-mensal'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Receitas', data: receitasPorMes, backgroundColor: cores.secundaria, borderRadius: 6 },
          { label: 'Pagamentos recebidos', data: recebidoPorMes, backgroundColor: cores.linha, borderRadius: 6 }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { color: cores.texto, boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: cores.texto }, grid: { display: false } },
          y: { ticks: { color: cores.texto }, grid: { color: cores.grade }, beginAtZero: true }
        }
      }
    });

    var pagas = lista.filter(function(c) { return c.status === 'pago'; }).length;
    if (graficoSituacaoFinanceira) graficoSituacaoFinanceira.destroy();
    graficoSituacaoFinanceira = new Chart(document.getElementById('grafico-situacao-financeira'), {
      type: 'doughnut',
      data: {
        labels: ['Em dia', 'Vencidas', 'Pendentes'],
        datasets: [{ data: [pagas, vencidas.length, aVencer.length], backgroundColor: ['#2ECC71', '#E74C3C', '#D9A441'] }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { color: cores.texto, boxWidth: 12, font: { size: 11 } } } }
      }
    });
  }

  function renderizarCobrancas(lista) {
    cobrancasCache = lista;
    atualizarDashboardFinanceiro(lista);
    var container = document.getElementById('tabela-cobrancas-container');

    var vencendoEmBreve = lista.filter(function(c) { return c.status_exibicao === 'vencendo_em_breve'; });
    var bannerAlerta = document.getElementById('banner-alerta-vencimento');
    if (vencendoEmBreve.length > 0) {
      bannerAlerta.style.display = 'block';
      bannerAlerta.textContent = '⚠ ' + vencendoEmBreve.length + ' cobrança(s) vencendo em breve.';
    } else {
      bannerAlerta.style.display = 'none';
    }

    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhuma cobrança cadastrada ainda.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Associado</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th><th></th></tr></thead><tbody>';
    lista.forEach(function(c) {
      var statusExibicao = c.status_exibicao || c.status;
      var statusTexto = statusExibicao.replace(/_/g, ' ');
      if (statusExibicao === 'vencendo_em_breve' && c.dias_restantes != null) {
        statusTexto += ' (' + c.dias_restantes + 'd)';
      }
      var valorFormatado = 'R$ ' + parseFloat(c.valor).toFixed(2).replace('.', ',');
      var acoes = '';
      if (c.tem_comprovante && c.status !== 'pago') {
        acoes += '<button class="btn-pequeno" data-acao="abrirComprovante" data-id="' + c.id + '">Ver comprovante</button> ';
      }
      if (c.status !== 'pago') {
        acoes += '<button class="btn-pequeno" data-acao="abrirModalPix" data-id="' + c.id + '">Pix</button> ';
        if (podeFazer('cobrancas_pagar')) {
          acoes += '<button class="btn-pequeno" data-acao="marcarComoPago" data-id="' + c.id + '">Marcar como pago</button> ';
        }
        if (podeFazer('cobrancas_editar')) {
          acoes += '<button class="btn-pequeno" data-acao="abrirEdicaoCobranca" data-id="' + c.id + '">Editar</button> ';
        }
      }
      if (c.status === 'pago' && podeFazer('cobrancas_estornar')) {
        acoes += '<button class="btn-pequeno" data-acao="estornarPagamento" data-id="' + c.id + '">Estornar</button> ';
      }
      if (podeFazer('cobrancas_excluir')) {
        acoes += '<button class="btn-pequeno" data-acao="excluirCobranca" data-id="' + c.id + '">Excluir</button>';
      }
      html += '<tr>' +
        '<td>' + escapeHtml(c.associado_nome) + '</td>' +
        '<td>' + escapeHtml(c.descricao) + '</td>' +
        '<td>' + valorFormatado + '</td>' +
        '<td>' + formatarData(c.vencimento) + '</td>' +
        '<td><span class="badge ' + escapeHtml(statusExibicao) + '">' + escapeHtml(statusTexto) + '</span></td>' +
        '<td style="white-space:nowrap;">' + acoes + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function marcarComoPago(id) {
    fetch(API_URL + '/cobrancas/' + id + '/pagar', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ metodo: 'pix' })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao registrar pagamento', true);
        return;
      }
      mostrarToast('Pagamento registrado!');
      carregarCobrancas();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function abrirEdicaoCobranca(id) {
    var cobranca = cobrancasCache.find(function(c) { return c.id === id; });
    if (!cobranca) return;

    document.getElementById('titulo-modal-cobranca').textContent = 'Editar cobrança';
    document.getElementById('editar-cobranca-id').value = cobranca.id;
    document.getElementById('campo-cobranca-associado').style.display = 'none';
    document.getElementById('cobranca-descricao').value = cobranca.descricao;
    document.getElementById('cobranca-valor').value = String(cobranca.valor).replace('.', ',');
    document.getElementById('cobranca-vencimento').value = cobranca.vencimento.substring(0, 10);
    document.getElementById('overlay-modal-cobranca').style.display = 'flex';
  }

  function excluirCobranca(id) {
    confirmarAcao({
      titulo: 'Excluir cobrança',
      mensagem: 'Tem certeza que deseja excluir essa cobrança?',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/cobrancas/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao excluir cobrança', true);
            return;
          }
          mostrarToast('Cobrança excluída.');
          carregarCobrancas();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  function estornarPagamento(id) {
    confirmarAcao({
      titulo: 'Estornar pagamento',
      mensagem: 'Estornar esse pagamento? A cobrança volta para "pendente" e o associado poderá pagar novamente.',
      textoConfirmar: 'Estornar',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/cobrancas/' + id + '/estornar', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao estornar pagamento', true);
            return;
          }
          mostrarToast('Pagamento estornado. A cobrança voltou para pendente.');
          carregarCobrancas();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  // ---------- Modal Ver comprovante (admin/diretoria) ----------
  // Converte uma data URI (base64) em um blob: URL, que o navegador
  // consegue exibir/abrir de forma confiável (data: URLs grandes costumam falhar)
  // Só aceita data URL base64 com MIME conhecido e alfabeto base64 estrito.
  // Espelha utils/validacao.js no backend (ver comentário lá): concatenar um
  // valor do banco dentro de src="..." permitia que aspas escapassem do
  // atributo e virassem XSS armazenado -- um comprovante enviado por um
  // associado executava script na sessão da diretoria.
  var RE_DATA_URL_SEGURA = /^data:(image\/(png|jpeg|jpg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

  function renderizarComprovanteBase64(container, dataUrl) {
    container.textContent = '';
    if (!dataUrl || !RE_DATA_URL_SEGURA.test(dataUrl)) {
      container.innerHTML = '<div class="vazio">Comprovante em formato inválido ou não suportado.</div>';
      return;
    }
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
      link.textContent = 'Abrir em nova aba';
      p.appendChild(link);
      container.appendChild(p);
      return;
    }
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Comprovante';
    img.style.cssText = 'max-width:100%; border-radius:10px;';
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

  function abrirComprovante(cobrancaId) {
    document.getElementById('comprovante-cobranca-id').value = cobrancaId;
    var conteudo = document.getElementById('comprovante-conteudo');
    conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
    document.getElementById('overlay-modal-comprovante').style.display = 'flex';

    fetch(API_URL + '/cobrancas/' + cobrancaId + '/comprovante', {
      headers: { 'Authorization': 'Bearer ' + estado.token },
      cache: 'no-store'
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        conteudo.innerHTML = '<div class="vazio">' + escapeHtml(res.data.erro || 'Comprovante não encontrado') + '</div>';
        return;
      }
      renderizarComprovanteBase64(conteudo, res.data.comprovante_base64);
    })
    .catch(function() { conteudo.innerHTML = '<div class="vazio">Erro ao carregar comprovante</div>'; });
  }

  document.getElementById('btn-fechar-modal-comprovante').onclick = function() {
    document.getElementById('overlay-modal-comprovante').style.display = 'none';
  };

  document.getElementById('btn-confirmar-pagamento-comprovante').onclick = function() {
    var id = document.getElementById('comprovante-cobranca-id').value;
    document.getElementById('overlay-modal-comprovante').style.display = 'none';
    marcarComoPago(id);
  };

  // ---------- Modal nova/editar cobrança ----------
  document.getElementById('btn-nova-cobranca').onclick = function() {
    var select = document.getElementById('cobranca-associado');
    select.innerHTML = associadosCache.map(function(a) {
      return '<option value="' + a.id + '">' + escapeHtml(a.nome_completo) + '</option>';
    }).join('');
    if (associadosCache.length === 0) {
      mostrarToast('Cadastre um associado antes de gerar cobrança', true);
      return;
    }
    document.getElementById('titulo-modal-cobranca').textContent = 'Nova cobrança';
    document.getElementById('editar-cobranca-id').value = '';
    document.getElementById('campo-cobranca-associado').style.display = 'block';
    document.getElementById('cobranca-descricao').value = 'Mensalidade';
    document.getElementById('cobranca-valor').value = '';
    document.getElementById('cobranca-vencimento').value = '';
    document.getElementById('overlay-modal-cobranca').style.display = 'flex';
  };
  document.getElementById('btn-cancelar-modal-cobranca').onclick = function() {
    document.getElementById('overlay-modal-cobranca').style.display = 'none';
  };

  document.getElementById('btn-salvar-cobranca').onclick = function() {
    var idEdicao = document.getElementById('editar-cobranca-id').value;
    var associadoId = document.getElementById('cobranca-associado').value;
    var descricao = document.getElementById('cobranca-descricao').value.trim() || 'Mensalidade';
    var valor = parseMoney(document.getElementById('cobranca-valor').value);
    var vencimento = document.getElementById('cobranca-vencimento').value;

    if (!vencimento || valor <= 0 || (!idEdicao && !associadoId)) {
      mostrarToast('Preencha associado, valor e vencimento corretamente', true);
      return;
    }

    var url = API_URL + '/cobrancas' + (idEdicao ? '/' + idEdicao : '');
    var metodo = idEdicao ? 'PUT' : 'POST';
    var corpo = idEdicao
      ? { descricao: descricao, valor: valor, vencimento: vencimento }
      : { associado_id: associadoId, descricao: descricao, valor: valor, vencimento: vencimento };

    fetch(url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify(corpo)
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar cobrança', true);
        return;
      }
      document.getElementById('overlay-modal-cobranca').style.display = 'none';
      mostrarToast(idEdicao ? 'Cobrança atualizada!' : 'Cobrança criada com sucesso!');
      carregarCobrancas();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Atividades recentes (Dashboard) ----------
  var ICONES_ATIVIDADE = {
    associado_criado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    associado_editado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    cobranca_paga: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    comunicado_publicado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    usuario_convidado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><circle cx="19" cy="8" r="2"/><circle cx="5" cy="8" r="2"/></svg>'
  };

  function formatarTempoRelativo(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    var min = Math.floor(diffMs / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + min + ' min';
    var horas = Math.floor(min / 60);
    if (horas < 24) return 'há ' + horas + 'h';
    var dias = Math.floor(horas / 24);
    return 'há ' + dias + (dias === 1 ? ' dia' : ' dias');
  }

  function carregarAtividades() {
    fetch(API_URL + '/atividades', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      var container = document.getElementById('lista-atividades-container');
      if (!res.ok) {
        container.innerHTML = '<div class="vazio">' + escapeHtml(res.data.erro || 'Erro ao carregar atividades') + '</div>';
        return;
      }
      if (res.data.length === 0) {
        container.innerHTML = '<div class="vazio">Nenhuma atividade recente.</div>';
        return;
      }
      var html = '';
      res.data.forEach(function(a) {
        html += '<div class="atividade-item">' +
          '<div class="atividade-icone">' + (ICONES_ATIVIDADE[a.tipo] || ICONES_ATIVIDADE.associado_criado) + '</div>' +
          '<div>' +
            '<div class="atividade-texto"><b>' + escapeHtml(a.usuario_nome || 'Alguém') + '</b> ' + escapeHtml(a.descricao) + '</div>' +
            '<div class="atividade-tempo">' + formatarTempoRelativo(a.criado_em) + '</div>' +
          '</div>' +
          '</div>';
      });
      container.innerHTML = html;
    })
    .catch(function() {
      document.getElementById('lista-atividades-container').innerHTML = '<div class="vazio">Erro ao conectar ao servidor</div>';
    });
  }

  // ---------- Comunicados ----------
  var comunicadosCache = [];

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
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function atualizarComunicadosRecentes(lista) {
    var container = document.getElementById('lista-comunicados-recentes-container');
    if (!container) return;
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum comunicado publicado ainda.</div>';
      return;
    }
    var html = '';
    lista.slice(0, 3).forEach(function(c) {
      html += '<div class="mini-item">' +
        '<div class="mini-item-info">' +
          '<div class="mini-item-nome">' + escapeHtml(c.titulo) + '</div>' +
          '<div class="mini-item-sub">' + formatarDataHora(c.publicado_em) + '</div>' +
        '</div>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  function renderizarComunicados(lista) {
    comunicadosCache = lista;
    atualizarComunicadosRecentes(lista);
    var container = document.getElementById('lista-comunicados-container');

    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum comunicado publicado ainda.</div>';
      return;
    }

    var html = '';
    lista.forEach(function(c) {
      var total = parseInt(c.total_destinatarios, 10) || 0;
      var lidoPor = parseInt(c.leituras_associados, 10) || 0;
      var pendente = Math.max(total - lidoPor, 0);
      var taxa = total > 0 ? (lidoPor / total) * 100 : 0;
      var classeTaxa = taxa >= 70 ? 'taxa-alta' : taxa >= 40 ? 'taxa-media' : 'taxa-baixa';
      html += '<div class="comunicado-card">' +
        '<div class="comunicado-header">' +
          '<span class="comunicado-titulo">' + escapeHtml(c.titulo) + '</span>' +
          '<span class="comunicado-data">' + formatarDataHora(c.publicado_em) + '</span>' +
        '</div>' +
        '<div class="comunicado-conteudo">' + escapeHtml(c.conteudo) + '</div>' +
        (c.categoria_alvo ? '<span class="comunicado-categoria">' + escapeHtml(c.categoria_alvo) + '</span>' : '') +
        (c.origem_plataforma ? '<span class="comunicado-oficial">Comunicado oficial</span>' : '') +
        '<div class="comunicado-stats">' +
          '<span>Enviado para <strong>' + total + '</strong></span>' +
          '<span>Lido por <strong>' + lidoPor + '</strong></span>' +
          '<span>Pendente <strong>' + pendente + '</strong></span>' +
          '<span class="comunicado-taxa ' + classeTaxa + '">Taxa de leitura: ' + taxa.toFixed(1).replace('.', ',') + '%</span>' +
        '</div>' +
        '<div style="margin-top:10px;">' +
          '<button class="btn-pequeno" data-acao="abrirLeiturasComunicado" data-id="' + c.id + '">Ver leituras</button> ' +
          (c.origem_plataforma ? '' :
            (podeFazer('comunicados_editar') ? '<button class="btn-pequeno" data-acao="abrirEdicaoComunicado" data-id="' + c.id + '">Editar</button> ' : '') +
            (podeFazer('comunicados_excluir') ? '<button class="btn-pequeno" data-acao="excluirComunicado" data-id="' + c.id + '">Excluir</button>' : '')) +
        '</div>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  // ---------- Confirmação de leitura dos comunicados (item de sprint 3) ----------
  var leiturasComunicadoCache = [];
  var leiturasComunicadoId = null;
  var abaLeiturasAtiva = 'lidos';

  function abrirLeiturasComunicado(id) {
    leiturasComunicadoId = id;
    document.getElementById('resumo-leituras-comunicado').innerHTML = '';
    document.getElementById('lista-leituras-comunicado').innerHTML = '<div class="vazio">Carregando...</div>';
    document.getElementById('busca-leituras-comunicado').value = '';
    ativarAbaLeituras('lidos');
    // Exportar PDF é recurso do plano Intermediário+ (gating por plano,
    // 29/07/2026) -- ver GET /comunicados/:id/leituras/exportar/:formato.
    document.getElementById('btn-exportar-leituras-pdf').style.display = planoAtende('intermediario') ? '' : 'none';
    document.getElementById('overlay-modal-leituras').style.display = 'flex';

    fetch(API_URL + '/comunicados/' + id + '/leituras', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        document.getElementById('lista-leituras-comunicado').innerHTML = '<div class="vazio">Erro ao carregar leituras.</div>';
        return;
      }
      document.getElementById('titulo-modal-leituras').textContent = 'Leituras — ' + res.data.titulo;
      leiturasComunicadoCache = res.data.leituras;

      var total = leiturasComunicadoCache.length;
      var lidoPor = leiturasComunicadoCache.filter(function(l) { return l.lido; }).length;
      var taxa = total > 0 ? (lidoPor / total) * 100 : 0;
      var classeTaxa = taxa >= 70 ? 'taxa-alta' : taxa >= 40 ? 'taxa-media' : 'taxa-baixa';
      document.getElementById('resumo-leituras-comunicado').innerHTML =
        '<span>Enviado para <strong>' + total + '</strong></span>' +
        '<span>Lido por <strong>' + lidoPor + '</strong></span>' +
        '<span>Pendente <strong>' + (total - lidoPor) + '</strong></span>' +
        '<span class="comunicado-taxa ' + classeTaxa + '">Taxa de leitura: ' + taxa.toFixed(1).replace('.', ',') + '%</span>';

      renderizarListaLeituras();
    })
    .catch(function() { document.getElementById('lista-leituras-comunicado').innerHTML = '<div class="vazio">Erro ao conectar ao servidor.</div>'; });
  }

  function ativarAbaLeituras(aba) {
    abaLeiturasAtiva = aba;
    document.getElementById('btn-aba-leituras-lidos').classList.toggle('ativa', aba === 'lidos');
    document.getElementById('btn-aba-leituras-nao-lidos').classList.toggle('ativa', aba === 'nao-lidos');
    renderizarListaLeituras();
  }
  document.getElementById('btn-aba-leituras-lidos').onclick = function() { ativarAbaLeituras('lidos'); };
  document.getElementById('btn-aba-leituras-nao-lidos').onclick = function() { ativarAbaLeituras('nao-lidos'); };
  document.getElementById('busca-leituras-comunicado').oninput = renderizarListaLeituras;
  document.getElementById('btn-fechar-modal-leituras').onclick = function() {
    document.getElementById('overlay-modal-leituras').style.display = 'none';
  };

  function renderizarListaLeituras() {
    var busca = document.getElementById('busca-leituras-comunicado').value.trim().toLowerCase();
    var filtrada = leiturasComunicadoCache.filter(function(l) {
      if (abaLeiturasAtiva === 'lidos' && !l.lido) return false;
      if (abaLeiturasAtiva === 'nao-lidos' && l.lido) return false;
      if (busca && l.nome.toLowerCase().indexOf(busca) < 0) return false;
      return true;
    });
    var container = document.getElementById('lista-leituras-comunicado');
    if (filtrada.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum associado encontrado.</div>';
      return;
    }
    container.innerHTML = filtrada.map(function(l) {
      var sub = l.email + (l.lido ? ' · Lido em ' + formatarDataHora(l.lido_em) : '');
      return '<div class="item-ficha">' +
        '<div>' +
          '<div class="item-ficha-titulo">' + escapeHtml(l.nome) + '</div>' +
          '<div class="item-ficha-sub">' + escapeHtml(sub) + '</div>' +
        '</div>' +
        '<span class="badge ' + (l.lido ? 'pago' : 'pendente') + '">' + (l.lido ? '✅ Lido' : '⏳ Não lido') + '</span>' +
      '</div>';
    }).join('');
  }

  function exportarLeiturasComunicado() {
    if (!leiturasComunicadoId) return;
    fetch(API_URL + '/comunicados/' + leiturasComunicadoId + '/leituras/exportar/pdf', {
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
      link.download = 'leituras-comunicado.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch(function(err) { mostrarToast(err.message || 'Erro ao exportar leituras', true); });
  }
  document.getElementById('btn-exportar-leituras-pdf').onclick = function() { exportarLeiturasComunicado(); };

  function abrirEdicaoComunicado(id) {
    var c = comunicadosCache.find(function(x) { return x.id === id; });
    if (!c) return;

    document.getElementById('titulo-modal-comunicado').textContent = 'Editar comunicado';
    document.getElementById('editar-comunicado-id').value = c.id;
    document.getElementById('comunicado-titulo').value = c.titulo;
    document.getElementById('comunicado-conteudo').value = c.conteudo;
    document.getElementById('comunicado-categoria').value = c.categoria_alvo || '';
    document.getElementById('overlay-modal-comunicado').style.display = 'flex';
  }

  function excluirComunicado(id) {
    confirmarAcao({
      titulo: 'Excluir comunicado',
      mensagem: 'Tem certeza que deseja excluir esse comunicado?',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/comunicados/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao excluir comunicado', true);
            return;
          }
          mostrarToast('Comunicado excluído.');
          carregarComunicados();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
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

  // ---------- Modal novo/editar comunicado ----------
  document.getElementById('btn-novo-comunicado').onclick = function() {
    document.getElementById('titulo-modal-comunicado').textContent = 'Novo comunicado';
    document.getElementById('editar-comunicado-id').value = '';
    document.getElementById('comunicado-titulo').value = '';
    document.getElementById('comunicado-conteudo').value = '';
    document.getElementById('comunicado-categoria').value = '';
    document.getElementById('overlay-modal-comunicado').style.display = 'flex';
  };
  document.getElementById('btn-cancelar-modal-comunicado').onclick = function() {
    document.getElementById('overlay-modal-comunicado').style.display = 'none';
  };

  document.getElementById('btn-salvar-comunicado').onclick = function() {
    var idEdicao = document.getElementById('editar-comunicado-id').value;
    var titulo = document.getElementById('comunicado-titulo').value.trim();
    var conteudo = document.getElementById('comunicado-conteudo').value.trim();
    var categoria = document.getElementById('comunicado-categoria').value.trim();

    if (!titulo || !conteudo) {
      mostrarToast('Preencha título e conteúdo', true);
      return;
    }

    var url = API_URL + '/comunicados' + (idEdicao ? '/' + idEdicao : '');
    var metodo = idEdicao ? 'PUT' : 'POST';

    fetch(url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ titulo: titulo, conteudo: conteudo, categoria_alvo: categoria || null })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao salvar comunicado', true);
        return;
      }
      document.getElementById('overlay-modal-comunicado').style.display = 'none';
      document.getElementById('comunicado-titulo').value = '';
      document.getElementById('comunicado-conteudo').value = '';
      document.getElementById('comunicado-categoria').value = '';
      mostrarToast(idEdicao ? 'Comunicado atualizado!' : 'Comunicado publicado!');
      carregarComunicados();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Usuários (multiusuário) ----------
  var usuariosCache = [];

  function carregarUsuarios() {
    fetch(API_URL + '/usuarios', {
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao carregar usuários', true);
        return;
      }
      renderizarUsuarios(res.data);
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  var rotuloPapel = {
    admin: 'Admin', diretoria: 'Diretoria', associado: 'Associado',
    financeiro: 'Financeiro', atendimento: 'Atendimento', operador: 'Operador', consulta: 'Somente Consulta',
  };

  function renderizarUsuarios(lista) {
    usuariosCache = lista;
    var container = document.getElementById('tabela-usuarios-container');

    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum usuário encontrado.</div>';
      return;
    }

    var html = '<table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th>Criado em</th><th>Último acesso</th><th></th></tr></thead><tbody>';
    lista.forEach(function(u) {
      var acoes = '';
      if (u.papel !== 'admin') {
        acoes += '<button class="btn-pequeno" data-acao="abrirEdicaoUsuario" data-id="' + u.id + '">Editar</button> ';
        acoes += '<button class="btn-pequeno" data-acao="redefinirSenhaUsuario" data-id="' + u.id + '">Redefinir senha</button> ';
        if (u.ativo) {
          acoes += '<button class="btn-pequeno" data-acao="desativarUsuario" data-id="' + u.id + '">Desativar</button> ';
        } else {
          acoes += '<button class="btn-pequeno" data-acao="reativarUsuario" data-id="' + u.id + '">Reativar</button> ';
        }
        acoes += '<button class="btn-pequeno" data-acao="excluirUsuario" data-id="' + u.id + '">Excluir</button>';
      }
      html += '<tr>' +
        '<td>' + escapeHtml(u.nome) + '</td>' +
        '<td>' + escapeHtml(u.email) + '</td>' +
        '<td><span class="comunicado-categoria">' + escapeHtml(rotuloPapel[u.papel] || u.papel) + '</span></td>' +
        '<td><span class="badge ' + (u.ativo ? 'ativo' : 'desligado') + '">' + (u.ativo ? 'ativo' : 'inativo') + '</span></td>' +
        '<td>' + formatarData(u.criado_em) + '</td>' +
        '<td>' + (u.ultimo_acesso ? formatarDataHora(u.ultimo_acesso) : 'nunca acessou') + '</td>' +
        '<td style="white-space:nowrap;">' + acoes + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function desativarUsuario(id) {
    fetch(API_URL + '/usuarios/' + id + '/desativar', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao desativar', true);
        return;
      }
      mostrarToast('Usuário desativado.');
      carregarUsuarios();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function reativarUsuario(id) {
    fetch(API_URL + '/usuarios/' + id + '/reativar', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + estado.token }
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao reativar', true);
        return;
      }
      mostrarToast('Usuário reativado.');
      carregarUsuarios();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  }

  function redefinirSenhaUsuario(id) {
    confirmarAcao({
      titulo: 'Redefinir senha',
      mensagem: 'Isso gera uma senha provisória nova. A pessoa vai precisar trocar no próximo login.',
      textoConfirmar: 'Gerar nova senha',
      aoConfirmar: function() {
        fetch(API_URL + '/usuarios/' + id + '/redefinir-senha', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao redefinir senha', true);
            return;
          }
          document.getElementById('titulo-modal-usuario').textContent = 'Senha redefinida';
          document.getElementById('texto-resultado-usuario').textContent =
            'Essa senha só aparece agora — copie e envie para ' + res.data.nome + '. No próximo login, a senha nova vai precisar ser trocada.';
          document.getElementById('resultado-usuario-email').value = res.data.email;
          document.getElementById('resultado-usuario-senha').value = res.data.senha_provisoria;
          document.getElementById('form-usuario').style.display = 'none';
          document.getElementById('resultado-usuario').style.display = 'block';
          document.getElementById('overlay-modal-usuario').style.display = 'flex';
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  function abrirEdicaoUsuario(id) {
    var u = usuariosCache.find(function(x) { return x.id === id; });
    if (!u) return;

    document.getElementById('titulo-modal-usuario').textContent = 'Editar usuário';
    document.getElementById('editar-usuario-id').value = u.id;
    document.getElementById('usuario-nome').value = u.nome;
    atualizarOpcoesPapelUsuario(u.papel);
    document.getElementById('usuario-papel').value = u.papel;
    document.getElementById('campo-usuario-email').style.display = 'none';
    document.getElementById('campo-usuario-associado').style.display = 'none';
    document.getElementById('form-usuario').style.display = 'block';
    document.getElementById('resultado-usuario').style.display = 'none';
    document.getElementById('btn-salvar-usuario').textContent = 'Salvar';
    document.getElementById('overlay-modal-usuario').style.display = 'flex';
  }

  function excluirUsuario(id) {
    confirmarAcao({
      titulo: 'Excluir usuário',
      mensagem: 'Tem certeza que deseja excluir esse usuário permanentemente?',
      textoConfirmar: 'Excluir',
      perigo: true,
      aoConfirmar: function() {
        fetch(API_URL + '/usuarios/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + estado.token }
        })
        .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
        .then(function(res) {
          if (!res.ok) {
            mostrarToast(res.data.erro || 'Erro ao excluir usuário', true);
            return;
          }
          mostrarToast('Usuário excluído.');
          carregarUsuarios();
        })
        .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      }
    });
  }

  // ---------- Auditoria (item de sprint 4, etapa 2 -- mesma ideia da tela do Super Admin, escopo tenant) ----------
  var ROTULOS_MODULO_AUDITORIA = {
    associados: 'Associados', cobrancas: 'Cobranças', comunicados: 'Comunicados', usuarios: 'Usuários',
    configuracoes: 'Configurações', autenticacao: 'Autenticação', auditoria: 'Auditoria', planos: 'Plano da associação'
  };
  var ROTULOS_TIPO_ACAO_AUDITORIA = {
    login: 'Login', logout: 'Logout', criacao: 'Criação', edicao: 'Edição', exclusao: 'Exclusão',
    alteracao_senha: 'Alteração de senha', alteracao_permissoes: 'Alteração de permissões', exportacao: 'Exportação de dados'
  };
  var auditoriaCache = [];
  var paginaAtualAuditoria = 1;
  var totalAuditoria = 0;
  var porPaginaAuditoria = 50;

  function filtrosAuditoriaQueryString() {
    var params = [];
    var usuario = document.getElementById('filtro-auditoria-usuario').value.trim();
    var modulo = document.getElementById('filtro-auditoria-modulo').value;
    var tipoAcao = document.getElementById('filtro-auditoria-tipo-acao').value;
    var dataInicio = document.getElementById('filtro-auditoria-data-inicio').value;
    var dataFim = document.getElementById('filtro-auditoria-data-fim').value;
    var ordenar = document.getElementById('filtro-auditoria-ordenar').value;
    if (usuario) params.push('usuario=' + encodeURIComponent(usuario));
    if (modulo) params.push('modulo=' + encodeURIComponent(modulo));
    if (tipoAcao) params.push('tipo_acao=' + encodeURIComponent(tipoAcao));
    if (dataInicio) params.push('data_inicio=' + encodeURIComponent(dataInicio));
    if (dataFim) params.push('data_fim=' + encodeURIComponent(dataFim));
    if (ordenar) params.push('ordenar=' + encodeURIComponent(ordenar));
    return params;
  }

  function carregarAuditoria() {
    var params = filtrosAuditoriaQueryString();
    params.push('pagina=' + paginaAtualAuditoria);
    params.push('por_pagina=' + porPaginaAuditoria);
    var container = document.getElementById('tabela-auditoria-container');
    container.innerHTML = '<div class="vazio">Carregando...</div>';

    fetch(API_URL + '/auditoria?' + params.join('&'), { headers: { 'Authorization': 'Bearer ' + estado.token }, cache: 'no-store' })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) { mostrarToast(res.data.erro || 'Erro ao carregar auditoria', true); return; }
      auditoriaCache = res.data.registros;
      totalAuditoria = res.data.total;
      renderizarAuditoria(auditoriaCache);
      atualizarPaginacaoAuditoria();
    })
    .catch(function() { mostrarToast('Erro ao carregar auditoria', true); });
  }

  document.getElementById('filtro-auditoria-usuario').oninput = function() { paginaAtualAuditoria = 1; carregarAuditoria(); };
  ['filtro-auditoria-modulo', 'filtro-auditoria-tipo-acao', 'filtro-auditoria-data-inicio', 'filtro-auditoria-data-fim', 'filtro-auditoria-ordenar'].forEach(function(id) {
    document.getElementById(id).onchange = function() { paginaAtualAuditoria = 1; carregarAuditoria(); };
  });

  function renderizarAuditoria(lista) {
    var container = document.getElementById('tabela-auditoria-container');
    if (lista.length === 0) {
      container.innerHTML = '<div class="vazio">Nenhum registro encontrado.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Módulo</th><th>Ação</th><th>Descrição</th><th></th></tr></thead><tbody>';
    lista.forEach(function(l) {
      var nomeAtor = l.usuario_nome || l.super_admin_nome || l.usuario_email || l.super_admin_email || '—';
      html += '<tr>' +
        '<td style="white-space:nowrap;">' + new Date(l.criado_em).toLocaleString('pt-BR') + '</td>' +
        '<td>' + escapeHtml(nomeAtor) + (l.super_admin_nome ? ' <span style="color:var(--text-muted); font-size:11px;">(Super Admin)</span>' : '') + '</td>' +
        '<td>' + (ROTULOS_MODULO_AUDITORIA[l.modulo] || l.modulo) + '</td>' +
        '<td>' + (ROTULOS_TIPO_ACAO_AUDITORIA[l.tipo_acao] || l.tipo_acao) + '</td>' +
        '<td>' + escapeHtml(l.descricao) + '</td>' +
        '<td><button class="btn-pequeno" data-acao="abrirDetalhesLogAuditoria" data-id="' + l.id + '">Detalhes</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function atualizarPaginacaoAuditoria() {
    var inicio = totalAuditoria === 0 ? 0 : (paginaAtualAuditoria - 1) * porPaginaAuditoria + 1;
    var fim = Math.min(paginaAtualAuditoria * porPaginaAuditoria, totalAuditoria);
    document.getElementById('texto-paginacao-auditoria').textContent = totalAuditoria === 0
      ? 'Nenhum registro'
      : ('Mostrando ' + inicio + '–' + fim + ' de ' + totalAuditoria);
    document.getElementById('btn-pagina-anterior-auditoria').disabled = paginaAtualAuditoria <= 1;
    document.getElementById('btn-pagina-proxima-auditoria').disabled = (paginaAtualAuditoria * porPaginaAuditoria) >= totalAuditoria;
  }
  document.getElementById('btn-pagina-anterior-auditoria').onclick = function() {
    if (paginaAtualAuditoria > 1) { paginaAtualAuditoria--; carregarAuditoria(); }
  };
  document.getElementById('btn-pagina-proxima-auditoria').onclick = function() {
    if ((paginaAtualAuditoria * porPaginaAuditoria) < totalAuditoria) { paginaAtualAuditoria++; carregarAuditoria(); }
  };

  function linhaInfo(rotulo, valor) {
    return '<div class="info-linha"><span>' + rotulo + '</span><span>' + escapeHtml(valor || '—') + '</span></div>';
  }

  function abrirDetalhesLogAuditoria(id) {
    var log = auditoriaCache.find(function(l) { return l.id === id; });
    if (!log) return;
    var nomeAtor = log.usuario_nome || log.super_admin_nome || log.usuario_email || log.super_admin_email || '—';
    var emailAtor = log.usuario_email || log.super_admin_email || '—';

    document.getElementById('lista-detalhes-log-auditoria').innerHTML =
      linhaInfo('Data/Hora', new Date(log.criado_em).toLocaleString('pt-BR')) +
      linhaInfo('Usuário', nomeAtor) +
      linhaInfo('E-mail', emailAtor) +
      linhaInfo('Módulo', ROTULOS_MODULO_AUDITORIA[log.modulo] || log.modulo) +
      linhaInfo('Tipo de ação', ROTULOS_TIPO_ACAO_AUDITORIA[log.tipo_acao] || log.tipo_acao) +
      linhaInfo('Descrição', log.descricao) +
      linhaInfo('IP', log.ip) +
      linhaInfo('Dispositivo/Navegador', log.user_agent);

    var blocoDiff = document.getElementById('bloco-diff-log-auditoria');
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

    document.getElementById('overlay-modal-log-auditoria').style.display = 'flex';
  }
  document.getElementById('btn-fechar-modal-log-auditoria').onclick = function() {
    document.getElementById('overlay-modal-log-auditoria').style.display = 'none';
  };

  function exportarAuditoria() {
    var params = filtrosAuditoriaQueryString();
    fetch(API_URL + '/auditoria/exportar/pdf?' + params.join('&'), {
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
      link.download = 'auditoria.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch(function(err) { mostrarToast(err.message || 'Erro ao exportar auditoria', true); });
  }
  document.getElementById('btn-exportar-auditoria-pdf').onclick = function() { exportarAuditoria(); };

  function atualizarCampoVinculoAssociado() {
    var papel = document.getElementById('usuario-papel').value;
    var campo = document.getElementById('campo-usuario-associado');
    var idEdicao = document.getElementById('editar-usuario-id').value;

    if (papel === 'associado' && !idEdicao) {
      campo.style.display = 'block';
      fetch(API_URL + '/usuarios/associados-sem-login', {
        headers: { 'Authorization': 'Bearer ' + estado.token }
      })
      .then(function(resp) { return resp.json(); })
      .then(function(lista) {
        var select = document.getElementById('usuario-associado-vinculo');
        if (lista.length === 0) {
          select.innerHTML = '<option value="">Nenhum associado disponível</option>';
          return;
        }
        select.innerHTML = lista.map(function(a) {
          return '<option value="' + a.id + '">' + escapeHtml(a.nome_completo) + '</option>';
        }).join('');
      })
      .catch(function() { mostrarToast('Erro ao carregar associados disponíveis', true); });
    } else {
      campo.style.display = 'none';
    }
  }
  document.getElementById('usuario-papel').onchange = atualizarCampoVinculoAssociado;

  // ---------- Modal novo/editar usuário ----------
  document.getElementById('btn-novo-usuario').onclick = function() {
    document.getElementById('editar-usuario-id').value = '';
    document.getElementById('usuario-nome').value = '';
    document.getElementById('usuario-email').value = '';
    atualizarOpcoesPapelUsuario(null);
    document.getElementById('usuario-papel').value = 'diretoria';
    document.getElementById('campo-usuario-email').style.display = 'block';
    document.getElementById('campo-usuario-associado').style.display = 'none';
    document.getElementById('btn-salvar-usuario').textContent = 'Convidar';
    document.getElementById('form-usuario').style.display = 'block';
    document.getElementById('resultado-usuario').style.display = 'none';
    document.getElementById('titulo-modal-usuario').textContent = 'Convidar usuário';
    document.getElementById('overlay-modal-usuario').style.display = 'flex';
  };
  document.getElementById('btn-cancelar-modal-usuario').onclick = function() {
    document.getElementById('overlay-modal-usuario').style.display = 'none';
  };
  document.getElementById('btn-fechar-resultado-usuario').onclick = function() {
    document.getElementById('overlay-modal-usuario').style.display = 'none';
  };
  document.getElementById('btn-copiar-senha-usuario').onclick = function() {
    var campo = document.getElementById('resultado-usuario-senha');
    campo.select();
    navigator.clipboard.writeText(campo.value).then(function() {
      mostrarToast('Senha copiada!');
    }).catch(function() {
      mostrarToast('Não foi possível copiar automaticamente — selecione e copie manualmente.', true);
    });
  };

  document.getElementById('btn-salvar-usuario').onclick = function() {
    var idEdicao = document.getElementById('editar-usuario-id').value;
    var nome = document.getElementById('usuario-nome').value.trim();
    var papel = document.getElementById('usuario-papel').value;

    if (idEdicao) {
      if (!nome) {
        mostrarToast('Informe o nome', true);
        return;
      }
      fetch(API_URL + '/usuarios/' + idEdicao, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + estado.token
        },
        body: JSON.stringify({ nome: nome, papel: papel })
      })
      .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
      .then(function(res) {
        if (!res.ok) {
          mostrarToast(res.data.erro || 'Erro ao salvar usuário', true);
          return;
        }
        document.getElementById('overlay-modal-usuario').style.display = 'none';
        mostrarToast('Usuário atualizado!');
        carregarUsuarios();
      })
      .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
      return;
    }

    var email = document.getElementById('usuario-email').value.trim();
    var associadoVinculo = document.getElementById('usuario-associado-vinculo').value;

    if (!nome || !email) {
      mostrarToast('Preencha nome e e-mail', true);
      return;
    }
    if (papel === 'associado' && !associadoVinculo) {
      mostrarToast('Selecione a qual associado esse login pertence', true);
      return;
    }

    fetch(API_URL + '/usuarios', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + estado.token
      },
      body: JSON.stringify({ nome: nome, email: email, papel: papel, associado_id: papel === 'associado' ? associadoVinculo : undefined })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(res) {
      if (!res.ok) {
        mostrarToast(res.data.erro || 'Erro ao convidar usuário', true);
        return;
      }
      document.getElementById('usuario-nome').value = '';
      document.getElementById('usuario-email').value = '';

      document.getElementById('resultado-usuario-email').value = res.data.email;
      document.getElementById('resultado-usuario-senha').value = res.data.senha_provisoria;
      document.getElementById('form-usuario').style.display = 'none';
      document.getElementById('resultado-usuario').style.display = 'block';
      document.getElementById('titulo-modal-usuario').textContent = 'Usuário criado';

      carregarUsuarios();
    })
    .catch(function() { mostrarToast('Erro ao conectar ao servidor', true); });
  };

  // ---------- Modal Pagar com Pix (visualização pela diretoria) ----------
  function abrirModalPix(cobrancaId) {
    var cobranca = cobrancasCache.find(function(c) { return c.id === cobrancaId; });
    if (!cobranca) return;

    document.getElementById('pix-cobranca-id').value = cobrancaId;
    document.getElementById('pix-descricao-valor').textContent =
      cobranca.associado_nome + ' — ' + cobranca.descricao + ' — R$ ' + parseFloat(cobranca.valor).toFixed(2).replace('.', ',');

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
    abrirComprovante: abrirComprovante,
    abrirDetalhesLogAuditoria: abrirDetalhesLogAuditoria,
    abrirEdicaoCobranca: abrirEdicaoCobranca,
    abrirEdicaoComunicado: abrirEdicaoComunicado,
    abrirEdicaoUsuario: abrirEdicaoUsuario,
    abrirFichaAssociado: abrirFichaAssociado,
    abrirLeiturasComunicado: abrirLeiturasComunicado,
    abrirModalPix: abrirModalPix,
    desativarUsuario: desativarUsuario,
    estornarPagamento: estornarPagamento,
    excluirAssociado: excluirAssociado,
    excluirCobranca: excluirCobranca,
    excluirComunicado: excluirComunicado,
    excluirUsuario: excluirUsuario,
    marcarComoPago: marcarComoPago,
    reativarUsuario: reativarUsuario,
    redefinirSenhaUsuario: redefinirSenhaUsuario,
    selecionarOpcaoPlano: selecionarOpcaoPlano,
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
