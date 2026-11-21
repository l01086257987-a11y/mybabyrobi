/* 눈 내리는 밤 광장 — Beomjun 이 Robi 에게 선물을 건네는 3D 미니 게임
 *
 * - 각자 자기 휴대폰으로 들어오면, 가입 없이 쓰는 공개 무료 중계 서버(MQTT)로 서로의 위치를 주고받는다.
 *   중계 서버 두 곳에 동시에 붙어서 한쪽이 안 돼도 이어지게 했다.
 * - 연결이 안 되거나 둘이 같이 있으면 '한 폰으로' 모드: 왼쪽 조이스틱 = Beomjun, 오른쪽 = Robi.
 * - 캐릭터는 조이스틱(또는 키보드)으로만 움직인다. 혼자 움직이지 않는다.
 * - Beomjun 이 선물을 들고 있다가 Robi 곁에서 건네면, Robi 가 열 수 있다 (자물쇠 문제는 app.js 가 띄운다).
 */
import * as THREE from './vendor/three.module.min.js';

const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const SPEED = 3.1;              // m/s
const PLAZA_R = 10.4;           // 광장 반지름 (밖으로 못 나감)
const FOUNTAIN = { x: 0, z: -3.6, r: 2.3 };
const GIVE_DIST = 1.9;          // 이만큼 가까우면 선물을 건넬 수 있다
const SPAWN = { robi: [-2.4, 2.6, 0.5], beomjun: [2.4, 1.4, -0.5] }; // x, z, 바라보는 방향

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const angLerp = (a, b, t) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; };
// 이름 뒤 조사: Beomjun이 / Robi가 (한글 받침, 영어는 끝 글자로 판단)
const ga = name => {
  const ch = name.slice(-1), code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return name + ((code - 0xac00) % 28 ? '이' : '가');
  return name + (/[aeiouy]$/i.test(ch) ? '가' : '이');
};
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const radialTex = (inner, outer) => canvasTex(128, 128, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const heartTex = () => canvasTex(128, 128, g => {
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(64, 112);
  g.bezierCurveTo(10, 76, 4, 40, 30, 24);
  g.bezierCurveTo(48, 14, 60, 26, 64, 38);
  g.bezierCurveTo(68, 26, 80, 14, 98, 24);
  g.bezierCurveTo(124, 40, 118, 76, 64, 112);
  g.fill();
});

/* ---------- 광장 ---------- */
function buildWorld(scene) {
  const sky = new THREE.Color('#0b1328');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 18, 46);
  scene.add(new THREE.HemisphereLight('#9fb5e8', '#2a2f45', 1.15));
  const moonLight = new THREE.DirectionalLight('#c9d8ff', 0.9);
  moonLight.position.set(-8, 14, -10);
  scene.add(moonLight);
  const fill = new THREE.DirectionalLight('#ffe9d6', 1.1); // 카메라 쪽에서 비추는 은은한 빛: 얼굴이 어둡지 않게
  fill.position.set(2, 7, 12);
  scene.add(fill);

  const snowM = std('#eef3f9', { roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), std('#d7e0ec', { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 눈을 치운 돌바닥
  const stone = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8f98a6'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = -1; x < 8; x++) {
      g.fillStyle = `hsl(220, 9%, ${60 + Math.random() * 12}%)`;
      g.fillRect(x * 32 + (y % 2) * 16 + 1, y * 32 + 1, 30, 30);
    }
  });
  stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
  stone.repeat.set(7, 7);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(11, 64), std('#ffffff', { map: stone, roughness: 0.95 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.005;
  scene.add(plaza);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(11.25, 0.4, 8, 72), snowM);
  rim.rotation.x = -Math.PI / 2; rim.scale.z = 0.45; rim.position.y = 0.02;
  scene.add(rim);

  // 분수
  const stoneM = std('#9ea7b3');
  const f = new THREE.Group();
  f.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
  const add = (geo, mat, y, parent = f) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; parent.add(m); return m; };
  add(new THREE.CylinderGeometry(2.1, 2.2, 0.55, 40), stoneM, 0.275);
  const water = add(new THREE.CircleGeometry(1.86, 40), std('#4f78ad', { roughness: 0.15, emissive: '#1b2f52', emissiveIntensity: 0.7 }), 0.5);
  water.rotation.x = -Math.PI / 2;
  const ring = add(new THREE.TorusGeometry(2.06, 0.12, 8, 40), snowM, 0.57);
  ring.rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(0.25, 0.34, 1.6, 16), stoneM, 1.2);
  add(new THREE.CylinderGeometry(0.85, 0.45, 0.3, 24), stoneM, 1.95);
  add(new THREE.CylinderGeometry(0.86, 0.86, 0.08, 24), snowM, 2.12);
  add(new THREE.SphereGeometry(0.22, 16, 12), snowM, 2.3);
  scene.add(f);

  // 가로등
  const glowTex = radialTex('rgba(255,214,140,1)', 'rgba(255,214,140,0)');
  const poleM = std('#23272f', { roughness: 0.6 });
  const bulbM = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffcf85', emissiveIntensity: 2.2 });
  const lampAt = (x, z, withLight) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    add(new THREE.CylinderGeometry(0.06, 0.09, 3.1, 10), poleM, 1.55, g);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), poleM, 2.82, g);
    add(new THREE.SphereGeometry(0.17, 16, 12), bulbM, 3.0, g);
    add(new THREE.ConeGeometry(0.27, 0.22, 8), poleM, 3.25, g);
    add(new THREE.SphereGeometry(0.14, 10, 8), snowM, 3.35, g).scale.y = 0.5;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75 }));
    glow.scale.set(1.7, 1.7, 1); glow.position.y = 3.0;
    g.add(glow);
    if (withLight) { const pl = new THREE.PointLight('#ffcf85', 16, 11, 2); pl.position.y = 2.9; g.add(pl); }
    scene.add(g);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    lampAt(Math.cos(a) * 8.8, Math.sin(a) * 8.8, i % 2 === 0 || i === 3);
  }

  // 건물 (불 켜진 창문)
  const variants = [0, 1, 2].map(() => {
    const lit = Array.from({ length: 16 }, () => Math.random() < 0.4);
    const draw = (wall, on, off) => (g, w) => {
      g.fillStyle = wall; g.fillRect(0, 0, w, w);
      lit.forEach((l, i) => { g.fillStyle = l ? on : off; g.fillRect((i % 4) * 32 + 9, ((i / 4) | 0) * 32 + 8, 14, 18); });
    };
    const map = canvasTex(128, 128, draw(pick(['#c9c0b4', '#bfb3a5', '#cbbdaf', '#b9bec7']), '#f3c983', '#2c3346'));
    const em = canvasTex(128, 128, draw('#000000', '#ffc56e', '#000000'));
    map.wrapS = map.wrapT = em.wrapS = em.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1.5, 2); em.repeat.set(1.5, 2);
    return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.9 });
  });
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + rnd(-0.08, 0.08);
    const r = rnd(17, 20), h = rnd(5, 9), w = rnd(4.2, 6);
    if (Math.sin(a) * r > 8) continue;           // 남쪽은 버스가 다니는 길
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), variants[i % 3]);
    b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    b.lookAt(0, h / 2, 0);
    scene.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, 4.3), snowM);
    roof.position.copy(b.position); roof.position.y = h + 0.17; roof.rotation.copy(b.rotation);
    scene.add(roof);
  }

  // 트리 (작은 전구)
  const treeAt = (x, z, s, lights) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.scale.setScalar(s);
    const leaf = std('#1f4a36', { roughness: 0.9 });
    add(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8), std('#4a3326'), 0.3, g);
    [[1.25, 1.3, 1.0], [1.0, 1.1, 1.75], [0.72, 0.95, 2.4]].forEach(([r, hh, y]) => {
      add(new THREE.ConeGeometry(r, hh, 10), leaf, y, g);
      add(new THREE.ConeGeometry(r * 0.55, hh * 0.35, 10), snowM, y + hh * 0.36, g);
    });
    if (lights) {
      add(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#ffd25e', emissiveIntensity: 2.5 }), 3.05, g);
      const colors = ['#ff7a8a', '#ffd25e', '#8fd3ff', '#ffffff'];
      for (let i = 0; i < 26; i++) {
        const y = rnd(0.7, 2.7), rr = (1 - (y - 0.6) / 2.4) * 1.1 + 0.05, a = rnd(0, Math.PI * 2);
        const c = pick(colors);
        const m = add(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2 }), y, g);
        m.position.x = Math.cos(a) * rr; m.position.z = Math.sin(a) * rr;
      }
    }
    scene.add(g);
  };
  treeAt(6.4, -5.8, 1.15, true);
  treeAt(-7.2, -5.2, 0.9, false);
  [[13, -9], [-13, -8], [14, 3], [-14, 4], [9, -14], [-9, -14]].forEach(([x, z]) => treeAt(x, z, rnd(1, 1.4), false));

  // 벤치
  const wood = std('#6b4a35'), iron = std('#2a2c33');
  const benches = [];
  const benchAt = (x, z, ry) => {
    benches.push({ x, z, ry });
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = ry;
    add(new THREE.BoxGeometry(1.6, 0.08, 0.5), wood, 0.45, g);
    const back = add(new THREE.BoxGeometry(1.6, 0.4, 0.06), wood, 0.72, g); back.position.z = -0.24;
    [-0.7, 0.7].forEach(xx => { const l = add(new THREE.BoxGeometry(0.06, 0.45, 0.45), iron, 0.22, g); l.position.x = xx; });
    add(new THREE.BoxGeometry(1.6, 0.05, 0.5), snowM, 0.51, g);
    scene.add(g);
  };
  benchAt(-5.6, -1.2, 0.9);
  benchAt(5.8, 0.2, -1.0);

  // 달과 별
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), new THREE.MeshBasicMaterial({ color: '#f6f0d8', fog: false }));
  moon.position.set(-16, 22, -42);
  scene.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(246,240,216,.55)', 'rgba(246,240,216,0)'), transparent: true, depthWrite: false, fog: false }));
  moonGlow.scale.set(14, 14, 1); moonGlow.position.copy(moon.position);
  scene.add(moonGlow);
  const starPos = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) {
    const a = rnd(0, Math.PI * 2), e = rnd(0.25, 1.3), r = 55;
    starPos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r - 10], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe8ff', size: 0.18, fog: false })));

  // 내리는 눈
  const N = 900;
  const snowPos = new Float32Array(N * 3), speeds = new Float32Array(N);
  for (let i = 0; i < N; i++) { snowPos.set([rnd(-16, 16), rnd(0, 12), rnd(-20, 10)], i * 3); speeds[i] = rnd(0.6, 1.3); }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const flakes = new THREE.Points(snowGeo, new THREE.PointsMaterial({
    map: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 0.13, transparent: true, depthWrite: false, color: '#ffffff',
  }));
  scene.add(flakes);
  let t = 0;
  return {
    benches,
    update(dt, cx, cz) {
      t += dt;
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        snowPos[k + 1] -= speeds[i] * dt;
        snowPos[k] += Math.sin(t * 0.8 + i) * 0.15 * dt;
        if (snowPos[k + 1] < 0) { snowPos[k] = cx + rnd(-16, 16); snowPos[k + 1] = 12; snowPos[k + 2] = cz + rnd(-20, 10); }
      }
      snowGeo.attributes.position.needsUpdate = true;
    },
    recenter(cx, cz) {
      for (let i = 0; i < N; i++) snowPos.set([cx + rnd(-16, 16), rnd(0, 12), cz + rnd(-20, 10)], i * 3);
      snowGeo.attributes.position.needsUpdate = true;
    },
    setSnow(v) { flakes.visible = v; },
  };
}

