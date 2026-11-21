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

  const state = { key: null, content: null, contentBuf: null, gate: null, tries: 0, days: 0, mediaCache: new Map(), musicURL: null, musicWanted: false };

  function mediaURL(ref, onProgress) {
    if (!ref || !ref.src) return Promise.reject(new Error('no media'));
    if (!state.mediaCache.has(ref.src)) {
      state.mediaCache.set(ref.src, (async () => {
        const buf = await fetchBytes(ref.src, onProgress);
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

  /* ---------- 오프닝 꽃 ---------- */
  function buildBloom(svg) {
    const rings = [
      { n: 2, len: 124, w: 24, off: 148, gap: 64, d: 0, c: ['#9fbb93', '#4d6b4a'] },      // 잎
      { n: 9, len: 112, w: 50, off: 0, d: .1, c: ['#f9dbe2', '#ec98ae'] },
      { n: 8, len: 88, w: 42, off: 22, d: .38, c: ['#f6c6d2', '#e07c98'] },
      { n: 7, len: 64, w: 34, off: 9, d: .66, c: ['#f1aebf', '#d26584'] },
      { n: 6, len: 42, w: 24, off: 31, d: .94, c: ['#ea98ad', '#bf4d6e'] },
    ];
    let defs = '', body = '';
    rings.forEach((r, i) => {
      defs += `<radialGradient id="bg${i}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r.len}">` +
        `<stop offset="0" stop-color="${r.c[1]}"/><stop offset="1" stop-color="${r.c[0]}"/></radialGradient>`;
      const L = r.len, w = r.w;
      const d = `M0 0C${-w} ${-L * .3} ${-w * .95} ${-L * .95} ${-w * .35} ${-L}Q0 ${-L * .93} ${w * .35} ${-L}` +
        `C${w * .95} ${-L * .95} ${w} ${-L * .3} 0 0Z`;
      for (let k = 0; k < r.n; k++) {
        const a = r.off + k * (r.gap || 360 / r.n);
        body += `<path class="p" d="${d}" fill="url(#bg${i})" stroke="rgba(255,255,255,.22)" stroke-width=".6" style="--a:${a}deg;--d:${(r.d + k * .035).toFixed(3)}s"/>`;
      }
    });
    let core = '<g class="core"><circle r="10" fill="#f4d58d"/>';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      core += `<circle cx="${(Math.cos(a) * 15).toFixed(2)}" cy="${(Math.sin(a) * 15).toFixed(2)}" r="2.3" fill="#e2a944"/>`;
    }
    svg.innerHTML = `<defs>${defs}</defs>${body}${core}</g>`;
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
      // 휴대폰에서 음악을 나중에 틀 수 있도록, 탭한 순간에 오디오를 깨워 둔다
      if (!audio.src) { audio.src = silentWav(); audio.play().catch(noop); }
      tryUnlock(input.value);
    });

    try {
      const res = await fetch('data/gate.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      state.gate = await res.json();
      if (state.gate.question) $('#gate-q').textContent = state.gate.question;
      fetchBytes('data/content.bin').then(b => { state.contentBuf = b; }, noop);
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
    if (m.video) loadVideo(m.video);
    if (m.realPhoto) mediaURL(m.realPhoto).then(u => { $('#real-img').src = u; state.hasReal = true; }).catch(e => console.warn(e));

    const imgs = [...document.querySelectorAll('#filmstrip img')];
    const tasks = (c.moments || []).map((mo, i) => () => mo.photo ? mediaURL(mo.photo).then(u => { imgs[i].src = u; }) : null);
    pool(tasks, 3);

    if (c.music) mediaURL(c.music).then(setupMusic).catch(e => console.warn(e));
    else if (audio.src) { audio.pause(); audio.removeAttribute('src'); }
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
  video.addEventListener('play', () => duck(true));
  video.addEventListener('pause', () => { if (!video.ended) duck(false); });
  video.addEventListener('ended', () => { duck(false); setTimeout(() => closeCinema(true), 700); });

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

  function setupMusic(url) {
    state.musicURL = url;
    audio.src = url;
    audio.volume = .7;
    musicBtn.hidden = false;
    audio.play().then(() => { state.musicWanted = true; musicBtn.setAttribute('aria-pressed', 'true'); })
      .catch(() => { state.musicWanted = false; musicBtn.setAttribute('aria-pressed', 'false'); });
  }
  musicBtn.addEventListener('click', () => {
    if (!state.musicURL) return;
    if (audio.paused) { state.musicWanted = true; audio.volume = .7; audio.play().catch(noop); musicBtn.setAttribute('aria-pressed', 'true'); }
    else { state.musicWanted = false; audio.pause(); musicBtn.setAttribute('aria-pressed', 'false'); }
  });
  let fadeTimer = 0;
  function duck(down) {
    if (!state.musicURL || !state.musicWanted) return;
    clearInterval(fadeTimer);
    if (down) {
      fadeTimer = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - .07);
        if (audio.volume <= .01) { clearInterval(fadeTimer); audio.pause(); }
      }, 50);
    } else {
      audio.volume = 0;
      audio.play().catch(noop);
      fadeTimer = setInterval(() => {
        audio.volume = Math.min(.7, audio.volume + .05);
        if (audio.volume >= .7) clearInterval(fadeTimer);
      }, 80);
    }
  }

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
    $('#coupon-no').textContent = cp.no || '';
    const terms = $('#coupon-terms');
    terms.textContent = '';
    (cp.terms || []).forEach(([k, v]) => {
      const d = el('div');
      d.append(el('dt', null, k), el('dd', null, v));
      terms.append(d);
    });
  }

  function showGameInvite() {
    const inv = $('#game-invite');
    inv.hidden = false;
    setTimeout(() => {
      const y = inv.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45;
      window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'auto' : 'smooth' });
    }, 80);
  }

  async function enterGame(role) {
    const c = state.content || {};
    const gc = c.game || {};
    gameEl.hidden = false;
    document.body.classList.add('locked');
    Petals.stop();
    if (game) { game.resume(); return; }
    if (gameLoading) return;
    gameLoading = true;
    $('#game-status').textContent = '광장으로 가는 중…';
    try {
      const { startGame } = await import('./game.js');
      const broker = new URLSearchParams(location.search).get('broker'); // 테스트용
      game = await startGame({
        root: gameEl,
        role,
        room: gc.room || 'mybabyrobi',
        names: { robi: (c.her && c.her.name) || 'Robi', beomjun: gc.me || 'Beomjun' },
        brokers: broker ? [broker] : null,
        onWantOpen: openGiftSheet,
      });
    } catch (e) {
      console.error(e);
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
  $('#enter-game').addEventListener('click', () => enterGame('robi'));
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
