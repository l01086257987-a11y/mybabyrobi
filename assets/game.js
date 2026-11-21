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
  const benchAt = (x, z, ry) => {
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
      s.position.set(x, -0.27, 0.02); s.rotation.z = x > 0 ? -0.12 : 0.12; head.add(s);
    });
  }
  const eyeM = new THREE.MeshBasicMaterial({ color: '#1c1614' }), white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  [-0.12, 0.12].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), eyeM);
    e.scale.set(1, 1.25, 0.6); e.position.set(x, -0.01, 0.315); head.add(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), white);
    hl.position.set(x + 0.016, 0.017, 0.343); head.add(hl);
  });
  const blushM = new THREE.MeshBasicMaterial({ color: '#f29aae', transparent: true, opacity: 0.55, depthWrite: false });
  [-0.2, 0.2].forEach(x => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blushM);
    b.position.set(x, -0.09, 0.285); b.rotation.y = x * 1.3; head.add(b);
  });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 6, 12, Math.PI), eyeM);
  mouth.rotation.z = Math.PI; mouth.position.set(0, -0.1, 0.322); head.add(mouth);

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

  return { group: g, rig, legL, legR, armL, armR, label, bubble, pos: g.position, ry: 0, moving: false, walk: 0, phase: 0, sub: '' };
}