/* ---------- 캐릭터 ---------- */
const shadowTex = radialTex('rgba(10,14,30,.45)', 'rgba(10,14,30,0)');

function makeLabel(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(1.5, 0.47, 1);
  sprite.renderOrder = 10;
  const draw = sub => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 512, 160);
    g.font = '700 64px "Gowun Batang", "Apple SD Gothic Neo", sans-serif';
    const w = Math.max(g.measureText(name).width, sub ? 220 : 0) + 64;
    g.fillStyle = 'rgba(12, 20, 38, 0.62)';
    const x = (512 - w) / 2, y = 8, hh = sub ? 140 : 88, r = 44;
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256, 54);
    if (sub) { g.font = '500 34px "Gowun Batang", sans-serif'; g.fillStyle = 'rgba(244,235,225,.75)'; g.fillText(sub, 256, 118); }
    tex.needsUpdate = true;
  };
  let current = '';
  const redraw = sub => { current = sub; draw(sub); };
  redraw('');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw(current));
  return { sprite, draw: redraw };
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
  sprite.renderOrder = 11;
  sprite.center.set(0.5, 0);
  const show = text => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    g.font = '700 44px "Gowun Batang", "Apple SD Gothic Neo", sans-serif';
    // 글자 단위로 줄바꿈 (최대 3줄)
    const lines = [];
    let line = '';
    for (const ch of text) {
      if (g.measureText(line + ch).width > 420) { lines.push(line); line = ch.trim() ? ch : ''; if (lines.length === 3) break; }
      else line += ch;
    }
    if (lines.length < 3 && line) lines.push(line);
    else if (lines.length === 3 && line) lines[2] = lines[2].slice(0, -1) + '…';
    const w = Math.min(470, Math.max(...lines.map(l => g.measureText(l).width)) + 56), h = lines.length * 50 + 34;
    const x = (512 - w) / 2, y = 256 - h - 26, r = 26;
    g.fillStyle = 'rgba(255, 252, 247, 0.96)';
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.lineTo(276, y + h); g.lineTo(256, 252); g.lineTo(240, y + h);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
    g.fillStyle = '#2a1d20'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, 256, y + 17 + 25 + i * 50));
    tex.needsUpdate = true;
  };
  sprite.scale.set(2.5, 1.25, 1);
  return { sprite, show, until: 0 };
}

function makeChar(o) {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const skin = std(o.skin), coat = std(o.coat, { roughness: o.fluffy ? 1 : 0.65 }), hair = std(o.hair, { roughness: 0.55 });
  const dark = std('#2b2c34'), shoe = std('#3a2e2a');

  const legGeo = new THREE.CapsuleGeometry(0.085, 0.2, 4, 8);
  const mkLeg = x => {
    const p = new THREE.Group(); p.position.set(x, 0.42, 0);
    const m = new THREE.Mesh(legGeo, dark); m.position.y = -0.2; p.add(m);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), shoe); s.scale.set(1, 0.7, 1.4); s.position.set(0, -0.37, 0.04); p.add(s);
    rig.add(p); return p;
  };
  const legL = mkLeg(-0.12), legR = mkLeg(0.12);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.34, 6, 14), coat);
  body.position.y = 0.78; body.scale.set(1, 1, 0.88);
  rig.add(body);
  if (o.fluffy) {
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.39, 0.32, 18), coat); hem.position.y = 0.52; rig.add(hem);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 8, 20), coat); collar.rotation.x = Math.PI / 2; collar.position.y = 1.1; rig.add(collar);
  }

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.26, 4, 8);
  const mkArm = x => {
    const p = new THREE.Group(); p.position.set(x, 1.0, 0);
    const m = new THREE.Mesh(armGeo, coat); m.position.y = -0.17; p.add(m);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin); h.position.y = -0.35; p.add(h);
    p.userData.hand = h;
    rig.add(p); return p;
  };
  const armL = mkArm(-0.35), armR = mkArm(0.35);

  const head = new THREE.Group(); head.position.y = 1.44; rig.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20), skin));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.365, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  cap.rotation.x = -0.3; cap.position.set(0, 0.02, -0.02); head.add(cap);
  const bang = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), hair);
  bang.scale.set(1.55, 0.55, 0.8); bang.position.set(o.longHair ? -0.04 : 0.02, 0.2, 0.19); bang.rotation.z = o.longHair ? 0.25 : -0.15;
  head.add(bang);
  if (o.longHair) {
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 14), hair);
    back.scale.set(1.08, 1, 0.55); back.position.set(0, -0.3, -0.17); head.add(back);
    [-0.29, 0.29].forEach(x => {
      const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 10), hair);
      s.position.set(x * 0.98, -0.27, -0.09); s.rotation.z = x > 0 ? -0.12 : 0.12; head.add(s); // 옆모습에서 얼굴을 가리지 않게 뒤로
    });
  }
  const eyeM = new THREE.MeshBasicMaterial({ color: '#1c1614' }), white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const eyes = [], shines = [];
  [-0.12, 0.12].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), eyeM);
    e.scale.set(1, 1.25, 0.6); e.position.set(x, -0.01, 0.315); head.add(e); eyes.push(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), white);
    hl.position.set(x + 0.016, 0.017, 0.343); head.add(hl); shines.push(hl);
  });
  const blushM = new THREE.MeshBasicMaterial({ color: '#f29aae', transparent: true, opacity: 0.55, depthWrite: false });
  [-0.2, 0.2].forEach(x => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blushM);
    b.position.set(x, -0.09, 0.285); b.rotation.y = x * 1.3; head.add(b);
  });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 6, 12, Math.PI), eyeM);
  mouth.rotation.z = Math.PI; mouth.position.set(0, -0.1, 0.322); head.add(mouth);
  // 뽀뽀할 때 쭉 내미는 입술
  const lips = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), new THREE.MeshStandardMaterial({ color: '#e0607a', roughness: 0.35 }));
  lips.position.set(0, -0.1, 0.33); lips.visible = false; head.add(lips);

  if (o.scarf) {
    const sM = std(o.scarf, { roughness: 1 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.08, 8, 20), sM);
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.1; rig.add(ring);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.06), sM);
    tail.position.set(0.1, 0.94, 0.27); tail.rotation.z = 0.12; rig.add(tail);
  }

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);

  const label = makeLabel(o.name);
  label.sprite.position.y = 2.2; g.add(label.sprite);
  const bubble = makeBubble();
  bubble.sprite.position.y = 2.45; g.add(bubble.sprite);

  return { group: g, rig, head, blushM, eyes, shines, mouth, lips, legL, legR, armL, armR, label, bubble, pos: g.position, ry: 0, moving: false, walk: 0, phase: 0, sub: '', seat: -1, sitW: 0 };
}

// emo: { type: 'hug' | 'kiss', w: 0~1 } — 안기·뽀뽀 자세를 w 만큼 섞는다. side: 고개를 기울일 방향(±1)
function animateChar(c, dt, t, holding, emo, side = 1) {
  c.walk += ((c.moving ? 1 : 0) - c.walk) * Math.min(1, dt * 10);
  if (c.moving) c.phase += dt * 11;
  const s = Math.sin(c.phase) * 0.55 * c.walk;
  c.legL.rotation.x = s; c.legR.rotation.x = -s;
  let lx = holding ? -1.15 : -s * 0.8, rx = holding ? -1.15 : s * 0.8;
  let lz = holding ? 0.32 : 0.12, rz = holding ? -0.32 : -0.12, lean = 0, tilt = 0, blush = 0.55, reach = 1, pucker = 0, happy = 0;
  if (emo && emo.w > 0) {
    const w = emo.w, mix = (a, b) => a + (b - a) * w;
    if (emo.part === 'hug') {
      // 팔끼리 부딪히지 않게 높이를 나눈다: side>0(Beomjun)은 허리를, side<0(Robi)은 목을 감싼다.
      // 짧은 팔로 상대 옆구리까지 닿도록 안는 동안만 팔을 늘린다. 머리는 서로 반대쪽으로 기댄다.
      const ax = side > 0 ? -1.15 : -1.75;
      lx = mix(lx, ax); rx = mix(rx, ax); lz = mix(lz, 0.1); rz = mix(rz, -0.1);
      reach = 1 + 0.6 * w; tilt = 0.24 * w * side; blush = 0.55 + 0.25 * w;
    } else if (emo.part === 'kisser') {
      // 볼에 뽀뽀하는 사람: 뒷짐 지고, 입술을 쭉 내밀고, 눈을 감고 0.1 기울인다 (자리와 맞춰 계산됨)
      lx = mix(lx, 0.55); rx = mix(rx, 0.55); lz = mix(lz, 0.25); rz = mix(rz, -0.25);
      lean = 0.1 * w; blush = 0.55 + 0.35 * w; pucker = w;
    } else {
      // 받는 사람: 볼을 내민 채 웃으며 눈을 감고 볼이 더 빨개진다
      blush = 0.55 + 0.45 * w; happy = w;
    }
  }
  c.sitW += ((c.seat >= 0 && !c.moving ? 1 : 0) - c.sitW) * Math.min(1, dt * 6);
  const sw = c.sitW;
  if (sw > 0.001) { lx += (-0.55 - lx) * sw; rx += (-0.55 - rx) * sw; lz += (0.2 - lz) * sw; rz += (-0.2 - rz) * sw; }
  const k = Math.min(1, dt * 12);
  const sc = c.armL.scale.y + (reach - c.armL.scale.y) * k;
  c.armL.scale.y = c.armR.scale.y = sc;
  c.armL.userData.hand.scale.y = c.armR.userData.hand.scale.y = 1 / sc;
  c.armL.rotation.x += (lx - c.armL.rotation.x) * k; c.armR.rotation.x += (rx - c.armR.rotation.x) * k;
  c.armL.rotation.z += (lz - c.armL.rotation.z) * k; c.armR.rotation.z += (rz - c.armR.rotation.z) * k;
  c.rig.rotation.x += (lean - c.rig.rotation.x) * k;
  c.head.rotation.z += (tilt - c.head.rotation.z) * k;
  c.blushM.opacity = blush;
  // 뽀뽀 표정: 웃는 입 대신 입술을 쭉 내밀고, 얼굴이 가까워지면 눈을 감는다
  const shut = Math.max(0, Math.min(1, (pucker - 0.35) / 0.4), Math.min(1, (happy - 0.2) / 0.4));
  for (const e of c.eyes) e.scale.y = 1.25 - 1.08 * shut;
  for (const h of c.shines) h.visible = shut < 0.5;
  const lp = Math.max(0, Math.min(1, (pucker - 0.2) / 0.45));
  c.mouth.visible = lp < 0.15;
  c.lips.visible = lp >= 0.15;
  c.lips.scale.set(1.15 * lp, 0.9 * lp, 1.1 * lp);
  c.lips.position.z = 0.318 + 0.03 * lp;
  c.rig.position.y = Math.abs(Math.sin(c.phase)) * 0.05 * c.walk + Math.sin(t * 2.2) * 0.008;
  if (sw > 0.001) {                                // 벤치에 앉아 발을 동동
    const kick = Math.sin(t * 3.2) * 0.14;
    c.legL.rotation.x += (-1.25 + kick - c.legL.rotation.x) * sw;
    c.legR.rotation.x += (-1.25 - kick - c.legR.rotation.x) * sw;
  }
  c.pos.y = 0.13 * sw;                             // 엉덩이를 벤치 높이로
  c.group.rotation.y = angLerp(c.group.rotation.y, c.ry, Math.min(1, dt * 12));
}
const handPos = (c, out) => out.set(c.pos.x + Math.sin(c.group.rotation.y) * 0.42, 0.84 + c.rig.position.y + c.pos.y, c.pos.z + Math.cos(c.group.rotation.y) * 0.42);

