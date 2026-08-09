(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealEls = document.querySelectorAll('.ap-reveal');
    var obs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('in');
          obs.unobserve(entries[i].target);
        }
      }
    }, { threshold: 0.1 });
    for (var i = 0; i < revealEls.length; i++) obs.observe(revealEls[i]);
  } else {
    var revealElsFallback = document.querySelectorAll('.ap-reveal');
    for (var i = 0; i < revealElsFallback.length; i++) revealElsFallback[i].classList.add('in');
  }

  // Destaca o link da seção visível no nav ao rolar
  var navLinks = document.querySelectorAll('.ap-nav-links a[href^="#"]');
  var sections = [];
  navLinks.forEach(function(a) {
    var sec = document.querySelector(a.getAttribute('href'));
    if (sec) sections.push({ link: a, el: sec });
  });
  window.addEventListener('scroll', function() {
    var pos = window.scrollY + 120;
    var atual = null;
    sections.forEach(function(s) {
      if (s.el.offsetTop <= pos) atual = s;
    });
    navLinks.forEach(function(a) { a.classList.remove('ativo'); });
    if (atual) atual.link.classList.add('ativo');
  });

  // Menu sanduíche (mobile)
  var hamburger = document.getElementById('apHamburger');
  var navLinksEl = document.getElementById('apNavLinks');
  hamburger.addEventListener('click', function() {
    var aberto = navLinksEl.classList.toggle('aberto');
    hamburger.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  });
  navLinksEl.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      navLinksEl.classList.remove('aberto');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
})();
