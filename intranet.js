(function() {
  var themeToggle = document.getElementById('themeToggle');
  var temaSalvo = localStorage.getItem('tema-preferido') || 'light';

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    localStorage.setItem('tema-preferido', tema);
    themeToggle.textContent = tema === 'dark' ? '☀️' : '🌙';
  }

  themeToggle.addEventListener('click', function() {
    var temAtual = document.documentElement.getAttribute('data-theme');
    var novoTema = temAtual === 'dark' ? 'light' : 'dark';
    aplicarTema(novoTema);
  });

  aplicarTema(temaSalvo);

  var btnProducao = document.getElementById('btn-tab-producao');
  var btnHomologacao = document.getElementById('btn-tab-homologacao');
  function ativarAmbiente(nome) {
    document.getElementById('tab-producao').style.display = nome === 'producao' ? 'block' : 'none';
    document.getElementById('tab-homologacao').style.display = nome === 'homologacao' ? 'block' : 'none';
    btnProducao.classList.toggle('ativa', nome === 'producao');
    btnHomologacao.classList.toggle('ativa', nome === 'homologacao');
    localStorage.setItem('intranet-ambiente', nome);
  }
  btnProducao.addEventListener('click', function() { ativarAmbiente('producao'); });
  btnHomologacao.addEventListener('click', function() { ativarAmbiente('homologacao'); });
  ativarAmbiente(localStorage.getItem('intranet-ambiente') || 'producao');
})();