/* ---------- 선물 ---------- */
function makeGift() {
  const g = new THREE.Group();
  const red = std('#c4526c', { roughness: 0.55 }), gold = std('#e2c07f', { roughness: 0.4, metalness: 0.2 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.36), red); g.add(box);
  [[0.08, 0.31, 0.37], [0.37, 0.31, 0.08]].forEach(([x, y, z]) => g.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), gold)));
  const lid = new THREE.Group(); lid.position.y = 0.19; g.add(lid);
  const lidMat = std('#d8687f', { roughness: 0.55, transparent: true });
  lid.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.09, 0.4), lidMat));
  const goldT = std('#e2c07f', { roughness: 0.4, metalness: 0.2, transparent: true });
  [[0.08, 0.1, 0.41], [0.41, 0.1, 0.08]].forEach(([x, y, z]) => lid.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), goldT)));
  [-1, 1].forEach(s => {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 6, 14), goldT);
    loop.position.set(s * 0.06, 0.09, 0); loop.rotation.set(0, Math.PI / 2, s * 0.6); lid.add(loop);
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(255,226,163,1)', 'rgba(255,226,163,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  glow.scale.set(1.6, 1.6, 1); glow.position.y = 0.2; g.add(glow);
  return { group: g, lid, lidMats: [lidMat, goldT], glow };
}

/* ---------- 조이스틱 ---------- */
class Joystick {
  constructor(zone, onUse) {
    this.zone = zone; this.base = zone.querySelector('.joy-base'); this.knob = zone.querySelector('.joy-knob');
    this.id = null; this.v = { x: 0, y: 0 }; this.R = 52; this.onUse = onUse;
    zone.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
  }
  down(e) {
    if (this.id !== null) return;
    e.preventDefault();
    this.id = e.pointerId; this.ox = e.clientX; this.oy = e.clientY;
    const r = this.zone.getBoundingClientRect();
    this.base.style.left = `${e.clientX - r.left}px`; this.base.style.top = `${e.clientY - r.top}px`;
    this.zone.classList.add('active');
    try { this.zone.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    this.move(e);
    if (this.onUse) this.onUse();
  }
  move(e) {
    if (e.pointerId !== this.id) return;
    let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.R) { dx *= this.R / d; dy *= this.R / d; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.v.x = dx / this.R; this.v.y = dy / this.R;
  }
  up(e) {
    if (e.pointerId !== this.id) return;
    this.id = null; this.v.x = 0; this.v.y = 0;
    this.knob.style.transform = '';
    this.zone.classList.remove('active');
  }
  reset() { if (this.id !== null) this.up({ pointerId: this.id }); }
}

/* ---------- 중계 (MQTT) ---------- */
async function connectNet(urls, room, onMsg, onChange) {
  const mod = await import('./vendor/mqtt.esm.js');
  const mqtt = mod.default && mod.default.connect ? mod.default : mod;
  const id = Math.random().toString(36).slice(2, 10);
  const up = new Set(), seen = new Map(), clients = [];
  let seq = 0;
  urls.forEach((url, i) => {
    let c;
    try { c = mqtt.connect(url, { clientId: `mbr_${id}_${i}`, keepalive: 20, reconnectPeriod: 3000, connectTimeout: 8000, clean: true }); }
    catch (e) { console.warn('mqtt', url, e); return; }
    c.on('connect', () => { up.add(i); c.subscribe(`mbr/${room}/#`, { qos: 0 }); onChange(up.size); });
    c.on('close', () => { if (up.delete(i)) onChange(up.size); });
    c.on('error', e => console.warn('mqtt', url, e && e.message));
    c.on('message', (_topic, payload) => {
      let m;
      try { m = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (!m || m.id === id || typeof m.s !== 'number') return;
      const key = `${m.id}/${m.k}`;                 // 두 서버에서 같은 메시지가 오면 한 번만 처리
      if (m.s <= (seen.get(key) || 0)) return;
      seen.set(key, m.s);
      onMsg(m);
    });
    clients.push([i, c]);
  });
  return {
    send(k, data) {
      const s = JSON.stringify({ ...data, k, id, s: ++seq });
      for (const [i, c] of clients) if (up.has(i)) c.publish(`mbr/${room}/${k}`, s, { qos: 0 });
    },
    get connected() { return up.size > 0; },
    close() { for (const [, c] of clients) { try { c.end(true); } catch { /* 무시 */ } } },
  };
}

/* ---------- 버스 · 영화관 ---------- */
// 장소는 서로 멀리 떨어진 곳에 만들어 두고, 캐릭터를 옮겨서 이동한다 (x 좌표로 어디에 있는지 안다)
const AREA = { bus: { x: 300, z: 0 }, cinema: { x: -300, z: 0 } };
const areaOf = x => (x > 150 ? 'bus' : x < -150 ? 'cinema' : 'plaza');
const STOP = { x: 2.4, z: 9.0, w: 3.0, d: 1.5, wait: 15 };   // 버스정류장 칸 (광장 남쪽 끝), 15초 기다리면 버스
const ROAD_Z = 13;                                             // 광장 남쪽 도로
const RIDE_SEC = 60;                                           // 영화관까지 1분
const BUS = { L: 9, W: 2.6, floorY: 0.55, door: -2.7 };        // door: 문 가운데 (버스 기준 x)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function plateTex(text, bg, fg, w = 512, h = 96, font = 52) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${font}px "Gowun Batang", "Apple SD Gothic Neo", sans-serif`;
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

function makeTree(s = 1) {
  const g = new THREE.Group();
  g.scale.setScalar(s);
  const leaf = std('#1f4a36', { roughness: 0.9 }), snow = std('#eef3f9', { roughness: 1 });
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; g.add(m); };
  add(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 8), std('#4a3326'), 0.3);
  [[1.25, 1.3, 1.0], [1.0, 1.1, 1.75], [0.72, 0.95, 2.4]].forEach(([r, h, y]) => {
    add(new THREE.ConeGeometry(r, h, 10), leaf, y);
    add(new THREE.ConeGeometry(r * 0.55, h * 0.35, 10), snow, y + h * 0.36);
  });
  return g;
}

// 버스정류장: 바닥 칸 + 시계 방향으로 차는 노란 테두리 + 'BUS STOP' + 표지판 + 도로
function buildBusStop(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const flat = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  // 도로와 차선
  flat(new THREE.PlaneGeometry(110, 4.8), std('#3a3e4a', { roughness: 0.95 }), 0, 0.012, ROAD_Z);
  const dashM = new THREE.MeshBasicMaterial({ color: '#e9e4d6' });
  for (let x = -54; x < 54; x += 3) flat(new THREE.PlaneGeometry(1.4, 0.12), dashM, x, 0.016, ROAD_Z);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(110, 0.16, 0.3), std('#eef3f9', { roughness: 1 }));
  curb.position.set(0, 0.08, ROAD_Z - 2.55); g.add(curb);
  // 칸 안 'BUS STOP'
  const mark = canvasTex(512, 160, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255, 210, 63, 0.9)'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '800 88px "Helvetica Neue", Arial, "Apple SD Gothic Neo", sans-serif';   // 도로 표시처럼 굵은 글씨
    c.fillText('BUS STOP', w / 2, h / 2 + 4);
  });
  flat(new THREE.PlaneGeometry(STOP.w * 0.78, STOP.d * 0.5), new THREE.MeshBasicMaterial({ map: mark, transparent: true, depthWrite: false }), STOP.x, 0.02, STOP.z);
  // 테두리 리본: 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래 (카메라에서 볼 때 시계 방향)
  const x0 = STOP.x - STOP.w / 2, x1 = STOP.x + STOP.w / 2, z0 = STOP.z - STOP.d / 2, z1 = STOP.z + STOP.d / 2;
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  const ribbon = (color, opacity, y, width) => {
    const pos = [];
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[i + 1];
      const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.round(len / 0.05));
      const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz * width / 2, nz = dx * width / 2;
      for (let s = 0; s < steps; s++) {
        const p0x = ax + (bx - ax) * (s / steps), p0z = az + (bz - az) * (s / steps);
        const p1x = ax + (bx - ax) * ((s + 1) / steps), p1z = az + (bz - az) * ((s + 1) / steps);
        pos.push(p0x + nx, y, p0z + nz, p0x - nx, y, p0z - nz, p1x + nx, y, p1z + nz,
                 p0x - nx, y, p0z - nz, p1x - nx, y, p1z - nz, p1x + nx, y, p1z + nz);
        n++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
    g.add(m);
    return { mesh: m, n };
  };
  ribbon('#ffffff', 0.35, 0.022, 0.12);
  const fill = ribbon('#ffd23f', 1, 0.026, 0.17);
  fill.mesh.geometry.setDrawRange(0, 0);
  // 표지판
  const poleM = std('#2a2d35', { roughness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 10), poleM);
  pole.position.set(x1 + 0.35, 1.25, z0 - 0.1); g.add(pole);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 28), std('#2f6fd6'));
  disc.rotation.x = Math.PI / 2; disc.position.set(x1 + 0.35, 2.55, z0 - 0.045); g.add(disc);   // 기둥(z0-0.1, 굵기 0.05)보다 앞에
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.36, 28), new THREE.MeshBasicMaterial({ map: plateTex('BUS', '#2f6fd6', '#ffffff', 256, 256, 96) }));
  face.position.set(x1 + 0.35, 2.55, z0 - 0.015); g.add(face);   // 글씨가 바로 서 보이게 평평한 판에
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), new THREE.MeshBasicMaterial({ map: plateTex('영화관 행 →', '#1b1d24', '#ffd23f', 512, 148, 66) }));
  board.position.set(x1 + 0.35, 1.95, z0 - 0.015); g.add(board);   // 기둥 앞에 붙여서 글자가 가려지지 않게
  return { setProgress(p) { fill.mesh.geometry.setDrawRange(0, Math.floor(fill.n * clamp(p, 0, 1)) * 6); } };
}

