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

  /* ---------- Buy page ----------
     Suite, Walkthru Pro and Survey Pro go to a Stripe checkout made by
     the suite-checkout function. Plot is free in early access, so its
     choice just opens the app. */
  const buy = $('#buy');
  const cfgEl = $('#kv-config');
  if (buy && cfgEl) {
    const cfg = JSON.parse(cfgEl.textContent);
    const params = new URLSearchParams(location.search);
    const want = params.get('app');
    const radio = $$('input[name="plan"]', buy);
    const pick = radio.find((r) => r.value === want) || radio.find((r) => r.value === 'suite') || radio[0];
    if (pick) pick.checked = true;
    const money = (n) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));
    const go = $('#buy-go');
    const open = $('#buy-open');
    const err = $('#buy-error');
    const email = $('#buy-email');
    const current = () => {
      const cycle = document.documentElement.dataset.cycle === 'yearly' ? 'yearly' : 'monthly';
      const id = (radio.find((r) => r.checked) || pick).value;
      return { id, cycle, p: cfg.products[id] };
    };
    const render = () => {
      const { cycle, p } = current();
      err.hidden = true;
      $('#sum-name').textContent = p.name;
      if (p.free) {
        $('#sum-unit').textContent = 'Free while in early access';
        $('#sum-total').textContent = '$0';
        $('#sum-note').textContent = '';
        go.hidden = true;
        open.hidden = false;
        open.href = p.fallback;
        open.textContent = p.fallbackLabel;
        $('#buy-how').textContent = p.fallbackHow;
        return;
      }
      const yearly = cycle === 'yearly';
      const unit = yearly ? p.yearly : p.monthly;
      const per = p.perSeat ? ' per user' : '';
      $('#sum-unit').textContent = money(unit) + per + (yearly ? ' / year' : ' / month');
      $('#sum-total').textContent = '$0';
      const days = cfg.trialDays || 7;
      const trial = days + '-day free trial, then ' + money(unit) + per + (yearly ? ' a year.' : ' a month.');
      $('#sum-note').textContent = yearly && p.saveYear ? trial + ' Yearly saves ' + money(p.saveYear) + ' compared with paying monthly.' : trial;
      go.hidden = false;
      go.disabled = false;
      go.textContent = 'Continue to checkout';
      open.hidden = true;
      $('#buy-how').textContent = 'You’ll pay on a secure Stripe checkout page. Cancel before the trial ends and you won’t be charged.';
    };
    const fail = () => {
      go.disabled = false;
      go.textContent = 'Continue to checkout';
      err.hidden = false;
    };
    buy.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { id, cycle, p } = current();
      if (p.free || !p.checkout) return;
      go.disabled = true;
      go.textContent = 'Opening checkout…';
      err.hidden = true;
      const body = { plan: id, cycle, returnUrl: location.origin + '/buy/thanks' };
      const mail = email && email.value.trim();
      if (mail) body.email = mail;
      try {
        const res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = res.ok ? await res.json() : null;
        const url = data && typeof data.url === 'string' ? data.url : '';
        if (url.startsWith('https://checkout.stripe.com/')) location.assign(url);
        else fail();
      } catch {
        fail();
      }
    });
    radio.forEach((r) => r.addEventListener('change', render));
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
