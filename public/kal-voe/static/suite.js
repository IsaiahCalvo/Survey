// Kal Voe suite site. One small file: menus, the app launcher, the mobile nav,
// the monthly/yearly switch, the buy page, and the demo timelines.
// The marketing CSP only allows 'self' scripts, so nothing here is inline.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Menus (Products, app launcher, mobile nav) ---------- */
  const closeAll = (except) => {
    $$('[data-menu][data-open]').forEach((m) => {
      if (m === except) return;
      m.removeAttribute('data-open');
      const b = $('button[aria-expanded]', m);
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  };
  $$('[data-menu]').forEach((menu) => {
    const btn = $(':scope > button', menu);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.hasAttribute('data-open');
      closeAll(menu);
      menu.toggleAttribute('data-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-menu]')) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $('[data-menu][data-open]');
    closeAll();
    const top = $('.top[data-open]');
    if (top) top.removeAttribute('data-open');
    const b = open && $('button[aria-expanded]', open);
    if (b) b.focus();
  });
  const burger = $('.burger');
  if (burger) {
    burger.addEventListener('click', () => {
      const top = burger.closest('.top');
      const open = !top.hasAttribute('data-open');
      top.toggleAttribute('data-open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- Monthly / yearly switch ---------- */
  const setCycle = (cycle) => {
    document.documentElement.dataset.cycle = cycle;
    $$('.cycle button[data-cycle]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cycle === cycle)));
    $$('[data-monthly]').forEach((el) => {
      const v = cycle === 'yearly' ? el.dataset.yearly : el.dataset.monthly;
      if (v != null) el.textContent = v;
    });
    $$('a[data-href-monthly]').forEach((a) => {
      a.href = cycle === 'yearly' ? a.dataset.hrefYearly : a.dataset.hrefMonthly;
    });
    document.dispatchEvent(new CustomEvent('kv:cycle', { detail: cycle }));
  };
  $$('.cycle button[data-cycle]').forEach((b) => b.addEventListener('click', () => setCycle(b.dataset.cycle)));
  const startCycle = new URLSearchParams(location.search).get('cycle');
  if ($('.cycle')) setCycle(startCycle === 'yearly' ? 'yearly' : 'monthly');

  /* ---------- Buy page ---------- */
  const buy = $('#buy');
  const cfgEl = $('#kv-config');
  if (buy && cfgEl) {
    const cfg = JSON.parse(cfgEl.textContent);
    const params = new URLSearchParams(location.search);
    const want = params.get('app');
    const radio = $$('input[name="plan"]', buy);
    const pick = radio.find((r) => r.value === want) || radio.find((r) => r.value === 'suite') || radio[0];
    if (pick) pick.checked = true;
    let seats = Math.max(1, Math.min(500, parseInt(params.get('seats'), 10) || 1));
    const money = (n) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));
    const render = () => {
      const cycle = document.documentElement.dataset.cycle || 'monthly';
      const id = (radio.find((r) => r.checked) || pick).value;
      const p = cfg.products[id];
      const yearly = cycle === 'yearly' && p.yearly != null;
      const unit = yearly ? p.yearly : p.monthly;
      const perSeat = !!p.perSeat;
      const n = perSeat ? seats : 1;
      $('#sum-name').textContent = p.name;
      $('#sum-unit').textContent = money(unit) + (perSeat ? ' per user' : '') + (yearly ? ' / year' : ' / month');
      $('#sum-seats-row').hidden = !perSeat;
      $('#seat-count').textContent = String(seats);
      $('#sum-total').textContent = money(Math.round(unit * n * 100) / 100) + (yearly ? ' / year' : ' / month');
      const note = $('#sum-note');
      if (cycle === 'yearly' && p.yearly == null) note.textContent = p.name + ' is billed monthly for now. Yearly billing isn’t offered for it yet.';
      else if (yearly && p.saveYear) note.textContent = 'Yearly saves ' + money(p.saveYear * n) + ' compared with paying monthly.';
      else note.textContent = p.note || '';
      const link = (cfg.checkout[id] || {})[yearly ? 'yearly' : 'monthly'];
      const go = $('#buy-go');
      let href = link || p.fallback;
      if (!link && p.fallbackMail) {
        const body = `Hi,\n\nI'd like to buy ${p.name} (${yearly ? 'yearly' : 'monthly'})${perSeat ? ` for ${seats} user${seats === 1 ? '' : 's'}` : ''}.\n\nThanks`;
        href = 'mailto:' + cfg.mail + '?subject=' + encodeURIComponent(p.name + ' purchase') + '&body=' + encodeURIComponent(body);
      }
      go.href = href;
      go.textContent = link ? 'Continue to checkout' : p.fallbackLabel;
      $('#buy-how').textContent = link ? 'You’ll pay on a secure Stripe checkout page.' : p.fallbackHow;
    };
    radio.forEach((r) => r.addEventListener('change', render));
    $('#seat-minus').addEventListener('click', () => { seats = Math.max(1, seats - 1); render(); });
    $('#seat-plus').addEventListener('click', () => { seats = Math.min(500, seats + 1); render(); });
    document.addEventListener('kv:cycle', render);
    render();
  }

  /* ---------- Demo timelines ----------
     Inside a .demo: elements with class "a" turn on (class "on") at data-at
     seconds and off again at data-off. A .cursor moves through data-moves
     ("t:x,y;t:x,y"). [data-count-to] counts up from data-count-from at
     data-count-at over data-count-dur. The whole demo repeats every
     data-loop seconds, and only runs while it is on screen. */
  const parseMoves = (s) => (s || '').split(';').filter(Boolean).map((p) => {
    const [t, xy] = p.split(':');
    const [x, y] = xy.split(',').map(Number);
    return { t: Number(t), x, y };
  });
  const fmt = (n, el) => {
    const d = Number(el.dataset.countDec || 0);
    let v = d ? n.toFixed(d) : String(Math.round(n));
    if (el.dataset.countPad) v = v.padStart(Number(el.dataset.countPad), '0');
    return (el.dataset.countPre || '') + v + (el.dataset.countSuf || '');
  };
  class Demo {
    constructor(root) {
      this.root = root;
      this.loop = Number(root.dataset.loop || 10);
      this.items = $$('.a, .ping', root);
      this.cursors = $$('.cursor', root).map((el) => ({ el, moves: parseMoves(el.dataset.moves) }));
      this.counts = $$('[data-count-to]', root);
      this.timers = [];
      this.raf = 0;
      this.running = false;
    }
    clear() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
      cancelAnimationFrame(this.raf);
    }
    at(sec, fn) { this.timers.push(setTimeout(fn, sec * 1000)); }
    reset() {
      this.items.forEach((el) => el.classList.remove('on'));
      this.cursors.forEach(({ el, moves }) => { if (moves[0]) el.style.transform = `translate(${moves[0].x}px,${moves[0].y}px)`; });
      this.counts.forEach((el) => { el.textContent = fmt(Number(el.dataset.countFrom || 0), el); });
    }
    final() {
      this.clear();
      this.items.forEach((el) => {
        const off = el.dataset.off != null;
        el.classList.toggle('on', !off && !el.classList.contains('ping'));
      });
      this.cursors.forEach(({ el, moves }) => { const m = moves[moves.length - 1]; if (m) el.style.transform = `translate(${m.x}px,${m.y}px)`; });
      this.counts.forEach((el) => { el.textContent = fmt(Number(el.dataset.countTo), el); });
    }
    play() {
      this.clear();
      this.reset();
      void this.root.getBoundingClientRect();
      this.items.forEach((el) => {
        const on = Number(el.dataset.at || 0);
        this.at(on, () => {
          if (el.classList.contains('ping')) { el.classList.remove('on'); void el.getBoundingClientRect(); }
          el.classList.add('on');
        });
        if (el.dataset.off != null) this.at(Number(el.dataset.off), () => el.classList.remove('on'));
      });
      this.cursors.forEach(({ el, moves }) => moves.slice(1).forEach((m) => this.at(m.t, () => el.style.transform = `translate(${m.x}px,${m.y}px)`)));
      this.counts.forEach((el) => {
        const from = Number(el.dataset.countFrom || 0);
        const to = Number(el.dataset.countTo);
        const start = Number(el.dataset.countAt || 0);
        const dur = Number(el.dataset.countDur || 1);
        this.at(start, () => {
          const t0 = performance.now();
          const step = (now) => {
            const k = Math.min(1, (now - t0) / (dur * 1000));
            const e = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(from + (to - from) * e, el);
            if (k < 1) this.raf = requestAnimationFrame(step);
          };
          this.raf = requestAnimationFrame(step);
        });
      });
      // Fade everything back out just before the loop restarts.
      this.at(this.loop - 0.6, () => this.items.forEach((el) => el.classList.remove('on')));
      this.at(this.loop, () => { if (this.running) this.play(); });
    }
    start() {
      if (this.running) return;
      this.running = true;
      if (reduced.matches) { this.final(); return; }
      this.play();
    }
    stop() {
      this.running = false;
      this.clear();
    }
  }
  const demos = $$('.demo').map((el) => new Demo(el));
  if (demos.length) {
    if (!('IntersectionObserver' in window)) demos.forEach((d) => d.final());
    else {
      const byEl = new Map(demos.map((d) => [d.root, d]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          const d = byEl.get(en.target);
          if (en.isIntersecting) d.start();
          else d.stop();
        });
      }, { threshold: 0.25 });
      demos.forEach((d) => { d.reset(); io.observe(d.root); });
    }
    reduced.addEventListener && reduced.addEventListener('change', () => demos.forEach((d) => { if (d.running) { d.stop(); d.start(); } }));
    document.addEventListener('visibilitychange', () => {
      demos.forEach((d) => {
        if (document.hidden && d.running) { d.stop(); d.wasRunning = true; }
        else if (!document.hidden && d.wasRunning) { d.wasRunning = false; d.start(); }
      });
    });
  }
})();