// 위가 뚫린 빨간 버스 (앞 = -x, 문은 오른쪽 = 광장 쪽 z-)
function makeBus() {
  const { L, W, floorY } = BUS;
  const g = new THREE.Group();
  const red = std('#cf3f57', { roughness: 0.45 }), cream = std('#f4e8d2', { roughness: 0.6 }), dark = std('#23262e', { roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  box(L, 0.42, W, red, 0, 0.36, 0);
  box(L - 0.16, 0.05, W - 0.16, std('#cdbfae'), 0, floorY, 0);
  const wallH = 0.95, wy = floorY + wallH / 2, d0 = BUS.door - 0.7, d1 = BUS.door + 0.7;
  box(d0 + L / 2, wallH, 0.1, red, (-L / 2 + d0) / 2, wy, -W / 2 + 0.05);         // 광장 쪽 벽 (문 자리 비움)
  box(L / 2 - d1, wallH, 0.1, red, (d1 + L / 2) / 2, wy, -W / 2 + 0.05);
  box(L, 0.45, 0.1, red, 0, floorY + 0.225, W / 2 - 0.05);                           // 카메라 쪽은 낮은 벽 + 유리
  box(L, 0.5, 0.04, glass, 0, floorY + 0.7, W / 2 - 0.05);
  box(L + 0.02, 0.1, 0.12, cream, 0, floorY + 0.38, W / 2 - 0.05);
  box(L + 0.02, 0.1, 0.12, cream, 0, floorY + 0.38, -W / 2 + 0.05);
  box(0.12, wallH + 0.25, W, red, -L / 2 + 0.06, floorY + (wallH + 0.25) / 2, 0);   // 앞
  box(0.04, 0.55, W - 0.3, glass, -L / 2 + 0.04, floorY + wallH + 0.52, 0);          // 앞유리
  box(0.12, wallH, W, red, L / 2 - 0.06, wy, 0);                                     // 뒤
  [-0.85, 0.85].forEach(z => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 1.6 }));
    h.position.set(-L / 2 - 0.02, 0.45, z); h.scale.x = 0.4; g.add(h);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.34), new THREE.MeshBasicMaterial({ map: plateTex('영화관  CINEMA', '#1b1d24', '#ffcf5a') }));
  sign.rotation.y = -Math.PI / 2; sign.position.set(-L / 2 - 0.01, floorY + wallH + 0.12, 0); g.add(sign);
  const door = box(1.36, wallH, 0.06, new THREE.MeshStandardMaterial({ color: '#3a4a5c', transparent: true, opacity: 0.55, roughness: 0.2 }), BUS.door, wy, -W / 2 + 0.02);
  const wheels = [];
  [-L / 2 + 1.5, L / 2 - 1.5].forEach(x => [-1, 1].forEach(s => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18), dark);
    w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, s * (W / 2 - 0.12)); g.add(w); wheels.push(w);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 12), cream);
    cap.rotation.x = Math.PI / 2; cap.position.copy(w.position); g.add(cap);
  }));
  const wheelM = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 20), dark);       // 운전대 (자율주행 버스)
  wheelM.position.set(-L / 2 + 0.55, floorY + 0.85, -0.7); wheelM.rotation.y = Math.PI / 2; wheelM.rotation.x = 0.5; g.add(wheelM);
  const seatM = std('#7a2533', { roughness: 0.8 }), seatLocal = [];
  [-1.9, -0.7, 0.5, 1.7, 2.9].forEach(x => [-0.85, 0.85].forEach(z => {      // 앞(-x)을 보고 앉는 좌석
    box(0.5, 0.12, 0.56, seatM, x, floorY + 0.4, z);
    box(0.1, 0.55, 0.56, seatM, x + 0.25, floorY + 0.68, z);
    box(0.34, 0.34, 0.34, dark, x, floorY + 0.17, z);
    seatLocal.push({ x: x + 0.02, z, ry: -Math.PI / 2 });
  }));
  return { group: g, wheels, door, seatLocal };
}
const spinWheels = (bus, dist) => { for (const w of bus.wheels) w.rotation.y -= dist / 0.42; };

// 달리는 버스 안: 버스는 제자리, 도로와 풍경이 뒤로 지나간다 (바닥 높이를 0 에 맞추려고 땅을 0.55 내린다)
function buildRide(scene) {
  const O = AREA.bus, g = new THREE.Group();
  g.position.set(O.x, 0, O.z); scene.add(g);
  const flat = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  flat(new THREE.PlaneGeometry(240, 140), std('#d7e0ec', { roughness: 1 }), 0, -0.57, -20);
  const roadTex = canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = '#3a3e4a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e9e4d6'; c.fillRect(0, h / 2 - 2, w * 0.45, 4);
  });
  roadTex.wrapS = THREE.RepeatWrapping; roadTex.repeat.set(30, 1);
  flat(new THREE.PlaneGeometry(240, 5.6), std('#ffffff', { map: roadTex, roughness: 0.95 }), 0, -0.555, 0);
  const movers = [];
  const glowTex = radialTex('rgba(255,214,140,1)', 'rgba(255,214,140,0)');
  const bulbM = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffcf85', emissiveIntensity: 2.2 }), poleM = std('#23272f', { roughness: 0.6 });
  const put = (obj, x, z) => { obj.position.set(x, -0.55, z); g.add(obj); movers.push(obj); };
  for (let x = -60; x < 60; x += 12) {                        // 길가 가로등
    const lamp = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.1, 8), poleM); p.position.y = 1.55; lamp.add(p);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), bulbM); b.position.y = 3.0; lamp.add(b);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
    s.scale.set(1.6, 1.6, 1); s.position.y = 3.0; lamp.add(s);
    put(lamp, x, -3.7);
  }
  for (let i = 0; i < 22; i++) put(makeTree(rnd(0.8, 1.4)), rnd(-60, 60), rnd(-15, -5.5));
  const houseColors = ['#e7d9c4', '#d9c7b4', '#c9d2de', '#e9d3cf'];
  for (let x = -56; x < 60; x += 14) {                         // 불 켜진 작은 집
    const h = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.6), std(pick(houseColors))); body.position.y = 1.1; h.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.2, 4), std('#eef3f9', { roughness: 1 })); roof.position.y = 2.8; roof.rotation.y = Math.PI / 4; h.add(roof);
    [-0.8, 0.8].forEach(wx => { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ color: '#ffd58a' })); w.position.set(wx, 1.2, 1.31); h.add(w); });
    put(h, x + rnd(-3, 3), rnd(-20, -14));
  }
  const bus = makeBus();
  bus.group.position.set(0, -0.55, 0); g.add(bus.group);
  const seats = bus.seatLocal.map(s => ({ x: O.x + s.x, z: O.z + s.z, ry: s.ry }));
  let t = 0;
  return {
    seats,
    update(dt) {
      const v = 9 * dt; t += dt;
      roadTex.offset.x -= v / 8;
      for (const m of movers) { m.position.x += v; if (m.position.x > 60) m.position.x -= 120; }
      spinWheels(bus, v);
      bus.group.position.y = -0.55 + Math.sin(t * 9) * 0.01;
    },
  };
}

// 영화관: 뒷벽 없이 잘라 낸 상영관 (카메라가 뒤에서 스크린을 본다), 좌석 3줄
function buildCinema(scene) {
  const O = AREA.cinema, g = new THREE.Group();
  g.position.set(O.x, 0, O.z); scene.add(g);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(14.4, 0.1, 13.6), std('#5a1f2b', { roughness: 1 }), 0, -0.05, 0.3);
  const wallM = std('#241521', { roughness: 0.9 });
  [-7.2, 7.2].forEach(x => add(new THREE.BoxGeometry(0.3, 5, 13.6), wallM, x, 2.5, 0.3));
  add(new THREE.BoxGeometry(14.4, 6.6, 0.3), std('#1a1018', { roughness: 0.9 }), 0, 3.3, -6.5);
  add(new THREE.BoxGeometry(12, 0.45, 1.5), std('#3a1620'), 0, 0.22, -5.6);
  add(new THREE.BoxGeometry(10.6, 6.0, 0.1), std('#0e0a0e'), 0, 3.4, -6.32);
  const placeholder = canvasTex(1024, 576, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.6);
    gr.addColorStop(0, '#2a2030'); gr.addColorStop(1, '#0c0a10');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(226, 192, 127, .5)'; c.lineWidth = 3;
    c.beginPath(); c.arc(w / 2, h / 2 - 30, 90, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(w / 2 - 110, h / 2 - 30); c.lineTo(w / 2 + 110, h / 2 - 30); c.moveTo(w / 2, h / 2 - 140); c.lineTo(w / 2, h / 2 + 80); c.stroke();
    c.fillStyle = '#e2c07f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '700 64px "Gowun Batang", sans-serif'; c.fillText('곧 상영합니다', w / 2, h / 2 + 130);
    c.font = 'italic 34px "Bodoni Moda", serif'; c.fillStyle = 'rgba(244, 235, 225, .7)'; c.fillText('Coming soon', w / 2, h / 2 + 190);
  });
  const screenMat = new THREE.MeshBasicMaterial({ map: placeholder, toneMapped: false });
  add(new THREE.PlaneGeometry(10, 5.625), screenMat, 0, 3.4, -6.25);
  const curtainM = std('#7c1a2c', { roughness: 0.85 });
  [-5.95, 5.95].forEach(x => add(new THREE.BoxGeometry(1.3, 6.2, 0.3), curtainM, x, 3.1, -6.1));
  const sconceM = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffc670', emissiveIntensity: 1.8 });
  [-3, 0.5, 4].forEach(z => [-7.02, 7.02].forEach(x => add(new THREE.SphereGeometry(0.14, 12, 10), sconceM, x, 2.6, z)));
  const seatM = std('#b3263e', { roughness: 0.75 }), armM = std('#3a1620'), seats = [];
  [0.4, 1.9, 3.4].forEach(z => [-3.6, -2.8, -2.0, 2.0, 2.8, 3.6].forEach(x => {     // 스크린(-z)을 보고 앉는다
    add(new THREE.BoxGeometry(0.66, 0.14, 0.6), seatM, x, 0.42, z);
    add(new THREE.BoxGeometry(0.66, 0.72, 0.12), seatM, x, 0.8, z + 0.3);
    add(new THREE.BoxGeometry(0.4, 0.35, 0.4), armM, x, 0.17, z);
    seats.push({ x: O.x + x, z: O.z + z - 0.04, ry: Math.PI });
  }));
  return {
    seats,
    setVideo(video) {
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      screenMat.map = tex; screenMat.needsUpdate = true;
    },
  };
}

