// えびは LIVE HOUSE — トップページの3D模型
// 受付（プロフィール）／バーカン（作品一覧・水槽からえびダイブへ）／ステージとフロア（COMING SOON）
import * as THREE from '../vendor/three.module.min.js';

const FONT_DISPLAY = '"Dela Gothic One", "Hiragino Sans", "Yu Gothic", sans-serif';
const FONT_BODY = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// 照明の演出（色の変化・ライトの首振り・ミラーボールの光・ネオンのまたたき）。false で全部止まる
const FX = { light: true };

// 軽量化：光の計算が安い Lambert に統一し、同じ見た目のマテリアルは1つを使い回す
const matCache = new Map();
function M(o = {}) {
  const { roughness, metalness, unique, ...opts } = o;
  void roughness; void metalness;
  const key = unique ? null : JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (key && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial(opts);
  if (key) matCache.set(key, m);
  return m;
}

// 動かない部品を、マテリアルごとに1つのメッシュへまとめる（描画命令を減らす）
function bake(node) {
  for (const c of [...node.children]) if (!c.isMesh && c.children.length) bake(c);
  const groups = new Map();
  for (const c of node.children) {
    if (!c.isMesh || c.userData.keep || c.children.length || c.material.transparent) continue;
    if (!groups.has(c.material)) groups.set(c.material, []);
    groups.get(c.material).push(c);
  }
  for (const [material, list] of groups) {
    if (list.length < 2) continue;
    const parts = list.map(m => {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrix);
      return g;
    });
    const merged = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv']) {
      if (!parts.every(g => g.attributes[n])) continue;
      const size = parts[0].attributes[n].itemSize;
      const arr = new Float32Array(parts.reduce((a, g) => a + g.attributes[n].array.length, 0));
      let off = 0;
      for (const g of parts) { arr.set(g.attributes[n].array, off); off += g.attributes[n].array.length; }
      merged.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    node.add(new THREE.Mesh(merged, material));
    for (const m of list) { node.remove(m); m.geometry.dispose(); }
    parts.forEach(g => g.dispose());
  }
}

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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: (devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('webgl');
  }
  // 解像度は控えめに。重いと分かったら frame() の中でさらに下げる
  let dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
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

  const camera = new THREE.PerspectiveCamera(50, 1, 0.2, 120);

  const world = new World(scene);
  const loader = new THREE.TextureLoader();
  world.build(loader);
  const firstSong = document.querySelector('.song[data-yt]');
  if (firstSong) world.setSong({
    id: firstSong.dataset.yt,
    title: firstSong.querySelector('.song-title').textContent.trim(),
    artist: firstSong.querySelector('.song-artist').textContent.trim(),
    url: firstSong.querySelector('.song-thumb').href,
  });

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
  // 入場：受付でドリンク代を払うまで、バーカンとステージには入れない（このタブの間は覚えておく）
  const ENTRY_KEY = 'ebiha-entry';
  let entered = false;
  try { entered = sessionStorage.getItem(ENTRY_KEY) === '1'; } catch (e) { /* 保存できなくても動く */ }
  let pending = null; // 払う前に行こうとした場所。払ったらそこへ
  const LOCKED = new Set(['bar', 'stage', 'dive']);

  const ui = {
    root: document.body,
    panels: [...document.querySelectorAll('.panel[data-area]')],
    navBtns: [...document.querySelectorAll('[data-go]')],
    markers: document.getElementById('markers'),
    loading: document.getElementById('loading'),
    dive: document.getElementById('dive'),
    hint: document.getElementById('hint'),
    pay: document.getElementById('pay'),
    speech: document.getElementById('speech'),
    toast: document.getElementById('toast'),
  };
  ui.root.dataset.entry = entered ? 'open' : 'locked';
  if (entered) world.openGate(true);

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

  // 利用者の操作による移動はすべてここを通す
  function nav(name, opts) {
    if (!entered && LOCKED.has(name)) { pending = name; denyEntry(); return; }
    if (name === 'dive') dive(); else go(name, opts);
  }
  let toastTimer = 0;
  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('on'), 2400);
  }
  function denyEntry() {
    if (area !== 'reception') go('reception');
    say('先にドリンク代をお願いします〜！');
    toast('受付でドリンク代を払うと、中に入れます');
    ui.pay.classList.remove('pulse'); void ui.pay.offsetWidth; ui.pay.classList.add('pulse');
  }
  function say(text) { ui.speech.querySelector('span').textContent = text; }
  function pay() {
    if (entered) return;
    entered = true;
    try { sessionStorage.setItem(ENTRY_KEY, '1'); } catch (e) { /* 保存できなくても入れる */ }
    ui.pay.disabled = true;
    say('まいど！ドリンクチケットどうぞ');
    // コインは画面の少し手前・下から投げる
    const from = new THREE.Vector3(0, -0.35, -1.0).applyQuaternion(camera.quaternion).add(camera.position);
    world.pay(from, reduceMotion, () => {
      ui.root.dataset.entry = 'open';
      say('いってらっしゃい〜！');
      toast('ドリンクチケットを受け取りました。中へどうぞ！');
      if (pending) { const to = pending; pending = null; setTimeout(() => nav(to), reduceMotion ? 0 : 500); }
    });
  }
  ui.pay.addEventListener('click', pay);
  say(entered ? 'いってらっしゃい〜！' : 'いらっしゃいませ！ドリンク代 700円です');

  ui.navBtns.forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    nav(b.dataset.go);
  }));
  document.querySelectorAll('.panel .fold').forEach(b => b.addEventListener('click', () => {
    const p = b.closest('.panel');
    p.classList.toggle('collapsed');
    b.setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
    requestAnimationFrame(updateOffsetTarget);
  }));
  addEventListener('popstate', () => {
    const to = AREA_OF_HASH[location.hash] || 'reception';
    if (!entered && LOCKED.has(to)) { pending = to; go('reception'); return; }
    go(to, { push: false });
  });
  addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(() => updateOffsetTarget()).observe(document.querySelector('.panels'));

  // ---------- 目印（HTMLラベル） ----------
  const markerDefs = [
    { id: 'reception', label: '受付', sub: 'プロフィール', at: [3.4, 3.5, 4.6] },
    { id: 'bar', label: 'バーカン', sub: '作品一覧', at: [-6.6, 3.55, -1.0] },
    { id: 'dive', label: '水槽をのぞく', sub: 'えびダイブ食堂へ', at: [-6.15, 2.55, 2.45], fish: true },
    { id: 'stage', label: 'ステージ', sub: 'おすすめの曲', at: [0, 4.6, -7.0] },
  ];
  const markers = markerDefs.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marker' + (d.fish ? ' fish' : '');
    b.innerHTML = `<span class="m-label">${d.label}</span><span class="m-sub">${d.sub}</span>`;
    b.setAttribute('aria-label', `${d.label}（${d.sub}）へ移動`);
    b.addEventListener('click', () => nav(d.id));
    ui.markers.appendChild(b);
    return { ...d, el: b, v: new THREE.Vector3(...d.at) };
  });
  const speechAt = new THREE.Vector3();
  function placeSpeech() {
    const on = area === 'reception' && !diving && !tween;
    ui.speech.classList.toggle('off', !on);
    if (!on) return;
    world.speechAnchor(speechAt).project(camera);
    ui.speech.style.transform = `translate(${((speechAt.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-speechAt.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
  }
  function placeMarkers() {
    placeSpeech();
    for (const m of markers) {
      const show = !diving && (m.id === 'dive' ? (area === 'bar' || area === 'overview') : m.id !== area);
      m.v.set(...m.at);
      m.v.project(camera);
      const visible = show && m.v.z < 1 && Math.abs(m.v.x) < 1.05 && Math.abs(m.v.y) < 1.05;
      m.el.classList.toggle('off', !visible);
      m.el.classList.toggle('locked', !entered && LOCKED.has(m.id));
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
    const songHit = hits.some(h => h.object.userData.go === 'song');
    if (songHit && area === 'stage' && world.songUrl) return 'song';
    for (const h of hits) {
      if (h.object.userData.go === 'song') continue;
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
      if (g === 'song') window.open(world.songUrl, '_blank', 'noopener');
      else if (g === 'reception' && area === 'reception' && !entered) pay();
      else if (g && g !== area) nav(g);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; world.setHover(null); } });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const keys = { '1': 'reception', '2': 'bar', '3': 'stage', '0': 'overview' };
    if (keys[e.key]) nav(keys[e.key]);
  });

  // ---------- ループ ----------
  let lastT = performance.now(), time = 0;
  const dbg = { freeze: false, noOffset: false, noRender: false, fixedDpr: false, fps: 0 };
  const perf = { n: 0, sum: -1500, prev: performance.now() }; // 最初の1.5秒（読み込み直後）は数えない
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
    if (!dbg.noOffset && (Math.abs(offset.x) > 0.5 || Math.abs(offset.y) > 0.5)) camera.setViewOffset(W, H, offset.x, offset.y, W, H);
    else camera.clearViewOffset();

    // 2秒ごとに平均フレーム時間を見て、重ければ解像度を一段下げる
    perf.n++; perf.sum += Math.min(now - perf.prev, 100); perf.prev = now;
    if (perf.sum > 2000) {
      const avg = perf.sum / perf.n;
      dbg.fps = 1000 / avg;
      if (avg > 26 && dpr > 0.75 && !document.hidden && !dbg.fixedDpr) { dpr = Math.max(0.75, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
      perf.n = 0; perf.sum = 0;
    }
    if (!dbg.freeze) world.update(time, dt);
    if (!dbg.noRender) renderer.render(scene, camera);
    placeMarkers();
    requestAnimationFrame(frame);
  }

  resize();
  // 最初は模型全体を見せてから、受付（またはURLの場所）へ
  let first = AREA_OF_HASH[location.hash] || 'reception';
  if (!entered && LOCKED.has(first)) { pending = first; first = 'reception'; }
  area = 'overview';
  const ov = viewFor('overview'); cam.pos.copy(ov.pos); cam.target.copy(ov.target);
  requestAnimationFrame(frame);
  ui.root.classList.add('ready');
  ui.loading.classList.add('gone');
  if (reduceMotion) go(first, { instant: true, push: false });
  else setTimeout(() => go(first, { push: false }), 650);
  setTimeout(() => ui.hint.classList.add('done'), 9000);
  if (new URLSearchParams(location.search).has('debug')) debugPanel({ renderer, scene, world, dbg, setDpr: v => { dpr = v; renderer.setPixelRatio(v); resize(); }, getDpr: () => dpr });
}

// ---------- 切り分け用パネル（?debug のときだけ） ----------
function debugPanel({ renderer, scene, world, dbg, setDpr, getDpr }) {
  const d = world.dbg, L = d.lights;
  const vis = list => on => list.forEach(o => { if (o) o.visible = on; });
  // 全マテリアルを「光の計算なし」に差し替える
  const basicCache = new Map();
  const setBasic = on => scene.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material) && !on && !o.userData.orig) return;
    if (on) {
      if (o.userData.orig) return;
      o.userData.orig = o.material;
      const conv = m => {
        if (m.isMeshBasicMaterial) return m;
        if (!basicCache.has(m)) basicCache.set(m, new THREE.MeshBasicMaterial({ color: m.color, map: m.map, transparent: m.transparent, opacity: m.opacity, side: m.side }));
        return basicCache.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    } else if (o.userData.orig) { o.material = o.userData.orig; delete o.userData.orig; }
  });
  const items = [
    ['light', '照明の演出（色・首振り・ミラーボール・ネオン）', true, on => { FX.light = on; }],
    ['anim', 'えび・泡などの動き', true, on => { dbg.freeze = !on; }],
    ['render', '3Dの描画（オフ＝最後の1枚で静止）', true, on => { dbg.noRender = !on; }],
    ['dots', '床の光の粒', true, vis([d.dots])],
    ['beams', 'スポットライトの光の筋', true, vis(d.beams || [])],
    ['ball', 'ミラーボール', true, vis([d.ball])],
    ['crowd', 'フロアのえびたち', true, vis(d.crowd)],
    ['particles', '模型のまわりの粒', true, vis([d.particles])],
    ['floor', '床（ホール・ロビー）', true, vis(d.floors)],
    ['stageLight', 'ステージの点光源', true, vis([L.stage])],
    ['pointLights', '受付・バーの点光源', true, vis([L.recep, L.bar])],
    ['ambient', '環境光・太陽光', true, vis([L.hemi, L.key])],
    ['lit', '光の計算（オフ＝全部単色）', true, on => setBasic(!on)],
    ['tone', 'トーンマッピング', true, on => { renderer.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }],
    ['ui', 'パネル・目印・ぼかし', true, on => document.body.classList.toggle('dbg-noui', !on)],
    ['offset', 'パネル分の画面ずらし', true, on => { dbg.noOffset = !on; }],
    ['autoDpr', '解像度の自動調整（オフ＝1.0固定）', true, on => { dbg.fixedDpr = !on; if (!on) setDpr(1); }],
  ];
  const params = new URLSearchParams(location.search);
  const off = new Set((params.get('off') || '').split(',').filter(Boolean));
  const onSet = new Set((params.get('on') || '').split(',').filter(Boolean));
  const box = document.createElement('div');
  box.id = 'dbg';
  box.innerHTML = '<b>切り分け</b><div class="dbg-stat"></div>';
  const state = {};
  for (const [key, label, def, fn] of items) {
    const on = onSet.has(key) ? true : off.has(key) ? false : def;
    state[key] = on;
    const row = document.createElement('label');
    row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}> ${label}`;
    const cb = row.querySelector('input');
    cb.addEventListener('change', () => { state[key] = cb.checked; fn(cb.checked); save(); });
    box.appendChild(row);
    if (on !== def) fn(on);
  }
  const reset = document.createElement('button');
  reset.textContent = 'すべて初期状態に';
  reset.onclick = () => { location.search = '?debug'; };
  box.appendChild(reset);
  document.body.appendChild(box);
  function save() {
    const q = new URLSearchParams('debug');
    const offs = items.filter(([k, , def]) => def && !state[k]).map(([k]) => k);
    const ons = items.filter(([k, , def]) => !def && state[k]).map(([k]) => k);
    let str = '?debug';
    if (offs.length) str += '&off=' + offs.join(',');
    if (ons.length) str += '&on=' + ons.join(',');
    void q;
    history.replaceState(history.state, '', str + location.hash);
  }
  const stat = box.querySelector('.dbg-stat');
  setInterval(() => {
    stat.textContent = `fps ${dbg.fps.toFixed(0)} ・ 解像度 ${getDpr()} ・ 描画命令 ${renderer.info.render.calls}`;
  }, 500);
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
    this.dbg = { crowd: [], floors: [] }; // デバッグ用の参照
    this.tankFront = new THREE.Vector3(-5.78, 1.5, 2.45);
  }

  mat(color, opts = {}) { return M({ color, ...opts }); }
  box(w, h, d, m, x, y, z, parent = this.scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  cyl(rt, rb, h, m, x, y, z, parent = this.scene, seg = 12) {
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
    bake(this.scene);
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
  // クリック判定は見えない箱で（まとめた後のメッシュに左右されず、判定も軽い）
  hotspot(name, [w, h, d, x, y, z]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    m.visible = false; m.position.set(x, y, z);
    m.userData.go = name; m.userData.keep = true;
    this.scene.add(m); this.hotspots.push(m);
  }

  // ---------- 光 ----------
  lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#8fb8d0', '#1a1020', 0.55));
    const key = new THREE.DirectionalLight('#b8d4ff', 0.55);
    key.position.set(8, 16, 12);
    s.add(key);
    const recep = new THREE.PointLight('#ffd9a8', 14, 9, 1.6); recep.position.set(3.2, 3.2, 6.6); s.add(recep);
    const bar = new THREE.PointLight('#ffb36b', 16, 9, 1.6); bar.position.set(-5.6, 3.1, -0.6); s.add(bar);
    // ステージは1灯で色を回す
    const stage = new THREE.PointLight('#ff5fa8', 26, 13, 1.4); stage.position.set(0, 3.6, -5.6); s.add(stage);
    const pink = new THREE.Color('#ff5fa8'), blue = new THREE.Color('#5f8bff');
    this.anim.push(t => FX.light && (() => { stage.color.lerpColors(pink, blue, Math.sin(t * 0.9) * 0.5 + 0.5); })());
    stage.color.lerpColors(pink, blue, 0.5);
    const hemi = s.children.find(o => o.isHemisphereLight);
    this.dbg.lights = { hemi, key, recep, bar, stage };
  }

  // ---------- 台座・床・壁 ----------
  shell() {
    const s = this.scene;
    // 模型の台座（木）
    const wood = this.mat('#5a3b28', { roughness: 0.7 });
    this.box(18.6, 0.7, 19.6, wood, 0, -0.65, -0.6);
    const trim = this.mat('#c99a5b', { roughness: 0.5, metalness: 0.2 });
    // 床のすぐ下に別の面があると、スマホなど奥行きの精度が低い端末で床がちらつく。
    // 台座は床の30cm下まで下げ、床は厚みのある板にする
    this.box(18.8, 0.08, 19.8, trim, 0, -0.36, -0.6);
    // 台座の名札
    const plate = textPlane(['えびは LIVE HOUSE'], { w: 1024, h: 160, bg: '#c99a5b', color: '#3a2414', font: `64px ${FONT_DISPLAY}`, pad: 0 }, 3.6, 0.56);
    plate.position.set(4.2, -0.65, 9.21);
    s.add(plate);

    // ホールの床（コンクリート）と、ロビーの市松
    const hall = this.box(16, 0.32, 12.2, this.mat('#2b2b33'), 0, -0.14, -2.9);
    hall.userData.keep = true; this.dbg.floors.push(hall);
    const checker = canvasTex(512, 512, (g, w, h) => {
      const n = 8;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#e9e0cf' : '#2a2422'; g.fillRect(i * w / n, j * h / n, w / n, h / n); }
    });
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping; checker.repeat.set(4, 1.5);
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(16, 0.32, 5.55), this.mat('#ffffff', { map: checker }));
    lobby.position.set(0, -0.14, 5.975);
    lobby.userData.keep = true; this.dbg.floors.push(lobby);
    s.add(lobby);

    // 壁：奥と左だけ高く、手前と右は低い縁（ドールハウスの切り口）
    const wallM = this.mat('#1d2130', { roughness: 0.9 });
    this.box(16.2, 3.8, 0.25, wallM, 0, 1.9, -9.0);
    this.box(0.25, 3.8, 17.8, wallM, -8.0, 1.9, -0.25);
    const rim = this.mat('#262a3a');
    this.box(0.25, 0.67, 17.8, rim, 8.0, 0.015, -0.25);
    this.box(16.2, 0.67, 0.25, rim, 0, 0.015, 8.6);
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
    const front = this.mat('#7a2f24', { emissive: '#ff7a57', emissiveIntensity: 0, unique: true });
    this.box(3.6, 1.05, 0.7, front, 0, 0.525, 0, g);
    const top = this.mat('#d8c39c', { roughness: 0.35 });
    this.box(3.8, 0.08, 0.86, top, 0, 1.09, 0, g);
    // カウンター正面の「受付」
    // 卓上：ベル、チケット立て、フライヤー
    const bell = this.mat('#e6c36a', { metalness: 0.9, roughness: 0.25 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), bell);
    b.position.set(-1.25, 1.13, 0.1); g.add(b);
    this.cyl(0.015, 0.015, 0.05, bell, -1.25, 1.25, 0.1, g, 8);
    for (let i = 0; i < 5; i++) {
      const f = this.box(0.26, 0.012, 0.36, this.mat(['#ff7a57', '#c6ef6e', '#7ef0ff', '#ffd36b', '#f5f1e8'][i]), 0.9 + i * 0.05, 1.14 + i * 0.012, 0.05, g);
      f.rotation.y = (i - 2) * 0.14;
    }
    const stand = this.box(0.5, 0.36, 0.04, this.mat('#1d1a20'), 0.1, 1.31, -0.15, g);
    stand.rotation.x = -0.25;
    // お金を置くトレイ
    this.cyl(0.15, 0.12, 0.025, this.mat('#2a2a30'), 0.62, 1.145, 0.2, g, 18);
    const ticket = textPlane(['1 DRINK', '¥700'], { w: 256, h: 180, bg: '#f5f1e8', color: '#7a2f24', font: `52px ${FONT_DISPLAY}`, line: 64 }, 0.44, 0.31);
    ticket.position.set(0.1, 1.32, -0.12); ticket.rotation.x = -0.25;
    g.add(ticket);

    // 受付のえび（えびは：緑のえび＋真珠のネックレス）
    const ebiha = makeShrimp({ body: '#5fbf6a', belly: '#bde8a6', pearls: true });
    ebiha.position.set(-0.8, 0.35, -0.9);
    ebiha.scale.setScalar(1.05);
    g.add(ebiha);
    this.ebiha = ebiha;
    this.anim.push(t => {
      // 払ってもらったら、ぴょんと跳ねる
      let hop = 0;
      if (this.hopAt != null) { const k = (t - this.hopAt) / 0.7; if (k >= 0 && k <= 1) hop = Math.sin(Math.PI * k) * 0.4; }
      ebiha.position.y = 0.35 + Math.sin(t * 2) * 0.03 + hop;
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
    neon.material.opacity = 0.9;
    this.anim.push(t => FX.light && (() => { neon.material.opacity = 0.88 + Math.sin(t * 9) * 0.04 + (Math.sin(t * 0.9) > 0.97 ? -0.4 : 0); })());

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
    this.gate();
    this.coin();
    this.plant(7.4, 4.2);
    // 床のマット
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), this.mat('#6b1f2a', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(3.2, 0.05, 6.8);
    this.scene.add(mat);

    this.hotspot('reception', [4.2, 3.0, 2.4, 3.2, 1.5, 5.0]);
  }

  // ロビーとホールの境目のベルトパーティション。払うとベルトが巻き取られる
  gate() {
    const metal = this.mat('#b8bec6');
    const beltM = this.mat('#c0392b', { emissive: '#c0392b', emissiveIntensity: 0.25 });
    const xs = [-7.7, -5.0, -2.3, 0.4, 1.25], z = 3.75, h = 0.92;
    this.belts = [];
    xs.forEach((x, i) => {
      this.cyl(0.035, 0.035, h, metal, x, h / 2, z, this.scene, 10);
      this.cyl(0.17, 0.19, 0.04, metal, x, 0.02, z, this.scene, 16);
      this.cyl(0.06, 0.06, 0.1, metal, x, h, z, this.scene, 12);
      if (i === xs.length - 1) return;
      const len = xs[i + 1] - x;
      const belt = new THREE.Group();
      const geo = new THREE.BoxGeometry(len, 0.06, 0.012); geo.translate(len / 2, 0, 0);
      const m = new THREE.Mesh(geo, beltM); m.userData.keep = true;
      belt.add(m);
      belt.position.set(x, h - 0.03, z);
      belt.userData.keep = true;
      this.scene.add(belt);
      this.belts.push(belt);
    });
    this.gateAt = null;
    this.anim.push(t => {
      if (this.gateAt == null) return;
      if (this.gateAt === -1) this.gateAt = t;
      const k = Math.min(1, Math.max(0, (t - this.gateAt) / 0.6));
      const e = 1 - Math.pow(1 - k, 3);
      for (const b of this.belts) { b.scale.x = Math.max(0.001, 1 - e); b.visible = k < 1; }
    });
  }
  openGate(instant) {
    if (instant) { for (const b of this.belts) b.visible = false; this.gateAt = null; return; }
    this.gateAt = -1;
  }

  coin() {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20), this.mat('#f2c14e', { emissive: '#b8860b', emissiveIntensity: 0.35 }));
    c.visible = false; c.userData.keep = true;
    this.scene.add(c);
    this.coinMesh = c;
    this.coinFly = null;
    const to = new THREE.Vector3(3.2 + 0.62, 1.175, 5.4 + 0.2);
    this.anim.push(t => {
      const f = this.coinFly;
      if (!f) return;
      if (f.t0 == null) f.t0 = t;
      const k = Math.min(1, (t - f.t0) / 0.8);
      c.position.lerpVectors(f.from, to, k);
      c.position.y += Math.sin(Math.PI * k) * 0.6;
      c.rotation.set(Math.PI / 2 * (1 - k) + k * 0, k * 12, 0);
      if (k >= 1) {
        c.rotation.set(0, 0, 0);
        this.coinFly = null;
        this.hopAt = t + 0.05;
        setTimeout(() => this.openGate(false), 450);
        setTimeout(f.done, 1100);
      }
    });
  }
  // 払うアクション：コインがトレイへ → えびはが跳ねる → ベルトが外れる
  pay(from, instant, done) {
    const c = this.coinMesh;
    c.visible = true;
    if (instant) { c.position.set(3.82, 1.175, 5.6); this.openGate(true); done(); return; }
    this.coinFly = { from: from.clone(), done };
  }
  speechAnchor(v) { return this.ebiha.getWorldPosition(v).add(new THREE.Vector3(0.15, 2.05, 0)); }

  plant(x, z) {
    const pot = this.mat('#c86f4a');
    this.cyl(0.26, 0.2, 0.5, pot, x, 0.25, z, this.scene, 16);
    const leaf = this.mat('#2f8a52', { roughness: 0.7 });
    for (let i = 0; i < 7; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), leaf);
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
    const body = this.mat('#2a1712', { emissive: '#ffb36b', emissiveIntensity: 0, unique: true });
    this.box(0.62, 1.08, 5.0, body, -5.6, 0.54, -1.1, g);
    const top = this.mat('#b07a45', { roughness: 0.3, metalness: 0.1 });
    this.box(0.86, 0.08, 5.2, top, -5.62, 1.12, -1.1, g);
    // カウンター下のライン照明
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 4.9), new THREE.MeshBasicMaterial({ color: '#ffb36b' }));
    strip.position.set(-5.27, 0.98, -1.1); g.add(strip);
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
        const m = M({ color: c, emissive: c, emissiveIntensity: 0.25 });
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
    const glass = M({ color: '#dff6ff', roughness: 0.05, transparent: true, opacity: 0.35 });
    const beer = M({ color: '#f2b233', roughness: 0.3, emissive: '#c77a00', emissiveIntensity: 0.3 });
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
    this.hotspot('bar', [2.8, 3.4, 5.8, -6.4, 1.7, -0.9]);
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
    const water = M({ unique: true, color: '#2fb4e0', emissive: '#1a8fc0', emissiveIntensity: 0.55, transparent: true, opacity: 0.42, roughness: 0.1, depthWrite: false });
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
      s.userData.keep = true; g.add(s); weeds.push(s);
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
      b.userData.keep = true; g.add(b); bubbles.push(b);
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
      if (FX.light) halo.material.opacity = 0.5 + Math.sin(t * 2) * 0.1;
    });
    this.hotspot('dive', [1.1, 2.3, 1.6, -6.2, 1.15, 2.45]);
  }

  // ---------- ステージ ----------
  stage() {
    const g = new THREE.Group();
    this.scene.add(g);
    const sH = 0.7;
    const front = this.mat('#111116', { emissive: '#5f8bff', emissiveIntensity: 0, unique: true });
    const deck = this.mat('#3a2a20');
    const stageBox = new THREE.Mesh(new THREE.BoxGeometry(11, sH, 3.4), [front, front, deck, front, front, front]);
    stageBox.position.set(0, sH / 2, -7.2); g.add(stageBox);
    // 柵
    const rail = this.mat('#8d96a3', { metalness: 0.7, roughness: 0.35 });
    this.box(8, 0.06, 0.06, rail, 0, 1.05, -4.9, g);
    this.box(8, 0.06, 0.06, rail, 0, 0.55, -4.9, g);
    for (let x = -4; x <= 4; x += 1) this.cyl(0.03, 0.03, 1.05, rail, x, 0.525, -4.9, g, 8);

    // LEDスクリーン：おすすめの曲（サムネと曲名）。曲は index.html の .song から setSong で渡す
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 1024; screenCanvas.height = 420;
    const sg = screenCanvas.getContext('2d');
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const wrap = (text, maxW, maxLines) => {
      const out = []; let line = '';
      for (const ch of text) {
        if (sg.measureText(line + ch).width > maxW && line) { out.push(line); line = ''; if (out.length === maxLines) break; }
        line += ch;
      }
      if (out.length < maxLines && line) out.push(line);
      else if (line) out[maxLines - 1] = out[maxLines - 1].slice(0, -1) + '…';
      return out;
    };
    const drawScreen = (song, img) => {
      const W = 1024, H = 420;
      const grd = sg.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, '#2a0f3a'); grd.addColorStop(1, '#0d2440');
      sg.fillStyle = grd; sg.fillRect(0, 0, W, H);
      sg.textBaseline = 'middle'; sg.textAlign = 'left';
      // サムネ（hqdefault は上下に黒帯があるので 16:9 に切り抜く）
      const tx = 40, ty = 60, tw = 533, th = 300;
      sg.fillStyle = '#000'; sg.fillRect(tx, ty, tw, th);
      if (img) sg.drawImage(img, 0, img.height * 0.125, img.width, img.height * 0.75, tx, ty, tw, th);
      // 再生マーク
      sg.fillStyle = 'rgba(255,0,0,0.92)';
      sg.beginPath(); sg.roundRect(tx + tw / 2 - 52, ty + th / 2 - 36, 104, 72, 18); sg.fill();
      sg.fillStyle = '#fff';
      sg.beginPath(); sg.moveTo(tx + tw / 2 - 14, ty + th / 2 - 20); sg.lineTo(tx + tw / 2 + 22, ty + th / 2); sg.lineTo(tx + tw / 2 - 14, ty + th / 2 + 20); sg.fill();
      // 文字
      const x = 610, maxW = W - x - 30;
      sg.shadowColor = '#ff8fb8'; sg.shadowBlur = 18;
      sg.fillStyle = '#ffb3d0'; sg.font = `40px ${FONT_DISPLAY}`;
      sg.fillText('おすすめの曲', x, 88);
      sg.shadowBlur = 0;
      if (song) {
        sg.fillStyle = '#fff3c4'; sg.font = `700 46px ${FONT_BODY}`;
        wrap(song.title, maxW, 3).forEach((l, k) => sg.fillText(l, x, 170 + k * 58));
        sg.fillStyle = '#c6ef6e'; sg.font = `700 34px ${FONT_BODY}`;
        sg.fillText(wrap(song.artist, maxW, 1)[0] || '', x, 360);
      }
      // LEDのドット
      sg.fillStyle = 'rgba(0,0,0,0.28)';
      for (let y = 0; y < H; y += 6) sg.fillRect(0, y, W, 2);
      for (let x2 = 0; x2 < W; x2 += 6) sg.fillRect(x2, 0, 2, H);
      screenTex.needsUpdate = true;
    };
    this.setSong = async song => {
      this.songUrl = song.url;
      // 曲名の字をフォントで描けるよう、先に読み込む
      try { await Promise.all([document.fonts.load(`40px ${FONT_DISPLAY}`, 'おすすめの曲'), document.fonts.load(`700 46px ${FONT_BODY}`, song.title + song.artist)]); } catch (e) { /* 読めなくても描く */ }
      drawScreen(song, null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => drawScreen(song, img);
      img.src = `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg`;
    };
    drawScreen(null, null);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.62), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
    screen.position.set(0, 2.45, -8.85);
    g.add(screen);
    // ステージにいるときにスクリーンを押すと YouTube へ
    this.hotspot('song', [6.4, 2.62, 0.3, 0, 2.45, -8.7]);
    this.box(6.6, 2.82, 0.08, this.mat('#08080b'), 0, 2.45, -8.92, g);
    // 文字は描き直さず（毎回の転送が重い）、色味だけゆっくり変える
    const tintA = new THREE.Color('#ffffff'), tintB = new THREE.Color('#b9c8ff');
    this.anim.push(t => FX.light && (() => { screen.material.color.lerpColors(tintA, tintB, Math.sin(t * 0.8) * 0.5 + 0.5); })());

    // スピーカー
    const spk = this.mat('#15151a', { roughness: 0.7 });
    const cone = this.mat('#2a2a30', { roughness: 0.4, metalness: 0.3 });
    [-6.3, 6.3].forEach(x => {
      this.box(1.1, 2.4, 0.9, spk, x, 1.2, -6.4, g);
      [0.6, 1.3, 1.95].forEach((y, i) => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(i === 2 ? 0.16 : 0.32, i === 2 ? 0.16 : 0.32, 0.04, 16), cone);
        c.rotation.x = Math.PI / 2; c.position.set(x, y, -5.94); g.add(c);
      });
    });
    // モニタースピーカー
    [-1.6, 1.6].forEach(x => {
      const m = this.box(0.7, 0.32, 0.45, spk, x, sH + 0.16, -5.85, g);
      m.rotation.x = -0.35;
    });

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
      beam.position.set(x, 3.4, -6.0); beam.userData.keep = true;
      g.add(beam); beams.push(beam);
      this.dbg.beams = beams;
    });
    const moveBeams = t => {
      beams.forEach((b, i) => {
        b.rotation.z = Math.sin(t * 0.8 + i * 1.1) * 0.45;
        b.rotation.x = 0.25 + Math.cos(t * 0.6 + i) * 0.2;
        b.material.opacity = 0.1 + (Math.sin(t * 2 + i) * 0.5 + 0.5) * 0.08;
      });
    };
    moveBeams(0);
    this.anim.push(t => FX.light && moveBeams(t));

    // ミラーボール
    this.cyl(0.01, 0.01, 0.5, this.mat('#888'), -3.0, 3.85, -2.6, this.scene, 4);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 2), M({ color: '#e8eef5', metalness: 0.6, roughness: 0.15, flatShading: true, emissive: '#5a6b80', emissiveIntensity: 0.4 }));
    ball.position.set(-3.0, 3.45, -2.6); ball.userData.keep = true;
    this.scene.add(ball);
    // 床に映る光の粒
    const dotPos = [], dotCol = [], col = new THREE.Color();
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 3.6;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r * 0.7, rad = 0.05 + Math.random() * 0.04;
      col.set(beamColors[i % beamColors.length]).multiplyScalar(0.55);
      for (let k = 0; k < 8; k++) {
        const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2;
        dotPos.push(cx, 0.07, cz, cx + Math.cos(a1) * rad, 0.07, cz + Math.sin(a1) * rad, cx + Math.cos(a0) * rad, 0.07, cz + Math.sin(a0) * rad);
        for (let v = 0; v < 3; v++) dotCol.push(col.r, col.g, col.b);
      }
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3));
    dotGeo.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3));
    const dots = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    dots.position.set(0, 0, -2.2); dots.userData.keep = true;
    this.scene.add(dots);
    this.anim.push((t, dt) => { if (FX.light) { ball.rotation.y += dt * 0.6; dots.rotation.y += dt * 0.25; } });
    Object.assign(this.dbg, { dots, ball });

    this.hotspot('stage', [12, 4, 4, 0, 2, -7.1]);
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
      this.scene.add(s); this.dbg.crowd.push(s);
      this.anim.push(t => {
        s.position.y = Math.abs(Math.sin(t * 2.6 + i * 0.9)) * 0.08;
        s.userData.wave(t * 1.5 + i);
      });
    });
    // フロアをクリックしてもステージへ
    this.hotspot('stage', [8.5, 1.8, 5.0, 0, 0.9, -2.4]);
  }

  // ---------- 模型のまわりの深海（泡・プランクトン） ----------
  seaParticles() {
    const n = 160;
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
    this.scene.add(pts); this.dbg.particles = pts;
    void seed;
    this.anim.push((t, dt) => { pts.rotation.y += dt * 0.02; pts.position.y = Math.sin(t * 0.2) * 1.5; });
  }
}

