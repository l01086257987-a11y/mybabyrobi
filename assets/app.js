/* 우리의 첫 장면 — 생일 상영관
 * 내용(편지·사진·영상)은 data/ 안에 암호화되어 있고, 입장 날짜를 맞혀야 브라우저에서 풀립니다.
 * 내용 수정은 private/content.json → `node tools/encrypt.mjs` (README 참고)
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const noop = () => {};
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- 날짜 ---------- */
  const pad = n => String(n).padStart(2, '0');
  const parseDate = s => { const [y, m, d] = String(s).split(/\D+/).map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const dotDate = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const spacedDate = d => `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}`;
  const koDate = d => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  // firstDay: 사귄 날을 몇 일로 셀지 (0 이면 사귄 날 = 0일, 1 이면 사귄 날 = 1일)
  const daysSince = (d, firstDay = 1) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - d) / 864e5) + firstDay; };

  /* ---------- 암호 ---------- */
  const normalize = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 6) d = '20' + d; return d; };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(pw, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decrypt(key, buf) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12));
  }
  async function fetchBytes(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!onProgress || !total || !res.body) return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(got / total, 1));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  }

  const state = { key: null, content: null, contentBuf: null, gate: null, tries: 0, days: 0, mediaCache: new Map(), warm: new Map(), warmProg: new Map(), musicURL: null, musicWanted: false };

  function mediaURL(ref, onProgress) {
    if (!ref || !ref.src) return Promise.reject(new Error('no media'));
    if (!state.mediaCache.has(ref.src)) {
      state.mediaCache.set(ref.src, (async () => {
        const warm = state.warm.get(ref.src);           // 입장권 화면에서 미리 받기 시작한 파일이면 그걸 기다린다
        let tick = 0;
        if (warm && onProgress) tick = setInterval(() => onProgress(state.warmProg.get(ref.src) || 0), 200);
        const buf = await (warm ? warm.catch(() => fetchBytes(ref.src, onProgress)) : fetchBytes(ref.src, onProgress)).finally(() => clearInterval(tick));
        state.warm.delete(ref.src); state.warmProg.delete(ref.src);
        const plain = await decrypt(state.key, buf);
        return URL.createObjectURL(new Blob([plain], { type: ref.type || '' }));
      })());
    }
    return state.mediaCache.get(ref.src);
  }
  async function pool(tasks, n) {
    const run = async () => { while (tasks.length) { try { await tasks.shift()(); } catch (e) { console.warn(e); } } };
    await Promise.all(Array.from({ length: n }, run));
  }

  /* ---------- 꽃잎 ---------- */
  const Petals = (() => {
    const cv = $('#petals');
    const ctx = cv.getContext('2d');
    const COLORS = ['#f7cdd7', '#f1b4c3', '#eba1b5', '#f9dfe5', '#e48ea6'];
    const SPARK = ['#e2c07f', '#f4ebe1', '#f1b4c3', '#ff9a3c'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[(Math.random() * arr.length) | 0];
    let W = 0, H = 0, wanted = 0, running = false, raf = 0, last = 0;
    const flakes = [], bits = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      wanted = reduceMotion ? 0 : Math.round(Math.min(46, Math.max(16, (W * H) / 24000)));
    }
    const flake = fromTop => ({
      x: rnd(-20, W + 20), y: fromTop ? rnd(-H * .4, -20) : rnd(-20, H),
      s: rnd(5, 11), r: rnd(0, 6.28), vr: rnd(-.025, .025), vy: rnd(.45, 1.05),
      sway: rnd(.4, 1.3), ph: rnd(0, 6.28), fl: rnd(0, 6.28), vf: rnd(.015, .045),
      c: pick(COLORS), a: rnd(.5, .92),
    });
    function petal(x, y, s, r, flip, color, alpha) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(r); ctx.scale(flip, 1);
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.bezierCurveTo(s * .95, s * .55, s * .8, -s * .7, s * .2, -s * .9);
      ctx.lineTo(0, -s * .66);
      ctx.lineTo(-s * .2, -s * .9);
      ctx.bezierCurveTo(-s * .8, -s * .7, -s * .95, s * .55, 0, s);
      ctx.fill();
      ctx.restore();
    }
    function frame(t) {
      const dt = Math.min((t - last) || 16, 48) / 16.67;
      last = t;
      ctx.clearRect(0, 0, W, H);
      while (running && flakes.length < wanted) flakes.push(flake(true));
      for (let i = flakes.length - 1; i >= 0; i--) {
        const p = flakes[i];
        p.ph += .02 * dt; p.fl += p.vf * dt; p.r += p.vr * dt;
        p.y += p.vy * dt; p.x += (Math.sin(p.ph) * p.sway + .3) * dt;
        if (p.y > H + 24 || p.x > W + 40) {
          if (running && flakes.length <= wanted) flakes[i] = flake(true); else flakes.splice(i, 1);
          continue;
        }
        petal(p.x, p.y, p.s, p.r, Math.cos(p.fl), p.c, p.a);
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        const drag = Math.pow(.985, dt);
        b.vy = b.vy * drag + .16 * dt; b.vx *= drag;
        b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt; b.fl += b.vf * dt;
        b.life -= dt / 170;
        if (b.life <= 0 || b.y > H + 40) { bits.splice(i, 1); continue; }
        const alpha = Math.min(1, b.life * 2.5) * b.a;
        if (b.petal) petal(b.x, b.y, b.s, b.r, Math.cos(b.fl), b.c, alpha);
        else {
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.scale(Math.cos(b.fl), 1);
          ctx.globalAlpha = alpha; ctx.fillStyle = b.c;
          ctx.fillRect(-b.s / 2, -b.s, b.s, b.s * 2);
          ctx.restore();
        }
      }
      if (running || flakes.length || bits.length) raf = requestAnimationFrame(frame);
      else { raf = 0; ctx.clearRect(0, 0, W, H); }
    }
    function loop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    resize();
    window.addEventListener('resize', resize);
    return {
      start() { running = true; loop(); },
      stop() { running = false; },
      burst(x, y) {
        if (reduceMotion) return;
        for (let i = 0; i < 140; i++) {
          const ang = rnd(-Math.PI * .93, -Math.PI * .07), v = rnd(4, 12.5), isPetal = Math.random() < .55;
          bits.push({
            petal: isPetal, x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
            s: isPetal ? rnd(5, 10) : rnd(2.5, 4.5), r: rnd(0, 6.28), vr: rnd(-.15, .15),
            fl: rnd(0, 6.28), vf: rnd(.05, .2), life: 1, a: rnd(.75, 1),
            c: isPetal ? pick(COLORS) : pick(SPARK),
          });
        }
        cv.classList.add('front');
        setTimeout(() => cv.classList.remove('front'), 3200);
        loop();
      },
    };
  })();

  /* ---------- 오프닝 꽃다발: 작약(피오니) 다발을 SVG 로 그린다 ---------- */
  function buildBloom(svg) {
    let seed = 20261122;
    const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const R = (a, b) => a + rnd() * (b - a);
    const f = n => n.toFixed(1);
    // 사진 속 색: 연분홍 · 분홍 · 진분홍(자홍) · 흰빛
    const pal = [
      { tip: '#fbc9dc', mid: '#ec86b1', base: '#b33e6d', ball: ['#f09cbe', '#d9619a', '#9c3062'], w: 44 },
      { tip: '#fde2ec', mid: '#f4a8c5', base: '#cc6690', ball: ['#f7c2d6', '#e78fb2', '#bd5d86'], w: 22 },
      { tip: '#f8a6ca', mid: '#d8457f', base: '#86174a', ball: ['#e46c9e', '#c13472', '#7a1442'], w: 22 },
      { tip: '#ffffff', mid: '#f9dce6', base: '#cf93a9', ball: ['#fdeef3', '#efc8d5', '#c78aa1'], w: 12 },
    ];
    let defs = '';
    pal.forEach((p, i) => {
      defs += `<linearGradient id="pp${i}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.base}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.tip}"/></linearGradient>`;
      defs += `<linearGradient id="pp${i}b" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.base}"/><stop offset=".7" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.mid}"/></linearGradient>`;
      defs += `<radialGradient id="pb${i}" cx=".42" cy=".38" r=".62"><stop offset="0" stop-color="${p.ball[0]}"/><stop offset=".6" stop-color="${p.ball[1]}"/><stop offset="1" stop-color="${p.ball[2]}"/></radialGradient>`;
    });
    defs += `<radialGradient id="pshade" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#5a0f2e" stop-opacity="0"/><stop offset="1" stop-color="#5a0f2e" stop-opacity=".32"/></radialGradient>
      <radialGradient id="pheart" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#6b1033" stop-opacity=".55"/><stop offset="1" stop-color="#6b1033" stop-opacity="0"/></radialGradient>
      <linearGradient id="wrapL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7d9d3"/><stop offset=".6" stop-color="#eebfb8"/><stop offset="1" stop-color="#d79e98"/></linearGradient>
      <linearGradient id="wrapR" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4d0ca"/><stop offset=".55" stop-color="#e8b2ad"/><stop offset="1" stop-color="#cf918c"/></linearGradient>
      <linearGradient id="tissue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9c2d6"/><stop offset="1" stop-color="#e98fb2"/></linearGradient>
      <linearGradient id="tissue2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbd3e1"/><stop offset="1" stop-color="#f0a5c2"/></linearGradient>
      <linearGradient id="leaf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f5a3d"/><stop offset="1" stop-color="#6d9a68"/></linearGradient>
      <linearGradient id="satin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbc6d8"/><stop offset=".5" stop-color="#f08db1"/><stop offset="1" stop-color="#d8668f"/></linearGradient>`;

    // 꽃잎 하나: 바닥(0,0)에서 위(-y)로, 끝이 물결처럼 주름진다
    const petal = (w, h) => {
      const b = () => R(0.94, 1.08);
      return `M0 0C${f(-w * .58)} ${f(-h * .12)} ${f(-w * .64)} ${f(-h * .7)} ${f(-w * .42)} ${f(-h * .9)}` +
        `Q${f(-w * .27)} ${f(-h * b())} ${f(-w * .1)} ${f(-h * .94)}Q${f(w * .06)} ${f(-h * b())} ${f(w * .22)} ${f(-h * .95)}` +
        `Q${f(w * .38)} ${f(-h * b())} ${f(w * .45)} ${f(-h * .86)}C${f(w * .64)} ${f(-h * .64)} ${f(w * .56)} ${f(-h * .12)} 0 0Z`;
    };
    // 작약 한 송이: 둥근 공 위에 바깥 → 안쪽으로 점점 작은 꽃잎 고리를 겹친다
    const peony = (r, pi) => {
      let s = `<ellipse cx="${f(r * .1)}" cy="${f(r * .22)}" rx="${f(r * 1.08)}" ry="${f(r * 1.0)}" fill="#3a0a20" opacity=".34"/>`;
      s += `<circle r="${f(r * .9)}" fill="url(#pb${pi})"/>`;
      const rings = [[9, .22, .92, .64], [9, .15, .76, .54], [8, .09, .6, .46], [7, .05, .45, .38], [6, .02, .31, .3], [4, 0, .17, .21]];
      let rot = R(0, 360);
      rings.forEach(([n, dist, h, w], ri) => {
        rot += 360 / n / 2 + R(-8, 8);
        for (let k = 0; k < n; k++) {
          const a = rot + k * 360 / n + R(-9, 9);
          s += `<path d="${petal(r * w * R(.9, 1.12), r * h * R(.9, 1.08))}" fill="url(#pp${pi}${rnd() < .4 ? 'b' : ''})" stroke="${ri ? 'rgba(255,255,255,.3)' : 'rgba(130,25,65,.3)'}" stroke-width="${ri ? .5 : .8}" transform="rotate(${f(a)}) translate(0 ${f(-r * dist)})"/>`;
        }
        if (ri === 3) s += `<circle r="${f(r * .3)}" fill="url(#pheart)"/>`;
      });
      s += `<ellipse cx="${f(-r * .3)}" cy="${f(-r * .38)}" rx="${f(r * .32)}" ry="${f(r * .18)}" fill="#fff" opacity=".16" transform="rotate(-30 ${f(-r * .3)} ${f(-r * .38)})"/>`;
      return s;
    };
    const pickPal = () => { const t = R(0, 100); let acc = 0; for (let i = 0; i < pal.length; i++) { acc += pal[i].w; if (t < acc) return i; } return 0; };
    const leaf = (x, y, a, s) => `<path d="M0 0C${f(-14 * s)} ${f(-18 * s)} ${f(-12 * s)} ${f(-44 * s)} 0 ${f(-58 * s)}C${f(12 * s)} ${f(-44 * s)} ${f(14 * s)} ${f(-18 * s)} 0 0Z" fill="url(#leaf)" transform="translate(${x} ${y}) rotate(${a})"/>` +
      `<path d="M0 -2L0 ${f(-54 * s)}" stroke="rgba(255,255,255,.18)" stroke-width=".8" transform="translate(${x} ${y}) rotate(${a})"/>`;

    // 뒤: 분홍 얇은 포장지가 부채처럼 펼쳐지고, 잎이 살짝 보인다
    let back = `<ellipse cx="0" cy="-34" rx="128" ry="104" fill="url(#tissue)"/>`;
    back += `<path d="M-6 120L-150 -38Q-148 -92 -112 -112Z" fill="url(#tissue)" opacity=".95"/>`;
    back += `<path d="M6 120L150 -40Q146 -96 108 -114Z" fill="url(#tissue)" opacity=".95"/>`;
    back += `<path d="M0 120L-96 -128Q-30 -158 30 -150Z" fill="url(#tissue2)"/>`;
    back += `<path d="M0 120L34 -152Q92 -148 112 -118Z" fill="url(#tissue2)"/>`;
    back += `<path d="M-2 110L-118 -96M2 110L-40 -150M4 110L96 -128M6 110L140 -70" stroke="rgba(255,255,255,.28)" stroke-width="1.1" fill="none"/>`;
    back += leaf(-112, -6, -64, 1.05) + leaf(116, -14, 62, 1) + leaf(-70, -104, -28, .9) + leaf(78, -100, 30, .85);

    // 꽃: 돔 모양으로 촘촘히 (위·뒤쪽부터 그려서 아래·앞쪽 꽃이 위에 겹치게)
    const spots = [];
    const sp = 39;
    for (let row = -4; row <= 4; row++) {
      const y = -30 + row * sp * .8;
      for (let col = -4; col <= 4; col++) {
        const x = col * sp + (row % 2 ? sp / 2 : 0);
        const ex = x / 116, ey = (y + 34) / 94;
        if (ex * ex + ey * ey > 1 || y > 28) continue;
        spots.push([x + R(-5, 5), y + R(-5, 5)]);
      }
    }
    spots.sort((a, b) => a[1] - b[1]);
    let flowers = '';
    spots.forEach(([x, y], i) => {
      const r = R(31, 36);
      flowers += `<g transform="translate(${f(x)} ${f(y)}) scale(1 ${f(.9 + .1 * Math.max(0, -y) / 120)})"><g class="bq-f" style="--d:${(.55 + i * .05).toFixed(2)}s">${peony(r, pickPal())}</g></g>`;
    });

    // 앞: 크래프트빛 분홍 포장지 두 장이 V 자로 겹치고, 리본으로 묶는다
    let front = '';
    front += `<path d="M-124 -4Q-86 30 -20 40Q16 44 50 36L20 128L-20 128Z" fill="url(#wrapL)"/>`;
    front += `<path d="M124 -6Q86 32 24 42Q-12 46 -48 38L-20 128L20 128Z" fill="url(#wrapR)"/>`;
    front += `<path d="M-124 -4Q-86 30 -20 40Q16 44 50 36" fill="none" stroke="rgba(90,20,40,.18)" stroke-width="4" transform="translate(0 4)"/>`;
    front += `<path d="M124 -6Q86 32 24 42Q-12 46 -48 38" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>`;
    front += `<path d="M-60 34L-12 124M64 32L14 124" stroke="rgba(120,60,60,.14)" stroke-width="1.2"/>`;
    front += `<path d="M-20 128L-34 168L34 168L20 128Z" fill="url(#wrapR)"/><path d="M-34 168L34 168" stroke="rgba(120,60,60,.18)"/>`;
    const bow = `<g class="bq-bow">
      <path d="M-4 128C-30 104 -62 108 -58 128C-55 146 -26 142 -4 132Z" fill="url(#satin)"/>
      <path d="M4 128C30 104 62 108 58 128C55 146 26 142 4 132Z" fill="url(#satin)"/>
      <path d="M-46 122C-36 116 -22 120 -10 128" stroke="rgba(255,255,255,.5)" stroke-width="1.4" fill="none"/>
      <path d="M46 122C36 116 22 120 10 128" stroke="rgba(255,255,255,.5)" stroke-width="1.4" fill="none"/>
      <path d="M-5 133L-26 176L-16 172L-10 182L2 135Z" fill="url(#satin)"/>
      <path d="M5 133L24 178L14 173L9 184L-2 135Z" fill="url(#satin)"/>
      <rect x="-8" y="122" width="16" height="15" rx="5" fill="#e87ea6"/>
      <rect x="-5" y="124" width="5" height="11" rx="2.5" fill="rgba(255,255,255,.35)"/>
    </g>`;
    svg.setAttribute('viewBox', '-150 -160 300 350');
    svg.innerHTML = `<defs>${defs}</defs><g class="bq-back">${back}</g><g class="bq-flowers">${flowers}</g><g class="bq-front">${front}</g>${bow}`;
  }

  /* ---------- 케이크 ---------- */
  function buildCake(svg, count) {
    const n = Math.max(1, Math.min(9, count | 0 || 3));
    const cream = '#fff6ee';
    const drips = (x0, x1, y, seed) => {
      let s = '';
      for (let x = x0 + 8, i = 0; x < x1 - 10; x += 19, i++) {
        const h = 8 + ((i * 7 + seed) % 5) * 3.4;
        s += `<rect x="${x}" y="${y}" width="11" height="${h}" rx="5.5" fill="${cream}"/>`;
      }
      return s;
    };
    const dots = (x0, x1, y, c) => {
      let s = '';
      for (let x = x0 + 16; x < x1 - 8; x += 22) s += `<circle cx="${x}" cy="${y}" r="3.2" fill="${c}"/>`;
      return s;
    };
    const span = Math.min(26, 100 / n);
    let candles = '';
    for (let i = 0; i < n; i++) {
      const x = 120 + (i - (n - 1) / 2) * span;
      candles += `<g class="candle" style="--i:${i}" transform="translate(${x.toFixed(1)} 0)">
        <circle class="glow" cx="0" cy="26" r="17" fill="url(#cglow)"/>
        <rect x="-3.6" y="40" width="7.2" height="32" rx="2" fill="#fdf6ee"/>
        <rect x="-3.6" y="40" width="7.2" height="32" rx="2" fill="url(#cstripe)"/>
        <line x1="0" y1="40" x2="0" y2="35" stroke="#4a3a33" stroke-width="1.4" stroke-linecap="round"/>
        <path class="flame" d="M0 14C6 22 6.5 30 0 35C-6.5 30 -6 22 0 14Z" fill="url(#cflame)"/>
        <path class="smoke" d="M0 32C-5 25 5 19 0 11C-4 5 3 -1 0 -8" stroke="#d9cec9" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      </g>`;
    }
    svg.innerHTML = `
      <defs>
        <radialGradient id="cflame" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#ffd46b"/><stop offset="1" stop-color="#ff8a3c"/></radialGradient>
        <radialGradient id="cglow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
        <pattern id="cstripe" width="7" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="7" height="4" fill="#e9a5b5"/></pattern>
      </defs>
      <ellipse cx="120" cy="195" rx="106" ry="11" fill="#2a1621"/>
      <ellipse cx="120" cy="191" rx="104" ry="10" fill="#efe4d8"/>
      <rect x="28" y="124" width="184" height="66" rx="10" fill="#f2cdd6"/>
      ${dots(28, 212, 168, '#c95c78')}
      <rect x="25" y="119" width="190" height="15" rx="7.5" fill="${cream}"/>
      ${drips(28, 212, 126, 2)}
      <rect x="60" y="76" width="120" height="52" rx="9" fill="#f7e3df"/>
      ${dots(60, 180, 108, '#e2c07f')}
      <rect x="57" y="71" width="126" height="14" rx="7" fill="${cream}"/>
      ${drips(60, 180, 78, 0)}
      ${candles}`;
  }

  /* ---------- 입장 ---------- */
  const gate = $('#gate'), ticket = $('#ticket'), form = $('#gate-form'), input = $('#gate-input'), gateBtn = $('#gate-btn'), gateMsg = $('#gate-msg');
  const film = $('#film'), opening = $('#opening');
  const audio = $('#music'), musicBtn = $('#music-btn');
  const say = t => { gateMsg.textContent = t; };

  function shake() {
    ticket.classList.remove('shake');
    void ticket.offsetWidth;
    ticket.classList.add('shake');
  }

  function silentWav() {
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  async function initGate() {
    document.body.classList.add('locked');
    $('#ticket-date').textContent = dotDate(new Date());
    buildBloom($('#bloom'));

    input.addEventListener('input', () => {
      const d = input.value.replace(/\D/g, '').slice(0, 8);
      input.value = d.slice(0, 4) + (d.length > 4 ? '.' + d.slice(4, 6) : '') + (d.length > 6 ? '.' + d.slice(6) : '');
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      primeMusic();   // 휴대폰에서 음악을 나중에 틀 수 있도록, 탭한 순간에 오디오를 깨워 둔다
      tryUnlock(input.value);
    });

    try {
      const res = await fetch('data/gate.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      state.gate = await res.json();
      if (state.gate.question) $('#gate-q').textContent = state.gate.question;
      fetchBytes('data/content.bin').then(b => { state.contentBuf = b; }, noop);
      // 날짜를 입력하는 동안 배경 음악 → 재현 영상 순서로 미리 받아 둔다 (음악이 먼저 다 오도록 하나씩)
      let chain = Promise.resolve();
      (state.gate.warm || []).forEach(src => {
        if (typeof src !== 'string') return;
        const p = chain.then(() => fetchBytes(src, v => state.warmProg.set(src, v)));
        p.catch(noop);
        state.warm.set(src, p);
        chain = p.catch(noop);
      });
    } catch (e) {
      console.error(e);
      say(location.protocol === 'file:'
        ? '파일을 직접 열면 안 돼요. README의 "미리보기" 방법으로 열어 주세요.'
        : '상영관 문을 여는 데 실패했어. 잠시 후 새로고침해 줘.');
    }
  }

  async function tryUnlock(raw) {
    const gateInfo = state.gate;
    if (!gateInfo) return;
    const pw = normalize(raw);
    if (pw.length !== 8) { say('날짜 8자리로 적어 줘. 예) 2024.03.12'); shake(); return; }
    gateBtn.disabled = true;
    say('확인하는 중…');
    try {
      const key = await deriveKey(pw, fromB64(gateInfo.salt), gateInfo.iter);
      if (!state.contentBuf) state.contentBuf = await fetchBytes('data/content.bin');
      const plain = await decrypt(key, state.contentBuf);
      state.key = key;
      state.pw = pw; // 게임 채팅 암호화에 쓴다 (메모리에만)
      state.content = JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      gateBtn.disabled = false;
      if (e && e.name === 'OperationError') {
        state.tries++;
        shake();
        say(state.tries >= 2 && gateInfo.hint ? `음… 아니야. 힌트: ${gateInfo.hint}` : '음… 그날이 아니야. 다시 생각해 봐.');
      } else {
        console.error(e);
        say('불러오는 중에 문제가 생겼어. 새로고침해 줘.');
      }
      return;
    }
    say('');
    enter();
  }

  async function enter() {
    const c = state.content;
    render(c);
    loadMedia(c);
    ticket.classList.add('torn');
    await wait(reduceMotion ? 0 : 950);
    film.hidden = false;
    document.body.classList.remove('locked');
    window.scrollTo(0, 0);
    gate.classList.add('leaving');
    opening.classList.add('run');
    setTimeout(() => { gate.hidden = true; }, 1000);
    setTimeout(() => Petals.start(), reduceMotion ? 0 : 2200);
    setupReveals();
    // Beomjun 전용 링크(#beomjun)로 들어오면 바로 광장으로
    if (location.hash === '#beomjun' && c.game) setTimeout(() => enterGame('beomjun'), reduceMotion ? 0 : 1200);
  }

  /* ---------- 내용 채우기 ---------- */
  const video = $('#meet-video'), screenEl = $('#screen'), cover = $('#screen-cover'), playBtn = $('#play-btn'), playLabel = $('#play-label');

  function render(c) {
    const her = c.her || {};
    const scenes = c.scenes || {};
    $('#greeting').textContent = `생일 축하해, ${her.call || her.name || ''}`;
    if (c.birthday) $('#birthday-text').textContent = spacedDate(parseDate(c.birthday));

    // S#1
    const m = c.firstMeet || {};
    const md = m.date ? parseDate(m.date) : null;
    $('#meet-slug').textContent = `${m.place || ''}${m.time ? ` (${m.time})` : ''}`;
    const title = $('#meet-title');
    title.textContent = '';
    if (md) title.append(`${koDate(md)},`, el('br'));
    title.append(el('em', null, m.line || '우리가 처음 만난 날'));
    // 영상 아래 글: 빈 줄로 문단을 나누고, 영상을 다 본 뒤에 한 문단씩 나타난다
    const note = $('#meet-note');
    note.textContent = '';
    String(m.note || '').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean).forEach((t, i) => {
      const para = el('p', null, t);
      para.style.setProperty('--i', i);
      note.append(para);
    });
    note.hidden = Boolean(m.video) || !note.children.length;
    if (md) $('#date-stamp').textContent = `'${String(md.getFullYear()).slice(2)} ${md.getMonth() + 1} ${md.getDate()}`;
    $('#real-caption').textContent = m.realCaption || '';
    $('#real-caption').hidden = !m.realCaption;
    $('.real-photo').classList.toggle('no-cap', !m.realCaption);
    if (m.realAlt) $('#real-img').alt = m.realAlt;
    if (!m.video) screenEl.hidden = true;

    // S#2
    $('#days-slug').textContent = scenes.days || '그 후의 우리 (계속)';
    const t = c.together || {};
    const since = t.since ? parseDate(t.since) : md;
    if (since) {
      state.days = daysSince(since, t.firstDay === 0 ? 0 : 1);
      $('#counter-label').textContent = t.label || '우리가 함께한 지';
      const today = new Date();
      const bd = c.birthday ? parseDate(c.birthday) : null;
      const isBirthday = bd && today.getMonth() === bd.getMonth() && today.getDate() === bd.getDate();
      const milestone = state.days > 0 && (state.days === 30 || state.days === 50 || state.days % 100 === 0);
      $('#counter-sub').textContent = isBirthday && t.birthdayNote ? t.birthdayNote
        : milestone ? `오늘은 우리 ${state.days.toLocaleString('ko-KR')}일이야`
        : `${koDate(since)}부터 오늘까지`;
    } else {
      $('#counter').hidden = true;
    }
    const strip = $('#filmstrip');
    strip.textContent = '';
    (c.moments || []).forEach(mo => {
      const li = el('li', 'frame');
      const box = el('div', 'frame-img');
      if (mo.ratio > 0) box.style.aspectRatio = String(mo.ratio); // 사진 모양 그대로 (휴대폰 캡처도 잘리지 않게)
      const img = el('img');
      img.alt = mo.caption || '우리 사진';
      img.decoding = 'async';
      img.addEventListener('load', () => img.classList.add('loaded'));
      box.append(img);
      const cap = el('div', 'frame-cap');
      if (mo.date) { const tm = el('time', null, dotDate(parseDate(mo.date))); tm.dateTime = mo.date; cap.append(tm); }
      if (mo.caption) cap.append(el('p', null, mo.caption));
      li.append(box, cap);
      strip.append(li);
    });
    if (!strip.children.length) strip.hidden = true;

    // S#3
    $('#letter-slug').textContent = scenes.letter || '편지 (밤)';
    const L = c.letter || {};
    const paper = $('#letter-paper');
    paper.textContent = '';
    let i = 0;
    const line = (cls, text) => { if (!text) return; const p = el('p', cls, text); p.style.setProperty('--i', i++); paper.append(p); };
    line('letter-to', L.to);
    (L.paragraphs || []).forEach(p => line('', p));
    line('letter-closing', L.closing);
    line('letter-from', L.from);
    line('letter-date', L.date);

    // S#4
    $('#cake-slug').textContent = scenes.cake || '오늘 (지금)';
    const cake = c.cake || {};
    $('#cake-title').textContent = cake.title || '촛불 끄고, 소원 빌어 줘';
    buildCake($('#cake-svg'), cake.candles);

    // 선물 · 게임
    if (c.gift) renderGift(c.gift);
    $('#game-invite-text').textContent = (c.game && c.game.invite) || '';
    renderInvitation(c);

    // 크레딧
    const roll = $('#credits-roll');
    roll.textContent = '';
    const head = el('p', 'credits-head', 'Our First Scene');
    head.append(el('small', null, '우리의 첫 장면'));
    roll.append(head);
    (c.credits || []).forEach(cr => {
      const dl = el('dl', 'credit');
      dl.append(el('dt', null, cr.role), el('dd', null, cr.name));
      roll.append(dl);
    });
    const end = c.ending || {};
    $('#final-big').textContent = end.big || 'To be continued';
    $('#final-line').textContent = end.line || '';
    $('#final-small').textContent = end.small || '';
  }

  /* ---------- 사진 · 영상 · 음악 ---------- */
  function loadMedia(c) {
    const m = c.firstMeet || {};
    if (m.poster) {
      mediaURL(m.poster).then(u => {
        cover.style.backgroundImage = `url("${u}")`;
        video.poster = u;
        const probe = new Image();
        probe.onload = () => { if (!video.videoWidth && probe.naturalHeight) screenEl.style.setProperty('--ar', (probe.naturalWidth / probe.naturalHeight).toFixed(4)); };
        probe.src = u;
      }).catch(e => console.warn(e));
    }
    if (c.music) mediaURL(c.music).then(setupMusic).catch(e => console.warn(e));
    if (!c.music && audio.src) { audio.pause(); audio.removeAttribute('src'); }
    if (m.video) loadVideo(m.video);                // 입장권 화면에서 음악 다음으로 미리 받기 시작했다
    if (m.realPhoto) mediaURL(m.realPhoto).then(u => { $('#real-img').src = u; state.hasReal = true; }).catch(e => console.warn(e));

    const imgs = [...document.querySelectorAll('#filmstrip img')];
    const tasks = (c.moments || []).map((mo, i) => () => mo.photo ? mediaURL(mo.photo).then(u => { imgs[i].src = u; }) : null);
    pool(tasks, 3);
  }

  async function loadVideo(ref) {
    try {
      const url = await mediaURL(ref, p => { playLabel.textContent = `필름 감는 중… ${Math.round(p * 100)}%`; });
      video.addEventListener('loadedmetadata', () => {
        if (video.videoWidth) screenEl.style.setProperty('--ar', (video.videoWidth / video.videoHeight).toFixed(4));
      }, { once: true });
      video.src = url;
      playBtn.disabled = false;
      playLabel.textContent = '상영 시작';
    } catch (e) {
      console.error(e);
      playLabel.textContent = '영상을 불러오지 못했어';
      showAfterFilm();
    }
  }

  /* ---------- 상영관: 위아래 검은 띠가 들어오며 전체화면 ---------- */
  const cinema = $('#cinema');
  let cinemaState = 'closed'; // closed | open | closing
  let cinemaIntro = false;     // 검은 띠가 내려오는 중
  const CINEMA_IN = 2400, CINEMA_OUT = 1400; // style.css 의 전환 시간과 맞춘다
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function enterFullscreen(node) {
    const req = node.requestFullscreen || node.webkitRequestFullscreen;
    if (!req) return; // 아이폰은 지원 안 함 → 화면을 덮는 것으로 대신
    try { const r = req.call(node, { navigationUI: 'hide' }); if (r && r.catch) r.catch(noop); } catch { /* 무시 */ }
  }
  function exitFullscreen() {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fsElement() || !ex) return;
    try { const r = ex.call(document); if (r && r.catch) r.catch(noop); } catch { /* 무시 */ }
  }
  function placeStageAtScreen() {
    const r = screenEl.getBoundingClientRect();
    cinema.style.setProperty('--x', `${r.left}px`);
    cinema.style.setProperty('--y', `${r.top}px`);
    cinema.style.setProperty('--w', `${r.width}px`);
    cinema.style.setProperty('--h', `${r.height}px`);
  }
  function sizeBars() {
    const W = cinema.clientWidth || window.innerWidth, H = cinema.clientHeight || window.innerHeight;
    const ar = video.videoWidth ? video.videoWidth / video.videoHeight : (parseFloat(screenEl.style.getPropertyValue('--ar')) || 16 / 9);
    const bar = Math.max((H - W / ar) / 2, H * .07);
    cinema.style.setProperty('--bar', `${Math.round(bar)}px`);
    cinema.classList.toggle('thin', bar < 52);
  }
  function openCinema() {
    if (cinemaState !== 'closed' || !video.src) return;
    placeStageAtScreen();
    cinema.hidden = false;
    sizeBars();
    document.body.classList.add('locked');
    if (video.ended) video.currentTime = 0;
    // 탭한 순간에 한 번 재생했다 멈춰서 휴대폰의 자동재생 제한을 풀어 두고, 띠가 다 내려온 뒤 진짜로 튼다
    cinemaIntro = true;
    cinema.classList.add('intro');
    $('#cinema-stage').style.backgroundImage = cover.style.backgroundImage;
    video.play().catch(noop);
    video.pause();
    setTimeout(() => {
      cinemaIntro = false;
      cinema.classList.remove('intro');
      if (cinemaState !== 'open' || !video.paused) return;
      video.play().catch(() => { $('#cinema-play').hidden = false; }); // 막히면 ▶ 를 보여 주고 탭하면 재생
    }, reduceMotion ? 0 : CINEMA_IN);
    enterFullscreen(cinema);
    cinemaState = 'open';
    void cinema.offsetWidth;
    requestAnimationFrame(() => cinema.classList.add('on'));
  }
  function closeCinema(revealAfter) {
    if (cinemaState !== 'open') return;
    cinemaState = 'closing';
    video.pause();
    $('#cinema-play').hidden = true;
    hideControls();
    exitFullscreen();
    placeStageAtScreen();
    cinema.classList.remove('on');
    setTimeout(placeStageAtScreen, 60); // 전체화면이 풀리며 화면 크기가 바뀐 뒤 다시 맞춘다
    setTimeout(() => {
      cinema.hidden = true;
      cinemaState = 'closed';
      document.body.classList.remove('locked');
      playLabel.textContent = '다시 보기';
      if (revealAfter) showAfterFilm();
    }, reduceMotion ? 0 : CINEMA_OUT + 50);
  }
  playBtn.addEventListener('click', openCinema);
  $('#cinema-stage').addEventListener('click', () => {
    if (cinemaState !== 'open') return;
    cinema.classList.remove('intro');
    if (video.paused) { video.play().catch(noop); showControls(); }
    else if (cc.classList.contains('show')) hideControls();
    else showControls();
  });
  video.addEventListener('play', () => { $('#cinema-play').hidden = true; if (cc.classList.contains('show')) showControls(); });
  video.addEventListener('pause', () => {
    if (cinemaState === 'open' && !cinemaIntro && !video.ended) { $('#cinema-play').hidden = false; showControls(true); }
  });

  /* ---------- 상영관 컨트롤: 탭하면 아래 띠에 나타나고 3초 뒤 사라진다 ---------- */
  const cc = $('#cinema-controls'), ccPlay = $('#cc-play'), ccMute = $('#cc-mute'), ccSeek = $('#cc-seek'), ccVol = $('#cc-vol'), ccTime = $('#cc-time');
  // 아이폰은 웹에서 음량을 바꿀 수 없다(기기 버튼으로만) → 음량 바를 숨기고 음소거만 둔다
  const canSetVolume = (() => { try { const a = document.createElement('audio'); a.volume = .5; return a.volume === .5; } catch { return false; } })();
  if (!canSetVolume) ccVol.hidden = true;
  let ccTimer = 0, seeking = false;
  const clock = s => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  function showControls(stay) {
    cc.classList.add('show');
    clearTimeout(ccTimer);
    if (!stay && !video.paused) ccTimer = setTimeout(() => cc.classList.remove('show'), 3000);
  }
  function hideControls() { clearTimeout(ccTimer); cc.classList.remove('show'); }
  function syncControls() {
    ccPlay.classList.toggle('is-paused', video.paused);
    ccPlay.setAttribute('aria-label', video.paused ? '재생' : '일시정지');
    const muted = video.muted || video.volume === 0;
    ccMute.classList.toggle('is-muted', muted);
    ccMute.setAttribute('aria-label', muted ? '소리 켜기' : '음소거');
    if (video.duration) {
      ccSeek.max = video.duration;
      if (!seeking) ccSeek.value = video.currentTime;
      ccSeek.style.setProperty('--p', `${(video.currentTime / video.duration) * 100}%`);
      ccTime.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
    }
    const vol = muted ? 0 : video.volume;
    ccVol.value = vol;
    ccVol.style.setProperty('--p', `${vol * 100}%`);
  }
  ['timeupdate', 'play', 'pause', 'volumechange', 'loadedmetadata', 'seeked'].forEach(ev => video.addEventListener(ev, syncControls));
  ccPlay.addEventListener('click', () => { cinema.classList.remove('intro'); if (video.paused) video.play().catch(noop); else video.pause(); showControls(); });
  ccMute.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = .7;
    showControls(video.paused);
  });
  ccSeek.addEventListener('input', () => { seeking = true; video.currentTime = Number(ccSeek.value); syncControls(); showControls(video.paused); });
  ccSeek.addEventListener('change', () => { seeking = false; });
  ccVol.addEventListener('input', () => { video.volume = Number(ccVol.value); video.muted = video.volume === 0; showControls(video.paused); });
  cc.addEventListener('pointerdown', () => showControls(video.paused));
  $('#cinema-close').addEventListener('click', () => closeCinema(video.duration > 0 && video.currentTime / video.duration > .8));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCinema(false); });
  const onFsChange = () => { if (!fsElement() && cinemaState === 'open') closeCinema(false); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  window.addEventListener('resize', () => { if (cinemaState === 'open') sizeBars(); });
  duckWith(video, 'meet');                         // 재현 영상이 나오는 동안 배경 음악은 디졸브로 빠진다
  video.addEventListener('ended', () => setTimeout(() => closeCinema(true), 700));

  // 영상을 다 보면(또는 영상을 못 불러오면) 글과 실제 사진을 꺼낸다
  function showAfterFilm() {
    const note = $('#meet-note'), real = $('#real');
    let first = null;
    if (note.hidden && note.children.length) {
      note.hidden = false;
      note.classList.add('show');
      first = note;
    }
    if (state.hasReal && real.hidden) {
      real.hidden = false;
      real.classList.add('show');
      first = first || real;
    }
    if (!first) return;
    setTimeout(() => {
      const y = first.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
    }, 400);
  }

  /* ---------- 배경 음악 ----------
   * 파일 자체를 은은한 크기(약 -22 LUFS)로 만들어 두고 끝없이 반복한다. 게임 안에서도 계속 나온다.
   * 영상(재현 영상, 영화관 스크린 영상)이 나오면 디졸브로 꺼지고, 멈추거나 끝나면 디졸브로 다시 켜진다.
   * 아이폰은 audio.volume 을 바꿀 수 없고 Web Audio 는 무음 모드에서 소리가 안 나서,
   * 그냥 <audio> 로 틀고 영상이 나오면 바로 멈췄다가 다시 튼다. */
  const DUCK = { meet: 0, screen: 0 };
  const music = { level: 1, ducks: new Map(), timer: 0, blocked: false };
  function primeMusic() {                          // 사용자가 탭한 순간에만 부른다 (아이폰은 이때 깨운 오디오만 나중에 틀 수 있다)
    if (!audio.src) { audio.src = silentWav(); audio.play().catch(noop); }
  }
  const canFade = () => canSetVolume;
  function setMusicLevel(v) {
    music.level = v;
    if (canSetVolume) audio.volume = v;
  }
  function musicTarget() {                         // 0 = 멈춤, 1 = 보통, 그 사이 = 작게 깔기
    if (!state.musicURL || !state.musicWanted || document.hidden) return 0;
    let t = 1;
    for (const v of music.ducks.values()) t = Math.min(t, v);
    return t;
  }
  const musicPlaying = () => !audio.paused;
  function syncMusic() {
    if (!state.musicURL) return;
    clearInterval(music.timer);
    const to = musicTarget();
    if (document.hidden) {                         // 다른 앱으로 갔을 때
      // 컴퓨터·안드로이드: 바로 멈췄다가 돌아오면 다시 튼다.
      // 아이폰: 직접 멈추지 않는다. 직접 멈추면 돌아왔을 때 다시 못 트는 일이 있어서,
      // 아이폰이 알아서 멈췄다가 돌아오면 다시 틀어 주도록 맡긴다.
      if (canFade()) audio.pause();
      return;
    }
    if (!canFade()) {                              // 아이폰: 줄이지 못하니 바로 멈추거나 튼다
      if (to === 0) audio.pause();
      else if (audio.paused) audio.play().then(() => { music.blocked = false; }, () => { music.blocked = true; });
      return;
    }
    if (to > 0 && audio.paused) {
      setMusicLevel(0);
      audio.play().then(() => { music.blocked = false; }, () => { music.blocked = true; });
    }
    if (to === 0 && audio.paused) return;
    const from = music.level, ms = to < from ? 1500 : 2200, t0 = performance.now();
    music.timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k);
      setMusicLevel(from + (to - from) * e);
      if (k >= 1) { clearInterval(music.timer); if (to === 0) audio.pause(); }
    }, 40);
  }
  function setupMusic(url) {
    state.musicURL = url;
    audio.src = url;
    audio.loop = true;
    musicBtn.hidden = false;
    state.musicWanted = true;
    musicBtn.setAttribute('aria-pressed', 'true');
    setMusicLevel(canFade() ? 0 : 1);
    syncMusic();
  }
  function duckWith(media, name) {                 // 이 영상이 재생되는 동안 음악을 줄이거나 뺀다
    media.addEventListener('play', () => { music.ducks.set(name, DUCK[name] ?? 0); syncMusic(); });
    const back = () => { if (music.ducks.delete(name)) syncMusic(); };
    media.addEventListener('pause', back);
    media.addEventListener('ended', back);
    media.addEventListener('emptied', back);
  }
  musicBtn.addEventListener('click', () => {
    if (!state.musicURL) return;
    primeMusic();
    state.musicWanted = !state.musicWanted;
    musicBtn.setAttribute('aria-pressed', String(state.musicWanted));
    syncMusic();
  });
  // 처음 재생이 막혔거나 멈춰 있으면(자동 재생 제한) 다음에 화면을 만지는 순간 튼다
  const onAnyTouch = () => { if (musicTarget() > 0 && (music.blocked || !musicPlaying())) syncMusic(); };
  for (const ev of ['touchend', 'click', 'pointerup', 'keydown']) document.addEventListener(ev, onAnyTouch, true);
  document.addEventListener('visibilitychange', syncMusic);
  // 앱에 돌아왔는데 노래가 멈춰 있으면: 바로, 그리고 조금 뒤에 한 번 더 틀어 본다 (막히면 다음 탭에서 튼다)
  // (아이폰만. 컴퓨터·안드로이드는 위의 visibilitychange 하나로 지금처럼 디졸브로 돌아온다)
  const onBack = () => { if (document.hidden || canFade()) return; syncMusic(); setTimeout(syncMusic, 500); setTimeout(syncMusic, 1500); };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('pageshow', onBack);
  window.addEventListener('focus', onBack);

  /* ---------- 스크롤 등장 · 카운터 ---------- */
  function setupReveals() {
    const counterNum = $('#counter-num');
    const runCounter = () => {
      const target = state.days;
      if (reduceMotion) { counterNum.textContent = `D+${target.toLocaleString('ko-KR')}`; return; }
      const t0 = performance.now(), dur = 1800;
      const step = now => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        counterNum.textContent = `D+${Math.round(target * e).toLocaleString('ko-KR')}`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!('IntersectionObserver' in window)) { runCounter(); return; }

    const counterIO = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { counterIO.disconnect(); runCounter(); }
    }, { threshold: .6 });
    counterIO.observe($('#counter'));

    if (reduceMotion) return;
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.scene .slug, .scene .scene-title, .screen, .counter, .frame, .envelope-wrap, .cake').forEach(t => {
      if (t.getBoundingClientRect().top > window.innerHeight * .9) { t.classList.add('reveal', 'pre'); io.observe(t); }
    });
  }

  /* ---------- 편지 ---------- */
  const envelope = $('#envelope'), envWrap = $('#envelope-wrap'), paper = $('#letter-paper');
  envelope.addEventListener('click', async () => {
    if (envelope.classList.contains('open')) return;
    envelope.classList.add('open');
    await wait(reduceMotion ? 0 : 1700);
    envWrap.classList.add('gone');
    await wait(reduceMotion ? 0 : 550);
    envWrap.hidden = true;
    paper.hidden = false;
    paper.classList.add('show');
    const y = paper.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- 케이크 ---------- */
  const cakeBtn = $('#cake-btn'), cakeHint = $('#cake-hint');
  cakeBtn.addEventListener('click', async () => {
    if (cakeBtn.classList.contains('out')) return;
    const candles = cakeBtn.querySelectorAll('.candle').length;
    cakeBtn.classList.add('out');
    cakeBtn.disabled = true;
    cakeHint.textContent = '후—';
    await wait(reduceMotion ? 0 : 420 + candles * 140);
    const r = cakeBtn.getBoundingClientRect();
    Petals.burst(r.left + r.width / 2, r.top + r.height * .22);
    cakeHint.textContent = '소원, 꼭 이루어질 거야';
    await wait(reduceMotion ? 300 : 2000);
    if (state.content && state.content.game) showGameInvite(); else openCredits();
  });

  /* ---------- 게임: 눈 내리는 밤 광장에서 선물 건네기 → 자물쇠 문제 → 쿠폰 ---------- */
  const gameEl = $('#game'), sheet = $('#game-sheet'), coupon = $('#coupon'), toCredits = $('#to-credits');
  const quizBox = $('#quiz'), quizChoices = $('#quiz-choices'), quizForm = $('#quiz-form'), quizInput = $('#quiz-input'), quizMsg = $('#quiz-msg');
  const quiz = { i: 0, list: [], busy: false, done: false };
  const norm = s => String(s ?? '').toLowerCase().replace(/[\s.,!?~'"’]/g, '');
  let game = null, gameLoading = false;

  function renderGift(g) {
    quiz.list = Array.isArray(g.questions) ? g.questions : [];
    const dotsEl = $('#quiz-dots');
    dotsEl.textContent = '';
    quiz.list.forEach(() => dotsEl.append(el('span')));
    const cp = g.coupon || {};
    $('#coupon-title').textContent = cp.title || '';
    $('#coupon-body').textContent = cp.body || '';
    $('#coupon-body').hidden = !cp.body;
    $('#coupon-no').textContent = cp.no || '';
    const terms = $('#coupon-terms');
    terms.textContent = '';
    (cp.terms || []).forEach(([k, v]) => {
      const d = el('div');
      d.append(el('dt', null, k), el('dd', null, v));
      terms.append(d);
    });
  }

  // 촛불을 끄면: 케이크 아래에 '초대장 열기'를 남겨 두고, 밤하늘에서 초대장이 떠오른다
  function showGameInvite() {
    $('#game-invite').hidden = false;
    openInvitation();
  }

  /* ---------- 초대장 ---------- */
  const invite = $('#invite');
  let skyBuilt = false, prefetched = false;
  function renderInvitation(c) {
    const iv = (c.game && c.game.invitation) || {};
    $('#invite-no').textContent = iv.no || '';
    $('#invite-en').textContent = iv.en || '';
    $('#invite-ko').textContent = iv.ko || '';
    $('#invite-body').textContent = iv.body || '';
    $('#invite-guest').textContent = (c.her && c.her.name) || 'Robi';
    $('#invite-host').textContent = (c.game && c.game.me) || 'Beomjun';
    $('#invite-go').textContent = iv.go || '초대에 응하기';
    $('#invite-later').textContent = iv.later || '나중에 갈게';
  }
  function addSnow(box, n, maxOpacity = 0.95) {   // 천천히 내리는 눈송이
    for (let i = 0; i < n; i++) {
      const f = el('i', 'flake');
      f.style.cssText = `left:${Math.random() * 100}%;--s:${(2 + Math.random() * 4).toFixed(1)}px;--d:${(7 + Math.random() * 9).toFixed(1)}s;--delay:${(-Math.random() * 16).toFixed(1)}s;--x:${(Math.random() * 60 - 30).toFixed(0)}px;opacity:${(0.3 + Math.random() * (maxOpacity - 0.3)).toFixed(2)}`;
      box.append(f);
    }
  }
  function buildSky() {
    if (skyBuilt) return;
    skyBuilt = true;
    const sky = $('#invite-sky');
    addSnow(sky, 46);
    for (let i = 0; i < 38; i++) {                // 반짝이는 별
      const s = el('i', 'star');
      s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 60}%;--d:${(2 + Math.random() * 3).toFixed(1)}s;--delay:${(-Math.random() * 4).toFixed(1)}s`;
      sky.append(s);
    }
  }
  function prefetchGame() {                       // 초대장을 읽는 동안 광장 파일을 미리 받아 둔다
    if (prefetched) return;
    prefetched = true;
    import('./game.js?v=1122a').catch(noop);
    import('./vendor/mqtt.esm.js').catch(noop);
  }
  function openInvitation() {
    buildSky();
    invite.hidden = false;
    invite.classList.remove('on');
    void invite.offsetWidth;
    invite.classList.add('on');
    document.body.classList.add('locked');
    prefetchGame();
    setTimeout(() => $('#invite-go').focus({ preventScroll: true }), reduceMotion ? 0 : 2600);
  }
  function closeInvitation() {
    invite.classList.remove('on');
    invite.classList.add('leaving');
    setTimeout(() => { invite.hidden = true; invite.classList.remove('leaving'); }, reduceMotion ? 0 : 700);
    document.body.classList.remove('locked');
  }
  $('#invite-go').addEventListener('click', () => { closeInvitation(); enterGame('robi'); });
  $('#invite-later').addEventListener('click', closeInvitation);

  async function enterGame(role) {
    const c = state.content || {};
    const gc = c.game || {};
    gameEl.hidden = false;
    document.body.classList.add('locked');
    Petals.stop();
    if (game) { game.resume(); return; }
    if (gameLoading) return;
    gameLoading = true;
    // 로딩 화면: 준비가 빨리 끝나도 최소 5초는 보여 준다 (눈이 내리고, 금색 줄이 천천히 차오른다)
    const loading = $('#game-loading'), bar = $('#gl-bar'), MIN_LOADING = 5000, t0 = performance.now();
    if (!loading.dataset.snow) { loading.dataset.snow = '1'; addSnow($('#gl-snow'), 34, 0.8); }
    loading.hidden = false; loading.classList.remove('gone');
    bar.style.transition = 'none'; bar.style.width = '0%';
    void bar.offsetWidth;
    bar.style.transition = `width ${MIN_LOADING}ms cubic-bezier(.3, .1, .3, 1)`;
    bar.style.width = '92%';
    const doneLoading = () => setTimeout(() => {
      bar.style.transition = 'width .35s ease'; bar.style.width = '100%';
      setTimeout(() => { loading.classList.add('gone'); setTimeout(() => { loading.hidden = true; }, 700); }, 400);
    }, Math.max(0, MIN_LOADING - (performance.now() - t0)));
    $('#game-status').textContent = '';
    try {
      const { startGame } = await import('./game.js?v=1122a');
      const broker = new URLSearchParams(location.search).get('broker'); // 테스트용
      game = await startGame({
        root: gameEl,
        role,
        room: gc.room || 'mybabyrobi',
        names: { robi: (c.her && c.her.name) || 'Robi', beomjun: gc.me || 'Beomjun' },
        brokers: broker ? [broker] : null,
        onWantOpen: openGiftSheet,
        onReady: doneLoading,          // 광장 첫 장면이 그려지면 로딩 화면을 걷는다
        getCinemaVideo: () => (gc.cinemaVideo ? mediaURL(gc.cinemaVideo).then(url => {   // 영화관 스크린 영상 (있으면)
          const v = document.createElement('video');
          v.src = url; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
          duckWith(v, 'screen');                 // 스크린 영상이 나오는 동안 배경 음악은 디졸브로 빠진다
          return v;
        }) : Promise.resolve(null)),
        secret: state.pw,
      });
    } catch (e) {
      console.error(e);
      doneLoading();
      $('#game-status').textContent = '이 기기에서는 3D 광장이 열리지 않아서, 선물을 바로 열어 줄게.';
      openGiftSheet();
    } finally {
      gameLoading = false;
    }
  }
  function exitGame() {
    if (game) game.pause();
    sheet.hidden = true;
    gameEl.hidden = true;
    document.body.classList.remove('locked');
    Petals.start();
  }
  $('#enter-game').addEventListener('click', openInvitation);
  $('#game-exit').addEventListener('click', exitGame);
  $('#sheet-close').addEventListener('click', () => { sheet.hidden = true; });

  function openGiftSheet() {
    sheet.hidden = false;
    if (quiz.done) { showCoupon(); return; }
    coupon.hidden = true;
    toCredits.hidden = true;
    quizBox.hidden = false;
    if (!quiz.list.length) { finishQuiz(); return; }
    showQuestion();
  }

  function showQuestion() {
    const q = quiz.list[quiz.i];
    $('#quiz-step').textContent = `자물쇠 ${quiz.i + 1} / ${quiz.list.length}`;
    $('#quiz-q').textContent = q.q || '';
    quizMsg.textContent = '';
    quizChoices.textContent = '';
    const hasChoices = Array.isArray(q.choices) && q.choices.length > 0;
    quizChoices.hidden = !hasChoices;
    quizForm.hidden = hasChoices;
    if (hasChoices) {
      q.choices.forEach((label, idx) => {
        const b = el('button', 'choice', label);
        b.type = 'button';
        b.addEventListener('click', () => answer(idx, b));
        quizChoices.append(b);
      });
    } else {
      quizInput.value = '';
    }
    quizBox.classList.remove('next', 'shake');
    void quizBox.offsetWidth;
    quizBox.classList.add('next');
  }

  function answer(given, btn) {
    if (quiz.busy) return;
    const q = quiz.list[quiz.i];
    let ok;
    if (Array.isArray(q.choices) && q.choices.length) {
      const right = typeof q.answer === 'number' ? q.answer : q.choices.findIndex(ch => norm(ch) === norm(q.answer));
      ok = given === right;
    } else {
      ok = [].concat(q.answers ?? q.answer ?? []).some(a => norm(a) === norm(given));
    }
    if (!ok) {
      quizMsg.textContent = q.hint ? `땡! 힌트: ${q.hint}` : '땡! 다시 생각해 봐';
      const target = btn || quizBox;
      target.classList.remove('shake');
      void target.offsetWidth;
      target.classList.add('shake');
      return;
    }
    quiz.busy = true;
    if (btn) btn.classList.add('right');
    quizMsg.textContent = '딸깍! 정답이야';
    const panelDots = $('#quiz-dots').children;
    if (panelDots[quiz.i]) panelDots[quiz.i].classList.add('on');
    quiz.i++;
    setTimeout(() => {
      quiz.busy = false;
      if (quiz.i < quiz.list.length) showQuestion(); else finishQuiz();
    }, reduceMotion ? 300 : 950);
  }
  quizForm.addEventListener('submit', e => { e.preventDefault(); answer(quizInput.value); });

  function finishQuiz() {
    quiz.done = true;
    quizBox.classList.add('gone');
    setTimeout(() => {
      quizBox.hidden = true;
      quizBox.classList.remove('gone');
      if (game) {
        sheet.hidden = true;           // 광장에서 선물이 열리는 장면을 먼저 보여 준다
        game.openGift();
        setTimeout(showCoupon, reduceMotion ? 0 : 1800);
      } else {
        showCoupon();
      }
    }, reduceMotion ? 0 : 500);
  }
  function showCoupon() {
    sheet.hidden = false;
    quizBox.hidden = true;
    coupon.hidden = false;
    coupon.classList.remove('pop');
    void coupon.offsetWidth;
    coupon.classList.add('pop');
    toCredits.hidden = false;
  }
  toCredits.addEventListener('click', () => { exitGame(); openCredits(); });

  /* ---------- 엔딩 크레딧 ---------- */
  const credits = $('#credits'), roll = $('#credits-roll'), finalCard = $('#credits-final'), skipBtn = $('#credits-skip');
  let rollAnim = null;

  function openCredits() {
    Petals.stop();
    credits.hidden = false;
    roll.hidden = false; finalCard.hidden = true; skipBtn.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => credits.classList.add('on'));
    if (reduceMotion || !roll.animate) { showFinal(); return; }
    const H = credits.clientHeight, h = roll.scrollHeight;
    rollAnim = roll.animate(
      [{ transform: `translateY(${H}px)` }, { transform: `translateY(${-h}px)` }],
      { duration: ((H + h) / 50) * 1000, delay: 1200, easing: 'linear', fill: 'both' },
    );
    rollAnim.finished.then(showFinal, noop);
  }
  function showFinal() {
    roll.hidden = true; skipBtn.hidden = true; finalCard.hidden = false;
    $('#again-top').focus({ preventScroll: true });
  }
  skipBtn.addEventListener('click', () => { if (rollAnim) rollAnim.cancel(); showFinal(); });

  async function closeCredits(target) {
    credits.classList.remove('on');
    await wait(reduceMotion ? 0 : 700);
    credits.hidden = true;
    document.body.classList.remove('locked');
    Petals.start();
    if (target === 'top') {
      window.scrollTo({ top: 0, behavior: 'auto' });
      opening.classList.remove('run');
      void opening.offsetWidth;
      opening.classList.add('run');
    } else {
      $('#letter').scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }
  $('#again-top').addEventListener('click', () => closeCredits('top'));
  $('#again-letter').addEventListener('click', () => closeCredits('letter'));

  initGate();
})();