/* ---------- 게임 ---------- */
export async function startGame(o) {
  const root = o.root;
  const q = sel => root.querySelector(sel);
  const canvas = q('#game-canvas'), statusEl = q('#game-status'), actionBtn = q('#game-action');
  const modeBtn = q('#game-mode'), helpEl = q('#game-help');
  const names = o.names;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
  const world = buildWorld(scene);
  // 2인용 벤치: 벤치마다 왼쪽·오른쪽 자리. 앉으면 벤치 앞쪽(벤치가 바라보는 쪽)을 본다
  const seats = [];
  world.benches.forEach(bn => [-0.4, 0.4].forEach(lx => {
    const lz = 0.04;
    seats.push({ x: bn.x + lx * Math.cos(bn.ry) + lz * Math.sin(bn.ry), z: bn.z - lx * Math.sin(bn.ry) + lz * Math.cos(bn.ry), ry: bn.ry });
  }));
  // 버스정류장 · 광장에 들어오는 버스 · 달리는 버스 안 · 영화관 (좌석 번호는 두 화면이 같은 순서)
  const stop = buildBusStop(scene);
  const plazaBus = makeBus();
  plazaBus.group.visible = false; scene.add(plazaBus.group);
  const ride = buildRide(scene);
  const cinema = buildCinema(scene);
  seats.push(...ride.seats, ...cinema.seats);

  const chars = {
    beomjun: makeChar({ name: names.beomjun, coat: '#22252c', hair: '#1b1716', scarf: '#8f8b86', skin: '#f2d0bc' }),
    robi: makeChar({ name: names.robi, coat: '#f4efe8', hair: '#3a261f', skin: '#f6d6c4', longHair: true, fluffy: true }),
  };
  for (const [k, c] of Object.entries(chars)) {
    c.pos.set(SPAWN[k][0], 0, SPAWN[k][1]);
    c.ry = SPAWN[k][2]; c.group.rotation.y = c.ry;
    scene.add(c.group);
  }
  const other = { beomjun: 'robi', robi: 'beomjun' };
  const gift = makeGift();
  scene.add(gift.group);

  // 하트·반짝이
  const heartMap = heartTex();
  const hearts = [];
  const bigHeart = (x, y, z) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartMap, color: '#ff5f86', transparent: true, depthWrite: false, depthTest: false }));
    s.position.set(x, y, z); s.scale.set(0.01, 0.01, 1); s.renderOrder = 12;
    scene.add(s);
    hearts.push({ s, vx: 0, vy: 0.35, vz: 0, life: 1.6, age: 0, grow: 0.75 });
  };
  const burst = (x, y, z, n) => {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartMap, color: pick(['#ff8fa8', '#ff6f91', '#ffd0dc', '#e2c07f']), transparent: true, depthWrite: false }));
      const sc = rnd(0.16, 0.32);
      s.scale.set(sc, sc, 1); s.position.set(x + rnd(-0.2, 0.2), y, z + rnd(-0.2, 0.2));
      scene.add(s);
      hearts.push({ s, vx: rnd(-0.7, 0.7), vy: rnd(1, 2.2), vz: rnd(-0.7, 0.7), life: rnd(1.4, 2.2), age: 0 });
    }
  };

  const st = {
    mode: o.role ? 'online' : 'local',
    role: o.role || 'robi',
    holder: 'beomjun', opened: false, opening: 0, transfer: null,
    net: null, netTried: false, netFailed: false, otherSeen: 0, otherOnline: false,
    remote: null, flash: null, flashUntil: 0, moved: false,
    sendAcc: 0, idleAcc: 0, lastSent: '',
    zone: 0, bus: { phase: 'idle', t: 0 }, snapCam: false,
  };

  // 입력
  const keys = new Set();
  const onKey = e => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      if (e.type === 'keydown') { keys.add(k); markMoved(); } else keys.delete(k);
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const keyVec = (up, down, left, right) => ({ x: (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0), y: (keys.has(down) ? 1 : 0) - (keys.has(up) ? 1 : 0) });
  const markMoved = () => { if (!st.moved) { st.moved = true; helpEl.classList.add('gone'); } };
  const joyL = new Joystick(q('#joy-left'), markMoved);
  const joyR = new Joystick(q('#joy-right'), markMoved);

  function flash(text, ms = 2600) { st.flash = text; st.flashUntil = performance.now() + ms; }
  function baseStatus() {
    const B = names.beomjun, R = names.robi;
    if (st.mode === 'local') {
      if (st.opened) return `생일 축하해, ${R}!`;
      if (st.holder === 'beomjun') return `${B}, ${R}에게 다가가서 선물을 건네 줘`;
      return `${R}, 선물을 열어 봐`;
    }
    if (!st.net || !st.net.connected) return st.netFailed ? '연결이 안 돼요. 같이 있다면 오른쪽 위 \'한 폰으로\'를 눌러 줘' : '광장에 연결하는 중…';
    const otherName = names[other[st.role]];
    if (!st.otherOnline) return `${otherName} 기다리는 중…`;
    if (st.role === 'robi') {
      if (st.opened) return `생일 축하해, ${R}!`;
      if (st.holder === 'beomjun') return `${ga(B)} 뭔가 들고 있어…`;
      return '선물을 받았어! 열어 볼까?';
    }
    if (st.opened) return `${ga(R)} 선물을 열었어!`;
    if (st.holder === 'beomjun') return `${R}에게 다가가서 선물을 건네 줘`;
    return `${ga(R)} 선물을 여는 중…`;
  }
  let shownStatus = '';
  const renderStatus = now => {
    const text = st.flash && now < st.flashUntil ? st.flash : baseStatus();
    if (text !== shownStatus) { statusEl.textContent = text; shownStatus = text; }
  };

  // 채팅: 입장 날짜로 만든 열쇠로 암호화해서 보낸다 (공개 중계 서버에는 알아볼 수 없는 글자만)
  const chatBtn = q('#game-chat-btn'), chatForm = q('#game-chat'), chatInput = q('#chat-input'), chatLog = q('#chat-log');
  const te = new TextEncoder();
  let chatKey = null;
  const getChatKey = async () => {
    if (!chatKey) {
      const base = await crypto.subtle.importKey('raw', te.encode(o.secret || o.room), 'PBKDF2', false, ['deriveKey']);
      chatKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode(`mbr-chat/${o.room}`), iterations: 120000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    return chatKey;
  };
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function seal(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getChatKey(), te.encode(text)));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return b64(out);
  }
  async function unseal(s) {
    const u = unb64(s);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, await getChatKey(), u.subarray(12)));
  }
  function showChat(role, text) {
    const c = chars[role];
    if (!c) return;
    c.bubble.show(text);
    c.bubble.until = performance.now() + 6000;
    const line = document.createElement('p');
    const who = document.createElement('b');
    who.textContent = names[role];
    line.append(who, ` ${text}`);
    chatLog.append(line);
    while (chatLog.children.length > 4) chatLog.firstChild.remove();
    setTimeout(() => { line.classList.add('gone'); setTimeout(() => line.remove(), 600); }, 12000);
  }
  async function sendChat(text) {
    text = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) return;
    showChat(st.role, text);
    if (st.mode === 'online' && st.net && st.net.connected) {
      try { st.net.send('c', { r: st.role, c: await seal(text) }); } catch (e) { console.warn(e); }
    }
  }
  const openChat = () => { chatForm.hidden = false; chatBtn.hidden = true; helpEl.classList.add('gone'); chatInput.focus(); };
  const closeChat = () => { chatForm.hidden = true; chatBtn.hidden = st.mode !== 'online'; chatInput.blur(); };
  chatBtn.addEventListener('click', openChat);
  q('#chat-close').addEventListener('click', closeChat);
  chatForm.addEventListener('submit', e => { e.preventDefault(); const t = chatInput.value; chatInput.value = ''; sendChat(t); });
  // 휴대폰 키보드가 올라오면 입력창을 그 위로
  const vv = window.visualViewport;
  const onVV = () => root.style.setProperty('--kb', `${vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0}px`);
  if (vv) { vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); }

  // 모드 전환
  function applyMode() {
    const local = st.mode === 'local';
    root.classList.toggle('local', local);
    q('#joy-right').hidden = !local;
    chatForm.hidden = true;
    chatBtn.hidden = local;
    modeBtn.textContent = local ? '각자 폰으로' : '한 폰으로';
    helpEl.textContent = local
      ? `왼쪽은 ${names.beomjun}, 오른쪽은 ${names.robi}. 화면을 꾹 누른 채로 움직여`
      : '화면 아래쪽을 꾹 누른 채로 움직여 봐';
    joyL.reset(); joyR.reset();
    for (const k of Object.keys(chars)) chars[k].moving = false;
    updateLabels();
  }
  modeBtn.addEventListener('click', () => {
    st.mode = st.mode === 'local' ? 'online' : 'local';
    if (st.mode === 'online') ensureNet();
    applyMode();
  });

  function updateLabels() {
    for (const k of Object.keys(chars)) {
      const waiting = st.mode === 'online' && k !== st.role && !st.otherOnline;
      const sub = waiting ? '접속 기다리는 중' : '';
      if (chars[k].sub !== sub) { chars[k].sub = sub; chars[k].label.draw(sub); }
    }
  }

  // 중계 연결
  function ensureNet() {
    if (st.netTried) return;
    st.netTried = true;
    const urls = o.brokers && o.brokers.length ? o.brokers : DEFAULT_BROKERS;
    setTimeout(() => { if (!st.net || !st.net.connected) st.netFailed = true; }, 10000);
    connectNet(urls, o.room, onNet, n => { if (n > 0) st.netFailed = false; })
      .then(net => { st.net = net; })
      .catch(e => { console.warn(e); st.netFailed = true; });
  }
  function onNet(m) {
    if (st.mode !== 'online' || m.r === st.role || !chars[m.r]) return;
    st.otherSeen = performance.now();
    if (m.k === 'c' && typeof m.c === 'string') {
      unseal(m.c).then(t => showChat(m.r, t)).catch(() => { /* 열쇠가 다르면 무시 */ });
    } else if (m.k === 'p') {
      st.remote = { x: m.x, z: m.z, ry: m.ry, m: !!m.m, sit: Number.isInteger(m.sit) ? m.sit : -1 };
      const theirArea = areaOf(m.x);           // 상대가 이미 버스나 영화관에 있으면 따라간다 (늦게 들어온 경우)
      if (theirArea !== 'plaza' && st.bus.phase === 'idle' && areaOf(chars[st.role].pos.x) === 'plaza') joinArea(theirArea);
      if (m.r === 'beomjun' && m.g === 'robi' && st.holder === 'beomjun') receiveGive();
      if (m.r === 'robi' && m.o && !st.opened) playOpen(false);
    } else if (m.k === 'e') {
      if (m.t === 'give' && st.holder === 'beomjun') receiveGive();
      if (m.t === 'open' && !st.opened) playOpen(false);
      if (m.t === 'hug' || m.t === 'kiss') startEmote(m, false);
      if (m.t === 'bus') startBus(false);
      if (m.t === 'mv') syncMovie(m);
    }
  }
  function sendState(force) {
    if (st.mode !== 'online' || !st.net || !st.net.connected) return;
    const me = chars[st.role];
    const msg = { r: st.role, x: +me.pos.x.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2), m: me.moving ? 1 : 0, sit: me.seat };
    if (st.role === 'beomjun') msg.g = st.holder;
    if (st.role === 'robi') msg.o = st.opened ? 1 : 0;
    const sig = JSON.stringify(msg);
    if (!force && sig === st.lastSent && st.idleAcc < 1) return;
    st.lastSent = sig; st.idleAcc = 0;
    st.net.send('p', msg);
  }

  // 선물 건네기 / 열기
  function giveGift() {
    if (st.holder !== 'beomjun') return;
    st.holder = 'robi';
    st.transfer = { t: 0 };
    const b = chars.beomjun.pos, r = chars.robi.pos;
    burst((b.x + r.x) / 2, 1.4, (b.z + r.z) / 2, 14);
    if (st.mode === 'online' && st.net) { st.net.send('e', { r: st.role, t: 'give' }); sendState(true); }
    flash(st.mode === 'online' ? `${names.robi}에게 선물을 건넸어!` : `${ga(names.robi)} 선물을 받았어!`);
  }
  function receiveGive() {
    if (st.holder !== 'beomjun') return;
    st.holder = 'robi';
    st.transfer = { t: 0 };
    const b = chars.beomjun.pos, r = chars.robi.pos;
    burst((b.x + r.x) / 2, 1.4, (b.z + r.z) / 2, 14);
    flash(`${ga(names.beomjun)} 선물을 줬어!`);
  }
  function playOpen(mine) {
    if (st.opened) return;
    st.opened = true; st.opening = 0.0001;
    const p = gift.group.position;
    burst(p.x, p.y + 0.3, p.z, 30);
    if (mine && st.mode === 'online' && st.net) { st.net.send('e', { r: st.role, t: 'open' }); sendState(true); }
    if (!mine) flash(`${ga(names.robi)} 선물을 열었어!`, 4000);
  }

  // 안아주기 · 볼 뽀뽀: 누가 눌러도 되고, 각자 폰이면 두 화면에서 같이 나온다
  const hugBtn = q('#game-hug'), kissBtn = q('#game-kiss');
  const EMOTE = { hug: { dur: 3.2, text: '꼬옥 🤗' }, kiss: { dur: 3, text: '볼에 쪽! 💋' } };
  // 볼 뽀뽀 치수: 받는 사람은 카메라 쪽으로 0.8 돌아 볼(머리 중심에서 0.21, -0.12, 0.23)을 내밀고,
  // 하는 사람은 0.1 기울였을 때 내민 입술 끝이 서 있는 자리에서 0.526 앞에 온다 → 그만큼 떨어져 서면 딱 닿는다
  const KISS = { turn: 0.8, cheek: [0.21, -0.12, 0.23], reach: 0.526 };
  const constrain = (x, z) => {
    const area = areaOf(x);
    if (area === 'bus') return [clamp(x, AREA.bus.x - 3.0, AREA.bus.x + 3.9), clamp(z, AREA.bus.z - 0.75, AREA.bus.z + 0.75)];
    if (area === 'cinema') return [clamp(x, AREA.cinema.x - 6.0, AREA.cinema.x + 6.0), clamp(z, AREA.cinema.z - 4.2, AREA.cinema.z + 6.2)];
    const r = Math.hypot(x, z);
    if (r > PLAZA_R - 0.5) { x *= (PLAZA_R - 0.5) / r; z *= (PLAZA_R - 0.5) / r; }
    const fx = x - FOUNTAIN.x, fz = z - FOUNTAIN.z, fd = Math.hypot(fx, fz) || 1, need = FOUNTAIN.r + 0.45;
    if (fd < need) { x = FOUNTAIN.x + (fx / fd) * need; z = FOUNTAIN.z + (fz / fd) * need; }
    return [x, z];
  };
  // 누른 쪽 화면에서 지금 위치로 계획을 세워 보낸다 (두 화면이 같은 계획으로 같은 장면을 그린다)
  function planEmote(type) {
    const b = chars.beomjun.pos, r = chars.robi.pos;
    if (type === 'hug') {
      return { t: 'hug', mx: +((b.x + r.x) / 2).toFixed(2), mz: +((b.z + r.z) / 2).toFixed(2), ang: b.x <= r.x ? Math.PI / 2 : -Math.PI / 2 };
    }
    const who = st.mode === 'online' ? st.role : 'beomjun', to = chars[other[who]].pos;
    return { t: 'kiss', who, rx: +to.x.toFixed(2), rz: +to.z.toFixed(2), sd: chars[who].pos.x >= to.x ? 1 : -1 };
  }
  function layoutEmote(m) {
    if (m.t === 'hug') {
      if (![m.mx, m.mz, m.ang].every(Number.isFinite)) return null;
      // 머리 지름 0.68 → 0.7 떨어져 좌우로 나란히 마주 본다 (카메라에 둘 다 옆모습)
      const [cx, cz] = constrain(m.mx, m.mz), dx = Math.sin(m.ang), dz = Math.cos(m.ang);
      return { pos: { beomjun: [cx - dx * 0.35, cz - dz * 0.35], robi: [cx + dx * 0.35, cz + dz * 0.35] },
        ry: { beomjun: m.ang, robi: m.ang + Math.PI }, pop: [cx, 1.9, cz], delay: 0 };
    }
    if (m.t === 'kiss') {
      if (![m.rx, m.rz, m.sd].every(Number.isFinite)) return null;
      const who = m.who === 'robi' ? 'robi' : 'beomjun', to = other[who], sd = m.sd >= 0 ? 1 : -1;
      const ryTo = sd * KISS.turn;
      const cx0 = sd * KISS.cheek[0], cz0 = KISS.cheek[2];
      const ox = cx0 * Math.cos(ryTo) + cz0 * Math.sin(ryTo), oz = -cx0 * Math.sin(ryTo) + cz0 * Math.cos(ryTo);
      const on = Math.hypot(ox, oz), nx = ox / on, nz = oz / on;          // 볼이 바라보는 방향
      let [rx, rz] = constrain(m.rx, m.rz);
      let kx = rx + ox + nx * KISS.reach, kz = rz + oz + nz * KISS.reach;
      const [ckx, ckz] = constrain(kx, kz);                               // 막히면 둘 다 같이 옮긴다
      rx += ckx - kx; rz += ckz - kz; kx = ckx; kz = ckz;
      return { who, pos: { [who]: [kx, kz], [to]: [rx, rz] }, ry: { [who]: Math.atan2(-nx, -nz), [to]: ryTo },
        pop: [rx + ox + nx * 0.06, 1.68, rz + oz + nz * 0.06], delay: 0.55 };
    }
    return null;
  }
  function startEmote(m, mine) {
    const E = m && EMOTE[m.t];
    if (st.emote || !E) return;
    const L = layoutEmote(m);
    if (!L) return;
    for (const c of Object.values(chars)) c.seat = -1;   // 앉아 있었다면 일어나서 한다
    st.emote = { type: m.t, t: 0, dur: E.dur, w: 0, popped: false, ...L };
    joyL.reset(); joyR.reset();
    flash(E.text, E.dur * 1000 + 600);
    if (mine && st.mode === 'online' && st.net) st.net.send('e', { r: st.role, ...m });
  }
  hugBtn.addEventListener('click', () => startEmote(planEmote('hug'), true));
  kissBtn.addEventListener('click', () => startEmote(planEmote('kiss'), true));

  actionBtn.addEventListener('click', () => {
    const act = actionBtn.dataset.act;
    if (act === 'give') giveGift();
    else if (act === 'open' && o.onWantOpen) o.onWantOpen();
  });

  // 버스: 정류장 칸에 15초 → 버스 도착 → 문 열림 → 타기 → (1분) → 영화관
  const fadeEl = q('#game-fade');
  const fade = on => fadeEl.classList.toggle('on', on);
  const nextPhase = phase => { st.bus = { phase, t: 0 }; };
  function startBus(mine) {
    if (st.bus.phase !== 'idle') return;
    nextPhase('arrive');
    st.zone = 1; stop.setProgress(1);
    plazaBus.group.visible = true;
    plazaBus.door.position.x = BUS.door;
    flash('🚌 버스가 와요!', 4000);
    if (mine && st.mode === 'online' && st.net) st.net.send('e', { r: st.role, t: 'bus' });
  }
  function teleport(area) {
    const O = AREA[area];
    const spots = area === 'bus'
      ? { beomjun: [O.x - 0.6, O.z + 0.3, 0.5], robi: [O.x + 0.6, O.z - 0.25, -0.4] }
      : { beomjun: [O.x + 0.7, O.z + 5.6, Math.PI], robi: [O.x - 0.7, O.z + 5.6, Math.PI] };
    for (const [role, c] of Object.entries(chars)) {
      const [x, z, ry] = spots[role];
      c.pos.x = x; c.pos.z = z; c.ry = ry; c.group.rotation.y = ry; c.seat = -1; c.moving = false;
    }
    st.emote = null; st.remote = null; st.snapCam = true;
    world.recenter(O.x, O.z);
    sendState(true);
  }
  function joinArea(area) {                       // 상대가 먼저 가 있는 곳으로 바로 합류
    teleport(area);
    stop.setProgress(0); st.zone = 0;
    nextPhase(area === 'bus' ? 'ride' : 'cinema');
    if (area === 'cinema') loadMovie();
  }
  // 반환값 true = 조이스틱을 잠깐 멈춘다 (타러 걸어가는 중, 화면 전환 중)
  function updateBus(dt) {
    const b = st.bus;
    b.t += dt;
    const stopX = STOP.x - BUS.door;
    if (b.phase === 'idle') {
      const inZone = c => areaOf(c.pos.x) === 'plaza' && Math.abs(c.pos.x - STOP.x) < STOP.w / 2 && Math.abs(c.pos.z - STOP.z) < STOP.d / 2;
      const here = st.mode === 'local' ? [chars.beomjun, chars.robi] : [chars[st.role], ...(st.otherOnline ? [chars[other[st.role]]] : [])];
      const any = here.some(inZone);
      st.zone = any ? Math.min(1, st.zone + dt / STOP.wait) : Math.max(0, st.zone - dt * 0.5);
      stop.setProgress(st.zone);
      if (any && !st.emote) flash(`🚌 버스 기다리는 중… ${Math.max(1, Math.ceil(STOP.wait * (1 - st.zone)))}초`, 300);
      if (st.zone >= 1) startBus(true);
      return false;
    }
    if (b.phase === 'arrive') {                   // 오른쪽에서 들어와 정류장 앞에 선다
      const k = Math.min(1, b.t / 5.5), x = stopX + 34 * (1 - k) ** 3;
      spinWheels(plazaBus, Math.abs(plazaBus.group.position.x - x));
      plazaBus.group.position.set(x, 0, ROAD_Z);
      if (k >= 1) nextPhase('door');
      return false;
    }
    if (b.phase === 'door') {
      plazaBus.door.position.x = BUS.door + 1.3 * Math.min(1, b.t / 0.7);
      if (b.t >= 0.7) { nextPhase('board'); flash('타자! 🚌', 2500); }
      return false;
    }
    if (b.phase === 'board') {                    // 문으로 걸어간다
      const tz = ROAD_Z - BUS.W / 2 - 0.25;
      for (const c of mine()) {
        if (areaOf(c.pos.x) !== 'plaza') continue;
        c.seat = -1;
        const tx = STOP.x + (c === chars.beomjun ? 0.3 : -0.3), dx = tx - c.pos.x, dz = tz - c.pos.z, d = Math.hypot(dx, dz);
        const step = Math.min(d, SPEED * dt);
        if (d > 0.001) { c.pos.x += (dx / d) * step; c.pos.z += (dz / d) * step; c.ry = Math.atan2(dx, dz); }
        c.moving = d > 0.05;
      }
      if (b.t >= 2.4) { fade(true); nextPhase('fadeout'); }
      return true;
    }
    if (b.phase === 'fadeout') {
      if (b.t >= 0.75) {
        teleport('bus');
        plazaBus.group.visible = false;
        st.zone = 0; stop.setProgress(0);
        nextPhase('ride');
        setTimeout(() => fade(false), 150);
        flash('영화관으로 출발! 🎬', 3000);
      }
      return true;
    }
    if (b.phase === 'ride') {
      if (b.t > 3 && !st.emote) flash(`🚌 영화관으로 가는 중… ${Math.max(1, Math.ceil(RIDE_SEC - b.t))}초`, 300);
      if (b.t >= RIDE_SEC) { fade(true); nextPhase('fade2'); }
      return false;
    }
    if (b.phase === 'fade2') {
      if (b.t >= 0.75) {
        teleport('cinema');
        nextPhase('cinema');
        setTimeout(() => fade(false), 150);
        flash('🎬 영화관에 도착했어!', 3500);
        loadMovie();
      }
      return true;
    }
    return false;
  }

  // 영화관 스크린: 영상이 있으면 '상영 시작'으로 틀고, 각자 폰이면 두 화면이 같이 튼다
  const movieBtn = q('#game-movie');
  let movie = null, movieLoading = false;
  function loadMovie() {
    if (movie || movieLoading || !o.getCinemaVideo) return;
    movieLoading = true;
    o.getCinemaVideo().then(v => {
      movieLoading = false;
      if (!v) return;
      movie = v;
      cinema.setVideo(v);
    }).catch(e => { movieLoading = false; console.warn(e); });
  }
  movieBtn.addEventListener('click', () => {
    if (!movie) return;
    const play = movie.paused;
    if (play) movie.play().catch(noop); else movie.pause();
    if (st.mode === 'online' && st.net) st.net.send('e', { r: st.role, t: 'mv', a: play ? 'play' : 'pause', at: +movie.currentTime.toFixed(2) });
  });
  function syncMovie(m) {
    if (!movie) return;
    if (Number.isFinite(m.at) && Math.abs(movie.currentTime - m.at) > 1) movie.currentTime = m.at;
    if (m.a === 'play') movie.play().catch(noop); else movie.pause();   // 막히면 '상영 시작'을 직접 누르면 된다
  }

  // 벤치
  const SEAT_RANGE = 1.4;
  const seatTaken = (id, c) => Object.values(chars).some(o => o !== c && o.seat === id);
  function freeSeatNear(c) {
    let best = -1, bd = SEAT_RANGE;
    seats.forEach((s, id) => {
      const d = Math.hypot(s.x - c.pos.x, s.z - c.pos.z);
      if (d < bd && !seatTaken(id, c)) { bd = d; best = id; }
    });
    return best;
  }
  function goSeat(c, dt) {                    // 자리까지 걸어가서, 도착하면 벤치 앞쪽을 본다
    const s = seats[c.seat], dx = s.x - c.pos.x, dz = s.z - c.pos.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, SPEED * dt);
    if (d > 0.001) { c.pos.x += (dx / d) * step; c.pos.z += (dz / d) * step; }
    c.moving = d > 0.04;
    c.ry = d > 0.3 ? Math.atan2(dx, dz) : s.ry;
  }
  function drive(c, v, dt, otherC) {          // 앉아 있을 때 조이스틱을 움직이면 일어난다
    if (c.seat >= 0) {
      if (Math.hypot(v.x, v.y) > 0.35) c.seat = -1;
      else { goSeat(c, dt); return; }
    }
    move(c, v, dt, otherC);
  }
  const sitBtn = q('#game-sit'), sitLbl = q('#game-sit-label');
  const mine = () => (st.mode === 'local' ? [chars.beomjun, chars.robi] : [chars[st.role]]);
  sitBtn.addEventListener('click', () => {
    if (sitBtn.dataset.act === 'sit') {
      for (const c of mine()) if (c.seat < 0) { const id = freeSeatNear(c); if (id >= 0) c.seat = id; }
    } else {
      for (const c of mine()) c.seat = -1;
    }
    sendState(true);
  });

  // 움직임
  function move(c, v, dt, otherC) {
    const len = Math.hypot(v.x, v.y);
    c.moving = len > 0.15;
    if (!c.moving) return;
    const k = Math.min(1, len);
    const dx = (v.x / len) * k, dz = (v.y / len) * k;
    c.pos.x += dx * SPEED * dt; c.pos.z += dz * SPEED * dt;
    const area = areaOf(c.pos.x);
    if (area === 'bus') {                       // 버스 안
      c.pos.x = clamp(c.pos.x, AREA.bus.x - 3.6, AREA.bus.x + 4.2); c.pos.z = clamp(c.pos.z, AREA.bus.z - 1.0, AREA.bus.z + 1.0);
    } else if (area === 'cinema') {             // 영화관 안
      c.pos.x = clamp(c.pos.x, AREA.cinema.x - 6.6, AREA.cinema.x + 6.6); c.pos.z = clamp(c.pos.z, AREA.cinema.z - 4.6, AREA.cinema.z + 6.6);
    } else {
      const r = Math.hypot(c.pos.x, c.pos.z);
      if (r > PLAZA_R) { c.pos.x *= PLAZA_R / r; c.pos.z *= PLAZA_R / r; }
      const fx = c.pos.x - FOUNTAIN.x, fz = c.pos.z - FOUNTAIN.z, fd = Math.hypot(fx, fz);
      if (fd < FOUNTAIN.r) { c.pos.x = FOUNTAIN.x + (fx / fd) * FOUNTAIN.r; c.pos.z = FOUNTAIN.z + (fz / fd) * FOUNTAIN.r; }
    }
    if (otherC) {
      const ox = c.pos.x - otherC.pos.x, oz = c.pos.z - otherC.pos.z, od = Math.hypot(ox, oz);
      if (od < 0.75 && od > 0) { c.pos.x = otherC.pos.x + (ox / od) * 0.75; c.pos.z = otherC.pos.z + (oz / od) * 0.75; }
    }
    c.ry = Math.atan2(dx, dz);
  }

  // 카메라
  const camT = new THREE.Vector3(SPAWN.robi[0], 0, SPAWN.robi[1]);
  let camExtra = 0;
  function updateCamera(dt, snap) {
    let tx, tz, extra = 0;
    if (st.emote) {                                   // 안기·뽀뽀: 둘 사이로 가까이 다가간다
      const b = chars.beomjun.pos, r = chars.robi.pos;
      tx = (b.x + r.x) / 2; tz = (b.z + r.z) / 2; extra = -3.2 * (st.emote.w || 0);
    } else if (st.mode === 'local') {
      const b = chars.beomjun.pos, r = chars.robi.pos;
      tx = (b.x + r.x) / 2; tz = (b.z + r.z) / 2;
      extra = Math.min(7, Math.hypot(b.x - r.x, b.z - r.z) * 0.55);
    } else { const me = chars[st.role].pos; tx = me.x; tz = me.z; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 4);
    camT.x += (tx - camT.x) * k; camT.z += (tz - camT.z) * k; camExtra += (extra - camExtra) * k;
    const portrait = camera.aspect < 1;
    const back = (portrait ? 7.4 : 6.4) + camExtra, up = (portrait ? 5.4 : 4.6) + camExtra * (camExtra < 0 ? 0.9 : 0.7);
    camera.position.set(camT.x, up, camT.z + back);
    camera.lookAt(camT.x, 0.9, camT.z - 0.6);
  }
  function resize() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 58 : 46;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(root);

  // 매 프레임
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  let running = false, raf = 0, last = 0, time = 0, shownAction = '', readySent = false;
  function frame(now) {
    raf = running ? requestAnimationFrame(frame) : 0;
    // 첫 프레임은 휴대폰이 바쁘면 시간이 거꾸로(음수) 올 수 있다 → 0~0.1초로 묶는다
    let dt = (now - last) / 1000;
    if (!(dt > 0)) dt = 0; else if (dt > 0.1) dt = 0.1;
    last = now; time += dt;
    const B = chars.beomjun, R = chars.robi;
    const em = st.emote;
    if (em) {
      em.t += dt;
      // 뽀뽀는 볼 옆까지 걸어간 뒤(delay) 기울인다
      em.w = Math.max(0, Math.min(1, (em.t - em.delay) / 0.45, (em.dur - em.t) / 0.4));
      const k = 1 - Math.exp(-dt * 7);
      for (const role of ['beomjun', 'robi']) {
        const c = chars[role], [tx, tz] = em.pos[role];
        c.pos.x += (tx - c.pos.x) * k; c.pos.z += (tz - c.pos.z) * k;
        c.ry = em.ry[role];
        c.moving = Math.hypot(tx - c.pos.x, tz - c.pos.z) > 0.05;   // 자리로 갈 땐 걸어서
      }
      if (!em.popped && em.t > em.delay + (em.type === 'kiss' ? 0.5 : 0.9)) {
        em.popped = true;
        const [px, py, pz] = em.pop;
        if (em.type === 'kiss') { bigHeart(px, py, pz); burst(px, py - 0.15, pz, 10); } else burst(px, py, pz, 22);
      }
      if (em.t >= em.dur) st.emote = null;
    }

    const busLock = updateBus(dt);
    ride.update(dt);

    if (st.mode === 'local') {
      const vb = joyL.v.x || joyL.v.y ? joyL.v : keyVec('w', 's', 'a', 'd');
      const vr = joyR.v.x || joyR.v.y ? joyR.v : keyVec('arrowup', 'arrowdown', 'arrowleft', 'arrowright');
      if (!em && !busLock) { drive(B, vb, dt, R); drive(R, vr, dt, B); }
    } else {
      const me = chars[st.role], them = chars[other[st.role]];
      const kv = keyVec('w', 's', 'a', 'd'), ka = keyVec('arrowup', 'arrowdown', 'arrowleft', 'arrowright');
      const v = joyL.v.x || joyL.v.y ? joyL.v : { x: kv.x || ka.x, y: kv.y || ka.y };
      if (!em && !busLock) drive(me, v, dt, them);
      const was = st.otherOnline;
      st.otherOnline = now - st.otherSeen < 8000 && st.otherSeen > 0; // 잠깐 끊겨도 바로 나간 걸로 보지 않는다
      if (st.otherOnline && !was && !em) flash(`${names[other[st.role]]} 들어왔어!`);
      if (st.otherOnline !== was) updateLabels();
      if (st.remote && !em) {
        them.seat = st.remote.sit >= 0 && seats[st.remote.sit] ? st.remote.sit : -1;
        if (them.seat >= 0 && them.seat === me.seat && st.role === 'beomjun') me.seat ^= 1; // 같은 자리면 Beomjun이 옆자리로
        if (them.seat >= 0) goSeat(them, dt);
        else if (Math.hypot(st.remote.x - them.pos.x, st.remote.z - them.pos.z) > 20) {   // 다른 장소로 옮겨 갔으면 바로
          them.pos.x = st.remote.x; them.pos.z = st.remote.z; them.ry = st.remote.ry; them.group.rotation.y = them.ry;
        } else {
          const kk = 1 - Math.exp(-dt * 12);
          them.pos.x += (st.remote.x - them.pos.x) * kk;
          them.pos.z += (st.remote.z - them.pos.z) * kk;
          them.ry = st.remote.ry;
          them.moving = !!st.remote.m || Math.hypot(st.remote.x - them.pos.x, st.remote.z - them.pos.z) > 0.05;
        }
      }
      st.sendAcc += dt; st.idleAcc += dt;
      if (st.sendAcc > 1 / 12) { st.sendAcc = 0; sendState(false); }
    }

    // 선물 위치
    const holderC = chars[st.holder];
    if (st.transfer) {
      st.transfer.t = Math.min(1, st.transfer.t + dt / 0.9);
      const e = st.transfer.t < 0.5 ? 2 * st.transfer.t ** 2 : 1 - (-2 * st.transfer.t + 2) ** 2 / 2;
      handPos(B, tmpA); handPos(R, tmpB);
      gift.group.position.lerpVectors(tmpA, tmpB, e);
      gift.group.position.y += Math.sin(Math.PI * e) * 0.7;
      gift.group.rotation.y += dt * 6;
      if (st.transfer.t >= 1) st.transfer = null;
    } else {
      handPos(holderC, tmpA);
      gift.group.position.lerp(tmpA, Math.min(1, dt * 18));
      gift.group.rotation.y = angLerp(gift.group.rotation.y, holderC.group.rotation.y, Math.min(1, dt * 10));
    }
    if (st.opening) {
      st.opening = Math.min(1, st.opening + dt / 1.4);
      const e = 1 - (1 - st.opening) ** 3;
      gift.lid.position.y = 0.19 + e * 0.9;
      gift.lid.rotation.x = -e * 1.4;
      gift.lidMats.forEach(m => { m.opacity = 1 - e; });
      gift.glow.material.opacity = Math.sin(Math.PI * Math.min(1, st.opening * 1.2)) * 0.95 + (st.opening >= 1 ? 0.35 : 0);
      if (st.opening >= 1) { st.opening = 0; gift.lid.visible = false; }
    }
    if (st.opened && !st.opening) gift.glow.material.opacity = 0.35 + Math.sin(time * 3) * 0.1;

    const emo = st.emote ? { type: st.emote.type, w: st.emote.w } : null;
    const part = role => (!st.emote ? null : st.emote.type === 'hug' ? 'hug' : st.emote.who === role ? 'kisser' : 'recv');
    gift.group.visible = !st.emote;                    // 안는 동안 선물은 잠깐 숨긴다
    B.label.sprite.visible = R.label.sprite.visible = !st.emote;
    animateChar(B, dt, time, st.holder === 'beomjun' && !st.transfer && !emo, emo && { ...emo, part: part('beomjun') }, 1);
    animateChar(R, dt, time, st.holder === 'robi' && !st.transfer && !emo, emo && { ...emo, part: part('robi') }, -1);
    for (const c of [B, R]) {
      const left = c.bubble.until - now;
      c.bubble.sprite.material.opacity = left > 0 ? Math.min(1, left / 400, (6000 - left) / 200) : 0;
    }

    // 하트
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.age += dt;
      h.s.position.x += h.vx * dt; h.s.position.y += h.vy * dt; h.s.position.z += h.vz * dt;
      if (h.grow) { const g = h.grow * Math.min(1, h.age / 0.22) * (1 + Math.sin(h.age * 14) * 0.04); h.s.scale.set(g, g, 1); }
      else h.vy -= 0.6 * dt;
      h.s.material.opacity = Math.max(0, 1 - h.age / h.life);
      if (h.age >= h.life) { scene.remove(h.s); h.s.material.dispose(); hearts.splice(i, 1); }
    }

    // 버튼
    const dist = Math.hypot(B.pos.x - R.pos.x, B.pos.z - R.pos.z);
    let act = '', label = '';
    const iAmB = st.mode === 'local' || st.role === 'beomjun', iAmR = st.mode === 'local' || st.role === 'robi';
    if (st.holder === 'beomjun' && !st.transfer && iAmB && dist < GIVE_DIST && (st.mode === 'local' || st.otherOnline)) {
      act = 'give'; label = st.mode === 'local' ? `${names.beomjun} · 선물 건네기` : '선물 건네기';
    } else if (st.holder === 'robi' && !st.transfer && !st.opened && !st.opening && iAmR) {
      act = 'open'; label = st.mode === 'local' ? `${names.robi} · 선물 열기` : '선물 열기';
    } else if (st.opened && !st.opening && iAmR) {
      act = 'open'; label = '쿠폰 보기';
    }
    if (st.emote || busLock) { act = ''; label = ''; }
    const canTouch = dist < 2.3 && !st.emote && !busLock && !st.transfer && (st.mode === 'local' || st.otherOnline);
    let sitAct = '';
    if (!st.emote && !busLock) {
      if (mine().some(c => c.seat < 0 && freeSeatNear(c) >= 0)) sitAct = 'sit';
      else if (mine().some(c => c.seat >= 0)) sitAct = 'stand';
    }
    const myArea = areaOf((st.mode === 'local' ? B : chars[st.role]).pos.x);
    const movieAct = myArea === 'cinema' && movie && !busLock ? (movie.paused ? '▶ 상영 시작' : '❚❚ 잠깐 멈춤') : '';
    const sig = act + label + (canTouch ? '+touch' : '') + sitAct + movieAct;
    if (sig !== shownAction) {
      shownAction = sig;
      actionBtn.hidden = !act; actionBtn.dataset.act = act; actionBtn.textContent = label;
      hugBtn.hidden = !canTouch; kissBtn.hidden = !canTouch;
      sitBtn.hidden = !sitAct; sitBtn.dataset.act = sitAct; sitLbl.textContent = sitAct === 'stand' ? '일어나기' : '앉기';
      movieBtn.hidden = !movieAct; movieBtn.textContent = movieAct;
    }

    renderStatus(now);
    updateCamera(dt, st.snapCam);
    st.snapCam = false;
    world.setSnow(areaOf(camT.x) !== 'cinema');      // 영화관 안에는 눈이 안 온다
    world.update(dt, camT.x, camT.z);
    renderer.render(scene, camera);
    if (!readySent) { readySent = true; if (o.onReady) o.onReady(); }
  }

  function resume() {
    if (running) return;
    running = true; last = performance.now();
    resize(); updateCamera(0, true);
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    closeChat();
    if (movie) movie.pause();
    if (raf) cancelAnimationFrame(raf);
    raf = 0; joyL.reset(); joyR.reset(); keys.clear();
  }

  applyMode();
  if (st.mode === 'online') ensureNet();
  resume();

  return {
    openGift() { playOpen(true); },
    pause, resume,
    get role() { return st.role; },
  };
}