// ---------- えび（立ち姿のマスコット） ----------
function makeShrimp({ body = '#ff7a57', belly = '#ffc2a8', pearls = false, bowtie = false } = {}) {
  const g = new THREE.Group();
  const shell = M({ color: body, roughness: 0.45, metalness: 0.05 });
  const soft = M({ color: belly, roughness: 0.6 });
  const black = M({ color: '#111', roughness: 0.3 });
  const white = M({ color: '#fff', roughness: 0.3 });

  // 頭（上）から尾（下、うしろへ丸まる）へ
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 11), shell);
  head.scale.set(1, 1.15, 1); head.position.set(0, 1.25, 0); g.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), soft);
  face.scale.set(0.9, 0.85, 0.5); face.position.set(0, 1.18, 0.2); g.add(face);
  // 目
  [-0.13, 0.13].forEach(x => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), shell);
    stalk.position.set(x, 1.55, 0.1); stalk.rotation.z = x > 0 ? -0.35 : 0.35; g.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), black);
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
    const a = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.014, 4), shell);
    a.userData.keep = true; g.add(a); antennae.push(a);
  });
  // 胴の節（下へいくほど細く、うしろへ）
  const segs = [];
  const pts = [[0, 0.92, -0.02, 0.3], [0, 0.68, -0.08, 0.27], [0, 0.47, -0.17, 0.24], [0, 0.3, -0.3, 0.2], [0, 0.2, -0.46, 0.17]];
  pts.forEach(([x, y, z, r], i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 11, 7), shell);
    s.scale.set(1, 0.72, 0.95); s.position.set(x, y, z); s.rotation.x = -i * 0.25; g.add(s); segs.push(s);
    const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 8, 6), soft);
    b.scale.set(0.9, 0.6, 0.6); b.position.set(x, y, z + r * 0.45); g.add(b);
  });
  // 尾びれ
  const tail = new THREE.Group();
  [-0.5, 0, 0.5].forEach(a => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), shell);
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
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), shell);
    claw.scale.set(1, 1.3, 0.7); claw.position.y = -0.42; arm.add(claw);
    arm.position.set(sd * 0.3, 1.0, 0.08);
    arm.rotation.z = sd * 0.5;
    g.add(arm); arms.push(arm);
  });
  if (pearls) {
    const pm = M({ color: '#fbf6ee', roughness: 0.15, metalness: 0.3, emissive: '#6d665d', emissiveIntensity: 0.2 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.95 + (i / 13) * Math.PI * 0.9 + Math.PI * 0.5;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), pm);
      p.position.set(Math.cos(a) * 0.3, 1.0 + Math.abs(Math.cos(a)) * 0.05 - 0.04, Math.sin(a) * 0.26 + 0.05);
      g.add(p);
    }
  }
  if (bowtie) {
    const bm = M({ color: '#111', roughness: 0.4 });
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
  return new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), M({ map: tex, transparent, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 }));
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
