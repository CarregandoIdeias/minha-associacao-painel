(function () {
  var faqItems = document.querySelectorAll('.ap-faq-item');
  for (var i = 0; i < faqItems.length; i++) {
    (function (item) {
      var btn = item.querySelector('.ap-faq-q');
      btn.addEventListener('click', function () {
        var isOpen = item.getAttribute('data-open') === 'true';
        for (var j = 0; j < faqItems.length; j++) {
          faqItems[j].setAttribute('data-open', 'false');
        }
        item.setAttribute('data-open', isOpen ? 'false' : 'true');
      });
    })(faqItems[i]);
  }

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
    }, { threshold: 0.15 });
    for (var i = 0; i < revealEls.length; i++) obs.observe(revealEls[i]);
  } else {
    var revealElsFallback = document.querySelectorAll('.ap-reveal');
    for (var i = 0; i < revealElsFallback.length; i++) revealElsFallback[i].classList.add('in');
  }

  // Rede sutil de pontos no fundo do hero -- representa associados conectados.
  // Cor da linha/ponto acompanha o tema (claro/escuro) ativo no momento.
  var canvas = document.getElementById('apNetCanvas');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    var w, h, points, dpr;

    function isDark() {
      var attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function resize() {
      var hero = canvas.parentElement;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = hero.offsetWidth;
      h = hero.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var count = Math.max(18, Math.round((w * h) / 42000));
      points = [];
      for (var i = 0; i < count; i++) {
        points.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12
        });
      }
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      var lineColor = isDark() ? 'rgba(249,248,245,' : 'rgba(26,23,18,';
      var dotColor = 'rgba(201,168,76,0.6)';

      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (!reduceMotion) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }
      for (var i = 0; i < points.length; i++) {
        for (var j = i + 1; j < points.length; j++) {
          var a = points[i], b = points[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.strokeStyle = lineColor + (1 - dist / 140) * 0.14 + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (var i = 0; i < points.length; i++) {
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduceMotion) requestAnimationFrame(tick);
    }

    resize();
    tick();
    window.addEventListener('resize', resize);
  }
})();
