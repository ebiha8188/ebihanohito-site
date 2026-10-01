// えびは LIVE HOUSE — トップページの3D模型
// 受付（プロフィール）／バーカン（作品一覧・水槽からえびダイブへ）／ステージとフロア（COMING SOON）
import * as THREE from '../vendor/three.module.min.js';

const FONT_DISPLAY = '"Dela Gothic One", "Hiragino Sans", "Yu Gothic", sans-serif';
const FONT_BODY = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 視点 ----------
// pos はカメラ位置、target は見る先。縦長画面では自動で引きの位置になる
const VIEWS = {
  overview:  { pos: [12.5, 14, 19],   target: [0, 0.4, -1] },
  reception: { pos: [3.4, 2.3, 12.2], target: [3.4, 1.55, 4.4] },
  bar:       { pos: [0.2, 2.9, 5.6],  target: [-6.0, 1.3, 0.2] },
  stage:     { pos: [0, 3.7, 3.4],    target: [0, 1.7, -7.0], maxMul: 1.05 },
};
const AREA_OF_HASH = { '': 'reception', '#reception': 'reception', '#bar': 'bar', '#works': 'bar', '#stage': 'stage', '#floor': 'stage', '#overview': 'overview' };
const HASH_OF_AREA = { reception: '#reception', bar: '#bar', stage: '#stage', overview: '#overview' };

