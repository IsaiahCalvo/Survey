(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var y = document.querySelector('.yr');
  if (y) y.textContent = new Date().getFullYear();

  function isDark() {
    var t = root.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  var btn = document.querySelector('.theme');
  function sync() {
    var d = isDark();
    btn.setAttribute('aria-pressed', String(d));
    btn.setAttribute('aria-label', d ? 'Light theme' : 'Dark theme');
  }
  if (btn) {
    sync();
    btn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      function apply() {
        root.dataset.theme = next;
        try { localStorage.setItem('theme', next); } catch (e) {}
        sync();
      }
      if (!document.startViewTransition || reduce) return apply();
      var r = btn.getBoundingClientRect();
      var x = r.left + r.width / 2, yy = r.top + r.height / 2;
      var end = Math.hypot(Math.max(x, innerWidth - x), Math.max(yy, innerHeight - yy));
      document.startViewTransition(apply).ready.then(function () {
        root.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + yy + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + yy + 'px)'] },
          { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
        );
      });
    });
  }

  var menu = document.querySelector('.menu');
  var mnav = document.getElementById('mnav');
  if (menu && mnav) menu.addEventListener('click', function () {
    var open = mnav.hidden;
    mnav.hidden = !open;
    menu.setAttribute('aria-expanded', String(open));
  });

  // Reduced motion: no autoplay, give the viewer controls instead.
  var v = document.querySelector('.frame video');
  if (v && reduce) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; }
})();
