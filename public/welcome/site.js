(function () {
  var root = document.documentElement;

  // The font sheet loads as media="print" so it never holds up the first
  // paint, then switches on here. This used to be an inline onload="..."
  // handler, which the site's content security policy blocks (vercel.json).
  var fontCss = document.querySelectorAll('link[data-font-css]');
  for (var i = 0; i < fontCss.length; i++) fontCss[i].media = 'all';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var y = document.querySelector('.yr');
  if (y) y.textContent = new Date().getFullYear();

  function isDark() {
    // Light unless the visitor picked dark with the toggle.
    return root.dataset.theme === 'dark';
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


  // Tabbed showcase: click or arrow keys pick a tab; while the block is on
  // screen and nobody has touched it, the active tab's bar fills and the next
  // tab follows. Reduced motion keeps it still.
  var shows = document.querySelectorAll('[data-show]');
  Array.prototype.forEach.call(shows, function (show) {
    var items = show.querySelectorAll('.show-item');
    var tabs = show.querySelectorAll('.show-tab');
    var panes = show.querySelectorAll('.show-pane');
    var cur = 0;
    function pick(n, focus) {
      cur = (n + tabs.length) % tabs.length;
      for (var i = 0; i < tabs.length; i++) {
        var on = i === cur;
        items[i].classList.toggle('on', on);
        tabs[i].setAttribute('aria-selected', String(on));
        tabs[i].tabIndex = on ? 0 : -1;
        panes[i].classList.toggle('on', on);
      }
      if (focus) tabs[cur].focus();
    }
    function stop() { show.classList.remove('auto'); }
    Array.prototype.forEach.call(tabs, function (t, i) {
      t.addEventListener('click', function () { stop(); pick(i); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, n = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') n = cur + 1;
        else if (k === 'ArrowUp' || k === 'ArrowLeft') n = cur - 1;
        else if (k === 'Home') n = 0;
        else if (k === 'End') n = tabs.length - 1;
        if (n === null) return;
        e.preventDefault(); stop(); pick(n, true);
      });
    });
    if (reduce || !('IntersectionObserver' in window)) return;
    show.classList.add('auto', 'paused');
    show.addEventListener('animationend', function (e) {
      if (e.animationName === 'show-fill' && show.classList.contains('auto')) pick(cur + 1);
    });
    // A mouse resting on the block holds the current tab.
    var seen = false;
    function sync() { show.classList.toggle('paused', !seen || show.classList.contains('hold')); }
    show.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { show.classList.add('hold'); sync(); } });
    show.addEventListener('pointerleave', function () { show.classList.remove('hold'); sync(); });
    new IntersectionObserver(function (es) { seen = es[0].isIntersecting; sync(); }, { threshold: 0.35 }).observe(show);
  });

  // Blocks below the first screen rise in once as they scroll into view.
  // Anything already on screen when the page opens is left alone, so nothing
  // blinks on load.
  if (!reduce && 'IntersectionObserver' in window) {
    var sel = '.sec .head, .show, .tools-copy, .toolgrid > div, .picks > a, .trust > *, .plans > .plan, .feat-grid > *, .grid6 > div, .dev-rows article, .steps li, .vs article, .tbl, .faq details, .cta-band, .devs > figure';
    var els = document.querySelectorAll(sel);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var t = e.target;
        t.classList.add('in');
        io.unobserve(t);
        // Drop the stagger once it has played, so hovers are not delayed.
        setTimeout(function () { t.style.transitionDelay = ''; }, 1100);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    var vh = window.innerHeight;
    Array.prototype.forEach.call(els, function (el) {
      if (el.getBoundingClientRect().top < vh) return;
      var sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.transitionDelay = Math.min(sibs, 5) * 60 + 'ms';
      el.classList.add('rv');
      io.observe(el);
    });
  }


  // Header tightens once the page has scrolled.
  var top = document.querySelector('.top');
  if (top) {
    var tick = false;
    var onScroll = function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () { tick = false; top.classList.toggle('scrolled', window.scrollY > 8); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Monthly / yearly switch: the white pill slides to the picked side and
  // every price with a yearly form blurs out and back in with the new words.
  var bills = document.querySelectorAll('.bill');
  Array.prototype.forEach.call(bills, function (bill) {
    var pill = bill.querySelector('.bill-pill');
    var btns = bill.querySelectorAll('button[data-bill]');
    var scope = bill.parentElement;
    function place() {
      var on = bill.querySelector('button[aria-pressed="true"]');
      if (!on || !pill) return;
      pill.style.width = on.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + (on.offsetLeft - 4) + 'px)';
    }
    function set(mode) {
      Array.prototype.forEach.call(btns, function (b) { b.setAttribute('aria-pressed', String(b.dataset.bill === mode)); });
      place();
      var els = scope.querySelectorAll('.swap[data-' + mode + ']');
      Array.prototype.forEach.call(els, function (el) {
        var next = el.getAttribute('data-' + mode);
        if (el.textContent === next) return;
        if (reduce) { el.textContent = next; return; }
        el.classList.add('out');
        setTimeout(function () { el.textContent = next; el.classList.remove('out'); }, 150);
      });
    }
    Array.prototype.forEach.call(btns, function (b) { b.addEventListener('click', function () { set(b.dataset.bill); }); });
    place();
    window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  });

  // The hero demo only plays while it is on screen.
  var stage = document.querySelector('.stage');
  if (stage && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { stage.classList.toggle('paused', !es[0].isIntersecting); }).observe(stage);
  }

})();