export async function start() {
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('webgl');
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // 看板の日本語がフォールバック書体にならないよう、使う字を先に読み込む
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`80px ${FONT_DISPLAY}`, 'えびはLIVEHOUSEBARMENU受付RECEPTIONCOMINGSOONダイブ食堂作品一覧ENTRANCE今後なにかが始まりますおたのしみに水槽→STAGEFLOOR0123456789'),
        document.fonts.load(`700 40px ${FONT_BODY}`, 'えびダイブ食堂作品一覧水槽をのぞくとゲームの世界へ本日のおすすめランキング料理ドリンクビールレモンサワー受付はこちら'),
      ]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* 読めなくても描画は続ける */ }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#061820');
  scene.fog = new THREE.Fog('#061820', 30, 70);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

  const world = new World(scene);
  const loader = new THREE.TextureLoader();
  world.build(loader);

  // ---------- 状態 ----------
  let area = null;
  const cam = {
    pos: new THREE.Vector3(...VIEWS.overview.pos),
    target: new THREE.Vector3(...VIEWS.overview.target),
  };
  let tween = null;          // カメラ移動中の補間
  const look = { yaw: 0, pitch: 0, yawTo: 0, pitchTo: 0 }; // ドラッグで見回す量
  const offset = { x: 0, y: 0, xTo: 0, yTo: 0 };         // パネルを避ける画面ずらし
  let diving = false;

  const ui = {
    root: document.body,
    panels: [...document.querySelectorAll('.panel[data-area]')],
    navBtns: [...document.querySelectorAll('[data-go]')],
    markers: document.getElementById('markers'),
    loading: document.getElementById('loading'),
    dive: document.getElementById('dive'),
    hint: document.getElementById('hint'),
  };

  // ---------- 画面サイズ ----------
  let W = 1, H = 1, distMul = 1;
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    renderer.setSize(W, H, false);
    const aspect = W / H;
    // 横の見える幅をそろえる（縦長スマホでも被写体が切れない）
    const hfov = 62 * Math.PI / 180;
    let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI;
    const maxV = 74, minV = 42;
    distMul = 1;
    if (vfov > maxV) {
      distMul = Math.tan((vfov / 2) * Math.PI / 180) / Math.tan((maxV / 2) * Math.PI / 180);
      distMul = Math.min(distMul, 1.6);
      vfov = maxV;
    }
    camera.fov = Math.max(minV, vfov);
    camera.aspect = aspect;
    updateOffsetTarget();
    camera.updateProjectionMatrix();
    if (!tween && area) { const v = viewFor(area); cam.pos.copy(v.pos); cam.target.copy(v.target); }
  }

  function isMobileLayout() { return W < 760; }
  function updateOffsetTarget() {
    const panel = ui.panels.find(p => p.dataset.area === area && !p.hidden);
    if (!panel || area === 'overview') { offset.xTo = 0; offset.yTo = 0; return; }
    const r = panel.getBoundingClientRect();
    if (isMobileLayout()) { offset.xTo = 0; offset.yTo = Math.min(r.height, H * 0.6) / 2; }
    else { offset.xTo = (r.width + 24) / 2; offset.yTo = 0; }
  }

  function viewFor(name) {
    const v = VIEWS[name];
    const target = new THREE.Vector3(...v.target);
    const pos = new THREE.Vector3(...v.pos);
    const dir = pos.clone().sub(target);
    const mul = name === 'overview' ? Math.min(distMul * 1.05, 1.9) : Math.min(distMul, v.maxMul || 9);
    pos.copy(target).add(dir.multiplyScalar(mul));
    return { pos, target };
  }

  // ---------- 移動 ----------
  function go(name, { instant = false, push = true } = {}) {
    if (!VIEWS[name] || diving) return;
    const prev = area;
    area = name;
    ui.root.dataset.area = name;
    ui.panels.forEach(p => {
      const on = p.dataset.area === name;
      p.hidden = !on;
      if (on) { p.classList.remove('collapsed'); p.scrollTop = 0; }
    });
    ui.navBtns.forEach(b => b.setAttribute('aria-current', b.dataset.go === name ? 'page' : 'false'));
    document.title = { reception: 'えびは', bar: '作品一覧（バーカン）｜えびは', stage: 'ステージとフロア｜えびは', overview: '全体｜えびは' }[name];
    if (push) {
      const hash = name === 'reception' ? location.pathname + location.search : HASH_OF_AREA[name];
      if ((location.hash || '') !== (name === 'reception' ? '' : HASH_OF_AREA[name])) history.pushState({ area: name }, '', hash);
    }
    look.yawTo = 0; look.pitchTo = 0;
    updateOffsetTarget();
    const to = viewFor(name);
    if (instant || reduceMotion) { cam.pos.copy(to.pos); cam.target.copy(to.target); tween = null; offset.x = offset.xTo; offset.y = offset.yTo; return; }
    // 遠い移動は少し上を通って模型をまたぐ
    const far = prev && prev !== name;
    tween = {
      t: 0, dur: far ? 1.7 : 1.2,
      fromPos: cam.pos.clone(), fromTarget: cam.target.clone(),
      toPos: to.pos, toTarget: to.target,
      lift: far && prev !== 'overview' && name !== 'overview' ? 2.6 : 0,
    };
  }

  function dive() {
    if (diving) return;
    if (reduceMotion) { location.href = 'ebi-dive/'; return; }
    diving = true;
    ui.root.classList.add('diving');
    ui.panels.forEach(p => p.hidden = true);
    offset.xTo = 0; offset.yTo = 0;
    look.yawTo = 0; look.pitchTo = 0;
    const t = world.tankFront;
    const first = { pos: new THREE.Vector3(t.x + 2.1, t.y + 0.15, t.z), target: new THREE.Vector3(t.x - 1, t.y, t.z) };
    const inside = { pos: new THREE.Vector3(t.x - 0.35, t.y, t.z), target: new THREE.Vector3(t.x - 3, t.y - 0.1, t.z) };
    tween = { t: 0, dur: 1.0, fromPos: cam.pos.clone(), fromTarget: cam.target.clone(), toPos: first.pos, toTarget: first.target, lift: 0,
      then: () => {
        tween = { t: 0, dur: 1.1, fromPos: cam.pos.clone(), fromTarget: cam.target.clone(), toPos: inside.pos, toTarget: inside.target, lift: 0, ease: 'in' };
        setTimeout(() => ui.dive.classList.add('on'), 500);
        setTimeout(() => { location.href = 'ebi-dive/'; }, 1700);
      } };
  }

  // 戻るボタンで帰ってきたとき（bfcache）に水中のままにしない
  addEventListener('pageshow', e => {
    if (e.persisted && diving) {
      diving = false;
      ui.root.classList.remove('diving');
      ui.dive.classList.remove('on');
      go('bar', { instant: true, push: false });
    }
  });

  ui.navBtns.forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const name = b.dataset.go;
    if (name === 'dive') dive(); else go(name);
  }));
  document.querySelectorAll('.panel .fold').forEach(b => b.addEventListener('click', () => {
    const p = b.closest('.panel');
    p.classList.toggle('collapsed');
    b.setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
    requestAnimationFrame(updateOffsetTarget);
  }));
  addEventListener('popstate', () => go(AREA_OF_HASH[location.hash] || 'reception', { push: false }));
  addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(() => updateOffsetTarget()).observe(document.querySelector('.panels'));

  // ---------- 目印（HTMLラベル） ----------
  const markerDefs = [
    { id: 'reception', label: '受付', sub: 'プロフィール', at: [3.4, 3.5, 4.6] },
    { id: 'bar', label: 'バーカン', sub: '作品一覧', at: [-6.6, 3.55, -1.0] },
    { id: 'dive', label: '水槽をのぞく', sub: 'えびダイブ食堂へ', at: [-6.15, 2.55, 2.45], fish: true },
    { id: 'stage', label: 'ステージ', sub: 'COMING SOON', at: [0, 4.6, -7.0] },
  ];
  const markers = markerDefs.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marker' + (d.fish ? ' fish' : '');
    b.innerHTML = `<span class="m-label">${d.label}</span><span class="m-sub">${d.sub}</span>`;
    b.setAttribute('aria-label', `${d.label}（${d.sub}）へ移動`);
    b.addEventListener('click', () => d.id === 'dive' ? dive() : go(d.id));
    ui.markers.appendChild(b);
    return { ...d, el: b, v: new THREE.Vector3(...d.at) };
  });
  function placeMarkers() {
    for (const m of markers) {
      const show = !diving && (m.id === 'dive' ? (area === 'bar' || area === 'overview') : m.id !== area);
      m.v.set(...m.at);
      m.v.project(camera);
      const visible = show && m.v.z < 1 && Math.abs(m.v.x) < 1.05 && Math.abs(m.v.y) < 1.05;
      m.el.classList.toggle('off', !visible);
      // setViewOffset のずれは projection に入っているので、そのまま画面座標になる
      if (visible) m.el.style.transform = `translate(${((m.v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-m.v.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
    }
  }

  // ---------- ポインター：クリックで移動／ドラッグで見回す ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null;
  let hovered = null;
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(world.hotspots, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.go) o = o.parent;
      if (o) return o.userData.go;
    }
    return null;
  }
  canvas.addEventListener('pointerdown', e => {
    if (diving) return;
    drag = { x: e.clientX, y: e.clientY, yaw: look.yawTo, pitch: look.pitchTo, moved: false, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (drag.moved) {
        const lim = area === 'overview' ? 0.9 : 0.55;
        look.yawTo = THREE.MathUtils.clamp(drag.yaw - dx * 0.005, -lim, lim);
        look.pitchTo = THREE.MathUtils.clamp(drag.pitch + dy * 0.003, -0.22, 0.3);
        ui.hint.classList.add('done');
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const g = diving ? null : pick(e.clientX, e.clientY);
      if (g !== hovered) {
        hovered = g;
        canvas.style.cursor = g ? 'pointer' : 'grab';
        world.setHover(g);
      }
    }
  });
  const endDrag = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasClick = !drag.moved;
    drag = null;
    if (wasClick && e.type === 'pointerup') {
      const g = pick(e.clientX, e.clientY);
      if (g === 'dive') dive();
      else if (g && g !== area) go(g);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; world.setHover(null); } });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const keys = { '1': 'reception', '2': 'bar', '3': 'stage', '0': 'overview' };
    if (keys[e.key]) go(keys[e.key]);
  });

  // ---------- ループ ----------
  let lastT = performance.now(), time = 0;
  const tmpPos = new THREE.Vector3(), tmpTarget = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const ease = {
    inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    in: t => t * t * t,
  };
  function frame() {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now; time += dt;

    if (tween) {
      tween.start ??= now;
      tween.t = (now - tween.start) / 1000 / tween.dur;
      const k = (ease[tween.ease] || ease.inOut)(Math.min(tween.t, 1));
      cam.pos.lerpVectors(tween.fromPos, tween.toPos, k);
      cam.pos.y += Math.sin(Math.PI * k) * tween.lift;
      cam.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (tween.t >= 1) { const then = tween.then; tween = null; if (then) then(); }
    }
    const s = 1 - Math.pow(0.0015, dt);
    look.yaw += (look.yawTo - look.yaw) * s;
    look.pitch += (look.pitchTo - look.pitch) * s;
    offset.x += (offset.xTo - offset.x) * s;
    offset.y += (offset.yTo - offset.y) * s;

    // 見る先を中心に、ドラッグ量だけ回り込む
    tmpDir.copy(cam.pos).sub(cam.target);
    const r = tmpDir.length();
    const yaw0 = Math.atan2(tmpDir.x, tmpDir.z);
    const pitch0 = Math.asin(THREE.MathUtils.clamp(tmpDir.y / r, -1, 1));
    const yaw = yaw0 + look.yaw;
    const pitch = THREE.MathUtils.clamp(pitch0 + look.pitch, -0.1, 1.35);
    tmpPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(r).add(cam.target);
    tmpTarget.copy(cam.target);
    camera.position.copy(tmpPos);
    camera.lookAt(tmpTarget);
    if (Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5) camera.setViewOffset(W, H, offset.x, offset.y, W, H);
    else camera.clearViewOffset();

    world.update(time, dt);
    renderer.render(scene, camera);
    placeMarkers();
    requestAnimationFrame(frame);
  }

  resize();
  // 最初は模型全体を見せてから、受付（またはURLの場所）へ
  const first = AREA_OF_HASH[location.hash] || 'reception';
  area = 'overview';
  const ov = viewFor('overview'); cam.pos.copy(ov.pos); cam.target.copy(ov.target);
  requestAnimationFrame(frame);
  ui.root.classList.add('ready');
  ui.loading.classList.add('gone');
  if (reduceMotion) go(first, { instant: true, push: false });
  else setTimeout(() => go(first, { push: false }), 650);
  setTimeout(() => ui.hint.classList.add('done'), 9000);
}

// =====================================================================
// 模型づくり
// =====================================================================
class World {
  constructor(scene) {
    this.scene = scene;
    this.hotspots = [];
    this.anim = [];       // 毎フレーム呼ぶ関数
    this.hoverables = {}; // go名 → 光らせるマテリアル
    this.tankFront = new THREE.Vector3(-5.78, 1.5, 2.45);
  }

  mat(color, opts = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...opts }); }
  box(w, h, d, m, x, y, z, parent = this.scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  cyl(rt, rb, h, m, x, y, z, parent = this.scene, seg = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  build(loader) {
    this.lights();
    this.shell();
    this.reception(loader);
    this.bar(loader);
    this.aquarium();
    this.stage();
    this.floorCrowd();
    this.seaParticles();
  }

  update(time, dt) { for (const f of this.anim) f(time, dt); }

  setHover(name) {
    for (const [k, list] of Object.entries(this.hoverables)) {
      for (const m of list) m.emissiveIntensity = (k === name ? m.userData.hoverOn : m.userData.hoverOff);
    }
  }
  addHover(name, material, off, on) {
    material.userData.hoverOff = off; material.userData.hoverOn = on;
    (this.hoverables[name] ||= []).push(material);
  }
  hotspot(obj, name) { obj.userData.go = name; this.hotspots.push(obj); }

  // ---------- 光 ----------
  lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#8fb8d0', '#1a1020', 0.55));
    const key = new THREE.DirectionalLight('#b8d4ff', 0.55);
    key.position.set(8, 16, 12);
    s.add(key);
    const recep = new THREE.PointLight('#ffd9a8', 14, 9, 1.6); recep.position.set(3.2, 3.2, 6.6); s.add(recep);
    const bar = new THREE.PointLight('#ffb36b', 16, 9, 1.6); bar.position.set(-5.6, 3.1, -0.6); s.add(bar);
    const tank = new THREE.PointLight('#3fd4ff', 6, 4.5, 1.6); tank.position.set(-5.2, 1.7, 2.45); s.add(tank);
    const stageA = new THREE.PointLight('#ff5fa8', 18, 12, 1.4); stageA.position.set(-3, 3.6, -6); s.add(stageA);
    const stageB = new THREE.PointLight('#5f8bff', 18, 12, 1.4); stageB.position.set(3, 3.6, -6); s.add(stageB);
    this.anim.push(t => {
      stageA.intensity = 14 + Math.sin(t * 1.7) * 6;
      stageB.intensity = 14 + Math.cos(t * 1.3) * 6;
      tank.intensity = 6 + Math.sin(t * 2.3) * 1.2;
    });
  }

  // ---------- 台座・床・壁 ----------
  shell() {
    const s = this.scene;
    // 模型の台座（木）
    const wood = this.mat('#5a3b28', { roughness: 0.7 });
    this.box(18.6, 0.7, 19.6, wood, 0, -0.36, -0.6);
    const trim = this.mat('#c99a5b', { roughness: 0.5, metalness: 0.2 });
    this.box(18.8, 0.08, 19.8, trim, 0, -0.02, -0.6);
    // 台座の名札
    const plate = textPlane(['えびは LIVE HOUSE'], { w: 1024, h: 160, bg: '#c99a5b', color: '#3a2414', font: `64px ${FONT_DISPLAY}`, pad: 0 }, 3.6, 0.56);
    plate.position.set(4.2, -0.36, 8.71);
    s.add(plate);

    // ホールの床（コンクリート）と、ロビーの市松
    const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12.2), this.mat('#2b2b33', { roughness: 0.95 }));
    hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.set(0, 0.02, -2.9);
    s.add(hallFloor);
    const checker = canvasTex(512, 512, (g, w, h) => {
      const n = 8;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#e9e0cf' : '#2a2422'; g.fillRect(i * w / n, j * h / n, w / n, h / n); }
    });
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping; checker.repeat.set(4, 1.5);
    const lobby = new THREE.Mesh(new THREE.PlaneGeometry(16, 5.6), this.mat('#ffffff', { map: checker, roughness: 0.6 }));
    lobby.rotation.x = -Math.PI / 2; lobby.position.set(0, 0.021, 5.95);
    s.add(lobby);

    // 壁：奥と左だけ高く、手前と右は低い縁（ドールハウスの切り口）
    const wallM = this.mat('#1d2130', { roughness: 0.9 });
    this.box(16.2, 3.8, 0.25, wallM, 0, 1.9, -9.0);
    this.box(0.25, 3.8, 17.8, wallM, -8.0, 1.9, -0.25);
    const rim = this.mat('#262a3a');
    this.box(0.25, 0.35, 17.8, rim, 8.0, 0.175, -0.25);
    this.box(16.2, 0.35, 0.25, rim, 0, 0.175, 8.6);
    // 壁の切り口（白い断面）
    const cut = this.mat('#efe9dd');
    this.box(16.2, 0.04, 0.27, cut, 0, 3.8, -9.0);
    this.box(0.27, 0.04, 17.8, cut, -8.0, 3.8, -0.25);

    // ロビーとホールの仕切り（受付の背中側）
    const part = this.mat('#24324a', { roughness: 0.85 });
    this.box(6.6, 3.2, 0.25, part, 4.7, 1.6, 3.2);
    this.box(6.6, 0.04, 0.27, cut, 4.7, 3.2, 3.2);
    this.box(6.6, 0.16, 0.3, this.mat('#c99a5b', { metalness: 0.3, roughness: 0.4 }), 3.5, 0.08, 3.36);

    // 入口ドア（左の壁）
    const door = this.mat('#3a1f18', { roughness: 0.6 });
    this.box(0.12, 2.3, 1.5, door, -7.82, 1.15, 6.4);
    this.box(0.06, 0.06, 0.3, this.mat('#d9b46a', { metalness: 0.8, roughness: 0.3 }), -7.72, 1.1, 5.95);
    const ent = neonPlane('ENTRANCE', '#7ef0ff', 1.6, 0.36);
    ent.rotation.y = Math.PI / 2; ent.position.set(-7.84, 2.6, 6.4);
    this.scene.add(ent);

    // 奥の壁のポスター
    const posters = [['#ff7a57', 'えびダイブ\n食堂'], ['#c6ef6e', 'NEXT\nLIVE\n???'], ['#7ef0ff', 'SHRIMP\nNIGHT']];
    posters.forEach(([c, t], i) => {
      const p = textPlane(t.split('\n'), { w: 256, h: 360, bg: c, color: '#14121a', font: `54px ${FONT_DISPLAY}`, line: 70 }, 0.7, 0.98);
      p.rotation.y = Math.PI / 2; p.position.set(-7.86, 1.9, -8.3 + i * 0.85);
      this.scene.add(p);
    });
  }

  // ---------- 受付 ----------
  reception(loader) {
    const g = new THREE.Group();
    g.position.set(3.2, 0, 5.4);
    this.scene.add(g);
    // カウンター
    const front = this.mat('#7a2f24', { roughness: 0.55, emissive: '#ff7a57', emissiveIntensity: 0 });
    this.addHover('reception', front, 0, 0.25);
    this.box(3.6, 1.05, 0.7, front, 0, 0.525, 0, g);
    const top = this.mat('#d8c39c', { roughness: 0.35 });
    this.box(3.8, 0.08, 0.86, top, 0, 1.09, 0, g);
    // カウンター正面の「受付」
    const sign = textPlane(['受付  RECEPTION'], { w: 1024, h: 150, bg: 'rgba(0,0,0,0)', color: '#ffe6c7', font: `70px ${FONT_DISPLAY}` }, 2.4, 0.35);
    sign.position.set(0, 0.62, 0.356);
    g.add(sign);
    // 卓上：ベル、チケット立て、フライヤー
    const bell = this.mat('#e6c36a', { metalness: 0.9, roughness: 0.25 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), bell);
    b.position.set(-1.25, 1.13, 0.1); g.add(b);
    this.cyl(0.015, 0.015, 0.05, bell, -1.25, 1.25, 0.1, g, 8);
    for (let i = 0; i < 5; i++) {
      const f = this.box(0.26, 0.012, 0.36, this.mat(['#ff7a57', '#c6ef6e', '#7ef0ff', '#ffd36b', '#f5f1e8'][i]), 0.9 + i * 0.05, 1.14 + i * 0.012, 0.05, g);
      f.rotation.y = (i - 2) * 0.14;
    }
    const stand = this.box(0.5, 0.36, 0.04, this.mat('#1d1a20'), 0.1, 1.31, -0.15, g);
    stand.rotation.x = -0.25;
    const ticket = textPlane(['TICKET', 'FREE'], { w: 256, h: 180, bg: '#f5f1e8', color: '#7a2f24', font: `52px ${FONT_DISPLAY}`, line: 64 }, 0.44, 0.31);
    ticket.position.set(0.1, 1.32, -0.12); ticket.rotation.x = -0.25;
    g.add(ticket);

    // 受付のえび（えびは：緑のえび＋真珠のネックレス）
    const ebiha = makeShrimp({ body: '#5fbf6a', belly: '#bde8a6', pearls: true });
    ebiha.position.set(-0.8, 0.35, -0.9);
    ebiha.scale.setScalar(1.05);
    g.add(ebiha);
    this.anim.push(t => {
      ebiha.position.y = 0.35 + Math.sin(t * 2) * 0.03;
      ebiha.rotation.y = Math.sin(t * 0.7) * 0.18;
      ebiha.userData.wave(t);
    });

    // 背中の仕切りに、ネオンの「えびは」
    const neon = neonPlane('えびは', '#ff8fb8', 2.6, 0.95, 150);
    neon.position.set(4.3, 2.45, 3.34);
    this.scene.add(neon);
    const sub = neonPlane('LIVE HOUSE', '#7ef0ff', 2.2, 0.4);
    sub.position.set(4.3, 1.75, 3.34);
    this.scene.add(sub);
    this.anim.push(t => { neon.material.opacity = 0.88 + Math.sin(t * 9) * 0.04 + (Math.sin(t * 0.9) > 0.97 ? -0.4 : 0); });

    // 仕切りのポスター（えびダイブ食堂のサムネ）
    loader.load('ebi-dive/thumbnail.png', tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.125), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      p.position.set(6.75, 1.75, 3.34);
      this.scene.add(p);
      const frame = this.box(2.12, 1.245, 0.04, this.mat('#c99a5b', { metalness: 0.4, roughness: 0.4 }), 6.75, 1.75, 3.31);
      void frame;
    });
    // 観葉植物
    this.plant(-7.3, 8.0);
    this.plant(7.4, 4.2);
    // 床のマット
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), this.mat('#6b1f2a', { roughness: 1 }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(3.2, 0.03, 6.8);
    this.scene.add(mat);

    this.hotspot(g, 'reception');
  }

  plant(x, z) {
    const pot = this.mat('#c86f4a');
    this.cyl(0.26, 0.2, 0.5, pot, x, 0.25, z, this.scene, 16);
    const leaf = this.mat('#2f8a52', { roughness: 0.7 });
    for (let i = 0; i < 7; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), leaf);
      const a = i / 7 * Math.PI * 2;
      l.scale.set(0.45, 1.4, 0.25);
      l.position.set(x + Math.cos(a) * 0.18, 0.85 + (i % 2) * 0.12, z + Math.sin(a) * 0.18);
      l.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      this.scene.add(l);
    }
  }

  // ---------- バーカン ----------
  bar(loader) {
    const g = new THREE.Group();
    this.scene.add(g);
    // カウンター（壁と平行、客席側が +x）
    const body = this.mat('#2a1712', { roughness: 0.6, emissive: '#ffb36b', emissiveIntensity: 0 });
    this.addHover('bar', body, 0, 0.18);
    this.box(0.62, 1.08, 5.4, body, -5.6, 0.54, -0.9, g);
    const top = this.mat('#b07a45', { roughness: 0.3, metalness: 0.1 });
    this.box(0.86, 0.08, 5.6, top, -5.62, 1.12, -0.9, g);
    // カウンター下のライン照明
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 5.3), new THREE.MeshBasicMaterial({ color: '#ffb36b' }));
    strip.position.set(-5.27, 0.98, -0.9); g.add(strip);
    // スツール
    const seat = this.mat('#c0392b', { roughness: 0.5 });
    const leg = this.mat('#9aa3ad', { metalness: 0.8, roughness: 0.3 });
    [-2.9, -1.7, -0.5, 0.7].forEach(z => {
      this.cyl(0.04, 0.04, 0.8, leg, -4.75, 0.4, z, g, 8);
      this.cyl(0.2, 0.2, 0.03, leg, -4.75, 0.02, z, g, 16);
      this.cyl(0.22, 0.2, 0.1, seat, -4.75, 0.84, z, g, 18);
    });
    // 奥の棚とボトル
    const shelfM = this.mat('#3b2418', { roughness: 0.6 });
    this.box(0.4, 2.6, 4.6, this.mat('#141019'), -7.72, 1.3, -1.0, g);
    const bottleColors = ['#3fa34d', '#c0582b', '#e6c36a', '#7ec8ff', '#b23a6b', '#f2efe6', '#5a3a1a'];
    [1.35, 1.95, 2.55].forEach((y, row) => {
      this.box(0.46, 0.05, 4.6, shelfM, -7.6, y - 0.03, -1.0, g);
      for (let i = 0; i < 11; i++) {
        const c = bottleColors[(i * 3 + row * 2) % bottleColors.length];
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.1, emissive: c, emissiveIntensity: 0.25, transparent: true, opacity: 0.92 });
        const h = 0.3 + ((i + row) % 3) * 0.05;
        const z = -3.1 + i * 0.42;
        this.cyl(0.06, 0.07, h, m, -7.6, y + h / 2, z, g, 10);
        this.cyl(0.025, 0.04, 0.12, m, -7.6, y + h + 0.06, z, g, 8);
      }
    });
    // バックバーの間接照明
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.4), new THREE.MeshBasicMaterial({ map: glowTex('#ff9d4d'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    glow.rotation.y = Math.PI / 2; glow.position.set(-7.5, 1.95, -1.0);
    this.scene.add(glow);
    // ネオン「BAR」
    const neon = neonPlane('BAR', '#ffb36b', 1.5, 0.6);
    neon.rotation.y = Math.PI / 2; neon.position.set(-7.86, 3.25, 0.65);
    this.scene.add(neon);
    // 黒板メニュー：作品一覧
    const board = textPlane(['MENU', '作品一覧', '', '・えびダイブ食堂', '　→ 水槽をのぞく', '', '・次の作品', '　準備中…'], {
      w: 512, h: 600, bg: '#1f2b24', color: '#f5f1e8', font: `700 38px ${FONT_BODY}`, line: 62, align: 'left', border: '#8a6a43',
      first: `56px ${FONT_DISPLAY}`, firstColor: '#ffd36b',
    }, 1.45, 1.7);
    board.rotation.y = Math.PI / 2; board.position.set(-7.86, 2.1, -4.15);
    this.scene.add(board);
    // カウンターの上：グラスとビール
    const glass = new THREE.MeshStandardMaterial({ color: '#dff6ff', roughness: 0.05, transparent: true, opacity: 0.35 });
    const beer = new THREE.MeshStandardMaterial({ color: '#f2b233', roughness: 0.3, emissive: '#c77a00', emissiveIntensity: 0.3 });
    [[-2.4, beer], [-1.1, glass], [0.2, beer]].forEach(([z, m]) => {
      this.cyl(0.07, 0.06, 0.2, m, -5.5, 1.26, z, g, 14);
      if (m === beer) this.cyl(0.072, 0.072, 0.04, this.mat('#fffaf0'), -5.5, 1.38, z, g, 14);
    });
    // バーテンダーのえび（蝶ネクタイ）
    const bart = makeShrimp({ body: '#ff7a57', belly: '#ffc2a8', bowtie: true });
    bart.position.set(-6.85, 0.3, -1.4);
    bart.rotation.y = Math.PI / 2;
    bart.scale.setScalar(0.95);
    this.scene.add(bart);
    this.anim.push(t => {
      bart.position.y = 0.3 + Math.abs(Math.sin(t * 2.4)) * 0.04;
      bart.rotation.y = Math.PI / 2 + Math.sin(t * 0.6) * 0.25;
      bart.userData.wave(t * 1.3);
    });
    this.hotspot(g, 'bar');
    this.hotspot(bart, 'bar');
    void loader;
  }

  // ---------- 水槽（カウンター横） ----------
  aquarium() {
    const g = new THREE.Group();
    const cx = -6.2, cz = 2.45, y0 = 0.9, w = 0.85, d = 1.4, h = 1.2; // w: x方向(奥行き), d: z方向(幅)
    g.position.set(cx, 0, cz);
    this.scene.add(g);
    // 台
    this.box(w + 0.15, y0, d + 0.15, this.mat('#1b1d26', { roughness: 0.5 }), 0, y0 / 2, 0, g);
    // 水
    const water = new THREE.MeshStandardMaterial({ color: '#2fb4e0', emissive: '#1a8fc0', emissiveIntensity: 0.55, transparent: true, opacity: 0.42, roughness: 0.1, depthWrite: false });
    this.addHover('dive', water, 0.55, 1.1);
    const wmesh = this.box(w - 0.04, h - 0.12, d - 0.04, water, 0, y0 + (h - 0.12) / 2, 0, g);
    wmesh.renderOrder = 2;
    // ガラスの枠
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.8 }));
    edges.position.set(0, y0 + h / 2, 0); g.add(edges);
    this.box(w + 0.04, 0.06, d + 0.04, this.mat('#111318'), 0, y0 + h + 0.03, 0, g);
    // 砂利と水草
    this.box(w - 0.06, 0.08, d - 0.06, this.mat('#d8c59a', { roughness: 1 }), 0, y0 + 0.04, 0, g);
    const weed = this.mat('#3fbf6a', { roughness: 0.6, emissive: '#1d6b35', emissiveIntensity: 0.3 });
    const weeds = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.5 + (i % 3) * 0.18, 6), weed);
      s.position.set(-0.25 + (i % 2) * 0.15, y0 + 0.3 + (i % 3) * 0.09, -0.55 + i * 0.17 + (i > 3 ? 0.1 : 0));
      g.add(s); weeds.push(s);
    }
    // 中のえび
    const shrimp = makeShrimp({ body: '#ff7a57', belly: '#ffc2a8' });
    shrimp.scale.setScalar(0.22);
    g.add(shrimp);
    // 泡
    const bubbleM = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.7 });
    const bubbles = [];
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.018 + (i % 3) * 0.008, 8, 6), bubbleM);
      b.userData = { x: -0.2 + (i % 3) * 0.12, z: -0.5 + (i % 5) * 0.25, s: 0.25 + (i % 4) * 0.08, o: i / 10 };
      g.add(b); bubbles.push(b);
    }
    // 水槽のまわりの光
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ map: glowTex('#3fd4ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
    halo.rotation.y = Math.PI / 2; halo.position.set(-0.5, y0 + h / 2, 0);
    g.add(halo);
    // 札「えびダイブ食堂 →」
    const tag = textPlane(['えびダイブ食堂', 'のぞいてみてね'], { w: 512, h: 200, bg: '#f5f1e8', color: '#7a2f24', font: `700 52px ${FONT_BODY}`, line: 74, border: '#ff7a57' }, 0.7, 0.27);
    tag.rotation.y = Math.PI / 2; tag.position.set(w / 2 + 0.01, y0 - 0.25, 0);
    g.add(tag);

    this.anim.push((t) => {
      const a = t * 0.9;
      shrimp.position.set(Math.sin(a * 0.7) * 0.12, y0 + 0.55 + Math.sin(a * 1.6) * 0.15, Math.cos(a) * 0.42);
      shrimp.rotation.set(0, Math.atan2(-Math.sin(a), 0) > 0 ? 0 : Math.PI, Math.PI / 2 - 0.2);
      shrimp.userData.wave(t * 3);
      for (const b of bubbles) {
        const u = (t * b.userData.s + b.userData.o) % 1;
        b.position.set(b.userData.x + Math.sin(t * 3 + b.userData.o * 9) * 0.02, y0 + 0.1 + u * (h - 0.25), b.userData.z);
      }
      weeds.forEach((s, i) => { s.rotation.x = Math.sin(t * 1.4 + i) * 0.12; });
      halo.material.opacity = 0.5 + Math.sin(t * 2) * 0.1;
    });
    this.hotspot(g, 'dive');
  }

  // ---------- ステージ ----------
  stage() {
    const g = new THREE.Group();
    this.scene.add(g);
    const sH = 0.7;
    const front = this.mat('#111116', { roughness: 0.6, emissive: '#5f8bff', emissiveIntensity: 0 });
    this.addHover('stage', front, 0, 0.22);
    this.box(11, sH, 3.4, front, 0, sH / 2, -7.2, g);
    this.box(11.1, 0.05, 3.5, this.mat('#3a2a20', { roughness: 0.5 }), 0, sH + 0.02, -7.2, g);
    // 柵
    const rail = this.mat('#8d96a3', { metalness: 0.7, roughness: 0.35 });
    this.box(8, 0.06, 0.06, rail, 0, 1.05, -4.9, g);
    this.box(8, 0.06, 0.06, rail, 0, 0.55, -4.9, g);
    for (let x = -4; x <= 4; x += 1) this.cyl(0.03, 0.03, 1.05, rail, x, 0.525, -4.9, g, 8);

    // LEDスクリーン：COMING SOON
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 1024; screenCanvas.height = 420;
    const sg = screenCanvas.getContext('2d');
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const drawScreen = (t) => {
      const W = 1024, H = 420;
      const grd = sg.createLinearGradient(0, 0, W, H);
      const hue = (t * 20) % 360;
      grd.addColorStop(0, `hsl(${hue}, 70%, 18%)`);
      grd.addColorStop(1, `hsl(${(hue + 120) % 360}, 70%, 14%)`);
      sg.fillStyle = grd; sg.fillRect(0, 0, W, H);
      sg.textAlign = 'center'; sg.textBaseline = 'middle';
      sg.shadowColor = '#ffd36b'; sg.shadowBlur = 24;
      sg.fillStyle = '#fff3c4';
      sg.font = `130px ${FONT_DISPLAY}`;
      sg.fillText('COMING SOON', W / 2, H * 0.42);
      sg.shadowBlur = 0;
      sg.font = `700 44px ${FONT_BODY}`;
      sg.fillStyle = '#c6ef6e';
      sg.fillText('今後なにかが始まります。おたのしみに', W / 2, H * 0.74);
      // LEDのドット
      sg.fillStyle = 'rgba(0,0,0,0.28)';
      for (let y = 0; y < H; y += 6) sg.fillRect(0, y, W, 2);
      for (let x = 0; x < W; x += 6) sg.fillRect(x, 0, 2, H);
      screenTex.needsUpdate = true;
    };
    drawScreen(0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.62), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
    screen.position.set(0, 2.45, -8.85);
    g.add(screen);
    this.box(6.6, 2.82, 0.08, this.mat('#08080b'), 0, 2.45, -8.92, g);
    let last = 0;
    this.anim.push(t => { if (t - last > 0.12) { last = t; drawScreen(t); } });

    // スピーカー
    const spk = this.mat('#15151a', { roughness: 0.7 });
    const cone = this.mat('#2a2a30', { roughness: 0.4, metalness: 0.3 });
    [-6.3, 6.3].forEach(x => {
      this.box(1.1, 2.4, 0.9, spk, x, 1.2, -6.4, g);
      [0.6, 1.3, 1.95].forEach((y, i) => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(i === 2 ? 0.16 : 0.32, i === 2 ? 0.16 : 0.32, 0.04, 24), cone);
        c.rotation.x = Math.PI / 2; c.position.set(x, y, -5.94); g.add(c);
      });
    });
    // アンプ
    [[-3.2, '#1a1a1f'], [3.2, '#1a1a1f']].forEach(([x, c]) => {
      this.box(1.1, 0.9, 0.55, this.mat(c), x, sH + 0.45, -8.3, g);
      this.box(1.02, 0.5, 0.02, this.mat('#2d2a24', { roughness: 1 }), x, sH + 0.38, -8.01, g);
      this.box(1.02, 0.1, 0.02, this.mat('#b8b2a2', { metalness: 0.6 }), x, sH + 0.78, -8.01, g);
    });
    // ドラムセット
    const shell = this.mat('#c0392b', { roughness: 0.35, metalness: 0.2 });
    const head = this.mat('#f2efe6', { roughness: 0.6 });
    const brass = this.mat('#d4a73a', { metalness: 0.9, roughness: 0.3 });
    const kick = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 28), shell);
    kick.rotation.x = Math.PI / 2; kick.position.set(0, sH + 0.42, -7.7); g.add(kick);
    const kickHead = new THREE.Mesh(new THREE.CircleGeometry(0.4, 28), head);
    kickHead.position.set(0, sH + 0.42, -7.49); g.add(kickHead);
    const kickLogo = textPlane(['EBI'], { w: 256, h: 256, bg: 'rgba(0,0,0,0)', color: '#c0392b', font: `100px ${FONT_DISPLAY}` }, 0.42, 0.42);
    kickLogo.position.set(0, sH + 0.42, -7.48); g.add(kickLogo);
    [[-0.35, 1.0, -7.6], [0.35, 1.0, -7.6], [0.8, 0.55, -7.3]].forEach(([x, y, z], i) => {
      this.cyl(i === 2 ? 0.26 : 0.18, i === 2 ? 0.26 : 0.18, i === 2 ? 0.35 : 0.2, shell, x, sH + y - 0.2 + (i === 2 ? -0.05 : 0.2), z, g, 20);
    });
    [[-0.95, 1.55, -7.4], [1.0, 1.65, -7.9], [-0.7, 1.15, -7.2]].forEach(([x, y, z]) => {
      this.cyl(0.012, 0.012, y, this.mat('#9aa3ad', { metalness: 0.8 }), x, sH + y / 2, z, g, 6);
      const cym = this.cyl(0.32, 0.32, 0.01, brass, x, sH + y, z, g, 24);
      cym.rotation.z = 0.12;
    });
    this.cyl(0.18, 0.18, 0.08, this.mat('#222'), 0, sH + 0.55, -8.35, g, 16);
    // マイクスタンド
    const metal = this.mat('#9aa3ad', { metalness: 0.85, roughness: 0.3 });
    this.cyl(0.015, 0.015, 1.5, metal, 0, sH + 0.75, -6.1, g, 8);
    this.cyl(0.2, 0.2, 0.02, metal, 0, sH + 0.01, -6.1, g, 16);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), this.mat('#3a3a40', { metalness: 0.6, roughness: 0.4 }));
    mic.position.set(0, sH + 1.55, -6.05); g.add(mic);
    // モニタースピーカー
    [-1.6, 1.6].forEach(x => {
      const m = this.box(0.7, 0.32, 0.45, spk, x, sH + 0.16, -5.85, g);
      m.rotation.x = -0.35;
    });
    // ギタースタンドとギター（ひとつ）
    const guitar = new THREE.Group();
    const gb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), this.mat('#2b6cb0', { roughness: 0.3, metalness: 0.2 }));
    gb.scale.set(1, 1.3, 0.3); guitar.add(gb);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.03), this.mat('#6b4423'));
    neck.position.y = 0.55; guitar.add(neck);
    guitar.position.set(-2.3, sH + 0.35, -7.5); guitar.rotation.z = 0.15;
    g.add(guitar);

    // トラスと照明
    const truss = this.mat('#b8bec6', { metalness: 0.8, roughness: 0.3 });
    this.box(11, 0.12, 0.12, truss, 0, 3.75, -6.0, g);
    this.box(11, 0.12, 0.12, truss, 0, 3.75, -8.5, g);
    [-5.4, 5.4].forEach(x => {
      this.box(0.12, 3.75, 0.12, truss, x, 3.75 / 2, -6.0, g);
      this.box(0.12, 0.12, 2.5, truss, x, 3.75, -7.25, g);
    });
    const beamColors = ['#ff5fa8', '#5f8bff', '#ffd36b', '#7ef0ff', '#c6ef6e', '#ff5fa8'];
    const beams = [];
    beamColors.forEach((c, i) => {
      const x = -4.2 + i * 1.68;
      const head = this.box(0.26, 0.3, 0.26, this.mat('#1a1a1f'), x, 3.5, -6.0, g);
      void head;
      const coneGeo = new THREE.ConeGeometry(0.55, 3.2, 24, 1, true);
      coneGeo.translate(0, -1.6, 0);
      const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(x, 3.4, -6.0);
      g.add(beam); beams.push(beam);
    });
    this.anim.push(t => {
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 0.8 + i * 1.1) * 0.45;
        b.rotation.x = 0.25 + Math.cos(t * 0.6 + i) * 0.2;
        b.material.opacity = 0.1 + (Math.sin(t * 2 + i) * 0.5 + 0.5) * 0.08;
      });
    });

    // ミラーボール
    this.cyl(0.01, 0.01, 0.5, this.mat('#888'), -3.0, 3.85, -2.6, this.scene, 4);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 2), new THREE.MeshStandardMaterial({ color: '#e8eef5', metalness: 0.6, roughness: 0.15, flatShading: true, emissive: '#5a6b80', emissiveIntensity: 0.4 }));
    ball.position.set(-3.0, 3.45, -2.6);
    this.scene.add(ball);
    // 床に映る光の粒
    const dots = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05 + Math.random() * 0.04, 10), new THREE.MeshBasicMaterial({ color: beamColors[i % beamColors.length], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 3.6;
      dot.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r * 0.7);
      dot.rotation.x = -Math.PI / 2;
      dots.add(dot);
    }
    dots.position.set(0, 0, -2.2);
    this.scene.add(dots);
    this.anim.push((t, dt) => { ball.rotation.y += dt * 0.6; dots.rotation.y += dt * 0.25; });

    this.hotspot(g, 'stage');
  }

  // ---------- フロアのえびたち ----------
  floorCrowd() {
    const spots = [[-2.6, -3.4], [-1.1, -3.9], [0.6, -3.5], [2.2, -3.8], [3.4, -2.6], [-3.4, -1.8], [1.4, -1.4]];
    const colors = ['#ff7a57', '#ff9a6b', '#e85d4a', '#ffb07a', '#ff7a57', '#f08a5d', '#ff6f61'];
    spots.forEach(([x, z], i) => {
      const s = makeShrimp({ body: colors[i], belly: '#ffd2bd' });
      s.scale.setScalar(0.55 + (i % 3) * 0.05);
      s.position.set(x, 0, z);
      s.rotation.y = Math.PI + Math.atan2(x, -7 - z) * -0.6;
      this.scene.add(s);
      this.hotspot(s, 'stage');
      this.anim.push(t => {
        s.position.y = Math.abs(Math.sin(t * 2.6 + i * 0.9)) * 0.08;
        s.userData.wave(t * 1.5 + i);
      });
    });
    // フロア中央の「COMING SOON」立て看板
    const sign = textPlane(['COMING', 'SOON'], { w: 512, h: 400, bg: '#ffd36b', color: '#1a1410', font: `110px ${FONT_DISPLAY}`, line: 130, border: '#1a1410' }, 1.2, 0.94);
    const easel = new THREE.Group();
    sign.position.y = 1.2; easel.add(sign);
    const legM = this.mat('#6b4423');
    [-0.45, 0.45].forEach(x => { const l = this.box(0.05, 1.5, 0.05, legM, x, 0.75, -0.08, easel); l.rotation.x = 0.08; });
    easel.position.set(3.6, 0, -0.6); easel.rotation.y = -0.35;
    this.scene.add(easel);
    this.hotspot(easel, 'stage');
  }

  // ---------- 模型のまわりの深海（泡・プランクトン） ----------
  seaParticles() {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 13 + Math.random() * 20;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = -6 + Math.random() * 24; pos[i * 3 + 2] = Math.sin(a) * r - 1;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, map: glowTex('#c6ef6e'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
    this.scene.add(pts);
    this.anim.push((t, dt) => {
      const p = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] += dt * (0.25 + seed[i] * 0.4);
        if (p[i * 3 + 1] > 18) p[i * 3 + 1] = -6;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }
}

// ---------- えび（立ち姿のマスコット） ----------
function makeShrimp({ body = '#ff7a57', belly = '#ffc2a8', pearls = false, bowtie = false } = {}) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: body, roughness: 0.45, metalness: 0.05 });
  const soft = new THREE.MeshStandardMaterial({ color: belly, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.3 });

  // 頭（上）から尾（下、うしろへ丸まる）へ
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), shell);
  head.scale.set(1, 1.15, 1); head.position.set(0, 1.25, 0); g.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), soft);
  face.scale.set(0.9, 0.85, 0.5); face.position.set(0, 1.18, 0.2); g.add(face);
  // 目
  [-0.13, 0.13].forEach(x => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), shell);
    stalk.position.set(x, 1.55, 0.1); stalk.rotation.z = x > 0 ? -0.35 : 0.35; g.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), black);
    eye.position.set(x * 1.4, 1.64, 0.13); g.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), white);
    shine.position.set(x * 1.4 + 0.02, 1.67, 0.2); g.add(shine);
  });
  // 触角
  const antennae = [];
  [-1, 1].forEach(sd => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sd * 0.08, 1.45, 0.25), new THREE.Vector3(sd * 0.35, 1.9, 0.3),
      new THREE.Vector3(sd * 0.7, 2.1, 0.0), new THREE.Vector3(sd * 0.95, 1.85, -0.3),
    ]);
    const a = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.014, 5), shell);
    g.add(a); antennae.push(a);
  });
  // 胴の節（下へいくほど細く、うしろへ）
  const segs = [];
  const pts = [[0, 0.92, -0.02, 0.3], [0, 0.68, -0.08, 0.27], [0, 0.47, -0.17, 0.24], [0, 0.3, -0.3, 0.2], [0, 0.2, -0.46, 0.17]];
  pts.forEach(([x, y, z, r], i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), shell);
    s.scale.set(1, 0.72, 0.95); s.position.set(x, y, z); s.rotation.x = -i * 0.25; g.add(s); segs.push(s);
    const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 14, 10), soft);
    b.scale.set(0.9, 0.6, 0.6); b.position.set(x, y, z + r * 0.45); g.add(b);
  });
  // 尾びれ
  const tail = new THREE.Group();
  [-0.5, 0, 0.5].forEach(a => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), shell);
    f.scale.set(0.55, 0.18, 1.3); f.position.set(Math.sin(a) * 0.12, 0, -0.14); f.rotation.y = a; tail.add(f);
  });
  tail.position.set(0, 0.18, -0.62); tail.rotation.x = 0.4; g.add(tail);
  // 小さな脚
  for (let i = 0; i < 3; i++) [-1, 1].forEach(sd => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.22, 6), soft);
    l.position.set(sd * 0.14, 0.75 - i * 0.2, 0.18 - i * 0.04); l.rotation.x = 0.5; l.rotation.z = sd * 0.25; g.add(l);
  });
  // 腕（手を振る）
  const arms = [];
  [-1, 1].forEach(sd => {
    const arm = new THREE.Group();
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.4, 8), shell);
    a.position.y = -0.2; arm.add(a);
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), shell);
    claw.scale.set(1, 1.3, 0.7); claw.position.y = -0.42; arm.add(claw);
    arm.position.set(sd * 0.3, 1.0, 0.08);
    arm.rotation.z = sd * 0.5;
    g.add(arm); arms.push(arm);
  });
  if (pearls) {
    const pm = new THREE.MeshStandardMaterial({ color: '#fbf6ee', roughness: 0.15, metalness: 0.3, emissive: '#6d665d', emissiveIntensity: 0.2 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.95 + (i / 13) * Math.PI * 0.9 + Math.PI * 0.5;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), pm);
      p.position.set(Math.cos(a) * 0.3, 1.0 + Math.abs(Math.cos(a)) * 0.05 - 0.04, Math.sin(a) * 0.26 + 0.05);
      g.add(p);
    }
  }
  if (bowtie) {
    const bm = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.4 });
    [-1, 1].forEach(sd => {
      const w = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.15, 4), bm);
      w.rotation.z = sd * Math.PI / 2; w.position.set(sd * 0.075, 1.0, 0.3); g.add(w);
    });
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bm); k.position.set(0, 1.0, 0.31); g.add(k);
  }
  g.userData.wave = t => {
    arms[1].rotation.z = 0.5 + Math.max(0, Math.sin(t * 1.4)) * 1.6 * (0.6 + 0.4 * Math.sin(t * 9));
    arms[0].rotation.z = -0.5 - Math.sin(t * 1.1) * 0.12;
    tail.rotation.x = 0.4 + Math.sin(t * 2.2) * 0.12;
    antennae.forEach((a, i) => { a.rotation.z = Math.sin(t * 1.8 + i) * 0.06; });
  };
  return g;
}

// ---------- テクスチャ道具 ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function textPlane(lines, o, pw, ph) {
  const tex = canvasTex(o.w, o.h, (g, w, h) => {
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14); }
    g.textBaseline = 'middle';
    const line = o.line || h;
    const total = line * lines.length;
    lines.forEach((s, i) => {
      g.font = i === 0 && o.first ? o.first : o.font;
      g.fillStyle = i === 0 && o.firstColor ? o.firstColor : o.color;
      const y = (h - total) / 2 + line * (i + 0.5);
      if (o.align === 'left') { g.textAlign = 'left'; g.fillText(s, i === 0 && o.first ? w / 2 - g.measureText(s).width / 2 : 40, y); }
      else { g.textAlign = 'center'; g.fillText(s, w / 2, y, w - 30); }
    });
  });
  const transparent = !o.bg || o.bg.startsWith('rgba');
  return new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: tex, transparent, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 }));
}

function neonPlane(text, color, pw, ph, size) {
  const tex = canvasTex(1024, Math.round(1024 * ph / pw), (g, w, h) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = size ? size * (1024 / 512) : h * 0.62;
    g.font = `${fs}px ${FONT_DISPLAY}`;
    g.shadowColor = color;
    for (const blur of [60, 30, 12]) { g.shadowBlur = blur; g.fillStyle = color; g.fillText(text, w / 2, h / 2, w - 40); }
    g.shadowBlur = 4; g.fillStyle = '#ffffff'; g.globalAlpha = 0.85;
    g.fillText(text, w / 2, h / 2, w - 40);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  return m;
}

const glowCache = {};
function glowTex(color) {
  if (glowCache[color]) return glowCache[color];
  const t = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  return (glowCache[color] = t);
}