function animateChar(c, dt, t, holding) {
  c.walk += ((c.moving ? 1 : 0) - c.walk) * Math.min(1, dt * 10);
  if (c.moving) c.phase += dt * 11;
  const s = Math.sin(c.phase) * 0.55 * c.walk;
  c.legL.rotation.x = s; c.legR.rotation.x = -s;
  const armX = holding ? -1.15 : -s * 0.8;
  c.armL.rotation.x += ((holding ? armX : -s * 0.8) - c.armL.rotation.x) * Math.min(1, dt * 12);
  c.armR.rotation.x += ((holding ? armX : s * 0.8) - c.armR.rotation.x) * Math.min(1, dt * 12);
  c.armL.rotation.z = holding ? 0.32 : 0.12;
  c.armR.rotation.z = holding ? -0.32 : -0.12;
  c.rig.position.y = Math.abs(Math.sin(c.phase)) * 0.05 * c.walk + Math.sin(t * 2.2) * 0.008;
  c.group.rotation.y = angLerp(c.group.rotation.y, c.ry, Math.min(1, dt * 12));
}
const handPos = (c, out) => out.set(c.pos.x + Math.sin(c.group.rotation.y) * 0.42, 0.84 + c.rig.position.y, c.pos.z + Math.cos(c.group.rotation.y) * 0.42);

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
      st.remote = { x: m.x, z: m.z, ry: m.ry, m: !!m.m };
      if (m.r === 'beomjun' && m.g === 'robi' && st.holder === 'beomjun') receiveGive();
      if (m.r === 'robi' && m.o && !st.opened) playOpen(false);
    } else if (m.k === 'e') {
      if (m.t === 'give' && st.holder === 'beomjun') receiveGive();
      if (m.t === 'open' && !st.opened) playOpen(false);
    }
  }
  function sendState(force) {
    if (st.mode !== 'online' || !st.net || !st.net.connected) return;
    const me = chars[st.role];
    const msg = { r: st.role, x: +me.pos.x.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.ry.toFixed(2), m: me.moving ? 1 : 0 };
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

  actionBtn.addEventListener('click', () => {
    const act = actionBtn.dataset.act;
    if (act === 'give') giveGift();
    else if (act === 'open' && o.onWantOpen) o.onWantOpen();
  });

  // 움직임
  function move(c, v, dt, otherC) {
    const len = Math.hypot(v.x, v.y);
    c.moving = len > 0.15;
    if (!c.moving) return;
    const k = Math.min(1, len);
    const dx = (v.x / len) * k, dz = (v.y / len) * k;
    c.pos.x += dx * SPEED * dt; c.pos.z += dz * SPEED * dt;
    const r = Math.hypot(c.pos.x, c.pos.z);
    if (r > PLAZA_R) { c.pos.x *= PLAZA_R / r; c.pos.z *= PLAZA_R / r; }
    const fx = c.pos.x - FOUNTAIN.x, fz = c.pos.z - FOUNTAIN.z, fd = Math.hypot(fx, fz);
    if (fd < FOUNTAIN.r) { c.pos.x = FOUNTAIN.x + (fx / fd) * FOUNTAIN.r; c.pos.z = FOUNTAIN.z + (fz / fd) * FOUNTAIN.r; }
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
    if (st.mode === 'local') {
      const b = chars.beomjun.pos, r = chars.robi.pos;
      tx = (b.x + r.x) / 2; tz = (b.z + r.z) / 2;
      extra = Math.min(7, Math.hypot(b.x - r.x, b.z - r.z) * 0.55);
    } else { const me = chars[st.role].pos; tx = me.x; tz = me.z; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 4);
    camT.x += (tx - camT.x) * k; camT.z += (tz - camT.z) * k; camExtra += (extra - camExtra) * k;
    const portrait = camera.aspect < 1;
    const back = (portrait ? 7.4 : 6.4) + camExtra, up = (portrait ? 5.4 : 4.6) + camExtra * 0.7;
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
  let running = false, raf = 0, last = 0, time = 0, shownAction = '';
  function frame(now) {
    raf = running ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now; time += dt;
    const B = chars.beomjun, R = chars.robi;

    if (st.mode === 'local') {
      const vb = joyL.v.x || joyL.v.y ? joyL.v : keyVec('w', 's', 'a', 'd');
      const vr = joyR.v.x || joyR.v.y ? joyR.v : keyVec('arrowup', 'arrowdown', 'arrowleft', 'arrowright');
      move(B, vb, dt, R); move(R, vr, dt, B);
    } else {
      const me = chars[st.role], them = chars[other[st.role]];
      const kv = keyVec('w', 's', 'a', 'd'), ka = keyVec('arrowup', 'arrowdown', 'arrowleft', 'arrowright');
      const v = joyL.v.x || joyL.v.y ? joyL.v : { x: kv.x || ka.x, y: kv.y || ka.y };
      move(me, v, dt, them);
      const was = st.otherOnline;
      st.otherOnline = now - st.otherSeen < 4500 && st.otherSeen > 0;
      if (st.otherOnline && !was) flash(`${names[other[st.role]]} 들어왔어!`);
      if (st.otherOnline !== was) updateLabels();
      if (st.remote) {
        const kk = 1 - Math.exp(-dt * 12);
        them.pos.x += (st.remote.x - them.pos.x) * kk;
        them.pos.z += (st.remote.z - them.pos.z) * kk;
        them.ry = st.remote.ry;
        them.moving = !!st.remote.m || Math.hypot(st.remote.x - them.pos.x, st.remote.z - them.pos.z) > 0.05;
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

    animateChar(B, dt, time, st.holder === 'beomjun' && !st.transfer);
    animateChar(R, dt, time, st.holder === 'robi' && !st.transfer);
    for (const c of [B, R]) {
      const left = c.bubble.until - now;
      c.bubble.sprite.material.opacity = left > 0 ? Math.min(1, left / 400, (6000 - left) / 200) : 0;
    }

    // 하트
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.age += dt;
      h.s.position.x += h.vx * dt; h.s.position.y += h.vy * dt; h.s.position.z += h.vz * dt;
      h.vy -= 0.6 * dt;
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
    const sig = act + label;
    if (sig !== shownAction) {
      shownAction = sig;
      actionBtn.hidden = !act; actionBtn.dataset.act = act; actionBtn.textContent = label;
    }

    renderStatus(now);
    updateCamera(dt, false);
    world.update(dt, camT.x, camT.z);
    renderer.render(scene, camera);
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
