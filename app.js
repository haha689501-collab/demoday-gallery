/*
 * 데모데이 전시관 — 야외 전시 광장에 조별 부스가 늘어선 3D 공간
 * ------------------------------------------------------------------
 *  노을 바닷가(바닷가/app.js)의 캐릭터 · 모습 고르기 · 대화 · 함께 모드 · 입력 · 이동 · 시작 화면을 그대로 가져오고,
 *  장면(입구 아치 · 가운데 통로 · 양쪽 부스 · 발표 무대)과 소리를 새로 만들었습니다.
 *  하늘 · 바닥 · 부스 · 액자 그림 · 소리 모두 코드로 만듭니다 (외부 파일 0개).
 *  설정(부스 수 · 이름 · Supabase 공개 키)은 같은 폴더의 config.js 에서 바꾸세요.
 *
 *  ※ 지금은 '빈 전시관'(배치만) 단계입니다. 부스 등록 · 포스터 · 작품 열기 · 좋아요는 아직 없습니다.
 *    붙일 자리: BOOTHS 배열 · paintFrame(booth, draw, data) · drawPlaceholder · actionsFor(p) 의 'booth' 칸
 */
(async () => {
  'use strict';

  const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
  const C = window.SPACE_CONFIG;
  const T = Object.assign({ fog: '#dfe6ea' }, C.theme || {});

  // ------------------------------------------------------------------
  // 유틸
  // ------------------------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, children = []) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const c of children) e.append(c);
    return e;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = seeded(20261112);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  // 값 잡음(value noise) — 텍스처와 지형을 같은 함수로 만듭니다.
  function hash2(x, y) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  const wrap = (v, p) => (p ? ((v % p) + p) % p : v);
  function noise2(x, y, px = 0, py = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hash2(wrap(a, px), wrap(b, py));
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  }
  function fbm(x, y, oct = 4, px = 0, py = 0) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, px * f, py * f); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }

  function cleanText(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, C.maxTextLength);
    if (!t) return null;
    const low = t.toLowerCase();
    if ((C.bannedWords || []).some((w) => w && low.includes(String(w).toLowerCase()))) return null;
    return t;
  }

  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function askText(title, placeholder) {
    return new Promise((resolve) => {
      const m = $('#modal'), inp = $('#modal-input'), cnt = $('#modal-count');
      $('#modal-title').textContent = title;
      inp.value = '';
      inp.placeholder = placeholder;
      inp.maxLength = C.maxTextLength;
      const upd = () => { cnt.textContent = `${inp.value.length} / ${C.maxTextLength}`; };
      upd();
      m.classList.add('show');
      setTimeout(() => inp.focus(), 30);
      const done = (v) => {
        m.classList.remove('show');
        $('#modal-ok').onclick = $('#modal-cancel').onclick = null;
        inp.oninput = inp.onkeydown = null;
        inp.blur();
        resolve(v);
      };
      inp.oninput = upd;
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.isComposing) done(inp.value);
        if (e.key === 'Escape') done(null);
      };
      $('#modal-ok').onclick = () => done(inp.value);
      $('#modal-cancel').onclick = () => done(null);
    });
  }

  // ------------------------------------------------------------------
  // 내 정보 — 이름 · 모습은 쉼터와 같은 저장 칸을 써서, 쉼터에서 고른 모습 그대로 들어옵니다.
  // ------------------------------------------------------------------
  const ADJ = ['조용한', '느긋한', '포근한', '반짝이는', '산책하는', '꿈꾸는', '따뜻한', '졸린', '상냥한', '씩씩한'];
  const NOUN = ['고양이', '다람쥐', '부엉이', '여우', '고래', '수달', '참새', '토끼', '펭귄', '판다'];
  const COLORS = ['#f4a7b9', '#9ad0ec', '#b8e0a8', '#ffd59a', '#c9b6f2', '#f7c59f', '#a8e6cf', '#ffb3a7'];
  const randomName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
  const HAIRS = [
    { id: 0, name: '단발' }, { id: 1, name: '짧은 머리' },
    { id: 2, name: '묶은 머리' }, { id: 3, name: '모자' },
  ];
  const HAIR_COLORS = ['#241d1a', '#4a3326', '#6b4a2f', '#8a6b4a', '#7a6f8e', '#b06a5a'];
  const me = {
    id: sessionStorage.getItem('shelter:id') || uid(),
    name: localStorage.getItem('shelter:name') || randomName(),
    color: localStorage.getItem('shelter:color') || COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  me.look = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('shelter:look') || 'null');
      if (v && v.color) return v;
    } catch (e) { /* 깨졌으면 새로 */ }
    return {
      color: me.color,
      hair: Math.floor(Math.random() * HAIRS.length),
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    };
  })();
  me.color = me.look.color;
  sessionStorage.setItem('shelter:id', me.id);
  // 명단 — teams.js 의 window.GALLERY_TEAMS (없거나 비면 명단 기능만 빠지고 나머지는 그대로)
  //   학생 이름은 캔버스 글씨 · textContent 로만 씁니다 (innerHTML 금지)
  const TEAMS = (Array.isArray(window.GALLERY_TEAMS) ? window.GALLERY_TEAMS : [])
    .map((t) => ({
      no: Number(t && t.no),
      team: String((t && t.team) || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      // 작품 — 주소는 https:// 또는 works/ 안 파일만, 캡처 이미지는 works/ 안 그림 파일만 받습니다
      members: (Array.isArray(t && t.members) ? t.members : []).map((m) => String(m || '').replace(/\s+/g, ' ').trim().slice(0, 12)).filter(Boolean).slice(0, 5),
      title: String((t && t.title) || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      url: /^(https:\/\/[^\s"'<>]+|works\/(local\/)?[\w.-]+\.html)$/.test(String((t && t.url) || '').trim()) ? String(t.url).trim() : '',
      thumb: /^works\/(local\/)?[\w.-]+\.(jpe?g|png|webp)$/i.test(String((t && t.thumb) || '').trim()) ? String(t.thumb).trim() : '',
    }))
    .filter((t) => Number.isInteger(t.no) && t.no >= 1 && t.no <= 99)
    .map((t) => ({ ...t, team: t.team || `${t.no}조` }));
  const teamOf = (no) => TEAMS.find((t) => t.no === no) || null;
  me.team = 0;      // 명단에서 고른 팀 번호 (0 = 관람객 · 안 고름)
  me.mi = -1;       // 팀 안에서 몇 번째 이름인지 (시상 때 무대 자리)
  localStorage.setItem('shelter:name', me.name);
  localStorage.setItem('shelter:color', me.color);

  const params = new URLSearchParams(location.search);
  const pathCode = (decodeURIComponent(location.pathname).match(/\/room\/([A-Za-z0-9가-힣-]+)/) || [])[1];
  const roomCode = (v) => String(v || '').replace(/[^a-zA-Z0-9가-힣-]/g, '').toUpperCase().slice(0, 12);
  const room = roomCode(params.get('room') || pathCode || 'main') || 'MAIN';
  // 쉼터와 같은 Supabase 를 함께 씁니다. 같은 방 코드라도 섞이지 않게 'GAL-' 를 붙여 저장합니다.
  //   (지금은 저장하는 것이 없습니다 — 내일 부스 등록 · 좋아요를 붙일 때 이 이름을 씁니다)
  // 반 안 판(teams.local.js)은 배포판과 다른 방을 씀 — 같은 Supabase 라도 서로 안 보이고, 이름이 배포판 쪽으로 새지 않음
  const PRIVATE = window.GALLERY_PRIVATE === true;
  const CH = PRIVATE ? 'gallery-class' : 'gallery';
  const DBROOM = ((PRIVATE ? 'GALC-' : 'GAL-') + room).slice(0, 30);

  // ------------------------------------------------------------------
  // 저장소: 혼자 모드(localStorage) / 함께 모드(Supabase)
  //   지금(빈 전시관)은 아무것도 저장하지 않습니다 — 대화 · 움직임은 실시간 broadcast 로만 주고받음.
  //   list/add/getCounter/incCounter 는 바닷가와 같은 모양으로 남겨 둠 (쉼터 테이블 shelter_* · 방 이름 GAL-…)
  // ------------------------------------------------------------------
  class LocalStore {
    constructor() { this.mode = 'local'; }
    key(k) { return `${CH}:${room}:${k}`; }
    async list(kind) { return JSON.parse(localStorage.getItem(this.key(kind)) || '[]'); }
    async add(kind, text) {
      const arr = await this.list(kind);
      const item = { id: uid(), text, created_at: new Date().toISOString() };
      arr.push(item);
      localStorage.setItem(this.key(kind), JSON.stringify(arr.slice(-200)));
      return item;
    }
    async getCounter(name) { return Number(localStorage.getItem(this.key('c:' + name)) || 0); }
    async incCounter(name) {
      const v = (await this.getCounter(name)) + 1;
      localStorage.setItem(this.key('c:' + name), String(v));
      return v;
    }
    connect() {}
    send() {}
  }

  class SupaStore {
    constructor(sb) { this.sb = sb; this.mode = 'supabase'; this.channel = null; }
    async list(kind) {
      const { data, error } = await this.sb.from('shelter_messages')
        .select('id,text,created_at').eq('room', DBROOM).eq('kind', kind)
        .order('created_at', { ascending: false }).limit(120);
      if (error) throw error;
      return (data || []).reverse();
    }
    async add(kind, text) {
      const { data, error } = await this.sb.from('shelter_messages')
        .insert({ room: DBROOM, kind, text }).select('id,text,created_at').single();
      if (error) throw error;
      return data;
    }
    async getCounter(name) {
      const { data, error } = await this.sb.from('shelter_counters')
        .select('value').eq('room', DBROOM).eq('name', name).maybeSingle();
      if (error) throw error;
      return Number(data?.value || 0);
    }
    async incCounter(name) {
      const { data, error } = await this.sb.rpc('shelter_increment', { p_room: DBROOM, p_name: name });
      if (error) throw error;
      return Number(data);
    }
    connect(h) {
      const ch = this.sb.channel(`${CH}:${room}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => h.onPresence(Object.keys(ch.presenceState())))
        .on('broadcast', { event: 'move' }, ({ payload }) => h.onMove(payload))
        .on('broadcast', { event: 'act' }, ({ payload }) => h.onAct(payload))
        .on('broadcast', { event: 'chat' }, ({ payload }) => h.onChat(payload))
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            // 20명이 동시에 들어와도 접속 신호가 한꺼번에 몰리지 않게 — 0~12초 사이 아무 때나
            const wait = Math.random() * 12000;
            setTimeout(() => { if (this.channel === ch) ch.track({ name: me.name, team: me.team, mi: me.mi }); }, wait);
          }
        });
      this.channel = ch;
    }
    send(event, payload) {
      if (this.channel) this.channel.send({ type: 'broadcast', event, payload });
    }
    // 다른 공간의 인원만 지켜봅니다 (오가기를 열 때 사용) — 내 자리는 등록하지 않으므로 그쪽 인원에 세어지지 않습니다
    watchCount(name, cb) {
      const ch = this.sb.channel(name, { config: { presence: { key: 'watch-' + me.id } } });
      ch.on('presence', { event: 'sync' }, () => cb(Object.keys(ch.presenceState()).length)).subscribe();
    }
  }

  let store = new LocalStore();
  if (C.supabase && C.supabase.url && C.supabase.anonKey) {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      store = new SupaStore(createClient(C.supabase.url, C.supabase.anonKey));
    } catch (e) {
      console.warn('Supabase 연결 실패, 혼자 모드로 전환합니다.', e);
    }
  }
  // ------------------------------------------------------------------
  // 렌더러 · 장면
  // ------------------------------------------------------------------
  const LOW = (navigator.hardwareConcurrency || 8) <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent);
  const TOUCH = window.matchMedia('(pointer: coarse)').matches;   // 손가락으로 쓰는 화면 — 키보드 안내 대신 터치 안내
  const PHONE = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1.3 : 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  $('#app').appendChild(renderer.domElement);
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // 빛 번짐(블룸) — 아주 약하게. 낮 장면이라 세게 걸면 흰 벽이 뿌옇게 번집니다
  let composer = null;
  async function setupComposer() {
    if (PHONE) return;
    try {
      const base = 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/';
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'),
        import(base + 'UnrealBloomPass.js'), import(base + 'OutputPass.js'),
      ]);
      const c = new EffectComposer(renderer);
      c.addPass(new RenderPass(scene, camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.12, 0.4, 0.98));
      c.addPass(new OutputPass());
      c.setSize(window.innerWidth, window.innerHeight);
      composer = c;
    } catch (e) { console.warn('블룸 생략', e); }
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(T.fog, 0.0075);         // 맑은 오후 — 안개는 아주 옅게 (먼 나무만 하늘색에 녹도록)
  scene.background = new THREE.Color(T.fog);
  const fovFor = (aspect) => (aspect < 0.8 ? 62 : 48);
  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.1, 1200);

  const tmpV = new THREE.Vector3();
  const matCache = new Map();
  function mat(color, opts = {}) {
    const k = color + JSON.stringify(opts);
    if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.9, envMapIntensity: 0.35, ...opts }));
    return matCache.get(k);
  }
  function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
  }
  // 네트워크 · 효과에서 쓰는 공용 상태 (앞에서 선언해 둬야 어느 함수에서 불러도 안전합니다)
  let netDirty = true, netTimer = 0, lastSentX = 0, lastSentZ = 0;
  // ── 실시간 메시지 예산 ──────────────────────────────────────────
  //   Supabase 무료: 프로젝트 전체 초당 100건 (보낸 것 + 받은 것 모두 셈) · 넘으면 연결이 끊김
  //   한 번 보내면 방 사람 수(N)만큼 셈 → 한 사람이 보낼 수 있는 빈도 = 예산 ÷ (N × 반 전체 인원)
  //   방을 나눠도 프로젝트 한도는 하나라 '반 전체 인원(expectedUsers)'으로 나눕니다
  const NET_BUDGET = Number(C.realtimeBudget) || 60;      // 초당 건수 목표 (무료 100 의 60%)
  const NET_USERS = Math.max(2, Number(C.expectedUsers) || 22);
  const netBucket = { tokens: 1, last: performance.now() };
  function netRate() {
    const n = Math.max(1, presentIds.length);
    if (n <= 3) return 4;                                  // 몇 명뿐이면 넉넉히 (초당 4번)
    return Math.min(4, NET_BUDGET / (n * Math.max(n, NET_USERS)));
  }
  function netTake() {
    const now = performance.now();
    netBucket.tokens = Math.min(1.5, netBucket.tokens + (now - netBucket.last) / 1000 * netRate());
    netBucket.last = now;
    if (netBucket.tokens < 1) return false;
    netBucket.tokens -= 1;
    return true;
  }
  let player = null;
  const floaters = [];
  const npcs = [];

  // ------------------------------------------------------------------
  // 질감 공장 — 캔버스에 직접 그려서 색 · 요철 · 거칠기 지도를 만듭니다.
  //   외부 이미지 파일이 없어도 "진짜 재질" 느낌이 나는 가장 싼 방법입니다.
  // ------------------------------------------------------------------
  const TS = LOW ? 128 : 256;              // 텍스처 한 변 크기
  const painters = {
    // 잔디 — 낮은 주파수 얼룩 + 높은 주파수 잔풀
    grass(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const a = fbm(u * 5, v * 5, 3, 5, 5);
        const b = fbm(u * 26 + 3, v * 26 + 7, 2, 26, 26);
        const dry = smooth(0.62, 0.86, a);
        const r = 46 + a * 34 + b * 44 + dry * 48;
        const g = 78 + a * 44 + b * 56 + dry * 30;
        const bl = 42 + a * 26 + b * 30 + dry * 12;
        px(d, S, x, y, r, g, bl);
      }
    },
    // 돌판 길 — 어긋나게 쌓은 판석 + 줄눈
    stone(d, S) {
      const cols = 3, cw = S / cols;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / cw);
        const sx = (x + (row % 2) * cw * 0.5) % S;
        const ex = Math.min(sx % cw, cw - (sx % cw));
        const ey = Math.min(y % cw, cw - (y % cw));
        const edge = Math.min(ex, ey);
        const seam = smooth(0.5, 3.2, edge);
        const id = row * 7 + Math.floor(sx / cw) * 13;
        const tint = 0.84 + hash2(id, 3) * 0.3;
        const n = fbm(x / S * 18, y / S * 18, 3, 18, 18);
        const g = (96 + n * 58) * tint * (0.42 + seam * 0.58);
        px(d, S, x, y, g * 1.02, g, g * 0.97);
      }
    },
    // 나무 — 결 + 옹이
    wood(d, S) {
      const planks = 3, ph = S / planks;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / ph);
        const ey = Math.min(y % ph, ph - (y % ph));
        const seam = smooth(0.4, 2.6, ey);
        const tint = 0.82 + hash2(row, 11) * 0.34;
        const grain = fbm(x / S * 3 + row * 4, y / S * 34, 3, 3, 34);
        const line = 0.74 + 0.26 * Math.abs(Math.sin((y / S) * 52 + grain * 5));
        const k = tint * line * (0.5 + seam * 0.5) * (0.82 + grain * 0.36);
        px(d, S, x, y, 150 * k, 104 * k, 68 * k);
      }
    },
    // 회벽 — 아주 고운 요철
    plaster(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 9, y / S * 9, 3, 9, 9);
        const b = fbm(x / S * 44, y / S * 44, 2, 44, 44);
        const k = 0.86 + a * 0.16 + b * 0.1;
        px(d, S, x, y, 232 * k, 220 * k, 199 * k);
      }
    },
    // 기와 — 반원 기와가 세로로 늘어선 모양
    roof(d, S) {
      const cols = 6, cw = S / cols, rows = 3, rh = S / rows;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const t = (x % cw) / cw;
        const round = Math.sin(t * Math.PI);
        const rowT = (y % rh) / rh;
        const step = smooth(0, 0.08, rowT) * (1 - smooth(0.93, 1, rowT));
        const n = fbm(x / S * 20, y / S * 20, 2, 20, 20);
        const k = (0.38 + round * 0.52) * (0.55 + step * 0.45) * (0.86 + n * 0.28);
        px(d, S, x, y, 78 * k, 82 * k, 96 * k);
      }
    },
    // 바위
    rock(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 7, y / S * 7, 4, 7, 7);
        const crack = 1 - smooth(0, 0.06, Math.abs(fbm(x / S * 4 + 9, y / S * 4 + 4, 3, 4, 4) - 0.5));
        const k = (0.56 + a * 0.5) * (1 - crack * 0.32);
        px(d, S, x, y, 128 * k, 124 * k, 126 * k);
      }
    },
    // 천 (담요 · 차양)
    cloth(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const weave = 0.88 + 0.12 * (Math.sin(x * 1.6) * Math.sin(y * 1.6));
        const n = fbm(x / S * 16, y / S * 16, 2, 16, 16);
        const k = weave * (0.88 + n * 0.22);
        px(d, S, x, y, 240 * k, 236 * k, 232 * k);
      }
    },
    // 물결 (법선용)
    ripple(d, S) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = fbm(x / S * 8, y / S * 8, 3, 8, 8);
        const b = Math.sin((x / S) * Math.PI * 12 + a * 6) * 0.5 + 0.5;
        const k = 0.5 + a * 0.3 + b * 0.2;
        px(d, S, x, y, 200 * k, 210 * k, 225 * k);
      }
    },
  };
  function px(d, S, x, y, r, g, b) {
    const i = (y * S + x) * 4;
    d[i] = clamp(r, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = 255;
  }
  function paint(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(TS, TS);
    painters[kind](img.data, TS);
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // 밝기 차이를 기울기로 바꿔 법선 지도를 만듭니다(소벨).
  function toNormal(src, strength) {
    const S = src.width;
    const sd = src.getContext('2d').getImageData(0, 0, S, S).data;
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    const img = octx.createImageData(S, S);
    const L = (x, y) => {
      const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
      return (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  // 밝은 곳일수록 매끈하게 — 거칠기 지도
  function toRough(src, lo, hi) {
    const S = src.width;
    const sd = src.getContext('2d').getImageData(0, 0, S, S).data;
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    const img = octx.createImageData(S, S);
    for (let i = 0; i < sd.length; i += 4) {
      const l = (sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11) / 255;
      const v = (lo + (hi - lo) * (1 - l)) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out;
  }
  const texBase = new Map();
  const texSets = new Map();
  const ROUGH = { grass: [0.82, 1], stone: [0.6, 0.95], wood: [0.55, 0.92], plaster: [0.7, 0.98], roof: [0.5, 0.9], rock: [0.65, 1], cloth: [0.8, 1], ripple: [0.1, 0.3] };
  const BUMP = { grass: 2.2, stone: 3.4, wood: 2.4, plaster: 1.6, roof: 3.6, rock: 3.2, cloth: 1.8, ripple: 3 };
  function texSet(kind, repeat) {
    const key = kind + ':' + repeat;
    if (texSets.has(key)) return texSets.get(key);
    if (!texBase.has(kind)) {
      const color = paint(kind);
      texBase.set(kind, { color, normal: toNormal(color, BUMP[kind]), rough: toRough(color, ROUGH[kind][0], ROUGH[kind][1]) });
    }
    const b = texBase.get(kind);
    const make = (canvas, srgb) => {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = ANISO;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const set = { map: make(b.color, true), normalMap: make(b.normal, false), roughnessMap: make(b.rough, false) };
    texSets.set(key, set);
    return set;
  }
  function matT(kind, { repeat = 2, color = '#ffffff', normalScale = 1, ...rest } = {}) {
    const key = 'T|' + kind + '|' + repeat + '|' + color + '|' + normalScale + '|' + JSON.stringify(rest);
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color, envMapIntensity: 0.4, ...texSet(kind, repeat), ...rest });
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
    matCache.set(key, m);
    return m;
  }

  function makeLabel(text, { size = 40, color = '#fff', bg = 'rgba(16,18,34,.56)', scale = 1 } = {}) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = `700 ${size}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + size * 1.3;
    const h = Math.ceil(size * 1.8);
    c.width = w; c.height = h;
    ctx.font = font;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, h / 2); else ctx.rect(0, 0, w, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.own = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sp.renderOrder = 10;
    const k = 0.011 * scale;
    sp.scale.set(w * k, h * k, 1);
    return sp;
  }

  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,236,190,.9)');
    grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const softTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // 다 쓴 3D 물체 정리 — 장면에서 빼도 그래픽 메모리(지오메트리 · 텍스처 · 재질)에는 남아 쌓입니다.
  //   여럿이 오래 있으면 말풍선 · 이모지 · 나간 사람 캐릭터가 계속 쌓여 점점 버벅였습니다 (8명 45초에 텍스처 2배).
  //   공용으로 쓰는 것(mat() 캐시 재질 · glowTex 같은 공용 텍스처 · 스프라이트 공용 판 · shared 표시한 지오메트리)은 남깁니다.
  function disposeObj(root) {
    if (!root) return;
    const shared = new Set(matCache.values());
    root.traverse((o) => {
      if (o.geometry && !o.isSprite && !o.geometry.userData.shared) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (shared.has(m)) continue;
        if (m.map && m.map.userData.own) m.map.dispose();
        m.dispose();
      }
    });
  }
  function emojiSprite(emoji, size = 1) {
    // 아이폰 이모지는 글꼴보다 크게 그려져 작은 캔버스에선 가장자리가 잘립니다 → 넉넉한 여백
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 80, 86);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.own = true;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
    sp.renderOrder = 11;
    sp.scale.set(size * 1.25, size * 1.25, 1);   // 여백만큼 키워 보이는 크기는 예전과 같게
    return sp;
  }

  // 더 쓰는 질감 — 나무껍질 · 흙
  painters.bark = (d, S) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = fbm(u * 6, v * 30, 3, 6, 30);
      const ridge = 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 16 + n * 7));
      const k = (0.5 + n * 0.6) * ridge;
      px(d, S, x, y, 112 * k, 82 * k, 60 * k);
    }
  };
  painters.dirt = (d, S) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const a = fbm(u * 6, v * 6, 4, 6, 6);
      const b = fbm(u * 34, v * 34, 2, 34, 34);
      const peb = smooth(0.72, 0.8, fbm(u * 22 + 4, v * 22 + 9, 2, 22, 22));
      const k = 0.58 + a * 0.38 + b * 0.22 + peb * 0.25;
      px(d, S, x, y, 122 * k, 98 * k, 76 * k);
    }
  };
  ROUGH.bark = [0.72, 1]; BUMP.bark = 3.6;
  ROUGH.dirt = [0.8, 1]; BUMP.dirt = 2.8;

  // 원 모양으로 가장자리가 흐려지는 투명도 지도 (흙 마당 · 빛 웅덩이)
  function radialAlpha(inner = 0.55) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(inner, '#fff');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }


  // 천 무늬 — 줄무늬 (파라솔 · 선베드 쿠션)
  function stripeTex(colors, n = 12, across = true) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const w = 128 / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      if (across) g.fillRect(i * w, 0, w + 1, 128); else g.fillRect(0, i * w, 128, w + 1);
    }
    g.globalAlpha = 0.14;                       // 실 결
    for (let y = 0; y < 128; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, 128, 1); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // 두 점을 잇는 둥근 막대 (난간 · 줄)
  const UP = new THREE.Vector3(0, 1, 0);
  function beam(a, b, r, m, seg = 6) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    const c = mesh(new THREE.CylinderGeometry(r, r, L, seg), m);
    c.position.copy(a).addScaledVector(d, 0.5);
    c.quaternion.setFromUnitVectors(UP, d.normalize());
    return c;
  }
  // ------------------------------------------------------------------
  // 하늘 — 바닷가의 하늘 셰이더(SKY_GLSL: 지평선 번짐 · 층구름)를 그대로 쓰고, 색은 늦은 오후 하나로 고정합니다.
  // ------------------------------------------------------------------
  const skyGroup = new THREE.Group();     // 카메라를 따라다닙니다 (아무리 걸어도 하늘이 멀리 있게)
  scene.add(skyGroup);
  const SKY_U = {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.1, 1) }, uMoonDir: { value: new THREE.Vector3(0, 0.4, 1).normalize() },
    uGlow: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 }, uSunVis: { value: 1 }, uLight: { value: 1 },
    uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
  };
  const SKY_GLSL = `
    uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform vec3 uMoonDir;
    uniform vec3 uCloudLit; uniform vec3 uCloudDark;
    uniform float uGlow; uniform float uNight; uniform float uTime; uniform float uSunVis; uniform float uLight;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }
    vec3 skyBase(vec3 d){
      float y = max(d.y, 0.0);
      vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.62, pow(y, 0.55)));
      vec3 sh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0001, 0.0, 0.0));
      vec3 dh = normalize(vec3(d.x, 0.0, d.z) + vec3(0.0001, 0.0, 0.0));
      float az = max(dot(dh, sh), 0.0);
      float sd = max(dot(d, uSunDir), 0.0);
      float band = exp(-y * 4.5);
      // 해 쪽 지평선이 넓게 물듭니다 (노을) + 해 둘레의 둥근 번짐
      c += uSunCol * uGlow * (0.5 * pow(az, 2.0) * band + 0.22 * pow(sd, 5.0) + 0.3 * pow(sd, 28.0) + 0.5 * pow(sd, 350.0));
      // 해 반대편 하늘의 옅은 분홍 띠 (해 질 녘에만)
      c += vec3(0.16, 0.07, 0.1) * uGlow * pow(max(-dot(dh, sh), 0.0), 2.0) * exp(-abs(y - 0.12) * 9.0) * (1.0 - uNight);
      return c;
    }
    // 구름 — 지평선 가까이 길게 누운 층구름. 해 질 녘엔 아랫면이 붉게 물듭니다
    vec3 withClouds(vec3 c, vec3 d){
      if (d.y < 0.004) return c;
      vec2 uv = d.xz / (d.y + 0.07);
      uv = vec2(uv.x * 0.16 + uTime * 0.0025, uv.y * 0.42);
      float n = vn(uv) * 0.55 + vn(uv * 2.3 + 3.7) * 0.3 + vn(uv * 5.2 + 9.1) * 0.15;
      float a = smoothstep(0.55, 0.8, n) * smoothstep(0.004, 0.05, d.y) * (1.0 - smoothstep(0.25, 0.55, d.y));
      if (a <= 0.0) return c;
      float sd = max(dot(d, uSunDir), 0.0);
      vec3 cc = mix(uCloudDark, uCloudLit, 0.45 + 0.55 * smoothstep(0.55, 0.85, n));
      cc += uSunCol * uGlow * pow(sd, 12.0) * 1.3;
      return mix(c, cc, a * 0.88);
    }
  `;
  const OUT_GLSL = '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: SKY_U,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_GLSL + `
      varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        vec3 c = skyBase(d);
        float sd = dot(d, uSunDir);
        // 해 — 둥근 원반
        c += uSunCol * uSunVis * (smoothstep(0.99955, 0.99968, sd) * 7.0 + pow(max(sd, 0.0), 1400.0) * 1.5);
        c = withClouds(c, d);
        if (d.y < 0.0) c = mix(uHor, uHor * 0.75, smoothstep(0.0, 0.2, -d.y));
        gl_FragColor = vec4(c, 1.0);
        ${OUT_GLSL}
      }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), skyMat);
  skyDome.renderOrder = -2;
  skyGroup.add(skyDome);
  const skyDir = (alt, az) => {             // 높이 · 방위(도) → 방향 (방위 0 = 무대 쪽 +z, 90 = +x)
    const a = THREE.MathUtils.degToRad(alt), z = THREE.MathUtils.degToRad(az);
    return new THREE.Vector3(Math.cos(a) * Math.sin(z), Math.sin(a), Math.cos(a) * Math.cos(z));
  };
  // 전시관은 하루가 흐르지 않습니다 — 맑은 늦은 오후로 고정 (해는 입구 쪽 남쪽 하늘, 조금 서쪽)
  //   색은 바닷가 PAL 의 해 높이 20~45° 사이 값을 가져와 조금 따뜻하게
  const SUN = { alt: 38, az: 195 };
  const SKY = {
    zen: '#4a86cc', hor: '#e6e8e2', sunCol: '#ffe2bc', glow: 0.22, cloudLit: '#ffffff', cloudDark: '#bcc3cf',
    hemiSky: '#d8e6f4', hemiGround: '#7a6a50', hemiI: 1.15, sun: '#fff0dc', sunI: 2.7, exposure: 0.95,
  };
  SKY_U.uZen.value.set(SKY.zen); SKY_U.uHor.value.set(SKY.hor); SKY_U.uSunCol.value.set(SKY.sunCol);
  SKY_U.uGlow.value = SKY.glow;
  SKY_U.uCloudLit.value.set(SKY.cloudLit); SKY_U.uCloudDark.value.set(SKY.cloudDark);
  SKY_U.uSunDir.value.copy(skyDir(SUN.alt, SUN.az));
  SKY_U.uSunVis.value = 1; SKY_U.uNight.value = 0; SKY_U.uLight.value = 1;

  // 빛 — 해(그림자) · 하늘빛 · 얼굴 채움빛
  const hemi = new THREE.HemisphereLight(SKY.hemiSky, SKY.hemiGround, SKY.hemiI);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(SKY.sun, SKY.sunI);
  sunLight.castShadow = !LOW;
  sunLight.shadow.mapSize.set(PHONE ? 1024 : 2048, PHONE ? 1024 : 2048);
  {
    const sc = sunLight.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 200;
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 0.03;
  }
  sunLight.userData.dir = skyDir(SUN.alt, SUN.az);
  scene.add(sunLight, sunLight.target);
  const camFill = new THREE.PointLight('#ffe6d0', 0.4, 16, 1.6);    // 카메라 쪽에서 얼굴을 살짝 — 그늘진 부스 안에서도 얼굴이 보이게
  scene.add(camFill);
  // 안개 · 배경 = 지평선 색 (먼 나무가 하늘에 녹아들게)
  scene.fog.color.copy(SKY_U.uHor.value).lerp(SKY_U.uZen.value, 0.22);
  scene.background.copy(SKY_U.uHor.value);
  renderer.toneMappingExposure = SKY.exposure;

  // ------------------------------------------------------------------
  // 배치 — 입구 아치는 남쪽(z=0), 가운데 통로는 북쪽(+z)으로 뻗고, 부스는 통로 양쪽에서 통로를 바라봅니다.
  //   통로 끝(북쪽)에는 작은 발표 무대. 부스 수는 config.js 의 booths (기본 5).
  //   부스가 홀수면 통로 왼쪽(+x)에 하나 더 놓고, 오른쪽 줄은 반 칸 밀어 엇갈리게 — 번호가 걷는 순서대로 이어집니다.
  //   ※ +x 가 화면 왼쪽입니다 (입구에서 통로 끝을 바라볼 때).
  // ------------------------------------------------------------------
  const BOOTH_N = clamp(Math.round(Number(C.booths) || 5), 1, 24);
  const AISLE_HALF = 4;                                   // 통로 반폭 (통로 너비 8m)
  const BOOTH_W = 6, BOOTH_D = 3.6, BOOTH_GAP = 2.6;      // 부스 폭(통로 방향) · 깊이 · 부스 사이 틈
  const PITCH = BOOTH_W + BOOTH_GAP;
  const WALL_H = 3.0;                                     // 뒷벽 높이
  const ENTRY_Z = 0;                                      // 입구 아치
  const ROW_Z0 = 9;                                       // 첫 부스의 가운데 z
  const LEFT_N = Math.ceil(BOOTH_N / 2), RIGHT_N = BOOTH_N - LEFT_N;
  const STAGGER = BOOTH_N % 2 ? PITCH / 2 : 0;            // 홀수면 오른쪽 줄을 반 칸 뒤로
  const LAST_Z = ROW_Z0 + (LEFT_N - 1) * PITCH;
  const STAGE = { z: LAST_Z + BOOTH_W / 2 + 12, hw: 5, hd: 2.4, h: 0.42 };   // 마지막 부스와 무대 사이에 관람석 5줄
  STAGE.zf = STAGE.z - STAGE.hd;                          // 무대 앞 가장자리 (계단은 그 앞 0.9m)
  const XB = AISLE_HALF + BOOTH_D + 4.4;                  // 광장 옆 경계 (부스 뒤로도 걸을 수 있게)
  const PLAZA = { x0: -XB, x1: XB, z0: ENTRY_Z - 11, z1: STAGE.z + STAGE.hd + 4.5 };
  const PCX = (PLAZA.x0 + PLAZA.x1) / 2, PCZ = (PLAZA.z0 + PLAZA.z1) / 2;
  const PHW = (PLAZA.x1 - PLAZA.x0) / 2, PHD = (PLAZA.z1 - PLAZA.z0) / 2;
  const R = 0.3;                                          // 사람 몸 반지름 — 막는 상자는 이만큼 크게 잡습니다

  // 땅 높이 — 광장 안은 평평(0), 광장 밖 잔디는 멀어질수록 낮은 언덕
  function outside(x, z) {
    const dx = Math.max(0, Math.abs(x - PCX) - PHW), dz = Math.max(0, Math.abs(z - PCZ) - PHD);
    return Math.hypot(dx, dz);
  }
  function terrainY(x, z) {
    const d = outside(x, z);
    if (d <= 0) return 0;
    return smooth(3, 26, d) * (0.4 + fbm(x * 0.035 + 7, z * 0.035, 3) * 4.2) + (fbm(x * 0.2, z * 0.2, 2) - 0.5) * 0.08 * smooth(0, 2, d);
  }
  // 무대 — 앞쪽 계단(0.9m)을 오르면 0.42m 높이
  function stageY(x, z) {
    if (Math.abs(x) > STAGE.hw || z > STAGE.z + STAGE.hd || z < STAGE.zf - 0.9) return 0;
    return STAGE.h * smooth(STAGE.zf - 0.9, STAGE.zf - 0.05, z);
  }
  function groundY(x, z) { return Math.max(terrainY(x, z), stageY(x, z)); }
  const standY = (x, z) => groundY(x, z) + 0.05;

  // 충돌 — 원 {x,z,r} · 회전 상자 {x,z,hw,hd,c,s} (쉼터 · 바닷가와 같은 방식)
  const blockers = [];
  function pushOut(pos, maxStep = 0.35) {
    for (let iter = 0; iter < 3; iter++) {
      let cx = 0, cz = 0, hits = 0;
      for (const b of blockers) {
        const dx = pos.x - b.x, dz = pos.z - b.z;
        if (b.hw !== undefined) {
          const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
          if (Math.abs(lx) >= b.hw || Math.abs(lz) >= b.hd) continue;
          const px2 = b.hw - Math.abs(lx), pz2 = b.hd - Math.abs(lz);
          let nlx = lx, nlz = lz;
          if (px2 < pz2) nlx = (lx < 0 ? -1 : 1) * b.hw; else nlz = (lz < 0 ? -1 : 1) * b.hd;
          cx += (b.x + nlx * b.c + nlz * b.s) - pos.x;
          cz += (b.z - nlx * b.s + nlz * b.c) - pos.z;
          hits++;
        } else {
          const d = Math.hypot(dx, dz);
          if (d >= b.r) continue;
          const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
          cx += (b.x + ux * b.r) - pos.x;
          cz += (b.z + uz * b.r) - pos.z;
          hits++;
        }
      }
      if (!hits) break;
      const ml = Math.hypot(cx, cz);
      if (ml < 1e-4) break;
      const k = ml > maxStep ? maxStep / ml : 1;
      pos.x += cx * k;
      pos.z += cz * k;
    }
    // 바깥 경계 (광장 둘레 산울타리 안쪽)
    pos.x = clamp(pos.x, PLAZA.x0 + 0.6, PLAZA.x1 - 0.6);
    pos.z = clamp(pos.z, PLAZA.z0 + 0.6, PLAZA.z1 - 0.6);
  }
  // ry 는 three.js 의 rotation.y 와 같은 뜻 (상자의 hw 는 그 물체의 로컬 x 반폭, hd 는 로컬 z 반폭)
  const boxBlock = (x, z, hw, hd, ry) => blockers.push({ x, z, hw, hd, c: Math.cos(ry), s: Math.sin(ry) });
  // 로컬 좌표(부스 · 벤치 안) → 세계 좌표
  const toWorld = (ox, oz, ry, lx, lz) => ({ x: ox + lx * Math.cos(ry) + lz * Math.sin(ry), z: oz - lx * Math.sin(ry) + lz * Math.cos(ry) });
  const toLocal = (ox, oz, ry, x, z) => { const dx = x - ox, dz = z - oz, c = Math.cos(ry), s = Math.sin(ry); return { x: dx * c - dz * s, z: dx * s + dz * c }; };

  const groundMeshes = [], clickables = [], occluders = [];
  const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  // 잔디 — 광장 밖은 낮은 언덕, 색은 잡음으로 얼룩지게
  {
    const S = LOW ? 110 : 170;
    const geo = new THREE.PlaneGeometry(320, 320, S, S);
    geo.translate(0, -(PCZ), 0);                 // 광장 가운데를 중심으로
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
      const d = outside(x, z);
      pos.setZ(i, d <= 0 ? -0.03 : terrainY(x, z));
      const n = fbm(x * 0.06, z * 0.06, 2);
      const k = 0.86 + n * 0.28;
      col.set([0.92 * k, 1.0 * k, 0.8 * k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const lawn = new THREE.Mesh(geo, matT('grass', { repeat: 70, color: '#cfe3a8', vertexColors: true, roughness: 1 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.receiveShadow = true;
    scene.add(lawn);
    groundMeshes.push(lawn);
  }
  // 바닥 판 — 너비 · 길이에 맞춰 무늬가 늘어나지 않게 UV 를 m 단위로 (tile m 마다 한 장)
  function floorPlane(w, d, tile, material, x, y, z) {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    const m = new THREE.Mesh(g, material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    groundMeshes.push(m);
    return m;
  }
  // 광장 돌바닥 · 통로 카펫
  floorPlane(PHW * 2, PHD * 2, 4.5, matT('stone', { repeat: 1, color: '#efe8dc', normalScale: 0.7 }), PCX, 0.004, PCZ);
  {
    const z0 = ENTRY_Z - 2.5, z1 = STAGE.zf - 0.9;
    const runner = matT('cloth', { repeat: 1, color: '#c9715a', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    floorPlane(3.4, z1 - z0, 1.2, runner, 0, 0.012, (z0 + z1) / 2);
    // 카펫 가장자리 금빛 선
    const edgeM = mat('#e3c27a', { roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const sx of [-1.75, 1.75]) floorPlane(0.12, z1 - z0, 1, edgeM, sx, 0.014, (z0 + z1) / 2);
  }

  // 글자 판 — 캔버스에 글씨를 써서 표지판 · 현수막에 붙입니다 (w×h 픽셀)
  function signTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    return t;
  }
  const FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  // 상자의 한 면(또는 여러 면)에만 그림을 붙입니다 — 면 순서: +x, -x, +y, -y, +z, -z
  function faceBox(w, h, d, base, faces) {
    const ms = [base, base, base, base, base, base];
    for (const [i, m] of Object.entries(faces)) ms[i] = m;
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ms);
  }

  // ------------------------------------------------------------------
  // 입구 아치 — '데모데이 전시관' 현판 + 양옆 산울타리 (아치로만 들어갑니다)
  // ------------------------------------------------------------------
  const ARCH = { hw: AISLE_HALF + 0.9, h: 4.4 };
  const archFlags = [];
  {
    const g = new THREE.Group();
    g.position.set(0, 0, ENTRY_Z);
    const pillarM = matT('plaster', { repeat: 1, color: '#f4efe6' });
    const trimM = mat('#2f3a4a', { roughness: 0.55, metalness: 0.2 });
    for (const s of [-1, 1]) {
      const p = mesh(new THREE.BoxGeometry(0.9, ARCH.h, 0.9), pillarM, s * ARCH.hw, ARCH.h / 2, 0);
      const base = mesh(new THREE.BoxGeometry(1.1, 0.35, 1.1), trimM, s * ARCH.hw, 0.175, 0);
      const cap = mesh(new THREE.BoxGeometry(1.05, 0.14, 1.05), trimM, s * ARCH.hw, ARCH.h + 0.07, 0);
      g.add(p, base, cap);
      occluders.push(p);
      boxBlock(s * ARCH.hw, ENTRY_Z, 0.45 + R, 0.45 + R, 0);
    }
    const signW = ARCH.hw * 2 + 1.1, signH = 1.35;
    const tex = signTex(1400, Math.round(1400 * signH / signW), (ctx, w, h) => {
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#2c3a52'); grd.addColorStop(1, '#1f2a3d');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e8c477'; ctx.lineWidth = 6; ctx.strokeRect(14, 14, w - 28, h - 28);
      // 양 끝에 작은 색 점 — 부스 색들
      ['#e8685a', '#f0a23b', '#4fa36b', '#3f8fd2', '#8a6fd6'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(60 + i * 26, h - 34, 7, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(w - 60 - i * 26, h - 34, 7, 0, 7); ctx.fill();
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff6e6';
      ctx.font = `800 ${Math.round(h * 0.46)}px ${FONT}`;
      ctx.fillText(C.title || '데모데이 전시관', w / 2, h * 0.44);
      ctx.fillStyle = '#e8c477';
      ctx.font = `700 ${Math.round(h * 0.13)}px ${FONT}`;
      ctx.fillText('D E M O   D A Y   G A L L E R Y', w / 2, h * 0.82);
    });
    const signM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 });
    const lintel = faceBox(signW, signH, 0.5, trimM, { 4: signM, 5: signM });
    lintel.position.set(0, ARCH.h + 0.14 + signH / 2, 0);
    g.add(lintel);
    occluders.push(lintel);
    // 현판 위 작은 깃발 셋
    ['#e8685a', '#f0a23b', '#3f8fd2'].forEach((c, i) => {
      const x = (i - 1) * 2.6, y = ARCH.h + 0.14 + signH;
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), trimM, x, y + 0.55, 0));
      const flag = mesh(new THREE.PlaneGeometry(0.62, 0.38), mat(c, { side: THREE.DoubleSide, roughness: 0.9 }), x + 0.32, y + 0.88, 0);
      g.add(flag);
      archFlags.push(flag);
    });
    shadowAll(g);
    scene.add(g);
  }

  // ------------------------------------------------------------------
  // 부스 — 데이터 배열 BOOTHS 하나로 관리합니다 (내일 부스 등록 · 포스터 · 좋아요를 여기에 붙입니다)
  //   BOOTHS[i] = { no, side, x, z, facing, color, group, frame, canvas, ctx, tex, sign, front, data }
  //     no      부스 번호 (1부터)          side    +1 = 통로 왼쪽(+x) · -1 = 오른쪽(-x)
  //     x, z    부스 바닥 가운데            facing  rotation.y (부스 앞면이 통로를 향함)
  //     color   부스 강조색                group   부스 전체 THREE.Group
  //     frame   액자 그림 판(Mesh)          canvas/ctx/tex  액자 그림 캔버스 · CanvasTexture
  //     sign    번호 표지 Mesh 들          front   길찾기로 서는 자리 {x, z}
  //     data    (비어 있음 — 등록된 작품 정보를 넣을 칸)
  //   액자 다시 그리기: paintFrame(booth, drawFn = drawPlaceholder, data)
  // ------------------------------------------------------------------
  const BOOTH_COLORS = ['#e8685a', '#f0a23b', '#4fa36b', '#3f8fd2', '#8a6fd6', '#e06aa6', '#2ea8a1', '#c98b3c'];
  const boothColor = (i) => (i < BOOTH_COLORS.length ? BOOTH_COLORS[i]
    : '#' + new THREE.Color().setHSL(((i * 0.618) % 1), 0.55, 0.56).getHexString());
  const FRAME = { w: 2.5, h: 1.66, y: 1.72, px: LOW ? 576 : 768 };
  FRAME.py = Math.round(FRAME.px * FRAME.h / FRAME.w);
  const BOOTHS = [];
  {
    // 걷는 순서대로 번호 — 왼쪽 줄 · 오른쪽 줄을 z 순서로 엇갈려 셉니다
    const slots = [];
    for (let i = 0; i < LEFT_N; i++) slots.push({ side: 1, z: ROW_Z0 + i * PITCH });
    for (let j = 0; j < RIGHT_N; j++) slots.push({ side: -1, z: ROW_Z0 + STAGGER + j * PITCH });
    slots.sort((a, b) => a.z - b.z || b.side - a.side);
    slots.forEach((s, i) => {
      const x = s.side * (AISLE_HALF + BOOTH_D / 2);
      const facing = -s.side * Math.PI / 2;                 // 왼쪽(+x) 부스는 -x 쪽(통로)을 봅니다
      const front = toWorld(x, s.z, facing, 0, BOOTH_D / 2 - 0.35);
      BOOTHS.push({ no: i + 1, side: s.side, x, z: s.z, facing, color: boothColor(i), front, team: teamOf(i + 1), data: (teamOf(i + 1) && (teamOf(i + 1).url || teamOf(i + 1).thumb)) ? teamOf(i + 1) : null });
    });
  }
  // '작품 준비 중' 자리 그림 — 캔버스에 직접 그립니다 (내일은 같은 모양의 drawPoster 를 만들어 paintFrame 에 넘기면 됨)
  function drawPlaceholder(ctx, w, h, booth) {
    const acc = booth.color;
    const grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#fbf7f0'); grd.addColorStop(1, '#efe7da');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    // 옅은 사선 무늬 (공사 중 느낌)
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = acc;
    ctx.lineWidth = w * 0.03;
    for (let x = -h; x < w + h; x += w * 0.08) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
    ctx.restore();
    // 점선 테두리
    const m = w * 0.05;
    ctx.save();
    ctx.setLineDash([w * 0.025, w * 0.016]);
    ctx.strokeStyle = acc;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = w * 0.007;
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.restore();
    // 액자 그림 아이콘 (산과 해) — 이모지 글꼴이 없어도 보이게 직접 그림
    const cx = w / 2, cy = h * 0.34, iw = w * 0.16, ih = iw * 0.72;
    ctx.save();
    ctx.lineWidth = w * 0.008;
    ctx.strokeStyle = acc;
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - iw / 2, cy - ih / 2, iw, ih, w * 0.012); else ctx.rect(cx - iw / 2, cy - ih / 2, iw, ih);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = acc;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(cx - iw * 0.4, cy + ih * 0.32); ctx.lineTo(cx - iw * 0.1, cy - ih * 0.08); ctx.lineTo(cx + iw * 0.08, cy + ih * 0.14);
    ctx.lineTo(cx + iw * 0.2, cy + ih * 0.02); ctx.lineTo(cx + iw * 0.4, cy + ih * 0.32); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + iw * 0.22, cy - ih * 0.18, iw * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2d2a33';
    ctx.font = `800 ${Math.round(h * 0.15)}px ${FONT}`;
    ctx.fillText('작품 준비 중', cx, h * 0.64);
    ctx.fillStyle = '#6b6470';
    ctx.font = `600 ${Math.round(h * 0.062)}px ${FONT}`;
    ctx.fillText(`부스 ${booth.no} · 곧 작품이 걸려요`, cx, h * 0.79);
  }
  // 작품 포스터 — 위쪽은 작품 캡처 화면, 아래 띠는 작품 제목 · 팀 이름 (글자는 캔버스로만)
  function drawPoster(ctx, w, h, booth, data) {
    const img = booth.thumbImg;
    const bandH = h * 0.2;
    const ih = h - bandH;
    ctx.fillStyle = '#1f2430';
    ctx.fillRect(0, 0, w, h);
    if (img && img.naturalWidth) {
      // 가로를 꽉 채우고 위쪽 기준으로 자름 (첫 화면 머리가 보이게)
      const s = Math.max(w / img.naturalWidth, ih / img.naturalHeight);
      ctx.drawImage(img, (w - img.naturalWidth * s) / 2, 0, img.naturalWidth * s, img.naturalHeight * s);
    } else {
      const grd = ctx.createLinearGradient(0, 0, w, ih);
      grd.addColorStop(0, booth.color); grd.addColorStop(1, '#2d2a33');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, ih);
    }
    ctx.fillStyle = '#fbf8f2';
    ctx.fillRect(0, ih, w, bandH);
    ctx.fillStyle = booth.color;
    ctx.fillRect(0, ih, w * 0.018, bandH);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const fit = (text, size, weight, maxW) => {
      let f = size;
      do { ctx.font = `${weight} ${f}px ${FONT}`; f -= 2; } while (ctx.measureText(text).width > maxW && f > 10);
    };
    const title = data.title || data.team;
    ctx.fillStyle = '#2d2a33';
    fit(title, Math.round(bandH * 0.42), 800, w * 0.7);
    ctx.fillText(title, w * 0.045, ih + bandH * 0.5);
    ctx.textAlign = 'right';
    ctx.fillStyle = booth.color;
    fit(`부스 ${booth.no} · ${data.team}`, Math.round(bandH * 0.26), 700, w * 0.22);
    ctx.fillText(`부스 ${booth.no} · ${data.team}`, w * 0.97, ih + bandH * 0.5);
  }
  // 작품 새 탭으로 열기 — iframe 없이 noopener
  function openWork(no) {
    const b = boothByNo(no);
    if (!b || !b.data || !b.data.url) return;
    window.open(b.data.url, '_blank', 'noopener');
  }
  // 액자 다시 그리기 — draw(ctx, w, h, booth, data)
  function paintFrame(booth, draw = drawPlaceholder, data = booth.data) {
    const { ctx, canvas } = booth;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    draw(ctx, canvas.width, canvas.height, booth, data);
    ctx.restore();
    booth.tex.needsUpdate = true;
  }
  // 명판 — 팀 이름 + 팀원 이름 (액자 오른쪽 벽). 이름은 캔버스 글씨로만
  function drawNameplate(ctx, w, h, booth) {
    const t = booth.team;
    ctx.fillStyle = '#fbf8f2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = booth.color;
    ctx.fillRect(0, 0, w, h * 0.17);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(h * 0.09)}px ${FONT}`;
    ctx.fillText(`부스 ${booth.no}`, w / 2, h * 0.087);
    const fit = (text, size, weight, maxW) => {
      let f = size;
      do { ctx.font = `${weight} ${f}px ${FONT}`; f -= 2; } while (ctx.measureText(text).width > maxW && f > 10);
    };
    ctx.fillStyle = '#2d2a33';
    fit(t.team, Math.round(h * 0.12), 800, w * 0.88);
    ctx.fillText(t.team, w / 2, h * 0.27);
    ctx.fillStyle = booth.color;
    ctx.fillRect(w * 0.3, h * 0.345, w * 0.4, 3);
    ctx.fillStyle = '#4a4552';
    // 팀원 이름이 있으면 이름 (작품명은 액자 아래 띠에 있음)
    if (t.members.length) {
      t.members.forEach((m, i) => {
        fit(m, Math.round(h * 0.078), 600, w * 0.86);
        ctx.fillText(m, w / 2, h * (0.43 + i * 0.112));
      });
      return;
    }
    // 이름이 없으면 작품명 — 낱말 단위로 줄바꿈, 최대 4줄
    const title = t.title || '작품 준비 중';
    ctx.font = `700 ${Math.round(h * 0.075)}px ${FONT}`;
    const lines = [];
    let cur = '';
    for (const word of title.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && ctx.measureText(next).width > w * 0.86) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 4).forEach((ln, i) => {
      fit(ln, Math.round(h * 0.075), 700, w * 0.86);
      ctx.fillText(ln, w / 2, h * (0.45 + i * 0.105));
    });
  }
  // 부스 번호 표지 그림
  function boothSignTex(booth, w, h) {
    return signTex(w, h, (ctx) => {
      ctx.fillStyle = booth.color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(0, 0, w, h * 0.12);
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.round(h * 0.56)}px ${FONT}`;
      ctx.fillText(`부스 ${booth.no}`, w / 2, h * 0.53);
    });
  }
  {
    const wallM = matT('plaster', { repeat: 1, color: '#f7f3ec' });
    const darkM = mat('#2f3a4a', { roughness: 0.55, metalness: 0.2 });
    const frameWood = matT('wood', { repeat: 1, color: '#6d4c37' });
    const potM = mat('#b8836a', { roughness: 0.85 });
    const leafM = mat('#4f7f45', { roughness: 1, flatShading: true });
    for (const b of BOOTHS) {
      const g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.facing;
      const accM = mat(b.color, { roughness: 0.75 });
      const rugM = mat(new THREE.Color(b.color).lerp(new THREE.Color('#ffffff'), 0.62).getStyle(), { roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      // 바닥 깔개 (눌러서 걸어 들어갈 수 있게 groundMeshes 에)
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(BOOTH_W - 0.3, BOOTH_D - 0.1), rugM);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(0, 0.012, 0.05);
      rug.receiveShadow = true;
      g.add(rug);
      groundMeshes.push(rug);
      // 뒷벽 + 위 띠 + 아래 걸레받이
      const wall = mesh(new THREE.BoxGeometry(BOOTH_W, WALL_H, 0.2), wallM, 0, WALL_H / 2, -BOOTH_D / 2);
      const band = mesh(new THREE.BoxGeometry(BOOTH_W + 0.06, 0.16, 0.26), accM, 0, WALL_H - 0.08, -BOOTH_D / 2);
      const skirt = mesh(new THREE.BoxGeometry(BOOTH_W + 0.02, 0.14, 0.24), darkM, 0, 0.07, -BOOTH_D / 2);
      g.add(wall, band, skirt);
      // 옆 칸막이 (짧게) — 부스 색
      const SIDE_L = 1.6, SIDE_H = WALL_H * 0.82;
      for (const s of [-1, 1]) {
        const p = mesh(new THREE.BoxGeometry(0.12, SIDE_H, SIDE_L), accM, s * BOOTH_W / 2, SIDE_H / 2, -BOOTH_D / 2 + SIDE_L / 2);
        g.add(p);
        occluders.push(p);
        const w = toWorld(b.x, b.z, b.facing, s * BOOTH_W / 2, -BOOTH_D / 2 + SIDE_L / 2);
        boxBlock(w.x, w.z, 0.06 + R, SIDE_L / 2 + R, b.facing);
      }
      occluders.push(wall);
      {
        const w = toWorld(b.x, b.z, b.facing, 0, -BOOTH_D / 2);
        boxBlock(w.x, w.z, BOOTH_W / 2 + R, 0.1 + R, b.facing);
      }
      // 번호 표지 — 뒷벽 위 현판 (통로 쪽 면에 글씨)
      const signM = new THREE.MeshStandardMaterial({ map: boothSignTex(b, 512, 160), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.12 });
      signM.emissiveMap = signM.map;
      const header = faceBox(2.2, 0.68, 0.12, accM, { 4: signM });
      header.position.set(0, WALL_H + 0.36, -BOOTH_D / 2);
      g.add(header);
      // 통로 가장자리 세움 간판 — 통로를 걸으며 앞뒤 어디서든 번호가 보이게 (양면)
      const bladeM = new THREE.MeshStandardMaterial({ map: boothSignTex(b, 400, 180), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.12 });
      bladeM.emissiveMap = bladeM.map;
      const bl = { x: BOOTH_W / 2 + 0.35, z: BOOTH_D / 2 - 0.15 };
      const post = mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.5, 8), darkM, bl.x, 1.25, bl.z);
      const blade = faceBox(0.06, 0.6, 1.33, accM, { 0: bladeM, 1: bladeM });
      blade.position.set(bl.x, 2.15, bl.z - 0.72);
      g.add(post, blade);
      {
        const w = toWorld(b.x, b.z, b.facing, bl.x, bl.z);
        blockers.push({ x: w.x, z: w.z, r: 0.08 + R });
      }
      // 액자 — 나무 틀 + 그림 판 (그림은 캔버스 · 조금 스스로 빛나서 그늘에서도 읽힘)
      const fz = -BOOTH_D / 2 + 0.1;
      const outer = mesh(new THREE.BoxGeometry(FRAME.w + 0.2, FRAME.h + 0.2, 0.08), frameWood, 0, FRAME.y, fz + 0.04);
      g.add(outer);
      b.canvas = document.createElement('canvas');
      b.canvas.width = FRAME.px; b.canvas.height = FRAME.py;
      b.ctx = b.canvas.getContext('2d');
      b.tex = new THREE.CanvasTexture(b.canvas);
      b.tex.colorSpace = THREE.SRGBColorSpace;
      b.tex.anisotropy = ANISO;
      const picM = new THREE.MeshStandardMaterial({ map: b.tex, roughness: 0.85, emissive: '#ffffff', emissiveMap: b.tex, emissiveIntensity: 0.22 });
      const frame = mesh(new THREE.PlaneGeometry(FRAME.w, FRAME.h), picM, 0, FRAME.y, fz + 0.085);
      frame.userData = { kind: 'frame', no: b.no };
      g.add(frame);
      clickables.push(frame);
      // 액자 위 그림 조명 (가는 막대 등)
      const ly = FRAME.y + FRAME.h / 2 + 0.24;
      for (const sx of [-0.5, 0.5]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.26), darkM, sx, ly, fz + 0.14));
      g.add(mesh(new THREE.BoxGeometry(1.3, 0.06, 0.09), darkM, 0, ly, fz + 0.28));
      g.add(mesh(new THREE.BoxGeometry(1.2, 0.02, 0.05), mat('#fff3d6', { emissive: '#ffe2a8', emissiveIntensity: 0.6 }), 0, ly - 0.035, fz + 0.28));
      // 구석 화분
      const pp = { x: -BOOTH_W / 2 + 0.55, z: -BOOTH_D / 2 + 0.55 };
      const pot = mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.42, 12), potM, pp.x, 0.21, pp.z);
      const bush = mesh(new THREE.IcosahedronGeometry(0.42, 1), leafM, pp.x, 0.78, pp.z);
      bush.scale.set(1, 1.15, 1);
      g.add(pot, bush);
      {
        const w = toWorld(b.x, b.z, b.facing, pp.x, pp.z);
        blockers.push({ x: w.x, z: w.z, r: 0.28 + R });
      }
      // 명판 (명단이 있을 때만)
      if (b.team) {
        const plTex = signTex(300, 380, (ctx, w, h) => drawNameplate(ctx, w, h, b));
        const plM = new THREE.MeshStandardMaterial({ map: plTex, roughness: 0.8, emissive: '#ffffff', emissiveMap: plTex, emissiveIntensity: 0.2 });
        b.plate = mesh(new THREE.PlaneGeometry(1.1, 1.39), plM, 2.15, 1.55, fz + 0.03);
        g.add(b.plate);
      }
      shadowAll(g);
      rug.castShadow = false;
      scene.add(g);
      b.group = g;
      b.frame = frame;
      b.sign = [header, blade];
      if (b.data) {
        paintFrame(b, drawPoster);
        if (b.data.thumb) {
          const img = new Image();
          img.onload = () => { b.thumbImg = img; paintFrame(b, drawPoster); };
          const inl = window.GALLERY_THUMBS && window.GALLERY_THUMBS[b.data.thumb];
          img.src = (typeof inl === 'string' && inl.startsWith('data:image/')) ? inl : b.data.thumb;
        }
      } else paintFrame(b);
    }
  }
  const boothByNo = (no) => BOOTHS.find((b) => b.no === no) || null;
  // 지금 서 있는 부스 (부스 바닥 또는 바로 앞 통로 2m 안)
  function boothAt(x, z) {
    for (const b of BOOTHS) {
      const l = toLocal(b.x, b.z, b.facing, x, z);
      if (Math.abs(l.x) < BOOTH_W / 2 + 0.2 && l.z > -BOOTH_D / 2 && l.z < BOOTH_D / 2 + 2.0) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 발표 무대 — 통로 끝. 앞 계단으로 올라가고, 뒤에는 큰 화면판
  // ------------------------------------------------------------------
  const stage = {};
  {
    const g = new THREE.Group();
    const deckM = matT('wood', { repeat: 1, color: '#c9a27c' });
    const darkM = mat('#2f3a4a', { roughness: 0.55, metalness: 0.2 });
    const deck = mesh(new THREE.BoxGeometry(STAGE.hw * 2, STAGE.h, STAGE.hd * 2), deckM, 0, STAGE.h / 2, STAGE.z);
    g.add(deck);
    groundMeshes.push(deck);
    for (let i = 0; i < 2; i++) {
      const h = STAGE.h * (i + 1) / 3, d = 0.45;
      const st = mesh(new THREE.BoxGeometry(STAGE.hw * 2, h, d), deckM, 0, h / 2, STAGE.zf - 0.9 + d / 2 + i * d);
      g.add(st);
      groundMeshes.push(st);
    }
    // 화면판 — 'DEMO DAY' (내일 발표 모드에서 지금 발표 중인 조를 띄울 수 있는 자리)
    const scrW = STAGE.hw * 2 - 0.6, scrH = 2.6;
    stage.canvas = document.createElement('canvas');
    stage.canvas.width = 1024; stage.canvas.height = Math.round(1024 * scrH / scrW);
    stage.ctx = stage.canvas.getContext('2d');
    stage.tex = new THREE.CanvasTexture(stage.canvas);
    stage.tex.colorSpace = THREE.SRGBColorSpace;
    stage.draw = (title, sub) => {
      const ctx = stage.ctx, w = stage.canvas.width, h = stage.canvas.height;
      const grd = ctx.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#24314a'); grd.addColorStop(1, '#3a2e52');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      // 축제 무늬 — 위쪽 삼각 깃발 + 흩날리는 색종이 (같은 무늬가 나오게 고정 난수)
      const FC = ['#ff5d73', '#ffb22e', '#ffe14d', '#4cd38a', '#3fa9ff', '#a77bff', '#ff7ad1'];
      let sd = 7;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w, y = rnd() * h, r = rnd() * 6.28;
        if (Math.abs(y - h * 0.5) < h * 0.22 && Math.abs(x - w / 2) < w * 0.36) continue;   // 글자 자리는 비움
        ctx.save(); ctx.translate(x, y); ctx.rotate(r);
        ctx.fillStyle = FC[i % FC.length]; ctx.globalAlpha = 0.75;
        ctx.fillRect(-w * 0.008, -h * 0.006, w * 0.016, h * 0.012);
        ctx.restore();
      }
      const fw = w / 22;
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = FC[i % FC.length];
        ctx.beginPath(); ctx.moveTo(i * fw, 0); ctx.lineTo((i + 1) * fw, 0); ctx.lineTo((i + 0.5) * fw, h * 0.1); ctx.closePath(); ctx.fill();
      }
      BOOTH_COLORS.slice(0, 5).forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(w * 0.3 + i * w * 0.08, h * 0.8, w * 0.08, h * 0.025); });
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fit = (text, size, weight) => { let f = size; do { ctx.font = `${weight} ${f}px ${FONT}`; f -= 2; } while (ctx.measureText(text).width > w * 0.9 && f > 12); };
      ctx.fillStyle = '#fff6e6';
      fit(title, Math.round(h * 0.22), 800);
      ctx.fillText(title, w / 2, h * 0.42);
      ctx.fillStyle = '#e8c477';
      fit(sub, Math.round(h * 0.085), 600);
      ctx.fillText(sub, w / 2, h * 0.64);
      stage.tex.needsUpdate = true;
    };
    stage.draw('DEMO DAY', '발표 무대');
    const scrM = new THREE.MeshStandardMaterial({ map: stage.tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: stage.tex, emissiveIntensity: 0.35 });
    const scr = faceBox(scrW, scrH, 0.16, darkM, { 5: scrM });
    scr.position.set(0, STAGE.h + 0.35 + scrH / 2, STAGE.z + STAGE.hd - 0.2);
    g.add(scr);
    occluders.push(scr);
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.16, scrH + 0.5, 0.16), darkM, s * (scrW / 2 + 0.1), STAGE.h + (scrH + 0.5) / 2, STAGE.z + STAGE.hd - 0.2));
      // 무대 옆 · 화면 뒤는 막고, 앞 계단으로만 오릅니다
      boxBlock(s * (STAGE.hw + 0.05), STAGE.z, 0.05 + R, STAGE.hd + 0.05, 0);
    }
    boxBlock(0, STAGE.z + STAGE.hd - 0.2, STAGE.hw + 0.1, 0.1 + R, 0);
    // 연설대
    const lect = mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), deckM, 4.1, STAGE.h + 0.55, STAGE.z + 1.1);   // 시상 자리(앞줄 5칸)와 겹치지 않게 오른쪽 뒤
    g.add(lect);
    blockers.push({ x: 4.1, z: STAGE.z + 1.1, r: 0.4 + R });
    shadowAll(g);
    scene.add(g);
  }

  // ------------------------------------------------------------------
  // 축제 장식 — 풍선 아치 · 풍선 다발 · 삼각 깃발 · 전구 줄 · 시상 꽃가루 (모두 코드로 생성)
  //   걸어 다니는 곳 위나 무대 바깥에만 놓습니다. 그림자는 끔 (가볍게)
  // ------------------------------------------------------------------
  const ENT_BX = AISLE_HALF + 1.6, ENT_BH = 4.1;   // 입구 앞 배너 줄 (x · 꼭대기 높이)
  const festive = { bob: [], lights: [], confetti: null, later: [], flashes: [], banners: [], drift: null, bulbs: [[], [], []],
    flashGeo: new THREE.SphereGeometry(0.5, 14, 10), ringGeo: new THREE.RingGeometry(0.42, 0.5, 40) };
  // 크래커(🎉) 꽃가루 — pos 에서 dir 방향으로 펑 (n 으로 색 묶음이 정해져 모든 화면에서 같은 색)
  const fwCol = new THREE.Color();
  function popConfetti(pos, dir, n = 0) {
    const fw = festive.fw;
    if (!fw) return;
    const SETS = [['#ff5d73', '#ffb22e', '#ffe14d', '#3fa9ff'], ['#3fa9ff', '#a77bff', '#7af0ff', '#ffe14d'], ['#4cd38a', '#ffe14d', '#ff7ad1', '#ffffff'], ['#ff7ad1', '#a77bff', '#ffb22e', '#4cd38a']];
    const c = SETS[Math.abs(Math.round(Number(n) || 0)) % SETS.length];
    const d = dir.clone().normalize();
    // d 에 수직인 두 축 — 고깔 모양으로 퍼지게
    const a1 = new THREE.Vector3(0, 1, 0).cross(d);
    if (a1.lengthSq() < 1e-4) a1.set(1, 0, 0);
    a1.normalize();
    const a2 = d.clone().cross(a1).normalize();
    const shoot = (count, spreadMax, speed0, speed1, kind, color) => {
      for (let i = 0; i < count; i++) {
        const spread = Math.pow(Math.random(), 0.7) * spreadMax, th = Math.random() * Math.PI * 2;
        const v = d.clone().multiplyScalar(Math.cos(spread))
          .addScaledVector(a1, Math.sin(spread) * Math.cos(th))
          .addScaledVector(a2, Math.sin(spread) * Math.sin(th))
          .multiplyScalar(speed0 + Math.random() * (speed1 - speed0));
        const k2 = kind || (i % 4 === 0 ? 'ribbon' : 'paper');   // 네 개 중 하나는 긴 리본
        fw.parts.push({ i: fw.next, x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y, vz: v.z, age: 0,
          life: (k2 === 'glitter' ? 1.6 : 3.0) + Math.random() * 1.4,
          rx: Math.random() * 6, ry: Math.random() * 6, sp: 4 + Math.random() * 8, ph: Math.random() * 6.28, kind: k2 });
        fw.inst.setColorAt(fw.next, fwCol.set(color || c[i % c.length]));
        fw.next = (fw.next + 1) % fw.N;
      }
      fw.inst.instanceColor.needsUpdate = true;
    };
    shoot(LOW ? 90 : 200, 0.75, 4.2, 8.5);                        // 꽃가루 · 리본
    festive.later.push({ t: 0.12, fn: () => shoot(LOW ? 40 : 90, 1.0, 2.5, 6.5, 'glitter', '#ffe9a8') });   // 뒤이어 반짝이는 금가루
    // 섬광 + 빛 고리 (입구에서 확 퍼짐)
    const flash = new THREE.Mesh(festive.flashGeo, new THREE.MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.position.copy(pos);
    const ring = new THREE.Mesh(festive.ringGeo, new THREE.MeshBasicMaterial({ color: c[0], transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.copy(pos).addScaledVector(d, 0.15);
    ring.lookAt(ring.position.clone().add(d));
    scene.add(flash, ring);
    festive.flashes.push({ flash, ring, age: 0 });
  }
  {
    const PAL = ['#ff5d73', '#ffb22e', '#ffe14d', '#4cd38a', '#3fa9ff', '#a77bff', '#ff7ad1', '#ffffff'];
    const balloonGeo = new THREE.SphereGeometry(1, 16, 12);
    const balloonM = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0.06 });
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    // ① 풍선 아치 — 무대 앞 계단 바로 앞, 화면을 액자처럼 감쌈
    {
      const AZ = STAGE.zf - 1.25, AX = STAGE.hw + 0.75, AY = 5.4;
      const pts = [];
      const N = 46;
      for (let i = 0; i <= N; i++) {
        const a = Math.PI * i / N;
        const x = Math.cos(a) * AX, y = 0.35 + Math.sin(a) * (AY - 0.35);
        // 한 지점에 풍선 4개를 꽃잎처럼 — 굵고 풍성한 아치
        for (let k = 0; k < 4; k++) {
          const ang = k * Math.PI / 2 + i * 0.7;
          pts.push({ x: x + Math.cos(ang) * 0.22 * Math.cos(a), y: y + Math.sin(ang) * 0.22, z: AZ + Math.sin(ang + 1) * 0.2, r: 0.26 + ((i * 7 + k * 3) % 5) * 0.018, c: PAL[(i + k * 2) % 7] });
        }
      }
      const inst = new THREE.InstancedMesh(balloonGeo, balloonM, pts.length);
      pts.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(p.r, p.r * 1.12, p.r);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, col.set(p.c));
      });
      scene.add(inst);
      // 아치 발 — 풍선 무게추 상자 (부딪히게)
      const baseM = mat('#ffffff', { roughness: 0.6 });
      for (const s of [-1, 1]) {
        const b = mesh(new THREE.BoxGeometry(0.6, 0.35, 0.6), baseM, s * AX, 0.175, AZ);
        scene.add(b);
        blockers.push({ x: s * AX, z: AZ, r: 0.45 + R });
      }
    }
    // ② 풍선 다발 — 화면판 양옆 기둥 위 · 무대 앞 양 모서리 (살랑살랑 흔들림)
    {
      const strM = new THREE.LineBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.8 });
      const bunch = (x, y, z, n, seed) => {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2 + seed;
          const bx = Math.cos(a) * 0.38, bz = Math.sin(a) * 0.3, by = 1.25 + ((i * 5 + seed * 3) % 4) * 0.16;
          const r = 0.3 + (i % 3) * 0.03;
          const m = balloonM.clone();
          m.color.set(PAL[(i + Math.round(seed * 3)) % PAL.length]);
          const bl = new THREE.Mesh(balloonGeo, m);
          bl.position.set(bx, by, bz);
          bl.scale.set(r, r * 1.15, r);
          g.add(bl);
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(bx, by - r * 1.1, bz)]);
          g.add(new THREE.Line(geo, strM));
        }
        scene.add(g);
        festive.bob.push({ g, ph: seed * 2.3 });
      };
      const scrX = STAGE.hw - 0.2;
      bunch(-scrX, STAGE.h + 3.1, STAGE.z + STAGE.hd - 0.2, 6, 0.4);
      bunch(scrX, STAGE.h + 3.1, STAGE.z + STAGE.hd - 0.2, 6, 1.3);
      bunch(-(STAGE.hw + 1.7), 0.9, STAGE.zf + 0.4, 7, 2.1);
      bunch(STAGE.hw + 1.7, 0.9, STAGE.zf + 0.4, 7, 2.9);
      // 입구 아치 양옆 바닥 — 큰 다발
      bunch(-(ARCH.hw + 1.5), 0.9, ENTRY_Z - 1.0, 9, 3.7);
      bunch(ARCH.hw + 1.5, 0.9, ENTRY_Z - 1.0, 9, 4.6);
      for (const sx of [-1, 1]) {
        const w2 = mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 10), mat('#ffffff', { roughness: 0.6 }), sx * (ARCH.hw + 1.5), 0.45, ENTRY_Z - 1.0);
        scene.add(w2);
        blockers.push({ x: sx * (ARCH.hw + 1.5), z: ENTRY_Z - 1.0, r: 0.3 + R });
      }
      for (const s of [-1, 1]) {
        const w = mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 10), mat('#ffffff', { roughness: 0.6 }), s * (STAGE.hw + 1.7), 0.45, STAGE.zf + 0.4);
        scene.add(w);
        blockers.push({ x: s * (STAGE.hw + 1.7), z: STAGE.zf + 0.4, r: 0.3 + R });
      }
    }
    // ③ 삼각 깃발 줄 + 전구 — 아치 위쪽에서 화면판 위로 (머리 위 4m 이상)
    {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.17, 0, 0, 0.17, 0, 0, 0, -0.42, 0], 3));
      tri.computeVertexNormals();
      const flagM = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
      const ropeM = new THREE.LineBasicMaterial({ color: '#3a3346' });
      const bulbGeo = new THREE.SphereGeometry(0.06, 8, 6);
      const bulbMs = ['#fff1b8', '#ffd27a', '#ffe9f2'].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2 }));
      festive.lights = bulbMs;
      const z0 = STAGE.zf - 1.25, z1 = STAGE.z + STAGE.hd - 0.25;
      const ropes = [
        // [시작점, 끝점, 처짐]
        [[-4.2, 4.9, z0], [-4.6, 4.2, z1], 0.35], [[4.2, 4.9, z0], [4.6, 4.2, z1], 0.35],
        [[-2.4, 5.25, z0], [2.4, 5.25, z0], 0.0],
        [[-5.4, 4.7, z0 + 0.05], [5.4, 4.7, z0 + 0.05], 0.55],
        [[-4.6, 4.35, z1], [4.6, 4.35, z1], 0.3],
        [[0, 5.4, z0], [0, 4.4, z1], 0.25],
        // 입구 — 아치 기둥 꼭대기에서 앞 배너로 · 앞마당 위로 두 줄만 (시야를 가리지 않게 높이)
        [[-ARCH.hw, ARCH.h + 0.1, ENTRY_Z - 0.3], [-ENT_BX, ENT_BH, ENTRY_Z - 3], 0.3], [[ARCH.hw, ARCH.h + 0.1, ENTRY_Z - 0.3], [ENT_BX, ENT_BH, ENTRY_Z - 3], 0.3],
        [[-ENT_BX, ENT_BH, ENTRY_Z - 3], [ENT_BX, ENT_BH, ENTRY_Z - 3], 0.35],
        [[-ENT_BX, ENT_BH, ENTRY_Z - 9], [ENT_BX, ENT_BH, ENTRY_Z - 9], 0.35],
      ];
      const flags = [];
      for (const [a, b, sag] of ropes) {
        const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
        const L = A.distanceTo(B);
        const n = Math.max(4, Math.round(L / 0.42));
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const p = A.clone().lerp(B, u);
          p.y -= Math.sin(Math.PI * u) * sag;
          pts.push(p);
        }
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ropeM));
        const dir = B.clone().sub(A).normalize();
        for (let i = 0; i < n; i++) {
          const p = pts[i].clone().lerp(pts[i + 1], 0.5);
          flags.push({ p, yaw: Math.atan2(-dir.z, dir.x) });
          festive.bulbs[i % 3].push([pts[i].x, pts[i].y - 0.05, pts[i].z, 1]);   // 전구는 모아서 한 번에 그림
        }
      }
      const inst = new THREE.InstancedMesh(tri, flagM, flags.length);
      flags.forEach((f, i) => {
        dummy.position.copy(f.p);
        dummy.rotation.set(0, f.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, col.set(PAL[i % 7]));
      });
      scene.add(inst);
    }
    // ④ 시상 꽃가루 — 시상 중에만 무대 위로 떨어짐
    {
      const n = LOW ? 160 : 320;
      const geo = new THREE.PlaneGeometry(0.09, 0.05);
      const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(geo, m, n);
      const parts = [];
      for (let i = 0; i < n; i++) {
        parts.push({ x: (Math.random() - 0.5) * 11, y: Math.random() * 6, z: STAGE.zf - 1.5 + Math.random() * 5.5, vy: 0.6 + Math.random() * 0.9, sp: 2 + Math.random() * 5, ph: Math.random() * 6.28 });
        inst.setColorAt(i, col.set(PAL[i % 7]));
      }
      inst.visible = false;
      inst.frustumCulled = false;
      scene.add(inst);
      festive.confetti = { inst, parts };
    }
    // ⑤ 크래커 꽃가루 — 종잇조각과 리본 (입자 묶음 하나로 여러 사람 것을 함께 그림)
    {
      const N = LOW ? 700 : 1600;
      const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), N);
      inst.frustumCulled = false;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) { inst.setMatrixAt(i, zero); inst.setColorAt(i, col.set('#ffffff')); }
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
      festive.fw = { inst, N, next: 0, parts: [] };
    }
    // ⑥ 입구 — 기둥 풍선 나선 · 현판 위 풍선 왕관 · 현판 테두리 전구 · 세로 배너 · 흩날리는 꽃가루
    {
      const pts = [];
      // 기둥을 감싸는 풍선 나선 (층마다 4개, 층이 올라갈수록 비틀림)
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 15; k++) {
          const y = 0.45 + k * 0.29;
          for (let j = 0; j < 4; j++) {
            const a = j * Math.PI / 2 + k * 0.45;
            pts.push({ x: sx * ARCH.hw + Math.cos(a) * 0.66, y, z: ENTRY_Z + Math.sin(a) * 0.66, r: 0.24, c: PAL[(k + j) % 7] });
          }
        }
      }
      // 현판 위 풍선 왕관 — 기둥 꼭대기 바깥에서 솟아올라 현판 위를 넘는 큰 아치
      const CX = ARCH.hw + 0.75, CY0 = ARCH.h + 0.2, CY = 2.9;
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI * i / 40;
        const x = Math.cos(a) * CX, y = CY0 + Math.sin(a) * CY;
        for (let k = 0; k < 3; k++) {
          const ang = k * 2.1 + i * 0.8;
          pts.push({ x, y: y + Math.sin(ang) * 0.2, z: ENTRY_Z - 0.1 + Math.cos(ang) * 0.22, r: 0.25 + ((i + k) % 3) * 0.02, c: PAL[(i + k * 3) % 7] });
        }
      }
      const inst = new THREE.InstancedMesh(balloonGeo, balloonM, pts.length);
      pts.forEach((q, i) => {
        dummy.position.set(q.x, q.y, q.z); dummy.rotation.set(0, 0, 0);
        dummy.scale.set(q.r, q.r * 1.12, q.r); dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, col.set(q.c));
      });
      scene.add(inst);
      // 현판 테두리 전구 (앞뒤 양면) — 깃발 줄 전구와 같이 반짝임
      const signW = ARCH.hw * 2 + 1.1, signH = 1.35, sy0 = ARCH.h + 0.14;
      const ring = [];
      const nx = Math.round(signW / 0.34), ny = Math.round(signH / 0.34);
      for (let i = 0; i <= nx; i++) { const x = -signW / 2 + signW * i / nx; ring.push([x, sy0], [x, sy0 + signH]); }
      for (let j = 1; j < ny; j++) { const y = sy0 + signH * j / ny; ring.push([-signW / 2, y], [signW / 2, y]); }
      ring.forEach(([x, y], i) => {
        for (const zf of [-0.27, 0.27]) festive.bulbs[i % 3].push([x, y, ENTRY_Z + zf, 1.25]);
      });
      // 세로 배너 — 입구로 오는 길 양옆 (펄럭)
      const WORDS = ['DEMO DAY', 'FESTIVAL', 'WELCOME'];
      const bannerTex = (c, word) => signTex(128, 512, (ctx, w, h) => {
        const grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, c); grd.addColorStop(1, new THREE.Color(c).lerp(new THREE.Color('#1d1a3a'), 0.35).getStyle());
        ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
        // 별 하나
        ctx.save(); ctx.translate(w / 2, h * 0.1); ctx.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 26, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fillStyle = '#fff3c4'; ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(w / 2, h * 0.58); ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${Math.round(w * 0.5)}px ${FONT}`;
        ctx.fillText(word, 0, 0);
        ctx.restore();
      });
      const poleM = mat('#2f3a4a', { roughness: 0.5, metalness: 0.4 });
      [-3, -6, -9].forEach((dz, k) => {
        for (const sx of [-1, 1]) {
          const x = sx * ENT_BX, z = ENTRY_Z + dz;
          const pole = mesh(new THREE.CylinderGeometry(0.045, 0.06, ENT_BH + 0.1, 8), poleM, x, (ENT_BH + 0.1) / 2, z);
          scene.add(pole);
          blockers.push({ x, z, r: 0.08 + R });
          const c = PAL[(k * 2 + (sx > 0 ? 1 : 0)) % 7];
          const bm = new THREE.MeshStandardMaterial({ map: bannerTex(c, WORDS[k % WORDS.length]), side: THREE.DoubleSide, roughness: 0.85, emissive: '#ffffff', emissiveIntensity: 0.08 });
          bm.emissiveMap = bm.map;
          const g = new THREE.Group();
          g.position.set(x, 0, z);
          // 앞뒤 두 장을 등 맞대 붙임 — 어느 쪽에서 봐도 글자가 바로 읽힘
          bm.side = THREE.FrontSide;
          const ban = new THREE.Group();
          const geo = new THREE.PlaneGeometry(0.62, 2.3, 1, 6);
          const f1 = new THREE.Mesh(geo, bm), f2 = new THREE.Mesh(geo, bm);
          f2.rotation.y = Math.PI;
          ban.add(f1, f2);
          ban.position.set(-sx * 0.36, ENT_BH - 1.3, 0);   // 통로 쪽으로 매달림
          ban.rotation.y = Math.PI / 2;
          g.add(ban);
          scene.add(g);
          festive.banners.push({ g, ph: k * 1.3 + sx });
        }
      });
      // 아치 주변에 늘 흩날리는 꽃가루 (조금만)
      const n = LOW ? 50 : 110;
      const dInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), n);
      dInst.frustumCulled = false;
      const dParts = [];
      for (let i = 0; i < n; i++) {
        dParts.push({ x: (Math.random() - 0.5) * 13, y: Math.random() * 7.5, z: ENTRY_Z - 4 + Math.random() * 6, vy: 0.35 + Math.random() * 0.45, sp: 1.5 + Math.random() * 3, ph: Math.random() * 6.28 });
        dInst.setColorAt(i, col.set(PAL[i % 7]));
      }
      scene.add(dInst);
      festive.drift = { inst: dInst, parts: dParts };
    }
    // 전구 — 색 세 가지마다 한 묶음 (따로 그리면 300번 가까이 그려서 느린 컴퓨터가 버거워함)
    {
      const geo = new THREE.SphereGeometry(0.06, 8, 6);
      festive.bulbs.forEach((list, k) => {
        if (!list.length) return;
        const inst = new THREE.InstancedMesh(geo, festive.lights[k], list.length);
        list.forEach(([x, y, z, sc], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(sc); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); });
        scene.add(inst);
      });
    }
    // 부드러운 빛용 그림 두 장 — 위로 사라지는 세로 그라데이션 · 동그란 후광
    {
      const fc = document.createElement('canvas'); fc.width = 4; fc.height = 128;
      const fx = fc.getContext('2d'), fg = fx.createLinearGradient(0, 0, 0, 128);
      fg.addColorStop(0, '#000'); fg.addColorStop(0.55, '#666'); fg.addColorStop(0.9, '#fff'); fg.addColorStop(1, '#000');   // 위(0)는 투명 · 아래 입구 쪽이 밝음
      fx.fillStyle = fg; fx.fillRect(0, 0, 4, 128);
      festive.fadeTex = new THREE.CanvasTexture(fc);
      const hc = document.createElement('canvas'); hc.width = hc.height = 128;
      const hx = hc.getContext('2d'), hg = hx.createRadialGradient(64, 64, 0, 64, 64, 64);
      hg.addColorStop(0, 'rgba(255,255,255,1)'); hg.addColorStop(0.35, 'rgba(255,255,255,.45)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      hx.fillStyle = hg; hx.fillRect(0, 0, 128, 128);
      festive.haloTex = new THREE.CanvasTexture(hc);
    }
    // ⑦ 시상대 — 1·2·3등 단상과 선물 상자 (누르면 상품 공개, 내 화면에서만 · 메시지 안 씀)
    {
      const PRIZES = [
        { rank: 1, amount: '20,000원', wrap: '#f4c542', ribbon: '#e0413a', h: 0.62, size: 0.58 },
        { rank: 2, amount: '15,000원', wrap: '#d5dbe3', ribbon: '#3f7fd8', h: 0.44, size: 0.52 },
        { rank: 3, amount: '10,000원', wrap: '#d6905a', ribbon: '#3fa86a', h: 0.30, size: 0.48 },
      ];
      festive.PRIZES = PRIZES;
      // 연설대(x 4.1) 반대편. 관람석에서 보면 왼쪽부터 2 · 1 · 3 (관람석은 +z 를 보므로 +x 가 화면 왼쪽)
      const PX = -2.9, PZ = STAGE.z + 1.2, GAP = 1.12;
      const xs = { 1: PX, 2: PX + GAP, 3: PX - GAP };
      const podTex = (pz) => signTex(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#fbf8f2'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = pz.wrap; ctx.fillRect(0, 0, w, h * 0.16);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = pz.rank === 1 ? '#c99a17' : pz.rank === 2 ? '#7c8796' : '#a4602e';
        ctx.font = `900 ${Math.round(h * 0.62)}px ${FONT}`;
        ctx.fillText(String(pz.rank), w / 2, h * 0.6);
      });
      const podTop = (c) => mat(c, { roughness: 0.5, metalness: 0.25 });
      festive.gifts = [];
      for (const pz of PRIZES) {
        const x = xs[pz.rank];
        const fM = new THREE.MeshStandardMaterial({ map: podTex(pz), roughness: 0.7 });
        const pod = faceBox(GAP - 0.04, pz.h, 0.9, mat('#fbf8f2', { roughness: 0.7 }), { 4: fM, 2: podTop(pz.wrap) });
        pod.position.set(x, STAGE.h + pz.h / 2, PZ);
        pod.rotation.y = Math.PI;                 // 숫자 면이 관람석(−z) 쪽
        pod.castShadow = pod.receiveShadow = true;
        scene.add(pod);
        // 선물 상자 — 몸통 + 뚜껑(따로 움직임) + 리본 십자 + 나비 리본
        const g = new THREE.Group();
        g.position.set(x, STAGE.h + pz.h, PZ);
        const S = pz.size, wrapM = mat(pz.wrap, { roughness: 0.35, metalness: pz.rank === 1 ? 0.35 : 0.2 }), ribM = mat(pz.ribbon, { roughness: 0.45 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(S, S * 0.78, S), wrapM);
        body.position.y = S * 0.39;
        const rb1 = new THREE.Mesh(new THREE.BoxGeometry(S * 1.01, S * 0.79, S * 0.16), ribM); rb1.position.y = S * 0.39;
        const rb2 = new THREE.Mesh(new THREE.BoxGeometry(S * 0.16, S * 0.79, S * 1.01), ribM); rb2.position.y = S * 0.39;
        const lid = new THREE.Group();
        lid.position.y = S * 0.78;
        const lidBox = new THREE.Mesh(new THREE.BoxGeometry(S * 1.08, S * 0.2, S * 1.08), wrapM); lidBox.position.y = S * 0.1;
        const lr1 = new THREE.Mesh(new THREE.BoxGeometry(S * 1.09, S * 0.21, S * 0.16), ribM); lr1.position.y = S * 0.1;
        const lr2 = new THREE.Mesh(new THREE.BoxGeometry(S * 0.16, S * 0.21, S * 1.09), ribM); lr2.position.y = S * 0.1;
        const bowGeo = new THREE.TorusGeometry(S * 0.16, S * 0.05, 8, 18);
        const bowA = new THREE.Mesh(bowGeo, ribM); bowA.position.set(-S * 0.14, S * 0.3, 0); bowA.rotation.set(0, Math.PI / 2, 0.5);
        const bowB = new THREE.Mesh(bowGeo, ribM); bowB.position.set(S * 0.14, S * 0.3, 0); bowB.rotation.set(0, Math.PI / 2, -0.5);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(S * 0.07, 10, 8), ribM); knot.position.y = S * 0.28;
        lid.add(lidBox, lr1, lr2, bowA, bowB, knot);
        g.add(body, rb1, rb2, lid);
        g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.userData = { kind: 'gift', rank: pz.rank }; clickables.push(m); } });
        scene.add(g);
        // 빛기둥 (열릴 때만)
        // 빛 — 짧은 깔때기(위로 퍼지며 부드럽게 사라짐) + 상자 입구의 동그란 후광
        const glowC = pz.rank === 1 ? '#ffe7a0' : pz.rank === 2 ? '#e6f0ff' : '#ffd2b0';
        const beam = new THREE.Group();
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(S * 1.05, S * 0.32, 1.4, 28, 1, true),
          new THREE.MeshBasicMaterial({ color: glowC, alphaMap: festive.fadeTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        cone.position.y = 0.7;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: festive.haloTex, color: glowC, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.position.y = 0.12;
        beam.add(cone, halo);
        beam.userData = { cone, halo };
        beam.position.set(x, STAGE.h + pz.h + S * 0.8, PZ);
        beam.visible = false;
        scene.add(beam);
        festive.gifts.push({ pz, g, lid, beam, S, x, z: PZ, top: STAGE.h + pz.h + S * 0.8, t: -1, wig: Math.random() * 4 });
      }
      // 단상 셋을 한 덩어리로 막음 — 따로 겹쳐 막으면 틈에서 서로 반대로 밀어 흔들리고, 화면판 뒤로 새어 나감
      boxBlock(PX, PZ, GAP * 1.5 + R, 0.45 + R, 0);
      // 상자 위로 피어오르는 반짝이 (눌러 보고 싶게)
      const n = 36;
      const sp = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color: '#fff1a8', toneMapped: false }), n);
      sp.frustumCulled = false;
      const sparks = Array.from({ length: n }, (_, i) => ({ k: i % 3, ph: Math.random() * 3, r: 0.15 + Math.random() * 0.25, a: Math.random() * 6.28 }));
      scene.add(sp);
      festive.giftSparks = { sp, sparks };
    }
    function openGift(rank) {
      const gi = festive.gifts.find((q) => q.pz.rank === rank);
      if (!gi || gi.t >= 0 || $('#prize').classList.contains('show')) return;
      ensureAudio();
      gi.t = 0;
      gi.popped = false;
    }
    festive.openGift = openGift;
    function showPrize(pz) {
      const box = $('#prize');
      box.dataset.rank = String(pz.rank);
      $('#prize-rank').textContent = `${pz.rank}등`;
      $('#prize-title').textContent = `🏆 ${pz.rank}등 팀 선물`;
      $('#prize-amount').textContent = `문화상품권 ${pz.amount}`;
      $('#prize-sub').textContent = `데모데이 시상에서 ${pz.rank}등 팀에게 드려요 🎉`;
      box.classList.add('show');
      $('#prize-ok').focus();
    }
    function updateGifts(t, dt) {
      const open = $('#prize').classList.contains('show');
      for (const gi of festive.gifts) {
        if (gi.t < 0) {
          // 가만히 있을 때 — 몇 초마다 한 번씩 통통 (눌러 보라는 신호)
          gi.wig += dt;
          const w = gi.wig % 4.5;
          const hop = w < 0.5 ? Math.sin(w / 0.5 * Math.PI) : 0;
          gi.g.position.y = gi.top - gi.S * 0.8 + hop * 0.06;
          gi.g.rotation.z = w < 0.5 ? Math.sin(w * 40) * 0.04 * hop : 0;
          gi.lid.position.y = gi.S * 0.78; gi.lid.rotation.set(0, 0, 0);
          continue;
        }
        gi.t += dt;
        const tt = gi.t;
        if (tt < 0.65) {                                 // 들썩들썩 — 점점 세게
          const k = tt / 0.65;
          gi.g.rotation.z = Math.sin(tt * 38) * 0.09 * k;
          gi.g.position.y = gi.top - gi.S * 0.8 + Math.abs(Math.sin(tt * 19)) * 0.05 * k;
        } else {
          gi.g.rotation.z = 0;
          gi.g.position.y = gi.top - gi.S * 0.8;
          if (!gi.popped) {                              // 펑! 뚜껑 · 빛기둥 · 금가루 · 팡파르
            gi.popped = true;
            popConfetti(new THREE.Vector3(gi.x, gi.top + 0.1, gi.z), new THREE.Vector3(0, 1, 0), gi.pz.rank === 1 ? 0 : gi.pz.rank === 2 ? 1 : 3);
            festive.later.push({ t: 0.18, fn: () => popConfetti(new THREE.Vector3(gi.x, gi.top + 0.3, gi.z), new THREE.Vector3(0, 1, 0), 2) });
            gi.beam.visible = true;
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.11, i === 3 ? 1.3 : 0.45, i * 0.12));
            tone(1318.5, 0.06, 1.4, 0.5);
            festive.later.push({ t: 0.9, fn: () => showPrize(gi.pz) });
          }
          const o = tt - 0.65;
          // 뚜껑은 튀어 올랐다가 상자 위에 둥둥 떠서 빙글빙글
          gi.lid.position.y = gi.S * 0.78 + Math.min(1, o * 4) * 0.75 + Math.sin(o * 3) * 0.05;
          gi.lid.rotation.set(Math.min(1, o * 4) * 0.5, o * 2.2, 0);
          const glow = Math.min(1, o * 3) * (open || o < 1.2 ? 1 : 0.5);
          gi.beam.userData.cone.material.opacity = 0.5 * glow;
          gi.beam.userData.cone.scale.set(1, 0.6 + 0.4 * Math.min(1, o * 2.5), 1);
          gi.beam.rotation.y = o * 0.8;
          const hs = gi.S * (2.6 + Math.sin(o * 5) * 0.25);
          gi.beam.userData.halo.scale.set(hs, hs, 1);
          gi.beam.userData.halo.material.opacity = 0.75 * glow;
          // 카드를 닫고 2초 지나면 다시 처음 상태로
          if (!open && o > 1.2) {
            gi.closeT = (gi.closeT || 0) + dt;
            if (gi.closeT > 2) { gi.t = -1; gi.closeT = 0; gi.beam.visible = false; gi.beam.userData.cone.material.opacity = 0; gi.beam.userData.halo.material.opacity = 0; }
          } else gi.closeT = 0;
        }
      }
      const { sp, sparks } = festive.giftSparks;
      sparks.forEach((q, i) => {
        const gi = festive.gifts[q.k];
        const life = (t * 0.45 + q.ph) % 1;
        const a = q.a + t * 0.6;
        dummy.position.set(gi.x + Math.cos(a) * q.r, gi.top + 0.05 + life * 0.9, gi.z + Math.sin(a) * q.r);
        dummy.rotation.set(t * 2 + i, t * 3, 0);
        dummy.scale.setScalar(Math.sin(life * Math.PI) * (gi.t >= 0 ? 1.8 : 1));
        dummy.updateMatrix();
        sp.setMatrixAt(i, dummy.matrix);
      });
      sp.instanceMatrix.needsUpdate = true;
    }
    festive.update = (t, dt) => {
      updateGifts(t, dt);
      const fw = festive.fw;
      for (const b of festive.banners) b.g.rotation.y = Math.sin(t * 1.6 + b.ph) * 0.18;
      {
        const dr = festive.drift;
        dr.parts.forEach((p, i) => {
          p.y -= p.vy * dt;
          if (p.y < 0.05) { p.y = 6.5 + Math.random() * 1.5; p.x = (Math.random() - 0.5) * 13; }
          dummy.position.set(p.x + Math.sin(t * 0.9 + p.ph) * 0.35, p.y, p.z + Math.cos(t * 0.7 + p.ph) * 0.2);
          dummy.rotation.set(t * p.sp + p.ph, t * p.sp * 0.7, p.ph);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          dr.inst.setMatrixAt(i, dummy.matrix);
        });
        dr.inst.instanceMatrix.needsUpdate = true;
      }
      // 조금 뒤에 이어지는 효과 (금가루)
      for (let k = festive.later.length - 1; k >= 0; k--) {
        const L = festive.later[k];
        L.t -= dt;
        if (L.t <= 0) { festive.later.splice(k, 1); L.fn(); }
      }
      // 섬광은 0.25초 · 빛 고리는 0.5초 동안 커지며 사라짐
      for (let k = festive.flashes.length - 1; k >= 0; k--) {
        const f = festive.flashes[k];
        f.age += dt;
        f.flash.scale.setScalar(0.25 + f.age * 3.2);
        f.flash.material.opacity = Math.max(0, 0.45 * (1 - f.age / 0.2));
        f.ring.scale.setScalar(0.4 + f.age * 7);
        f.ring.material.opacity = Math.max(0, 0.55 * (1 - f.age / 0.5));
        if (f.age > 0.5) {
          scene.remove(f.flash, f.ring);
          f.flash.material.dispose(); f.ring.material.dispose();
          festive.flashes.splice(k, 1);
        }
      }
      if (fw.parts.length) {
        for (let k = fw.parts.length - 1; k >= 0; k--) {
          const p = fw.parts[k];
          p.age += dt;
          // 처음엔 빠르게 튀어 나가고, 공기에 막혀 금방 느려진 뒤 팔랑이며 내려옴
          const drag = Math.exp(-3.2 * dt);
          p.vx *= drag; p.vz *= drag; p.vy = p.vy * drag - 1.7 * dt;
          if (p.vy < -0.9) p.vy = -0.9;
          const flut = p.age > 0.5 ? Math.sin(p.age * 3 + p.ph) * 0.35 : 0;
          p.x += (p.vx + flut) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const groundY = standY(p.x, p.z) + 0.02;
          if (p.y < groundY) { p.y = groundY; p.vx = p.vz = 0; }
          if (p.age > p.life) { fw.parts.splice(k, 1); dummy.scale.set(0, 0, 0); }
          else {
            const fade = 1 - smooth(p.life - 0.5, p.life, p.age);
            if (p.kind === 'ribbon') dummy.scale.set(0.32 * fade, 7 * fade, 1);
            else if (p.kind === 'glitter') dummy.scale.setScalar(0.55 * fade * (0.4 + 0.6 * Math.abs(Math.sin(p.age * 18 + p.ph))));   // 반짝반짝
            else dummy.scale.setScalar(1.15 * fade);
            dummy.rotation.set(p.rx + p.age * p.sp, p.ry + p.age * p.sp * 0.6, p.kind === 'ribbon' ? Math.sin(p.age * 6 + p.ph) * 0.8 : 0);
          }
          dummy.position.set(p.x, p.y, p.z); dummy.updateMatrix();
          fw.inst.setMatrixAt(p.i, dummy.matrix);
        }
        fw.inst.instanceMatrix.needsUpdate = true;
      }
      for (const b of festive.bob) { b.g.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.05; b.g.rotation.x = Math.cos(t * 0.7 + b.ph) * 0.04; }
      festive.lights.forEach((m, i) => { m.emissiveIntensity = 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.2 + i * 2.1)); });
      const c = festive.confetti;
      const on = !!award.team;
      if (on !== c.inst.visible) c.inst.visible = on;
      if (!on) return;
      c.parts.forEach((p, i) => {
        p.y -= p.vy * dt;
        if (p.y < STAGE.h * 0.5) { p.y = 5.5 + Math.random(); p.x = (Math.random() - 0.5) * 11; }
        dummy.position.set(p.x + Math.sin(t * 1.3 + p.ph) * 0.25, p.y, p.z);
        dummy.rotation.set(t * p.sp + p.ph, t * p.sp * 0.7, p.ph);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        c.inst.setMatrixAt(i, dummy.matrix);
      });
      c.inst.instanceMatrix.needsUpdate = true;
    };
  }

  // ------------------------------------------------------------------
  // 둘레 — 산울타리 · 나무 · 벤치 · 가로등 · 화분 (분위기만, 가볍게)
  // ------------------------------------------------------------------
  // 산울타리 — 광장 둘레 + 입구 아치 양옆 (아치로만 드나듦)
  {
    const hedgeM = matT('grass', { repeat: 1, color: '#7fa86a', normalScale: 1.4 });
    const H = 0.95;
    const runs = [
      [PLAZA.x0, PLAZA.z0, PLAZA.x1, PLAZA.z0], [PLAZA.x0, PLAZA.z1, PLAZA.x1, PLAZA.z1],
      [PLAZA.x0, PLAZA.z0, PLAZA.x0, PLAZA.z1], [PLAZA.x1, PLAZA.z0, PLAZA.x1, PLAZA.z1],
      [PLAZA.x0, ENTRY_Z, -ARCH.hw - 0.45, ENTRY_Z], [ARCH.hw + 0.45, ENTRY_Z, PLAZA.x1, ENTRY_Z],
    ];
    for (const [x0, z0, x1, z1] of runs) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const hz = mesh(new THREE.BoxGeometry(L + 0.7, H, 0.7), hedgeM, (x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      if (Math.abs(x1 - x0) < 0.01) hz.rotation.y = Math.PI / 2;
      hz.castShadow = hz.receiveShadow = true;
      scene.add(hz);
    }
    // 아치 양옆 울타리만 막습니다 (둘레는 pushOut 경계가 막음)
    boxBlock((PLAZA.x0 + -ARCH.hw - 0.45) / 2, ENTRY_Z, (-ARCH.hw - 0.45 - PLAZA.x0) / 2, 0.35 + R, 0);
    boxBlock((PLAZA.x1 + ARCH.hw + 0.45) / 2, ENTRY_Z, (PLAZA.x1 - ARCH.hw - 0.45) / 2, 0.35 + R, 0);
  }
  // 나무 — 광장 밖 잔디 언덕에 (바닷가 해송과 같은 '잎 뭉치' 방식, 잎은 둥글고 밝게)
  {
    const clumps = (list) => {
      const parts = list.map(([x, y, z, sx, sy, sz]) => {
        const g = new THREE.IcosahedronGeometry(1, 1);   // 이미 면마다 따로인 지오메트리
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const k = 0.85 + hash2(Math.round(p.getX(i) * 50) + x * 7, Math.round(p.getZ(i) * 50) + z * 5) * 0.3;
          p.setXYZ(i, p.getX(i) * sx * k + x, p.getY(i) * sy * k + y, p.getZ(i) * sz * k + z);
        }
        return g;
      });
      const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
      const pos = new Float32Array(n * 3);
      let o = 0;
      for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    };
    const canopy = clumps([[0, 4.4, 0, 1.9, 1.5, 1.9], [1.2, 3.7, 0.5, 1.3, 1.1, 1.3], [-1.1, 3.8, -0.4, 1.3, 1.1, 1.2], [0.2, 5.4, -0.3, 1.2, 1.0, 1.2]]);
    const trunkG = new THREE.CylinderGeometry(0.16, 0.3, 4.2, 7);
    trunkG.translate(0, 2.0, 0);
    const spots = [];
    const r = seeded(19);
    let guard = 0;
    while (spots.length < (LOW ? 90 : 160) && guard++ < 6000) {
      const x = (r() - 0.5) * 220, z = PCZ + (r() - 0.5) * 220;
      const d = outside(x, z);
      if (d < 3.5) continue;
      if (z < PLAZA.z0 - 2 && Math.abs(x) < 14 && d < 30) continue;    // 입구 앞은 탁 트이게
      if (d > 30 && r() < 0.5) continue;
      spots.push({ x, z, y: terrainY(x, z), s: 0.75 + r() * 0.6, ry: r() * 6.28, lx: (r() - 0.5) * 0.12, lz: (r() - 0.5) * 0.12, tint: r() });
    }
    const n = spots.length;
    const leafM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, envMapIntensity: 0.1, flatShading: true });
    const leaf = new THREE.InstancedMesh(canopy, leafM, n);
    const trunk = new THREE.InstancedMesh(trunkG, matT('bark', { repeat: 1, color: '#7a6450' }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), eu = new THREE.Euler();
    spots.forEach((t, i) => {
      p.set(t.x, t.y - 0.1, t.z);
      q.setFromEuler(eu.set(t.lx, t.ry, t.lz));
      sv.setScalar(t.s);
      m4.compose(p, q, sv);
      leaf.setMatrixAt(i, m4); trunk.setMatrixAt(i, m4);
      c.set('#5d8f4a').lerp(new THREE.Color(t.tint > 0.85 ? '#c9a24a' : '#79a858'), t.tint);
      leaf.setColorAt(i, c);
    });
    leaf.castShadow = trunk.castShadow = true;
    scene.add(leaf, trunk);
  }
  // 벤치 — 입구 앞마당 둘 · 무대 앞 관람석 넷. 앉을 수 있습니다 (seat.off = 좌석 높이 0.48 − 0.42)
  const seats = [];
  function addBench(x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const woodM = matT('wood', { repeat: 1, color: '#c08a5c' });
    const ironM = mat('#2f3a4a', { roughness: 0.5, metalness: 0.5 });
    const seat = mesh(new THREE.BoxGeometry(1.8, 0.07, 0.46), woodM, 0, 0.45, 0);
    const back = mesh(new THREE.BoxGeometry(1.8, 0.36, 0.06), woodM, 0, 0.74, -0.22);
    back.rotation.x = -0.12;
    g.add(seat, back);
    for (const sx of [-0.78, 0.78]) {
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.42, 0.42), ironM, sx, 0.21, 0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.5, 0.05), ironM, sx, 0.7, -0.22));
    }
    shadowAll(g);
    scene.add(g);
    boxBlock(x, z, 0.9 + 0.2, 0.25 + 0.2, ry);
    const list = [-0.45, 0.45].map((lx) => { const w = toWorld(x, z, ry, lx, 0.02); return { x: w.x, z: w.z, ry, off: 0.48 - 0.42, kind: 'bench' }; });
    seats.push(...list);
    seat.userData = back.userData = { kind: 'seat', seats: list };
    clickables.push(seat, back);
  }
  addBench(-7.5, ENTRY_Z - 5, Math.PI / 2);
  addBench(7.5, ENTRY_Z - 5, -Math.PI / 2);
  // 관람석 — 무대 앞 5줄 × 4석 = 20석 (가운데 통로 2.4m). 모두 무대(+z)를 봅니다. 앉기 높이 off = 좌석 0.46 − 0.42
  const CHAIR_X = [-2.6, -1.6, 1.6, 2.6], CHAIR_ROWS = 5, CHAIR_DZ = 1.15;
  const CHAIR_Z0 = STAGE.zf - 0.9 - 2.4;                 // 맨 앞줄 (계단에서 2.4m)
  const CHAIR_BACK = CHAIR_Z0 - (CHAIR_ROWS - 1) * CHAIR_DZ;
  const chairs = [];
  {
    for (let r = 0; r < CHAIR_ROWS; r++) for (const x of CHAIR_X) chairs.push({ i: chairs.length, row: r, x, z: CHAIR_Z0 - r * CHAIR_DZ, ry: 0, off: 0.46 - 0.42, kind: 'chair' });
    const n = chairs.length;
    const seatI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, 0.07, 0.46), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), n);
    const backI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, 0.4, 0.05), seatI.material, n);
    const legI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.43, 0.42), mat('#2f3a4a', { roughness: 0.5, metalness: 0.5 }), n * 2);
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), white = new THREE.Color('#ffffff');
    chairs.forEach((c, k) => {
      m4.makeTranslation(c.x, 0.43, c.z); seatI.setMatrixAt(k, m4);
      m4.makeTranslation(c.x, 0.68, c.z - 0.21); backI.setMatrixAt(k, m4);
      m4.makeTranslation(c.x - 0.22, 0.215, c.z); legI.setMatrixAt(k * 2, m4);
      m4.makeTranslation(c.x + 0.22, 0.215, c.z); legI.setMatrixAt(k * 2 + 1, m4);
      col.set(BOOTH_COLORS[c.row % BOOTH_COLORS.length]).lerp(white, 0.2);
      seatI.setColorAt(k, col); backI.setColorAt(k, col);
    });
    seatI.castShadow = backI.castShadow = legI.castShadow = true;
    seatI.receiveShadow = true;
    seatI.userData = { kind: 'chair' };
    backI.userData = { kind: 'chair' };
    clickables.push(seatI, backI);
    scene.add(seatI, backI, legI);
    // 한 줄의 왼쪽 두 석 · 오른쪽 두 석을 상자 하나씩으로 (원을 늘어놓으면 틈으로 샘)
    for (let r = 0; r < CHAIR_ROWS; r++) {
      const z = CHAIR_Z0 - r * CHAIR_DZ - 0.03;
      boxBlock(-2.1, z, 0.74 + 0.2, 0.26 + 0.15, 0);
      boxBlock(2.1, z, 0.74 + 0.2, 0.26 + 0.15, 0);
    }
  }
  // 가로등 · 화분 — 부스 사이 틈마다 (통로 가장자리)
  const lamps = [];
  {
    const postM = mat('#2f3a4a', { roughness: 0.5, metalness: 0.5 });
    const potM = mat('#d9cfc2', { roughness: 0.9 });
    const leafM = mat('#5f8f4c', { roughness: 1, flatShading: true });
    const spots = [];
    for (const side of [1, -1]) {
      const zs = BOOTHS.filter((b) => b.side === side).map((b) => b.z).sort((a, b) => a - b);
      for (let i = 0; i < zs.length; i++) {
        if (i < zs.length - 1) spots.push({ side, z: (zs[i] + zs[i + 1]) / 2, lamp: true });
        if (i === 0) spots.push({ side, z: zs[0] - BOOTH_W / 2 - 0.5, first: true });   // 줄 맨 앞 (화분 없이 등만)
      }
    }
    for (const s of spots) {
      const lx = s.side * (AISLE_HALF + 0.35);
      const post = mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 8), postM, lx, 1.6, s.z);
      const head = mesh(new THREE.SphereGeometry(0.17, 14, 10), mat('#fff6e2', { emissive: '#ffd9a0', emissiveIntensity: 0.35, roughness: 0.4 }), lx, 3.32, s.z);
      const cap = mesh(new THREE.ConeGeometry(0.22, 0.14, 12), postM, lx, 3.5, s.z);
      // 가로등에 매단 작은 깃발 (양쪽 부스 색)
      const near = BOOTHS.filter((b) => b.side === s.side).sort((a, b) => Math.abs(a.z - s.z) - Math.abs(b.z - s.z))[0];
      const flag = mesh(new THREE.PlaneGeometry(0.42, 0.9), mat(near ? near.color : '#e8c477', { side: THREE.DoubleSide, roughness: 0.9 }), lx - s.side * 0.24, 2.5, s.z);
      flag.rotation.y = Math.PI / 2;
      post.castShadow = flag.castShadow = true;
      scene.add(post, head, cap, flag);
      blockers.push({ x: lx, z: s.z, r: 0.07 + R });
      lamps.push({ head, flag });
      // 화분 — 등 뒤 부스 사이 틈 (줄 맨 앞은 부스 뒤 산책길 입구라 비워 둠)
      if (s.first) continue;
      const px2 = s.side * (AISLE_HALF + BOOTH_D - 0.7);
      const pot = mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.55, 14), potM, px2, 0.275, s.z);
      const bush = mesh(new THREE.IcosahedronGeometry(0.62, 1), leafM, px2, 0.95, s.z);
      bush.scale.set(1, 0.95, 1);
      pot.castShadow = bush.castShadow = true;
      scene.add(pot, bush);
      blockers.push({ x: px2, z: s.z, r: 0.42 + R });
    }
  }

  // ------------------------------------------------------------------
  // 아바타 — 머리 · 몸통 · 팔(어깨/팔꿈치) · 다리(엉덩이/무릎)를 갖춘 3.5등신
  // ------------------------------------------------------------------
  const SKIN = ['#f7d5b8', '#efbf9d', '#dda67c', '#c6895e'];
  const HAIRC = ['#241d1a', '#3b2a21', '#54382a', '#17151c'];
  function makeAvatar(color, name, opts = {}) {
    const h = hashStr(String(name || 'guest'));
    const root = new THREE.Group();
    const inner = new THREE.Group();   // 앉기 · 눕기 보정
    root.add(inner);
    const body = new THREE.Group();    // 걸음 흔들림
    inner.add(body);

    const base = new THREE.Color(color);
    // 사람은 반사를 거의 안 하도록(envMapIntensity 낮게) 해야 머리카락이 하얗게 뜨지 않습니다.
    const mSkin = new THREE.MeshStandardMaterial({ color: opts.skin || SKIN[h % SKIN.length], roughness: 0.88, envMapIntensity: 0.12 });
    // (h >> 3) 은 값이 크면 음수가 되어 색을 못 찾습니다. 부호 없는 >>> 를 써야 합니다.
    const mHair = new THREE.MeshStandardMaterial({ color: opts.hairColor || HAIRC[(h >>> 3) % HAIRC.length], roughness: 0.84, envMapIntensity: 0.1 });
    const mTop = new THREE.MeshStandardMaterial({ color: base, roughness: 0.92, envMapIntensity: 0.1 });
    const mSash = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.45), roughness: 0.9, envMapIntensity: 0.1 });
    const mPant = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#2b2a3c'), 0.86), roughness: 0.94, envMapIntensity: 0.08 });
    const mShoe = new THREE.MeshStandardMaterial({ color: '#2a2435', roughness: 0.78, envMapIntensity: 0.12 });
    const mEye = new THREE.MeshBasicMaterial({ color: '#2a2335' });
    // 불멍: 눈 반짝임은 빛을 받는 재질로 — 스스로 빛나는 흰색은 어두운 밤 얼굴에서 눈만 번쩍여 무서워 보였음
    const mGlint = new THREE.MeshStandardMaterial({ color: '#f4f0ea', roughness: 0.3, envMapIntensity: 0 });

    // 다리
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.13, 0.72, 0);
      hip.add(mesh(new THREE.CapsuleGeometry(0.115, 0.2, 4, 10), mPant, 0, -0.17, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.34;
      knee.add(mesh(new THREE.CapsuleGeometry(0.1, 0.18, 4, 10), mPant, 0, -0.14, 0));
      const shoe = mesh(new THREE.BoxGeometry(0.19, 0.12, 0.3), mShoe, 0, -0.29, 0.05);
      knee.add(shoe);
      hip.add(knee);
      body.add(hip);
      legs.push({ hip, knee, shoe });
    }

    // 상체 (허리에서 꺾이도록 그룹으로)
    const upper = new THREE.Group();
    upper.position.y = 0.72;
    body.add(upper);
    const torso = mesh(new THREE.CapsuleGeometry(0.235, 0.3, 5, 14), mTop, 0, 0.3, 0);
    torso.scale.z = 0.84;
    upper.add(torso);
    // 목과 옷깃
    upper.add(mesh(new THREE.CylinderGeometry(0.082, 0.092, 0.14, 10), mSkin, 0, 0.64, 0));
    const collar = mesh(new THREE.TorusGeometry(0.125, 0.032, 8, 18), mSash, 0, 0.6, 0);
    collar.rotation.x = Math.PI / 2;
    upper.add(collar);
    // 앞섶 — 옷에 바느질 선 하나만 넣어도 '옷'으로 읽힙니다.
    const placket = mesh(new THREE.BoxGeometry(0.055, 0.4, 0.03), mSash, 0, 0.34, 0.185);
    placket.scale.z = 0.9;
    upper.add(placket);

    // 팔
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.26, 0.52, 0);
      sh.add(mesh(new THREE.CapsuleGeometry(0.082, 0.17, 4, 10), mTop, 0, -0.13, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      elbow.add(mesh(new THREE.CapsuleGeometry(0.072, 0.14, 4, 10), mSkin, 0, -0.11, 0));
      elbow.add(mesh(new THREE.SphereGeometry(0.085, 10, 8), mSkin, 0, -0.24, 0));
      sh.add(elbow);
      upper.add(sh);
      arms.push({ sh, elbow });
    }

    // 머리
    const head = new THREE.Group();
    head.position.y = 0.91;
    upper.add(head);
    const skull = mesh(new THREE.SphereGeometry(0.26, 26, 20), mSkin);
    skull.scale.set(1, 1.03, 0.97);
    head.add(skull);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.055, 10, 8), mSkin, s * 0.252, -0.01, 0);
      ear.scale.set(0.55, 1, 0.8);
      head.add(ear);
    }
    // 머리 — 뒤통수를 덮는 모자 하나가 아니라, 이마선 + 앞머리 몇 가닥으로 나눠 만듭니다.
    // (그래야 눈과 머리가 따로 놀지 않습니다)
    const style = opts.hair !== undefined ? opts.hair : h % 4;
    const cap = mesh(new THREE.SphereGeometry(0.272, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), mHair, 0, 0.028, -0.022);
    cap.scale.set(1, 1.02, 1.04);
    head.add(cap);
    // 앞머리 — 이마를 살짝 덮는 한 장 (덩어리를 여러 개 얹으면 울퉁불퉁해 보입니다)
    if (style !== 3) {
      // 앞머리 — 한쪽을 조금 더 길게 해서 가르마를 만듭니다
      const side2 = (h >>> 5) % 2 ? 1 : -1;
      const fringe2 = mesh(new THREE.SphereGeometry(0.232, 20, 15, 0, Math.PI * 2, 0, Math.PI * 0.5), mHair, side2 * 0.022, 0.062, 0.05);
      fringe2.scale.set(1.06, 0.56, 1.0);
      fringe2.rotation.set(0.46, 0, side2 * 0.16);
      head.add(fringe2);
      // 뒤통수 볼륨
      const back = mesh(new THREE.SphereGeometry(0.2, 16, 12), mHair, 0, 0.03, -0.14);
      back.scale.set(1.12, 0.95, 0.85);
      head.add(back);
    }
    // 구레나룻 — 귀 앞을 살짝 덮어 얼굴선을 잡아 줍니다
    //   동그란 점이면 옆모습에서 눈동자처럼 보여서, 머리선에서 귀 앞으로 내려오는 가는 띠로 만듭니다
    for (const s of [-1, 1]) {
      const burn = mesh(new THREE.CapsuleGeometry(0.026, 0.1, 4, 8), mHair, s * 0.222, 0.06, 0.035);
      burn.scale.set(0.55, 1, 1.5);
      burn.rotation.x = 0.12;
      head.add(burn);
    }
    if (style === 0) for (const s of [-1, 1]) {          // 단발
      const side = mesh(new THREE.SphereGeometry(0.135, 14, 12), mHair, s * 0.2, -0.07, -0.04);
      side.scale.set(0.6, 1.35, 1);
      head.add(side);
    }
    if (style === 2) {                                    // 묶은 머리
      const bun = mesh(new THREE.SphereGeometry(0.125, 14, 12), mHair, 0, 0.12, -0.26);
      head.add(bun);
      const tie = mesh(new THREE.TorusGeometry(0.075, 0.022, 6, 14), mTop, 0, 0.05, -0.23);
      tie.rotation.x = 1.2;
      head.add(tie);
    }
    if (style === 3) {                                    // 모자 — 머리를 완전히 덮고, 챙은 어깨보다 좁게
      const hatM = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#40394e'), 0.62), roughness: 0.92, envMapIntensity: 0.1 });
      // 이마 위까지만 덮습니다 (예전엔 눈 높이까지 내려와 눈이 가려졌음)
      const crown = mesh(new THREE.SphereGeometry(0.29, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hatM, 0, 0.085, -0.02);
      crown.scale.set(1, 0.95, 1.02);
      head.add(crown);
      const band = mesh(new THREE.CylinderGeometry(0.292, 0.292, 0.06, 20), mat('#8d7a5e', { roughness: 0.9 }), 0, 0.11, -0.02);
      head.add(band);
      const brim = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.022, 22), hatM, 0, 0.085, -0.02);
      head.add(brim);
    }

    // 얼굴 — 단순할수록 귀엽습니다.
    //   눈꺼풀 · 짙은 눈썹을 얹으면 '가면'처럼 보여서, 또렷한 눈 + 옅은 눈썹 + 미소만 둡니다.
    const eyes = [], openEye = [], shutEye = [];
    const blushMat = new THREE.MeshBasicMaterial({ color: '#ff9a9a', transparent: true, opacity: 0.3 });
    for (const s2 of [-1, 1]) {
      // 눈 — 살짝 세로로 긴 타원, 흰 점 하나로 생기를 줍니다
      const eye = mesh(new THREE.SphereGeometry(0.034, 18, 14), mEye, s2 * 0.103, -0.028, 0.237);
      eye.scale.set(1.02, 1.08, 0.36);
      head.add(eye);
      eyes.push(eye);
      // 윗속눈썹 — 가는 선 하나로 눈매가 또렷해집니다
      const lash = mesh(new THREE.TorusGeometry(0.038, 0.0075, 6, 14, Math.PI * 0.8), mEye, s2 * 0.103, -0.018, 0.238);
      lash.rotation.z = -Math.PI * 0.1 + s2 * 0.08;
      lash.scale.set(1, 0.72, 0.6);
      head.add(lash);
      // 반짝임은 큰 것 하나 + 작은 것 하나 (하나만 두면 인형 눈처럼 보입니다)
      const g1 = mesh(new THREE.SphereGeometry(0.0095, 8, 6), mGlint, s2 * 0.091, -0.004, 0.252);
      head.add(g1);
      const g2 = mesh(new THREE.SphereGeometry(0.005, 6, 5), mGlint, s2 * 0.115, -0.046, 0.248);
      head.add(g2);
      openEye.push(eye, lash, g1, g2);
      // 감은 눈 — 아래로 둥근 초승달 선 (명상할 때만 보입니다)
      const shut = mesh(new THREE.TorusGeometry(0.034, 0.0065, 6, 14, Math.PI * 0.85), mEye, s2 * 0.103, -0.02, 0.24);
      shut.rotation.z = Math.PI + Math.PI * 0.075;
      shut.scale.set(1, 0.6, 0.6);
      shut.visible = false;
      head.add(shut);
      shutEye.push(shut);
      // 눈썹 — 피부색에 가깝게 옅게, 눈에서 멀찍이
      const blush = mesh(new THREE.SphereGeometry(0.046, 10, 8), blushMat, s2 * 0.158, -0.085, 0.185);
      blush.scale.set(1, 0.45, 0.2);
      head.add(blush);
    }
    const nose = mesh(new THREE.SphereGeometry(0.019, 8, 6), mSkin, 0, -0.058, 0.25);
    nose.scale.set(1, 0.85, 0.75);
    head.add(nose);
    // 입 — 작게 웃는 선
    const mouth = mesh(new THREE.TorusGeometry(0.026, 0.0062, 8, 18, Math.PI * 0.8), mEye, 0, -0.084, 0.234);
    mouth.rotation.z = Math.PI * 1.05;
    mouth.rotation.x = -0.1;
    head.add(mouth);

    // 발밑 그림자(그림자 맵 밖에서도 떠 보이지 않게)
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ map: softTex, color: '#0c0a18', transparent: true, opacity: 0.4, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    root.add(blob);

    root.traverse((o) => { if (o.isMesh && o !== blob && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

    const label = makeLabel(name, { size: 32, scale: opts.npc ? 0.36 : 0.44, bg: opts.npc ? 'rgba(16,18,34,.34)' : undefined });
    label.position.y = 2.22;
    root.add(label);
    if (opts.scale) root.scale.setScalar(opts.scale);

    root.userData = {
      inner, body, upper, head, legs, arms, eyes, openEye, shutEye, blob, label,
      pose: 'stand', gesture: null, t: rnd() * 10, gait: 0, walk: 0, blink: 2 + rnd() * 3,
    };
    return root;
  }

  const MEDK = 2.25;   // 가부좌 정강이 접는 각도 (무릎 축이 위를 향할 때 수평으로 돕니다)
  function animateAvatar(av, dt, moving) {
    const u = av.userData;
    const k = Math.min(1, dt * 12);
    u.t += dt;
    if (u.strumT !== undefined) u.strumT += dt;
    if (u.playing > 0) u.playing -= dt;
    if (u.keyHit) { u.keyHit.t += dt; if (u.keyHit.t > 0.6) u.keyHit = null; }
    if (u.watering > 0) u.watering -= dt;
    // 달리기 — 보폭 · 박자를 키우고 몸을 앞으로 숙입니다
    u.runAmt = lerp(u.runAmt || 0, moving && u.run ? 1 : 0, Math.min(1, dt * 6));
    const ra = u.runAmt;
    u.gait += dt * (moving ? 9.5 + ra * 4.5 : 0);
    u.walk = lerp(u.walk, moving ? 1 : 0, Math.min(1, dt * 7));
    const w = u.walk, s = Math.sin(u.gait);
    // 점프 — 몸(inner)만 위로 띄웁니다. 그림자 · 카메라는 땅에 그대로 (화면이 흔들리지 않게)
    if (u.jumpV != null) {
      u.jumpY += u.jumpV * dt;
      u.jumpV -= 15 * dt;
      if (u.jumpY <= 0) { u.jumpY = 0; u.jumpV = null; u.land = 0.18; }
    }
    if (u.land > 0) u.land -= dt;
    const aa = u.airAmt = lerp(u.airAmt || 0, u.jumpV != null ? 1 : 0, Math.min(1, dt * 14));

    // 기본 자세
    let rootY = 0, rootRx = 0, upperRx = 0, hipA = s * (0.62 + ra * 0.3) * w, kneeA = Math.max(0, -s) * (0.5 + ra * 0.75) * w;
    upperRx += ra * w * 0.16;
    if (u.land > 0) rootY -= Math.sin(u.land / 0.18 * Math.PI) * 0.08;   // 착지 — 무릎을 살짝 굽혔다 폅니다
    if (u.pose === 'sit') { rootY = u.meditate ? -0.4 : -0.3; }   // 명상 — 엉덩이를 방석에 붙여 낮게
    if (u.pose === 'crouch') { rootY = -0.52; upperRx += 0.18; }
    const atKeys = u.pose === 'sit' && (u.atPiano || u.playing > 0);
    if (atKeys) upperRx += 0.14;                 // 피아노 앞 — 상체를 살짝 숙여 건반 쪽으로
    if (u.pose === 'sit' && u.hug) { rootY = -0.6; upperRx += 0.12; }          // 모래에 무릎 안고 앉기 — 엉덩이를 땅에
    if (u.pose === 'lie') {
      if (u.recline) { rootY = 0; rootRx = -1.0; }                            // 선베드 — 33° 들린 등받이에 기대어
      else { rootY = 0.34; rootRx = -Math.PI / 2; }
    }

    // 제스처
    let waveAmt = 0, bowAmt = 0, patAmt = 0, danceAmt = 0, stickAmt = 0, rpsAmt = 0, rpsT = 0, throwAmt = 0, throwT = 0, balloonAmt = 0, popAmt = 0, popT = 0;
    if (u.gesture) {
      u.gesture.t += dt;
      const dur = u.gesture.dur || 2.2, gt = u.gesture.t;
      const g = Math.sin(Math.min(1, gt / dur) * Math.PI);
      // 0.4초에 걸쳐 시작하고, 머물다가, 0.4초에 걸쳐 끝냅니다
      const env = smooth(0, 0.4, gt) * (1 - smooth(dur - 0.4, dur, gt));
      if (u.gesture.type === 'bow') { bowAmt = g; upperRx += 0.72 * g; }
      if (u.gesture.type === 'wave') waveAmt = env;
      if (u.gesture.type === 'pat') patAmt = g;
      if (u.gesture.type === 'dance') danceAmt = env;
      if (u.gesture.type === 'stick') stickAmt = env;
      // 풍선 — 1초에 걸쳐 천천히 들어 올리고, 0.8초에 걸쳐 내림
      if (u.gesture.type === 'balloon') balloonAmt = smooth(0, 1.0, gt) * (1 - smooth(dur - 0.8, dur, gt));
      if (u.gesture.type === 'popper') { popAmt = smooth(0, 0.45, gt) * (1 - smooth(dur - 0.5, dur, gt)); popT = gt; }
      if (u.gesture.type === 'rps') { rpsAmt = env; rpsT = gt; }
      if (u.gesture.type === 'throw') { throwAmt = 1 - smooth(0.75, 1.0, gt); throwT = gt; }
      if (gt > dur) u.gesture = null;
    }
    const beat = u.t * 6.2;                       // 춤 박자 (약 1초에 한 번 통통)
    if (danceAmt > 0.02) rootY += Math.abs(Math.sin(beat)) * 0.07 * danceAmt;

    // 다리
    for (let i = 0; i < u.legs.length; i++) {
      const sgn = i ? 1 : -1;
      let hr = hipA * sgn, kr = kneeA;
      if (u.pose === 'sit') { hr = -1.3; kr = 1.4; }
      let hy = 0;
      let kz = 0;
      if (u.meditate) { hr = -1.5; kr = 0.12; hy = sgn * 0.95; kz = -MEDK * sgn; }   // 가부좌 — 허벅지는 옆으로, 정강이는 바닥에 눕혀 앞에서 엇갈리게
      if (u.pose === 'crouch') { hr = -1.45 + sgn * 0.12; kr = 1.95; }
      if (u.pose === 'lie') { hr = 0.04 * sgn; kr = 0.05; }
      if (u.pose === 'lie' && u.recline) { hr = -0.57 + (i ? -0.12 : 0); kr = i ? 0.3 : 0.06; }   // 다리는 선베드 위로 앞으로 (한쪽 무릎은 살짝 세움)
      if (u.pose === 'sit' && u.hug) { hr = -2.1 + sgn * 0.04; kr = 2.2; }        // 무릎을 세워 가슴 쪽으로
      if (aa > 0.02 && u.pose === 'stand') { hr = lerp(hr, -0.55, aa); kr = lerp(kr, 0.9, aa); }   // 점프 — 무릎을 접어 올림
      if (balloonAmt > 0.02 && u.pose === 'stand' && u.walk < 0.3) {   // 둥실 — 다리를 번갈아 살랑살랑
        hr = lerp(hr, -0.18 + Math.sin(u.t * 2.4 + i * Math.PI) * 0.22, balloonAmt);
        kr = lerp(kr, 0.35 + Math.sin(u.t * 2.4 + i * Math.PI + 0.8) * 0.15, balloonAmt);
      }
      if (danceAmt > 0.02 && u.pose === 'stand') {   // 무릎을 번갈아 굽히며 들썩
        hr = lerp(hr, -0.12 + Math.sin(beat * 0.5 + i * Math.PI) * 0.28, danceAmt);
        kr = lerp(kr, 0.28 + 0.28 * Math.sin(beat + i * Math.PI), danceAmt);
      }
      u.legs[i].hip.rotation.order = 'YXZ';          // 벌린 다음 숙이도록 (y=0 이면 예전과 같음)
      u.legs[i].hip.rotation.y = lerp(u.legs[i].hip.rotation.y, hy, k);
      u.legs[i].hip.rotation.x = lerp(u.legs[i].hip.rotation.x, hr, k);
      u.legs[i].knee.rotation.x = lerp(u.legs[i].knee.rotation.x, kr, k);
      u.legs[i].knee.rotation.z = lerp(u.legs[i].knee.rotation.z, kz, k);
      if (u.legs[i].shoe) u.legs[i].shoe.rotation.x = lerp(u.legs[i].shoe.rotation.x, u.meditate ? -1.5 : 0, k);   // 가부좌 — 발을 눕혀 발바닥이 위로 오지 않게
    }
    // 팔
    for (let i = 0; i < u.arms.length; i++) {
      const sgn = i ? 1 : -1;
      let rx = -hipA * sgn * 0.8, rz = sgn * (0.14 + Math.sin(u.t * 1.3) * 0.02 * (1 - w)), er = -0.25 - w * 0.2;
      if (u.pose === 'sit') { rx = -0.35; rz = sgn * 0.2; er = -0.5; }
      if (u.meditate) { rx = -0.55; rz = sgn * 0.5; er = -0.45; }   // 명상 — 팔을 벌려 손을 무릎 위에
      if (u.pose === 'crouch') { rx = -0.62; rz = sgn * 0.26; er = -0.72; }
      if (u.pose === 'sit' && u.hug) { rx = -0.82; rz = sgn * -0.04; er = -0.55; }   // 두 팔로 무릎을 감싸 안음
      if (u.pose === 'lie' && u.recline) { rx = -0.45; rz = sgn * 0.1; er = -1.05; }  // 두 손은 배 위에
      // 피아노 치는 중 — 두 팔을 번갈아 건반 쪽으로
      if (atKeys) {
        // 두 손을 건반 위에 — 위팔은 앞으로, 팔꿈치는 살짝 굽혀 손끝이 건반에 닿게.
        // 쉬는 동안에도 손이 아주 조금씩 움직이고, 건반을 누르면 그 손이 건반 위로 가서 톡 누릅니다.
        const shX = sgn * 0.26;
        let handX = sgn * 0.2;                                      // 쉬는 자리 (몸 앞 조금 벌려)
        let press = 0;
        const kh = u.keyHit;
        if (kh && kh.t < 0.45 && (kh.x >= 0) === (sgn > 0)) {      // 이 손이 칠 건반
          handX = kh.x;
          press = kh.t < 0.12 ? smooth(0, 0.08, kh.t) : 1 - smooth(0.12, 0.3, kh.t);
        }
        rz = Math.asin(clamp((handX - shX) / 0.52, -0.9, 0.9));   // 손을 좌우로 옮김
        rx = -1.2 + Math.sin(u.t * 1.6 + i * 2) * 0.03 - press * 0.06;
        er = -0.45 - press * 0.35 + Math.sin(u.t * 2.1 + i) * 0.03;
      }
      // 물 주는 중 — 오른팔을 앞으로 내밀어 조리개를 기울입니다
      if (u.watering > 0 && i === 1) {
        rx = -1.15;
        rz = sgn * 0.3;
        er = -0.35;
      }
      // 음료 마시는 중 — 오른팔이 입으로 올라갔다 내려옵니다
      if (u.drink > 0 && i === 1) {
        const cyc = u.drink % 4;
        const sip = smooth(2.0, 2.7, cyc) * (1 - smooth(3.4, 4.0, cyc));   // 들고 있다가 → 입으로 → 내려놓기
        u.sip = sip;
        rx = -0.5 - sip * 0.32;                   // 위팔은 조금만 앞으로
        rz = sgn * (0.12 - sip * 0.42);           // 마실 땐 손이 몸 안쪽(입)으로
        er = -1.15 - sip * 0.95;                  // 팔꿈치를 굽혀 컵을 입 높이로
      }
      // 마시멜로 굽기 — 꼬챙이 든 팔을 불 쪽으로 길게 뻗습니다
      // 불꽃막대 — 앞으로 든 팔을 천천히 흔들어 불꽃으로 그림을 그리듯
      if (u.sparkler && i === 1) { rx = -1.15 + Math.sin(u.t * 2.1) * 0.28; rz = sgn * (0.5 + Math.sin(u.t * 1.6) * 0.22); er = -0.3 + Math.sin(u.t * 2.6) * 0.1; }   // 몸 바깥쪽으로 — 얼굴을 가리지 않게
      if (u.roasting && i === 1 && u.pose === 'sit') { rx = -1.0 + Math.sin(u.t * 0.7) * 0.03; rz = sgn * 0.08; er = -0.12; }
      // 기타 — 한 손은 넥을 잡고, 한 손은 줄 위에서 위아래로 긁습니다
      if (u.guitar && u.pose === 'sit') {
        if (i === 1) { rx = -0.95; rz = sgn * 0.42; er = -0.75; }
        else {
          const k2 = Math.max(0, 1 - (u.strumT === undefined ? 9 : u.strumT) / 0.2);
          rx = -0.55; rz = sgn * -0.28; er = -1.2 + (u.strumDir < 0 ? -k2 : k2) * 0.28;
        }
      }
      let ez = 0;
      if (i === 1 && waveAmt > 0.02) {
        // 실제 사람처럼: 위팔은 앞·옆으로 비스듬히(어깨보다 조금 낮게) 들고,
        // 팔꿈치를 굽혀 손이 얼굴 옆으로 올라오게 한 뒤, 팔꿈치를 축으로 손을 좌우로 흔듭니다.
        // (팔을 옆으로 쭉 펴고 아래팔만 세우면 로봇 팔처럼 보입니다)
        const sway = Math.sin(u.t * 10.5) * waveAmt;
        rz = sgn * (0.14 + 0.88 * waveAmt + sway * 0.05);   // 위팔도 손을 따라 아주 조금 움직임
        rx = -0.62 * waveAmt;
        er = -0.25 - 1.75 * waveAmt;                         // 팔꿈치 약 115도 굽힘
        ez = -sgn * (0.12 * waveAmt + sway * 0.36);          // 손을 좌우로 (약 ±20도)
      }
      if (patAmt > 0.02 && i === 1) {   // 쓰다듬기 — 오른손을 앞 아래로 내려 토닥입니다
        rx = -1.0 - Math.sin(u.t * 7) * 0.18 * patAmt;
        rz = sgn * 0.3;
        er = -0.45;
      }
      if (danceAmt > 0.02) {            // 춤 — 두 팔을 번갈아 머리 위로
        const up = 0.5 + 0.5 * Math.sin(beat * 0.5 + i * Math.PI);
        rz = lerp(rz, sgn * (0.45 + 1.9 * up), danceAmt);
        rx = lerp(rx, -0.35, danceAmt);
        er = lerp(er, -1.0 + up * 0.7, danceAmt);
      }
      if (balloonAmt > 0.02 && i === 1) {   // 풍선 들기 — 줄을 쥔 손을 얼굴 옆 높이로 (팔꿈치는 살짝 굽힘)
        rz = lerp(rz, sgn * (1.45 + Math.sin(u.t * 1.6) * 0.04), balloonAmt);
        rx = lerp(rx, -0.75, balloonAmt);
        er = lerp(er, -0.85, balloonAmt);
      }
      if (popAmt > 0.02) {              // 크래커 — 오른손은 앞위로 겨누고, 왼손이 줄을 잡았다가 0.75초에 확 당김
        const pull = smooth(0.62, 0.78, popT);
        if (i === 1) {
          rx = lerp(rx, -2.0 + pull * 0.25, popAmt);      // 펑 할 때 살짝 반동
          rz = lerp(rz, sgn * 0.32, popAmt);
          er = lerp(er, -0.35, popAmt);
        } else {
          rx = lerp(rx, lerp(-1.55, -0.55, pull), popAmt);
          rz = lerp(rz, sgn * lerp(-0.05, 0.25, pull), popAmt);
          er = lerp(er, lerp(-0.75, -1.25, pull), popAmt);
        }
      }
      if (stickAmt > 0.02) {            // 응원봉 — 오른팔은 머리 위에서 좌우로, 왼팔은 박자 맞추기
        if (i === 1) {
          rz = lerp(rz, sgn * (2.35 + Math.sin(u.t * 5.2) * 0.38), stickAmt);
          rx = lerp(rx, -0.15, stickAmt);
          er = lerp(er, -0.2, stickAmt);
        } else {
          rz = lerp(rz, sgn * 0.3, stickAmt);
          rx = lerp(rx, -0.7 - Math.abs(Math.sin(u.t * 5.2)) * 0.2, stickAmt);
          er = lerp(er, -1.1, stickAmt);
        }
      }
      if (rpsAmt > 0.02 && i === 1) {   // 가위바위보 — 주먹을 세 번 흔들고(1.5초), 앞으로 내밉니다
        let tx2, te;
        if (rpsT < 1.5) {
          const pump = Math.abs(Math.sin(rpsT / 1.5 * Math.PI * 3));
          tx2 = -0.65 - 0.35 * pump; te = -1.25 + 0.55 * pump;
        } else { tx2 = -1.3; te = -0.15; }
        rx = lerp(rx, tx2, rpsAmt);
        rz = lerp(rz, sgn * 0.2, rpsAmt);
        er = lerp(er, te, rpsAmt);
      }
      if (throwAmt > 0.02 && i === 1) { // 공 던지기 — 팔을 뒤로 젖혔다가(0.35초) 앞위로 휘두릅니다
        const back = smooth(0, 0.3, throwT), fwd = smooth(0.3, 0.5, throwT);
        rx = lerp(rx, lerp(0.95 * back, -1.9, fwd), throwAmt);
        er = lerp(er, lerp(-1.4 * back, -0.15, fwd), throwAmt);
        rz = lerp(rz, sgn * 0.25, throwAmt);
      }
      if (bowAmt > 0.02) {              // 절할 때는 두 팔을 몸 앞으로 모읍니다
        rx = -0.42 * bowAmt;
        rz = sgn * (0.1 + 0.12 * bowAmt);
        er = -0.5 - 0.5 * bowAmt;
      }
      u.arms[i].sh.rotation.x = lerp(u.arms[i].sh.rotation.x, rx, k);
      u.arms[i].sh.rotation.z = lerp(u.arms[i].sh.rotation.z, rz, k);
      u.arms[i].elbow.rotation.x = lerp(u.arms[i].elbow.rotation.x, er, k);
      u.arms[i].elbow.rotation.z = lerp(u.arms[i].elbow.rotation.z, ez, Math.min(1, dt * 18));
      if (i === 1 && (balloonAmt > 0.02 || u.balloon)) {
        if (!u.balloon) {
          // 풍선은 장면에 따로 두고 매 프레임 손 위치로 옮김 — 팔 각도와 상관없이 줄은 늘 위로
          const bg = new THREE.Group();
          const bm = new THREE.MeshStandardMaterial({ color: u.balloonColor || '#ff5d73', roughness: 0.28, emissive: '#ffffff', emissiveIntensity: 0.06 });
          const sphere = new THREE.SphereGeometry(1, 16, 12);
          const ball = new THREE.Mesh(sphere, bm);
          ball.scale.set(0.29, 0.33, 0.29);
          // 옆 풍선 2개 — 조금 작고 색이 다름 (묶음)
          const sideMs = [0, 1].map(() => bm.clone());
          const sideA = new THREE.Mesh(sphere, sideMs[0]); sideA.position.set(-0.27, -0.12, 0.06); sideA.scale.set(0.23, 0.26, 0.23);
          const sideB = new THREE.Mesh(sphere, sideMs[1]); sideB.position.set(0.25, -0.15, -0.05); sideB.scale.set(0.22, 0.25, 0.22);
          const knot = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 8), bm);
          knot.rotation.x = Math.PI;
          const strGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          const str = new THREE.Line(strGeo, new THREE.LineBasicMaterial({ color: '#f4f1ea' }));
          str.frustumCulled = false;
          bg.add(ball, sideA, sideB, knot);
          scene.add(bg, str);
          u.balloon = bg; u.balloonBall = ball; u.balloonKnot = knot; u.balloonStr = str; u.balloonM = bm; u.balloonMs = [bm, ...sideMs];
          if (u.balloonIdx != null) setBalloonColor(av, u.balloonIdx);
          u.balloonPos = null;
        }
        const on = balloonAmt > 0.02;
        u.balloon.visible = u.balloonStr.visible = on;
        if (on) {
          const hand = u.arms[1].elbow.localToWorld(new THREE.Vector3(0, -0.25, 0));
          // 풍선은 손 위 0.95m 로 천천히 따라옴 (살짝 늦게 · 흔들흔들)
          const target = hand.clone().add(new THREE.Vector3(Math.sin(u.t * 1.3) * 0.1, 1.0 + Math.sin(u.t * 2.0 + 1) * 0.06, Math.cos(u.t * 1.1) * 0.08));
          if (!u.balloonPos || balloonAmt < 0.05) u.balloonPos = hand.clone().add(new THREE.Vector3(0, 0.95, 0));
          u.balloonPos.lerp(target, Math.min(1, dt * 4));
          const sc = smooth(0, 0.35, balloonAmt);
          u.balloon.position.copy(u.balloonPos);
          u.balloon.scale.setScalar(Math.max(0.001, sc));
          u.balloonKnot.position.set(0, -0.32, 0);
          u.balloon.rotation.z = Math.sin(u.t * 1.6) * 0.1;
          const pos = u.balloonStr.geometry.attributes.position;
          pos.setXYZ(0, hand.x, hand.y, hand.z);
          pos.setXYZ(1, u.balloonPos.x, u.balloonPos.y - 0.34 * sc, u.balloonPos.z);
          pos.needsUpdate = true;
        }
      }
      if (i === 1 && (popAmt > 0.02 || u.popper)) {
        if (!u.popper) {
          // 크래커 고깔 — 뾰족한 쪽을 손에 쥐고, 넓은 입구가 아래팔 방향(-y)으로
          const g2 = new THREE.Group();
          g2.position.y = -0.27;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#ffcf3a', roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }));
          cone.position.y = -0.13;
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.04, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#ff5d73', roughness: 0.6, side: THREE.DoubleSide }));
          band.position.y = -0.08;
          const band2 = band.clone(); band2.material = band.material.clone(); band2.material.color.set('#3fa9ff'); band2.position.y = -0.17; band2.scale.set(1.35, 1, 1.35);
          g2.add(cone, band, band2);
          u.arms[1].elbow.add(g2);
          u.popper = g2;
        }
        u.popper.visible = popAmt > 0.02;
        if (u.gesture && u.gesture.type === 'popper') {
          if (popT < 0.1) u.popped = false;
          if (!u.popped && popT >= 0.76) {
            u.popped = true;
            const mouth = u.arms[1].elbow.localToWorld(new THREE.Vector3(0, -0.53, 0));
            const dir = new THREE.Vector3(0, -1, 0).transformDirection(u.arms[1].elbow.matrixWorld);
            popConfetti(mouth, dir, u.popN || 0);
            if (typeof sfxPop === 'function') sfxPop(av);
          }
        }
      }
      if (i === 1 && u.cup) u.cup.rotation.x = -(u.arms[1].sh.rotation.x + u.arms[1].elbow.rotation.x) - (u.sip || 0) * 0.9;
    }
    // 몸 전체 — 걸을 때 위아래로 통통, 서 있을 땐 숨 쉬듯
    const bob = w * Math.abs(Math.sin(u.gait)) * (0.055 + ra * 0.05) * (1 - aa) + (1 - w) * Math.sin(u.t * 1.5) * 0.012;
    if (u.innerY == null) u.innerY = u.inner.position.y;
    u.innerY = lerp(u.innerY, rootY + bob, k);
    if (u.prevPose === 'lie' && u.pose !== 'lie') { u.inner.rotation.x = rootRx; u.innerY = rootY; }
    // 풍선 들기 — 몸이 살짝 떠올라 둥실둥실 (최대 약 0.3m)
    u.floatY = lerp(u.floatY || 0, balloonAmt * (0.24 + Math.sin(u.t * 2.0) * 0.08), Math.min(1, dt * 3));
    u.inner.position.y = u.innerY + (u.jumpY || 0) + u.floatY;
    u.inner.rotation.z = lerp(u.inner.rotation.z, balloonAmt * Math.sin(u.t * 1.4) * 0.05, Math.min(1, dt * 4));
    u.prevPose = u.pose;
    u.inner.rotation.x = lerp(u.inner.rotation.x, rootRx, Math.min(1, dt * 8));
    u.upper.rotation.x = lerp(u.upper.rotation.x, upperRx + w * 0.08, k);
    u.body.rotation.z = lerp(u.body.rotation.z, Math.sin(u.gait) * 0.03 * w + Math.sin(beat * 0.5) * 0.11 * danceAmt, k);
    u.inner.rotation.y = lerp(u.inner.rotation.y, Math.sin(beat * 0.25) * 0.45 * danceAmt, k);
    u.head.rotation.x = lerp(u.head.rotation.x, bowAmt * 0.3, k);
    u.head.rotation.z = lerp(u.head.rotation.z, -Math.sin(u.gait) * 0.05 * w + Math.sin(u.t * 0.9) * 0.03 * (1 - w) + waveAmt * 0.1, k);
    u.head.rotation.y = lerp(u.head.rotation.y, Math.sin(u.t * 0.45) * 0.22 * (1 - w), Math.min(1, dt * 2));

    // 눈 깜빡임 (명상 중에는 눈을 감고 있습니다)
    // 명상 — 뜬 눈 · 반짝임은 숨기고, 편안하게 감은 초승달 눈을 보입니다 (가늘게 뜬 눈은 무섭게 보였음)
    const shut = !!u.meditate;
    if (u.shutEye && u.shutNow !== shut) { u.shutNow = shut; for (const o of u.openEye) o.visible = !shut; for (const o of u.shutEye) o.visible = shut; }
    if (shut) u.blink = 1;
    u.blink -= dt;
    if (u.blink < 0) {
      const closing = u.blink > -0.07;
      for (const e of u.eyes) e.scale.y = closing ? 0.12 : 1.1;
      if (u.blink < -0.14) u.blink = 2.5 + Math.random() * 4;
    }
    u.blob.visible = u.pose === 'stand' || u.pose === 'crouch';
    u.label.visible = u.pose !== 'lie';
  }
  // ------------------------------------------------------------------
  // 둘러보는 관람객 (NPC) 2명 — 혼자 들어와도 사람 온기가 있도록. 이름표 없이 부스 앞을 천천히 옮겨 다닙니다
  // ------------------------------------------------------------------
  const NPC_DEFS = [
    { name: '관람객 1', color: '#7f9cc4', hair: 1, hairColor: '#241d1a', skin: SKIN[1], scale: 1.0 },
    { name: '관람객 2', color: '#d9a7c7', hair: 2, hairColor: '#6b4a2f', skin: SKIN[0], scale: 0.96 },
  ];
  const NPC_LINES = ['어떤 작품이 걸릴지 궁금하네요', '부스 색이 다 달라서 예뻐요', '발표 무대는 통로 끝이에요 🎤', '천천히 둘러보세요 🙂', '곧 작품이 걸린대요'];
  // 관람객이 서는 자리 — 부스 앞 통로 쪽 (부스 바닥 앞 1.2m)
  const npcSpot = (b) => { const w = toWorld(b.x, b.z, b.facing, (Math.random() - 0.5) * 2.4, BOOTH_D / 2 + 1.0); return { x: w.x, z: w.z, b }; };
  for (const [i, d] of (C.npcs === false ? [] : NPC_DEFS).entries()) {
    const av = makeAvatar(d.color, d.name, { hair: d.hair, hairColor: d.hairColor, skin: d.skin, npc: true, scale: d.scale });
    av.remove(av.userData.label);
    av.userData.label = new THREE.Object3D();
    const b = BOOTHS[(i * 2 + 1) % BOOTHS.length];
    const sp = npcSpot(b);
    av.position.set(sp.x, standY(sp.x, sp.z), sp.z);
    av.rotation.y = b.facing + Math.PI;
    scene.add(av);
    npcs.push({ av, name: d.name, to: null, at: b, pause: 3 + Math.random() * 6, t: 0, greet: 3, talk: 25 + Math.random() * 30 });
  }

  // 번호로 고르기 — labels: 버튼 글자 배열, onPick(i)
  let pickTags = [];
  function pickFrom(title, labels, onPick, tags = []) {
    const box = $('#pick');
    $('#pick-title').textContent = title;
    for (const tg of pickTags) tg.visible = false;          // 이전에 보이던 번호표는 숨기고
    pickTags = tags.filter(Boolean);
    for (const tg of pickTags) tg.visible = true;           // 고르는 동안만 번호표를 띄웁니다
    const close = () => { box.classList.remove('show'); clearTimeout(box._t); for (const tg of pickTags) tg.visible = false; pickTags = []; };
    $('#pick-list').replaceChildren(...labels.map((lb, i) => {
      const b = el('button', { type: 'button', textContent: lb });
      b.onclick = () => { close(); onPick(i); };
      return b;
    }));
    $('#pick-cancel').onclick = close;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(close, 15000);
  }
  // 지금 들어와 있는 사람들 (닉네임 목록용)
  let presentIds = [];
  function renderWho() {
    const box = $('#who');
    const rows = [el('div', { className: 'me-row', textContent: `${me.name} (나)` })];
    let waiting = 0;
    for (const id of presentIds) {
      if (id === me.id) continue;
      const o = others.get(id);
      if (o && o.name) rows.push(el('div', { textContent: o.name }));
      else waiting++;
    }
    if (waiting) rows.push(el('div', { className: 'sub', textContent: `들어오는 중 ${waiting}명` }));
    rows.push(el('div', { className: 'sub', textContent: `둘러보는 관람객(NPC) ${npcs.length}명은 빼고 셌어요` }));
    box.replaceChildren(...rows);
  }
  // hold: 머리 위에 머무는 시간(초). 0 이면 바로 떠오르며 사라집니다.
  function floatEmoji(emoji, pos, size = 0.8, hold = 0) {
    const s = emojiSprite(emoji, size);
    s.position.copy(pos);
    scene.add(s);
    floaters.push({ s, t: 0, vx: hold ? 0 : (Math.random() - 0.5) * 0.4, hold, base: s.scale.clone() });
  }
  // ------------------------------------------------------------------
  // 소리 — 전부 WebAudio 로 생성 (음원 파일 0개)
  //   배경은 '음악'이 아니라 자연음: 바람 · 나뭇잎 · 가끔 새소리 · 발소리
  //   지속음(드론)은 깔지 않습니다 ("웅 소리" 지적을 받았음)
  // ------------------------------------------------------------------
  let actx = null, master = null, muted = false, noiseBuf = null;
  const amb = {};
  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.8;
    master.connect(actx.destination);
    const len = actx.sampleRate * 2;
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(freq, vol = 0.25, dur = 1.8, when = 0) {
    if (!actx || muted) return;
    const t = actx.currentTime + when;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    for (const [type, mult, v] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
      const o = actx.createOscillator();
      const og = actx.createGain();
      o.type = type;
      o.frequency.value = freq * mult;
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  const chime = () => { tone(784, 0.1, 1.4); tone(1046.5, 0.07, 1.6, 0.12); };
  // 짧은 잡음 한 토막 — 타닥 · 쉭 · 첨벙 모두 이것으로
  function burst({ freq = 2500, q = 1, type = 'bandpass', vol = 0.1, dur = 0.05, when = 0, attack = 0.003 } = {}) {
    if (!actx || muted || vol < 0.002) return;
    const t = actx.currentTime + when;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, attack + dur + 0.05);
  }
  function plip(k = 1) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 * k, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.16);
    burst({ freq: 1400, q: 0.8, vol: 0.03 * k, dur: 0.09 });
  }
  // 조개를 주울 때 — 작게 '딸깍'
  function clink(k = 1) {
    burst({ freq: 3600 + Math.random() * 800, q: 6, vol: 0.035 * k, dur: 0.018 });
    burst({ freq: 4600 + Math.random() * 600, q: 6, vol: 0.02 * k, dur: 0.014, when: 0.07 });
  }
  function loopNoise(filterType, freq, q) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = actx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start(0, Math.random() * 1.5);
    return g;
  }
  function noiseSrc(when, dur) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.start(when, Math.random() * 1.5);
    src.stop(when + dur + 0.1);
    return src;
  }
  // 발소리 — 돌바닥 '톡' · 카펫 · 깔개 '폭' · 잔디 '사각' · 무대 나무 '똑'
  function stepSound(kind, k = 1) {
    if (!actx || muted) return;
    if (kind === 'wood') {
      burst({ freq: 380 + Math.random() * 140, q: 4, vol: 0.045 * k, dur: 0.05 });
      burst({ freq: 1700, q: 1, vol: 0.01 * k, dur: 0.02 });
      return;
    }
    if (kind === 'stone') {
      burst({ freq: 1100 + Math.random() * 500, q: 2.2, vol: 0.022 * k, dur: 0.03 });
      burst({ freq: 300, q: 0.7, type: 'lowpass', vol: 0.02 * k, dur: 0.05, attack: 0.004 });
      return;
    }
    if (kind === 'soft') {
      burst({ freq: 420 + Math.random() * 120, q: 0.6, type: 'lowpass', vol: 0.02 * k, dur: 0.07, attack: 0.008 });
      return;
    }
    for (let i = 0; i < 3; i++) burst({ freq: 2200 + Math.random() * 2400, q: 1.4, vol: (0.008 + Math.random() * 0.008) * k, dur: 0.012 + Math.random() * 0.02, when: i * 0.018 });
    burst({ freq: 360, q: 0.7, type: 'lowpass', vol: 0.014 * k, dur: 0.06, attack: 0.008 });
  }
  // 새소리 — 광장 둘레 나무에서 가끔, 멀리서 작게 '삐릿 삐릿'
  function birdCall(k = 1) {
    if (!actx || muted) return;
    const n = 2 + Math.floor(Math.random() * 3);
    const f0 = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t = actx.currentTime + i * (0.13 + Math.random() * 0.05);
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.1), t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.2), t + 0.06);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.95, t + 0.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.012 * k, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.13);
    }
  }
  // 배경 — 바람 · 나뭇잎 스치는 소리만 아주 작게 (지속음 · 음악은 깔지 않습니다)
  function startAmbient() {
    if (!actx || amb.wind) return;
    amb.wind = loopNoise('lowpass', 280, 0.3);
    amb.leaves = loopNoise('bandpass', 3400, 0.6);
  }
  let birdT = 5;
  // ------------------------------------------------------------------
  // 축제 배경 음악 — 코드로 연주 (음원 파일 없음). 다장조 C–G–Am–F 4마디 반복, 104 BPM
  //   마림바 엇박 화음 · 통통 베이스 · 부드러운 킥/박수/셰이커 · 몇 마디마다 실로폰 멜로디
  //   잔잔하게 — 전체 크기는 music.vol 한 곳에서 조절. '음악' 버튼으로 음악만 끌 수 있음
  // ------------------------------------------------------------------
  const music = { on: localStorage.getItem('gallery:music') !== 'off', bus: null, vol: 0.75, next: 0, step: 0 };
  const BPM = 104, STEP = 60 / BPM / 2;   // 8분음표 한 칸
  const mHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const CHORDS = [
    { bass: 48, notes: [60, 64, 67], tones: [72, 76, 79] },   // C
    { bass: 43, notes: [59, 62, 67], tones: [71, 74, 79] },   // G
    { bass: 45, notes: [60, 64, 69], tones: [72, 76, 81] },   // Am
    { bass: 41, notes: [60, 65, 69], tones: [72, 77, 81] },   // F
  ];
  const PENTA = [72, 74, 76, 79, 81, 84];
  // 같은 마디는 늘 같은 멜로디 (고정 난수) — 반복되며 귀에 익음
  const mRand = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const MELODY = [0, 1].map((v) => CHORDS.map((c, bar) => {
    const r = mRand(1000 + v * 97 + bar * 13);
    return Array.from({ length: 8 }, (_, k) => {
      if (k % 2 === 0) return r() < 0.8 ? c.tones[Math.floor(r() * 3)] : 0;   // 강박은 화음 음
      return r() < 0.45 ? PENTA[Math.floor(r() * PENTA.length)] : 0;          // 약박은 가끔 · 5음계
    });
  }));
  function mVoice(freq, when, { vol = 0.05, dur = 0.4, type = 'sine', partials = [[1, 1]], attack = 0.006 } = {}) {
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    g.connect(music.bus);
    for (const [mult, v] of partials) {
      const o = actx.createOscillator(), og = actx.createGain();
      o.type = type; o.frequency.value = freq * mult; og.gain.value = v;
      o.connect(og).connect(g);
      o.start(when); o.stop(when + dur + 0.05);
    }
  }
  function mNoise(when, { freq = 7000, q = 0.8, type = 'highpass', vol = 0.01, dur = 0.04 } = {}) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(music.bus);
    src.start(when, Math.random() * 1.5, dur + 0.05);
  }
  function mKick(when, vol = 0.12) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    o.connect(g).connect(music.bus);
    o.start(when); o.stop(when + 0.25);
  }
  function playStep(step, when) {
    const bar = Math.floor(step / 8) % 4, k = step % 8, loop = Math.floor(step / 32);
    const c = CHORDS[bar];
    const intro = loop === 0;   // 첫 바퀴는 화음 · 셰이커만 (살며시 시작)
    // 마림바 엇박 화음 (그리고 마디 첫 박에 살짝)
    if (k % 2 === 1 || k === 0) for (const n of c.notes) mVoice(mHz(n), when, { vol: k === 0 ? 0.022 : 0.03, dur: 0.32, partials: [[1, 1], [4, 0.12]] });
    // 셰이커 — 8분음표마다, 엇박을 조금 세게
    mNoise(when, { vol: k % 2 ? 0.011 : 0.006, dur: 0.035 });
    if (intro) return;
    // 베이스 — 1 · 3박은 뿌리음, 4박 엇박은 5도로 통통
    if (k === 0 || k === 4) mVoice(mHz(c.bass), when, { vol: 0.11, dur: 0.38, type: 'triangle', attack: 0.01 });
    if (k === 7) mVoice(mHz(c.bass + 7), when, { vol: 0.07, dur: 0.2, type: 'triangle', attack: 0.01 });
    // 킥 · 박수
    if (k === 0 || k === 4) mKick(when, 0.1);
    if (k === 2 || k === 6) mNoise(when, { type: 'bandpass', freq: 1500, q: 0.7, vol: 0.028, dur: 0.09 });
    // 실로폰 멜로디 — 2바퀴 연주하고 1바퀴 쉼 (A · B · 쉼)
    const phase = (loop - 1) % 3;
    if (phase < 2) {
      const m = MELODY[phase][bar][k];
      if (m) mVoice(mHz(m), when, { vol: 0.045, dur: 0.55, partials: [[1, 1], [2.76, 0.18], [5.4, 0.06]] });
    }
  }
  function updateMusic() {
    if (!actx || !noiseBuf) return;
    if (!music.bus) {
      music.bus = actx.createGain();
      music.bus.gain.value = 0.0001;
      music.bus.connect(master);
      music.next = actx.currentTime + 0.3;
    }
    const want = music.on && !muted ? music.vol : 0.0001;
    music.bus.gain.setTargetAtTime(want, actx.currentTime, 0.6);
    if (!music.on || muted) { music.next = actx.currentTime + 0.3; return; }
    if (actx.state !== 'running') return;
    if (music.next < actx.currentTime - 0.5) music.next = actx.currentTime + 0.05;   // 탭을 다녀왔으면 지금부터 다시
    while (music.next < actx.currentTime + 0.25) {
      playStep(music.step, music.next);
      music.step++;
      music.next += STEP;
    }
  }
  function updateAudio(dt, t) {
    updateMusic();
    if (!actx || !amb.wind) return;
    const now = actx.currentTime;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.077 + 1);
    amb.wind.gain.setTargetAtTime(muted ? 0 : 0.0045 * gust, now, 1);
    amb.leaves.gain.setTargetAtTime(muted ? 0 : 0.0014 * (0.5 + gust), now, 1.2);
    if (muted) return;
    birdT -= dt;
    if (birdT <= 0) { birdCall(0.5 + Math.random() * 0.5); birdT = 9 + Math.random() * 22; }
  }

  // ------------------------------------------------------------------
  // 효과 — 클릭 표시
  // ------------------------------------------------------------------
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.2, 0.26, 28);
  ringGeo.userData.shared = true;
  function markSpot(v) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#fff0d8', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(v.x, groundY(v.x, v.z) + 0.07, v.z);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 4;
    scene.add(m);
    rings.push({ m, t: 0, size: 1.4, mark: true });
  }
  // 받침(조사) — 마지막 글자에 받침이 있으면 a, 없으면 b
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? a : b; };
  // ------------------------------------------------------------------
  // 행동
  // ------------------------------------------------------------------
  const cooldown = {};
  function cool(name, ms) {
    const now = Date.now();
    if (cooldown[name] && now - cooldown[name] < ms) { toast('조금만 천천히 해 볼까요? 🙂', 1500); return false; }
    cooldown[name] = now;
    return true;
  }
  let camMode = 'follow';   // follow | frame (액자 정면 보기) | award (시상 — 무대 한 줄 정면)
  let frameView = null;     // 액자 정면 보기 중인 부스
  let moveTarget = null, waypoints = [];
  let arriveYaw = null;     // 길 찾기로 도착하면 카메라가 돌아갈 방향
  let seatOff = 0;          // 앉은 자리의 높이 보정 (상대에게도 'lift' 로 보냄)
  let mySeat = null;
  let blockedMsg = 0;
  let pending = null;       // 걸어간 뒤 할 일 (부스 앞에서 액자 바라보기 등)
  let running = false;      // 땅을 더블클릭(두 번 톡톡)하면 달려갑니다
  let lastTap = null;
  function standUp() {
    const s = mySeat;
    setPose('stand');
    if (s && s.kind === 'bench') {                                              // 벤치 앞으로 한 걸음
      player.position.x += Math.sin(s.ry) * 0.7;
      player.position.z += Math.cos(s.ry) * 0.7;
    }
    if (s && s.kind === 'chair') player.position.x = 0;                         // 관람석 — 가운데 통로로 나옴
    pushOut(player.position, 3);
  }
  function setPose(pose) {
    const u = player.userData;
    if (pose === 'stand') { seatOff = 0; mySeat = null; }
    u.pose = pose;
    if (camMode === 'frame' && pose !== 'stand') stopFrameView(true);
    if (camMode === 'award') camMode = 'follow';
    netDirty = true;
    if (currentPlace) showPanel(currentPlace, true);
  }
  const GESTURE_DUR = { wave: 2.2, bow: 2.2, dance: 6, balloon: 6, popper: 2.6 };
  const BALLOON_COLORS = ['#ff5d73', '#ffb22e', '#ffe14d', '#4cd38a', '#3fa9ff', '#a77bff', '#ff7ad1'];
  let lastFirework = 0;
  // 풍선 색 — 누를 때마다 바뀌지만, 모든 화면에서 같은 색 (n 을 함께 보냄)
  function setBalloonColor(av, n) {
    const u = av.userData;
    const k = Math.abs(Math.round(Number(n) || 0));
    u.balloonIdx = k;
    u.balloonColor = BALLOON_COLORS[k % BALLOON_COLORS.length];
    if (u.balloonMs) u.balloonMs.forEach((m, j) => m.color.set(BALLOON_COLORS[(k + j * 2) % BALLOON_COLORS.length]));
  }
  // 근처 NPC 가 그쪽을 돌아보고 같은 동작을 따라 함 (NPC 는 화면마다 따로 움직임)
  function npcReact(type, pos) {
    if (!['wave', 'bow', 'dance', 'balloon', 'popper'].includes(type)) return;
    for (const n of npcs) {
      if (n.av.position.distanceTo(pos) > 9) continue;
      if (n.react || (n.reactCool || 0) > 0) continue;
      n.react = { type, delay: 0.35 + Math.random() * 0.7, look: pos.clone() };
    }
  }
  function gesture(type) {
    if (type === 'dance' && player.userData.pose !== 'stand') { toast('일어선 뒤에 출 수 있어요', 1500); return; }
    if (type === 'bow' && player.userData.pose !== 'stand') { toast('일어선 뒤에 인사할 수 있어요', 1500); return; }
    if (type === 'popper') {
      if (performance.now() - lastFirework < 2600) return;   // 한 번 터질 때까지는 다시 못 누름
      lastFirework = performance.now();
    }
    const n = Math.floor(Math.random() * 1000);
    if (type === 'balloon') setBalloonColor(player, n);
    if (type === 'popper') player.userData.popN = n;
    player.userData.gesture = { type, t: 0, dur: GESTURE_DUR[type] };
    if (camMode === 'follow' && type !== 'balloon') { const side = Math.random() < 0.5 ? -1 : 1; showCam = { type, t: 0, dur: GESTURE_DUR[type] + 0.4, side, yaw: pickShotYaw(type, side) }; }
    npcReact(type, player.position);
    if (netTake()) store.send('act', { id: me.id, type, n });
  }
  // 점프 — 서 있을 때만. 몸(inner)만 띄워서 카메라 · 그림자는 그대로 (쉼터 v2 와 같은 방식)
  function startJump(av) {
    const u = av.userData;
    if (u.pose !== 'stand' || u.jumpV != null) return false;
    u.jumpV = 4.8; u.jumpY = 0.001;   // 약 0.77m · 0.64초
    return true;
  }
  function jump() {
    if (introOn) return;
    if (player.userData.pose !== 'stand') standUp();
    if (startJump(player)) store.send('act', { id: me.id, type: 'jump' });
  }
  function seatTaken(seat) {
    for (const o of others.values()) {
      if (seat.kind === 'chair' && o.av.userData.pose === 'sit' && o.seat === seat.i) return true;
      if (o.av.userData.pose !== 'stand' && Math.hypot(o.tx - seat.x, o.tz - seat.z) < 0.4) return true;
    }
    return false;
  }
  function sitAt(seat) {
    if (seatTaken(seat)) { toast('누군가 앉아 있는 자리예요 🙂', 1600); return; }
    if (player.userData.pose !== 'stand') setPose('stand');
    if (camMode === 'frame') stopFrameView(true);
    moveTarget = null; waypoints = []; pending = null;
    player.position.set(seat.x, standY(seat.x, seat.z) + seat.off, seat.z);
    player.rotation.y = seat.ry;
    seatOff = seat.off;
    mySeat = seat;
    setPose('sit');
    if (seat.kind === 'chair') { camYaw = Math.PI; camPitch = 0.16; arriveYaw = null; }   // 관람석 — 등 뒤에서 무대를 봄
    else { camYaw = seat.ry + Math.PI + 0.5; camPitch = 0.22; }
    camDist = Math.min(camDist, 7);
  }
  // 관람석 빈자리 — 쉼터 takeSeat 처럼 앞줄 · 가운데부터 차례로 (pref 를 주면 그 자리, 차 있으면 가까운 빈자리)
  const CHAIR_ORDER = chairs.slice().sort((a, b) => a.row - b.row || Math.abs(a.x) - Math.abs(b.x) || a.x - b.x);
  function freeChair(near, exclude) {
    if (!near) return CHAIR_ORDER.find((c) => c !== exclude && !seatTaken(c)) || null;
    let best = null, bd = Infinity;
    for (const c of chairs) {
      if (c === exclude || seatTaken(c)) continue;
      const d = Math.hypot(c.x - near.x, c.z - near.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function sitChair(pref) {
    const c = pref && !seatTaken(pref) ? pref : freeChair(pref || null);
    if (!c) { toast('관람석이 다 찼어요 🙂', 1600); return false; }
    sitAt(c);
    return true;
  }
  function nearestFree(list) {
    let best = null, bd = Infinity;
    for (const s of list) {
      if (seatTaken(s)) continue;
      const d = Math.hypot(s.x - player.position.x, s.z - player.position.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function sitNearest(filter) {
    const s = nearestFree(seats.filter(filter));
    if (!s) { toast('빈 벤치가 없어요 🙂', 1600); return; }
    sitAt(s);
  }
  function faceTo(av, target) {
    const tp = target.position || target;
    av.rotation.y = Math.atan2(tp.x - av.position.x, tp.z - av.position.z);
    if (av === player) { netDirty = true; netTimer = 1; }
  }
  // 길 고르기 — 부스 안 · 부스 뒤 산책길에서 출발하거나 부스 안으로 들어갈 때는 통로를 거쳐 갑니다
  //   (곧장 가면 칸막이 · 뒷벽에 막혀 '돌아갈 길을 못 찾았어요'로 끝났음)
  function inBooth(x, z) {
    for (const b of BOOTHS) {
      const l = toLocal(b.x, b.z, b.facing, x, z);
      if (Math.abs(l.x) < BOOTH_W / 2 + 0.4 && l.z > -BOOTH_D / 2 - 0.5 && l.z < BOOTH_D / 2 + 0.2) return b;
    }
    return null;
  }
  const aislePoint = (b) => { const w = toWorld(b.x, b.z, b.facing, 0, BOOTH_D / 2 + 1.2); return new THREE.Vector3(w.x, 0, w.z); };
  function behindRow(x, z) {                // 부스 뒤 산책길이면 → 그 줄의 가까운 끝 z
    if (Math.abs(x) < AISLE_HALF + BOOTH_D + 0.1) return null;
    const side = Math.sign(x);
    const zs = BOOTHS.filter((b) => b.side === side).map((b) => b.z);
    if (!zs.length) return null;
    const z0 = Math.min(...zs) - BOOTH_W / 2 - 1.6, z1 = Math.max(...zs) + BOOTH_W / 2 + 1.0;
    if (z < z0 || z > z1) return null;
    return { side, z: Math.abs(z - z0) < Math.abs(z - z1) ? z0 : z1 };
  }
  function routeVia(from, to) {
    const leave = (x, z) => {
      const out = [];
      const b = inBooth(x, z);
      if (b) out.push(aislePoint(b));
      const r = behindRow(x, z);
      if (r) out.push(new THREE.Vector3(r.side * (AISLE_HALF + BOOTH_D + 1.6), 0, r.z), new THREE.Vector3(r.side * (AISLE_HALF - 1.2), 0, r.z));
      return out;
    };
    const bf = inBooth(from.x, from.z);
    if (bf && bf === inBooth(to.x, to.z)) return [];
    return [...leave(from.x, from.z), ...leave(to.x, to.z).reverse()]
      .filter((p, i) => i > 0 || Math.hypot(p.x - from.x, p.z - from.z) > 0.8);   // 이미 서 있는 곳이면 건너뜀
  }
  function walkThen(x, z, job) {
    if (player.userData.pose !== 'stand') standUp();
    if (camMode === 'frame') stopFrameView(true);
    const dest = new THREE.Vector3(x, 0, z);
    pushOut(dest, 3);
    waypoints = routeVia(player.position, dest);
    waypoints.push(dest);
    moveTarget = waypoints.shift();
    bestD = Infinity; stuckT = 0; detouring = false;
    pending = job;
    markSpot(dest);
  }

  // 부스로 가기 — 부스 바닥 앞쪽에 서서 액자를 바라봅니다 (카메라는 내 등 뒤에서 부스 쪽으로)
  function goBooth(no) {
    const b = boothByNo(no);
    if (!b) return;
    walkThen(b.front.x, b.front.z, { type: 'booth', no });
    arriveYaw = b.facing;
  }
  function arriveBooth(b) {
    player.rotation.y = b.facing + Math.PI;
    netDirty = true;
    arriveYaw = b.facing;
  }
  // 액자 정면 보기 — 나는 옆으로 비켜서고, 카메라가 액자 정면에서 바라봅니다 (움직이거나 Esc 로 끝)
  function viewFrame(no) {
    const b = boothByNo(no);
    if (!b) return;
    const spot = toWorld(b.x, b.z, b.facing, 1.9, 0.6);
    const d = Math.hypot(spot.x - player.position.x, spot.z - player.position.z);
    if (d > 0.6) { walkThen(spot.x, spot.z, { type: 'frame', no }); return; }
    startFrameView(b);
  }
  function startFrameView(b) {
    if (player.userData.pose !== 'stand') standUp();
    frameView = b;
    camMode = 'frame';
    faceTo(player, new THREE.Vector3(b.x + Math.sin(b.facing) * -BOOTH_D / 2, 0, b.z + Math.cos(b.facing) * -BOOTH_D / 2));
    if (currentPlace) showPanel(currentPlace, true);
  }
  function stopFrameView(quiet) {
    if (camMode !== 'frame') return;
    const b = frameView;
    camMode = 'follow';
    frameView = null;
    if (b) { camYaw = b.facing; camPitch = 0.2; }
    if (!quiet && currentPlace) showPanel(currentPlace, true);
  }
  // ------------------------------------------------------------------
  // 시상 모드 — ?host=1 로 연 화면에만 시상 패널. 버튼 → act 'award' (team N, 0 = 모두 내려오기)
  //   그 팀 번호를 고른 사람만 무대 앞줄 자리(명단 순서)로 순간이동, 다른 팀이 불리면 관람석 빈자리로.
  //   ⚠️ 클라이언트 기준이라 보안 기능이 아님 (주소에 host=1 만 붙이면 누구나 시상 패널을 열 수 있음)
  // ------------------------------------------------------------------
  const HOST = params.get('host') === '1';
  const award = { team: 0, mine: false };
  // 무대 위 자리 — 팀 인원에 맞춰 가운데 정렬, 1.7m 간격, 관람석(-z)을 바라봄
  //   이름 명단이 없으므로, 그 조를 고른 접속자들을 id 순으로 줄 세움 (모든 화면이 같은 순서를 계산)
  function teamRoster(N) {
    const ids = [];
    if (me.team === N) ids.push(me.id);
    for (const [id, o] of others) if (o.team === N) ids.push(id);
    return ids.sort();
  }
  function slotFor(N, id, mi) {
    const t = teamOf(N);
    if (t && t.members.length && mi >= 0) return awardSlot(mi, t.members.length);
    const r = teamRoster(N);
    return awardSlot(r.indexOf(id), r.length);
  }
  function awardSlot(mi, n) {
    n = clamp(n, 1, 6);
    return { x: (clamp(mi, 0, n - 1) - (n - 1) / 2) * 1.7, z: STAGE.z - 0.6, ry: Math.PI };
  }
  // 화면을 잠깐 어둡게 했다가 옮김 (걸어가면 관람석 · 사람에 막힐 수 있어서)
  function hop(text, fn) {
    const f = $('#fade');
    f.querySelector('.go-text').textContent = text;
    f.classList.add('on', 'quick');
    setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 120); setTimeout(() => f.classList.remove('quick'), 700); }, 420);
  }
  function placeMe(x, z, ry) {
    if (player.userData.pose !== 'stand') setPose('stand');
    if (camMode === 'frame') stopFrameView(true);
    moveTarget = null; waypoints = []; pending = null; arriveYaw = null;
    player.position.set(x, standY(x, z), z);
    player.rotation.y = ry;
    camYaw = ry; camPitch = 0.2;
    netDirty = true; netTimer = 1;
  }
  // 시상 카메라 — 관람석 쪽에서 무대 위 한 줄(최대 5명)이 다 들어오게 (움직이거나 드래그하면 보통 시점으로)
  const awardTitle = (N) => { const t = teamOf(N); return `시상 · ${N}조${t && t.team !== `${N}조` ? ' · ' + t.team : ''}`; };
  function drawStageAward() {
    if (!award.team) { stage.draw('DEMO DAY', '발표 무대'); return; }
    const t = teamOf(award.team);
    stage.draw(awardTitle(award.team), t && t.members.length ? t.members.join(' · ') : (t && t.title ? t.title : '축하합니다!'));
  }
  function applyAward(N) {
    N = clamp(Math.round(Number(N) || 0), 0, 99);
    if (N === award.team) return;
    award.team = N;
    drawStageAward();
    refreshHostPanel();
    if (currentPlace) showPanel(currentPlace, true);
    if (award.mine) {
      award.mine = false;
      hop('💺 관람석으로', () => { if (!sitChair()) placeMe(0, CHAIR_BACK - 1.2, 0); });
    }
    toast(N ? `🏆 ${awardTitle(N)} — ${N}조는 아래 '🏆 시상대에 서기'를 눌러 주세요` : '🏆 시상이 끝났어요', N ? 4200 : 2600);
    if (N) showPanel(placeOf('audience'), true);
  }
  // 시상대 빈자리 — 다른 사람이 0.8m 안에 없는 첫 자리 (팀 인원만큼 가운데 정렬, 명단 없으면 5자리)
  function awardSpots() {
    const t = teamOf(award.team);
    const n = clamp(t && t.members.length ? t.members.length : 5, 1, 6);
    return Array.from({ length: n }, (_, i) => awardSlot(i, n));
  }
  function spotFree(sl, ignoreBigger) {
    for (const [id, o] of others) {
      if (ignoreBigger && id > me.id) continue;   // 거의 동시에 섰으면 id 가 앞선 사람이 그 자리
      if (Math.hypot(o.av.position.x - sl.x, o.av.position.z - sl.z) < 0.8) return false;
    }
    return true;
  }
  function standOnAward() {
    if (!award.team) return;
    const spots = awardSpots();
    const sl = spots.find((s) => spotFree(s, false)) || spots[spots.length - 1];
    award.mine = true;
    hop('🏆 시상대로 올라가는 중', () => { placeMe(sl.x, sl.z, sl.ry); camMode = 'award'; showPanel(placeOf('stage'), true); });
    setTimeout(() => toast(`🏆 ${awardTitle(award.team)} — 축하해요!`, 3200), 600);
  }
  // 같은 자리에 id 가 앞선 사람이 서 있으면 다른 빈자리로 비켜 섬
  setInterval(() => {
    if (!award.mine || !award.team) return;
    const here = { x: player.position.x, z: player.position.z };
    if (spotFree(here, true)) return;
    const sl = awardSpots().find((s) => spotFree(s, false));
    if (sl) placeMe(sl.x, sl.z, sl.ry);
  }, 1000);
  function sendAward(N) {
    store.send('act', { id: me.id, type: 'award', team: N });
    applyAward(N);
  }
  function refreshHostPanel() {
    for (const b of document.querySelectorAll('#award-list button')) b.classList.toggle('on', Number(b.dataset.team) === award.team);
  }
  if (HOST) {
    const box = $('#award');
    const list = $('#award-list');
    const nos = TEAMS.length ? TEAMS.map((t) => t.no) : BOOTHS.map((b) => b.no);
    for (const no of nos) {
      const tm = teamOf(no);
      const b = el('button', { type: 'button', textContent: tm && tm.team !== `${no}조` ? `${no} · ${tm.team}` : `${no}조` });
      b.dataset.team = String(no);
      b.onclick = () => sendAward(no);
      list.append(b);
    }
    const down = el('button', { type: 'button', className: 'down', textContent: '모두 내려오기' });
    down.dataset.team = '0';
    down.onclick = () => sendAward(0);
    list.append(down);
    box.classList.add('show');
  }
  function goStage() {
    walkThen(0, STAGE.z - 0.6, { type: 'stage' });
    arriveYaw = Math.PI;                  // 도착하면 관람석 쪽에서 나와 화면을 함께 비춤
  }

  // ------------------------------------------------------------------
  // 장소 — 입구 · 부스(BOOTHS 에서 자동으로) · 발표 무대
  // ------------------------------------------------------------------
  const places = [
    { type: 'entrance', name: '🚪 입구', desc: '데모데이 전시관에 오신 걸 환영해요. 통로를 따라 걸으며 조별 부스를 둘러보세요.', x: 0, z: ENTRY_Z - 3.5 },
    ...BOOTHS.map((b) => ({ type: 'booth', no: b.no, booth: b, name: `부스 ${b.no}${b.team && b.team.team !== `${b.no}조` ? ' · ' + b.team.team : ''}`, desc: b.data && b.data.url ? '‘작품 열기’를 누르면 새 탭에서 작품이 열려요.' : b.data ? '액자에 작품 화면이 걸려 있어요. 발표 때 작품을 직접 보여 줘요.' : '아직 작품이 걸리지 않았어요. 곧 이 액자에 작품이 걸려요.', x: b.front.x, z: b.front.z })),
    { type: 'audience', name: '💺 관람석', desc: '무대 앞 관람석 20석이에요. 빈자리에 앉으면 무대를 바라봐요.', x: 0, z: CHAIR_BACK - 1.2 },
    { type: 'stage', name: '🎤 발표 무대', desc: '통로 끝 발표 무대예요. 계단으로 올라가 발표하고, 앞 관람석에 앉아 들을 수 있어요.', x: 0, z: STAGE.z - 0.6 },
  ];
  const placeOf = (t) => places.find((p) => p.type === t);
  // 지금 있는 곳 — 부스는 부스 바닥 + 바로 앞 통로, 무대는 무대와 관람석, 입구는 아치 앞뒤
  function placeAt(x, z) {
    const b = boothAt(x, z);
    if (b) return places.find((p) => p.type === 'booth' && p.no === b.no);
    if (Math.abs(x) < STAGE.hw + 1.5 && z > STAGE.zf - 1.3) return placeOf('stage');
    if (Math.abs(x) < STAGE.hw + 1.5 && z > CHAIR_BACK - 2.2) return placeOf('audience');
    if (z < ENTRY_Z + 3) return placeOf('entrance');
    return null;
  }

  // ------------------------------------------------------------------
  // 패널 — 장소에 가까이 가면 아래에 할 수 있는 일이 나옵니다
  // ------------------------------------------------------------------
  let currentPlace = null;
  function infoText(p) {
    if (!p) return '';
    if (p.type === 'entrance') return `부스 ${BOOTH_N}곳 · 위쪽 길찾기로 바로 갈 수 있어요`;
    if (p.type === 'booth') {
      const t = p.booth.team;
      return [p.booth.data ? `「${p.booth.data.title || p.booth.data.team}」` : '', t ? `${t.team}${t.members.length ? ' — ' + t.members.join(', ') : ''}` : '', p.booth.data ? '' : '작품 준비 중'].filter(Boolean).join(' · ');
    }
    if (p.type === 'stage' || p.type === 'audience') {
      const used = chairs.filter((c) => seatTaken(c) || mySeat === c).length;
      return `관람석 ${used} / ${chairs.length}석 · ${award.team ? '지금 ' + awardTitle(award.team) : '🎁 시상대의 선물 상자를 눌러 보세요'}`;
    }
    return '';
  }
  function refreshPanelInfo() {
    const i = $('#panel .info');
    if (i) i.textContent = infoText(currentPlace);
  }
  // 장소별 버튼 — [글자, 할 일]. 내일 '작품 열기' · '좋아요' 는 'booth' 칸에 더하면 됩니다
  function actionsFor(p) {
    const pose = player.userData.pose;
    const list = [];
    if (p.type === 'entrance') {
      if (pose === 'sit') list.push(['🙋 일어나기', standUp]);
      else list.push(['🧭 부스 1부터 둘러보기', () => goBooth(1)], ['🪑 벤치에 앉기', () => sitNearest((s) => s.z < ENTRY_Z)]);
    }
    if (p.type === 'booth') {
      const no = p.no;
      if (p.booth && p.booth.data && p.booth.data.url) list.push(['🚀 작품 열기', () => openWork(no)]);
      if (camMode === 'frame' && frameView && frameView.no === no) list.push(['↩️ 돌아가기', () => stopFrameView()]);
      else list.push(['🖼 액자 정면에서 보기', () => viewFrame(no)]);
      if (no > 1) list.push([`⬅️ 부스 ${no - 1}`, () => goBooth(no - 1)]);
      if (no < BOOTH_N) list.push([`부스 ${no + 1} ➡️`, () => goBooth(no + 1)]);
      else list.push(['🎤 발표 무대로', goStage]);
    }
    if ((p.type === 'stage' || p.type === 'audience') && award.team && !award.mine) list.push([`🏆 시상대에 서기 (${award.team}조)`, standOnAward]);
    if ((p.type === 'stage' || p.type === 'audience') && award.mine) list.push(['💺 관람석으로', () => { award.mine = false; if (!sitChair()) placeMe(0, CHAIR_BACK - 1.2, 0); }]);
    if (p.type === 'stage') {
      if (pose === 'sit') list.push(['🙋 일어나기', standUp]);
      else {
        if (stageY(player.position.x, player.position.z) < 0.3) list.push(['🎤 무대에 오르기', goStage]);
        list.push(['💺 관람석에 앉기', () => sitChair()]);
      }
    }
    if (p.type === 'audience') {
      if (pose === 'sit') list.push(['🙋 일어나기', standUp]);
      else list.push(['💺 빈자리에 앉기', () => sitChair()], ['🎤 무대에 오르기', goStage]);
    }
    return list;
  }
  function showPanel(p, force = false) {
    if (p === currentPlace && !force) return;
    currentPlace = p;
    const panel = $('#panel');
    if (!p) { panel.classList.remove('show'); document.body.classList.remove('panel-open'); return; }
    const h3 = el('h3', { textContent: p.name });
    if (p.booth) h3.style.setProperty('--acc', p.booth.color), h3.classList.add('booth');
    panel.replaceChildren(h3, el('p', { textContent: p.desc }), el('div', { className: 'info', textContent: infoText(p) }));
    const row = el('div', { className: 'actions' });
    for (const [label, fn] of actionsFor(p)) row.append(el('button', { type: 'button', textContent: label, onclick: fn }));
    if (row.children.length) panel.append(row);
    panel.classList.add('show');
    document.body.classList.add('panel-open');
  }
  // 길 찾기 버튼 — 입구 · 부스 1~N · 발표 무대
  for (const p of places) {
    const btn = el('button', {
      type: 'button',
      textContent: p.name,
      onclick: () => {
        if (player.userData.pose !== 'stand') standUp();
        pending = null;
        if (p.type === 'booth') return goBooth(p.no);
        if (p.type === 'stage') return goStage();
        if (p.type === 'audience') { walkThen(p.x, p.z, { type: 'chairs' }); arriveYaw = Math.PI; return; }
        walkThen(p.x, p.z, null);
        arriveYaw = Math.PI;              // 입구 — 통로 끝(무대)을 바라보게
      },
    });
    if (p.booth) { btn.classList.add('booth'); btn.style.setProperty('--acc', p.booth.color); }
    $('#places').append(btn);
  }

  // 글 받기 — 안내 문구 · 버튼 글자를 상황에 맞게 바꿔서
  async function askWith(title, ph, notice, okText) {
    const n = $('#modal-notice'), ok = $('#modal-ok');
    const n0 = n.textContent, ok0 = ok.textContent;
    n.textContent = notice;
    ok.textContent = okText;
    const v = await askText(title, ph);
    n.textContent = n0;
    ok.textContent = ok0;
    return v;
  }
  // ------------------------------------------------------------------
  // 내 모습 고르기
  // ------------------------------------------------------------------
  function applyLook() {
    me.color = me.look.color;
    localStorage.setItem('shelter:look', JSON.stringify(me.look));
    localStorage.setItem('shelter:color', me.look.color);
    const old = player;
    const np = makeAvatar(me.look.color, me.name, { hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin });
    np.position.copy(old.position);
    np.rotation.y = old.rotation.y;
    np.userData.pose = old.userData.pose;
    scene.remove(old);
    disposeObj(old);
    scene.add(np);
    player = np;
    netDirty = true;
  }
  // 미리 만들어 둔 캐릭터 8종 — 색만이 아니라 '사람'을 고르는 느낌이 나도록
  const PRESETS = [
    { name: '분홍 단발',  color: '#f4a7b9', hair: 0, hairColor: '#241d1a', skin: SKIN[0] },
    { name: '하늘 단정',  color: '#9ad0ec', hair: 1, hairColor: '#3b2a21', skin: SKIN[1] },
    { name: '연두 묶음',  color: '#b8e0a8', hair: 2, hairColor: '#6b4a2f', skin: SKIN[0] },
    { name: '노랑 모자',  color: '#ffd59a', hair: 3, hairColor: '#241d1a', skin: SKIN[2] },
    { name: '보라 단발',  color: '#c9b6f2', hair: 0, hairColor: '#55392c', skin: SKIN[1] },
    { name: '살구 단정',  color: '#f7c59f', hair: 1, hairColor: '#17151c', skin: SKIN[3] },
    { name: '민트 묶음',  color: '#a8e6cf', hair: 2, hairColor: '#8a6b4a', skin: SKIN[2] },
    { name: '코랄 모자',  color: '#ffb3a7', hair: 3, hairColor: '#4a3326', skin: SKIN[0] },
  ];
  // 작은 3D 미리보기 (고르는 즉시 내 모습이 보입니다)
  let lookOpen = false, prevR = null, prevScene = null, prevCam = null, prevAv = null, prevT = 0;
  function ensurePreview() {
    if (prevR) return;
    const cv = $('#look-preview');
    if (!cv) return;
    prevR = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    prevR.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    prevR.setSize(cv.clientWidth || 170, cv.clientHeight || 240, false);
    prevR.outputColorSpace = THREE.SRGBColorSpace;
    prevR.toneMapping = THREE.ACESFilmicToneMapping;
    prevScene = new THREE.Scene();
    prevScene.add(new THREE.HemisphereLight(0xd6e4ff, 0x6a7a44, 1.5));
    const dl = new THREE.DirectionalLight(0xffdcb4, 2.2);
    dl.position.set(2.5, 4, 3);
    prevScene.add(dl);
    prevCam = new THREE.PerspectiveCamera(30, (cv.clientWidth || 170) / (cv.clientHeight || 240), 0.1, 50);
    prevCam.position.set(0, 1.15, 4.2);
    prevCam.lookAt(0, 1.0, 0);
  }
  function refreshPreview() {
    ensurePreview();
    if (!prevScene) return;
    if (prevAv) prevScene.remove(prevAv);
    prevAv = makeAvatar(me.look.color, me.name, {
      hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin,
    });
    prevAv.userData.label.visible = false;
    prevAv.userData.blob.visible = false;
    prevScene.add(prevAv);
  }
  function markPresetSelected() {
    const box = $('#look-presets');
    if (!box) return;
    [...box.children].forEach((b, i) => {
      const ps = PRESETS[i];
      const same = ps.color === me.look.color && ps.hair === me.look.hair
        && ps.hairColor === me.look.hairColor && ps.skin === me.look.skin;
      b.classList.toggle('on', same);
    });
  }
  function buildLookPicker() {
    const body = $('#look-body');
    if (!body || body.childElementCount) return;
    // 캐릭터 8종
    const pbox = $('#look-presets');
    PRESETS.forEach((ps) => {
      const b = el('button', { type: 'button', className: 'preset' });
      const dot = el('span', { className: 'dot' });
      dot.style.background = ps.color;
      b.append(dot, document.createTextNode(ps.name));
      b.onclick = () => {
        me.look.color = ps.color;
        me.look.hair = ps.hair;
        me.look.hairColor = ps.hairColor;
        me.look.skin = ps.skin;
        applyLook();
        syncLookUI();
      };
      pbox.append(b);
    });
    const mk = (label, items, get, set) => {
      const row = el('div', { className: 'look-row' }, [el('span', { className: 'look-label', textContent: label })]);
      const chips = el('div', { className: 'chips' });
      items.forEach((it) => {
        const b = el('button', { type: 'button', className: 'chip' });
        if (it.swatch) b.style.background = it.swatch; else b.textContent = it.text;
        b.onclick = () => {
          set(it.value);
          applyLook();
          refreshPreview();                 // 미리보기도 바로 (예전엔 캐릭터 8종 버튼만 미리보기를 다시 그렸음)
          for (const c of chips.children) c.classList.remove('on');
          b.classList.add('on');
          markPresetSelected();
        };
        if (get() === it.value) b.classList.add('on');
        chips.append(b);
      });
      row.append(chips);
      body.append(row);
    };
    mk('옷 색', COLORS.map((c) => ({ value: c, swatch: c })), () => me.look.color, (v) => { me.look.color = v; });
    mk('머리', HAIRS.map((h) => ({ value: h.id, text: h.name })), () => me.look.hair, (v) => { me.look.hair = v; });
    mk('머리 색', HAIR_COLORS.map((c) => ({ value: c, swatch: c })), () => me.look.hairColor, (v) => { me.look.hairColor = v; });
    syncLookUI();
  }
  function syncLookUI() {
    const body = $('#look-body');
    if (body) {
      const vals = [me.look.color, me.look.hair, me.look.hairColor];
      [...body.children].forEach((row, ri) => {
        const chips = row.querySelector('.chips');
        if (!chips) return;
        const list = ri === 0 ? COLORS : ri === 1 ? HAIRS.map((x) => x.id) : HAIR_COLORS;
        [...chips.children].forEach((b, bi) => b.classList.toggle('on', list[bi] === vals[ri]));
      });
    }
    markPresetSelected();
    refreshPreview();
  }
  // ------------------------------------------------------------------
  // 대화 — 한 줄씩 주고받고, 머리 위에 말풍선으로 띄웁니다
  // ------------------------------------------------------------------
  const bubbles = [];
  function sayBubble(av, text) {
    const u = av.userData;
    if (u.bubble) { av.remove(u.bubble); disposeObj(u.bubble); u.bubble = null; }
    const lb = makeLabel(text, { size: 30, scale: 0.55, bg: 'rgba(255,255,255,.88)', color: '#2a2338' });
    lb.position.y = 2.55;
    av.add(lb);
    u.bubble = lb;
    bubbles.push({ av, lb, t: 0 });
  }
  // 입장 · 퇴장 알림 — 위쪽 알림 + 대화창에 한 줄 (입장은 작은 딩동 소리)
  let joinQuietUntil = Infinity;
  function announce(text, ding) {
    toast(text, 2600);
    const list = $('#chat-list');
    if (list) { list.append(el('div', { className: 'line sys', textContent: text })); list.scrollTop = list.scrollHeight; }
    if (ding && actx && !muted) { tone(988, 0.05, 0.25); setTimeout(() => tone(1319, 0.05, 0.35), 130); }
  }
  function chatLog(name, text, mine) {
    const list = $('#chat-list');
    if (!list) return;
    const line = el('div', { className: 'line' + (mine ? ' mine' : '') }, [
      el('b', { textContent: name }), el('span', { textContent: text }),
    ]);
    list.append(line);
    while (list.children.length > 60) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
  }
  function sendChat(raw) {
    const text = cleanText(raw);
    if (!text) { toast('보낼 수 없는 내용이에요', 1600); return; }
    if (!cool('chat', 700)) return;
    chatLog(me.name, text, true);
    sayBubble(player, text);
    store.send('chat', { id: me.id, name: me.name, text });
  }

  // ------------------------------------------------------------------
  // 다른 사람들 (함께 모드)
  // ------------------------------------------------------------------
  const others = new Map();
  let roomChecked = false;
  const okColor = (v) => /^#[0-9a-f]{6}$/i.test(v);
  const handlers = {
    onPresence(ids) {
      const n = ids.length;
      const fresh = ids.filter((id) => id !== me.id && !presentIds.includes(id));
      presentIds = ids.slice();
      if (fresh.length) netDirty = true;
      // 시상 중에 새로 들어온 사람에게 — 진행자가 지금 상태를 다시 알림
      if (HOST && award.team && fresh.length) setTimeout(() => store.send('act', { id: me.id, type: 'award', team: award.team }), 800);
      $('#people').textContent = n <= 1 ? '👥 지금은 나 혼자 전시관에' : `👥 지금 ${n}명이 전시관에 있어요 ▾`;
      if ($('#who').classList.contains('open')) renderWho();
      for (const [id, o] of others) if (!ids.includes(id)) {
        if (o.name && performance.now() > joinQuietUntil) announce(`🚶 ${o.name}님이 자리를 떴어요`, false);
        { const u = o.av.userData; if (u.balloon) scene.remove(u.balloon, u.balloonStr); }   // 손에 든 풍선도 함께 치움
        scene.remove(o.av); disposeObj(o.av); others.delete(id);
      }
      if (!roomChecked && n > 0) {
        roomChecked = true;
        if (n > C.roomCapacity) {
          const m = room.match(/^(.*?)-(\d+)$/);
          const next = m ? `${m[1]}-${Number(m[2]) + 1}` : `${room}-2`;
          const box = $('#roomfull');
          box.replaceChildren('이 전시관이 조금 붐벼요.', el('a', { href: `?room=${encodeURIComponent(next)}`, textContent: '한적한 전시관으로 가기 →' }));
          box.style.display = 'block';
        }
      }
    },
    onMove(m) {
      if (!m || m.id === me.id) return;
      let o = others.get(m.id);
      if (!o) {
        const name = String(m.name || '손님').slice(0, 20);
        const lk = m.look && typeof m.look === 'object' ? m.look : {};
        o = {
          av: makeAvatar(okColor(m.color) ? m.color : '#cccccc', name, {
            hair: Number.isInteger(lk.hair) ? lk.hair : undefined,
            hairColor: okColor(lk.hairColor) ? lk.hairColor : undefined,
            skin: okColor(lk.skin) ? lk.skin : undefined,
          }),
          tx: Number(m.x) || 0, tz: Number(m.z) || 0, ry: Number(m.ry) || 0,
        };
        o.av.position.set(o.tx, standY(o.tx, o.tz), o.tz);
        scene.add(o.av);
        others.set(m.id, o);
        if (performance.now() > joinQuietUntil) announce(`👋 ${name}님이 전시관에 왔어요`, true);
      }
      o.name = String(m.name || '손님').slice(0, 20);
      o.tx = Number(m.x) || 0;
      o.tz = Number(m.z) || 0;
      o.ry = Number(m.ry) || 0;
      const u = o.av.userData;
      u.pose = ['stand', 'sit', 'lie', 'crouch'].includes(m.pose) ? m.pose : 'stand';
      u.run = !!m.run;
      o.seat = Number.isInteger(m.seat) && m.seat >= 0 && m.seat < chairs.length && u.pose === 'sit' ? m.seat : -1;
      o.team = Number.isInteger(m.team) ? m.team : 0;
      o.mi = Number.isInteger(m.mi) ? m.mi : -1;
      o.lift = clamp(Number(m.lift) || 0, -0.5, 1.2);
    },
    onAct(a) {
      if (!a || a.id === me.id) return;
      const o = others.get(a.id);
      if (['bow', 'wave', 'dance', 'balloon', 'popper'].includes(a.type) && o) {
        if (a.type === 'balloon') setBalloonColor(o.av, a.n);
        if (a.type === 'popper') {
          const now = performance.now();
          if (now - (o.lastFw || 0) < 2000) return;   // 너무 자주 오는 크래커는 무시 (화면 보호)
          o.lastFw = now;
          o.av.userData.popN = Number(a.n) || 0;
        }
        o.av.userData.gesture = { type: a.type, t: 0, dur: GESTURE_DUR[a.type] };
        npcReact(a.type, o.av.position);
      }
      if (a.type === 'emoji' && o && Number.isInteger(a.e) && a.e >= 0 && a.e < EMOJIS.length) floatEmoji(EMOJIS[a.e], o.av.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
      if (a.type === 'jump' && o) startJump(o.av);
      if (a.type === 'award' && Number.isFinite(Number(a.team))) applyAward(a.team);
    },
    onChat(c) {
      if (!c || c.id === me.id) return;
      const name = String(c.name || '손님').slice(0, 20);
      const text = String(c.text || '').slice(0, 60);
      if (!text) return;
      chatLog(name, text, false);
      const o = others.get(c.id);
      if (o) sayBubble(o.av, text);
      if (!$('#chat').classList.contains('open')) openChat(true);
      $('#btn-chat').classList.add('ping');
      setTimeout(() => $('#btn-chat').classList.remove('ping'), 2000);
    },
  };
  // ------------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------------
  let camYaw = Math.PI * 0.85, camPitch = 0.3, camDist = 8.5, camDistNow = 8.5;
  // 동작 연출 시점 — 내가 동작을 하면 카메라가 앞쪽으로 돌아가 보여 주고, 끝나면 원래 시점으로
  let showCam = null;
  const scF = new THREE.Vector3(), scS = new THREE.Vector3(), scFrom = new THREE.Vector3(), scDir = new THREE.Vector3();
  function endShowCam() { if (showCam) showCam.t = Math.max(showCam.t, showCam.dur - 0.7); }
  // 동작마다 시점 — ang: 얼굴 앞에서 몇 도 돌아간 쪽(옆모습 = 90°), dist: 거리, h: 높이, lookH: 보는 높이
  const SHOT = {
    wave: { ang: 0.45, dist: 3.4, h: 1.65, lookH: 1.35 },
    bow: { ang: Math.PI / 2, dist: 3.4, h: 1.25, lookH: 1.0 },
    balloon: { ang: Math.PI / 2, dist: 4.2, h: 0.6, lookH: 1.9 },
    popper: { ang: Math.PI / 2, dist: 3.6, h: 1.5, lookH: 1.6 },
  };
  // 시작할 때 한 번 — 카메라가 들어갈 공간이 넓은 쪽을 고름 (부스 벽에 붙지 않게)
  function pickShotYaw(type, side) {
    const sh = SHOT[type];
    if (!sh) return 0;
    const P = player.position, ry = player.rotation.y;
    const need = sh.dist + (type === 'popper' ? 2.2 : 0.4);
    let best = null;
    for (const sd of [side, -side]) {
      for (const off of [0, 0.35, -0.35, 0.7, -0.7]) {
        const yaw = ry + sd * (sh.ang + off);
        scFrom.set(P.x, P.y + 1.4, P.z);
        scDir.set(Math.sin(yaw), 0.15, Math.cos(yaw)).normalize();
        camRay.set(scFrom, scDir); camRay.far = need;
        const hit = camRay.intersectObjects(occluders, false)[0];
        const free = hit ? hit.distance : need;
        const score = free - Math.abs(off) * 0.8;   // 많이 비틀수록 감점
        if (!best || score > best.score) best = { yaw, score, free };
        if (free >= need && off === 0) return yaw;   // 원래 각도가 비어 있으면 바로
      }
    }
    return best.yaw;
  }
  function showCamPose(dt) {
    const sc = showCam;
    if (!sc) return null;
    sc.t += dt;
    if (sc.t > sc.dur) { showCam = null; return null; }
    const t = sc.t, P = player.position, u = player.userData;
    const w = smooth(0, 0.7, t) * (1 - smooth(sc.dur - 0.7, sc.dur, t));
    const by = P.y + (u.floatY || 0);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    if (sc.type === 'dance') {
      const a = player.rotation.y + sc.side * (0.5 + t * 0.75);       // 주위를 천천히 돎
      pos.set(P.x + Math.sin(a) * 4.0, by + 1.7 + Math.sin(t * 1.3) * 0.25, P.z + Math.cos(a) * 4.0);
      look.set(P.x, by + 1.0, P.z);
    } else {
      const sh = SHOT[sc.type];
      let dist = sh.dist, h = sh.h, lookH = sh.lookH;
      if (sc.type === 'balloon') dist -= smooth(0, sc.dur, t) * 0.9;                       // 천천히 다가감
      if (sc.type === 'popper') {                                                           // 펑 — 뒤로 빠지며 위쪽 꽃가루까지
        const pull = smooth(0.7, 1.05, t);
        dist += pull * 2.2; h += pull * 0.8; lookH += pull * 0.7;
      }
      pos.set(P.x + Math.sin(sc.yaw) * dist, by + h, P.z + Math.cos(sc.yaw) * dist);
      look.set(P.x, by + lookH, P.z);
      if (sc.type === 'popper' && t > 0.76 && t < 1.15) {                                   // 화면이 살짝 흔들림
        const k = 0.06 * (1 - (t - 0.76) / 0.39);
        pos.x += (Math.random() - 0.5) * k; pos.y += (Math.random() - 0.5) * k; pos.z += (Math.random() - 0.5) * k;
      }
    }
    // 그래도 막히면 그 앞까지만
    scFrom.set(P.x, by + 1.4, P.z);
    scDir.copy(pos).sub(scFrom);
    const L = scDir.length();
    scDir.normalize();
    camRay.set(scFrom, scDir); camRay.far = L;
    const hit = camRay.intersectObjects(occluders, false)[0];
    if (hit) pos.copy(scFrom).addScaledVector(scDir, Math.max(1.6, hit.distance - 0.4));
    pos.y = Math.max(pos.y, groundY(pos.x, pos.z) + 0.35);
    return { pos, look, w };
  }
  let lookDrop = 0, camBlockD = Infinity, camBlockT = 0;
  let introOn = true;
  let detour = 1, detourT = 0, noWayT = 0, detouring = false;
  let bestD = Infinity, stuckT = 0;

  const keys = {};
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    keys[e.code] = true;
    if (e.code === 'Escape') {
      $('#help').classList.remove('show');
      if (camMode === 'frame') stopFrameView();
    }
    // 스페이스 — 점프 (단추에 초점이 있어도 단추가 눌리지 않게)
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jump(); }
    if (e.code === 'KeyC' && !introOn && camMode === 'follow') { camYaw = player.rotation.y + Math.PI; camPitch = 0.3; }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const canvas = renderer.domElement;
  let drag = null;
  // 두 손가락 벌리기 · 모으기로 확대 · 축소 (휴대폰엔 휠이 없음)
  const touches = new Map();
  let pinch = null;
  const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  canvas.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = { d: pinchDist(), base: camDist }; if (drag) drag.moved = 999; return; }
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) { camDist = clamp(pinch.base * pinch.d / pinchDist(), 3.4, 22); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (camMode === 'frame') { if (drag.moved > 8) stopFrameView(); return; }
    if (camMode === 'award' && drag.moved > 8) camMode = 'follow';
    if (drag.moved > 8) endShowCam();
    if (drag.moved > 8) arriveYaw = null;
    camYaw -= dx * 0.006;
    camPitch = clamp(camPitch + dy * 0.004, camMode === 'lie' ? -0.05 : 0.04, camMode === 'lie' ? 1.5 : 1.2);
  });
  canvas.addEventListener('pointerup', (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.moved < 8) handleClick(e);
    drag = null;
  });
  canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; drag = null; });
  canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.01, 3.2, 22); }, { passive: true });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function handleClick(e) {
    if (introOn) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(clickables, false)[0];
    if (hit) {
      const u = hit.object.userData;
      const dd = Math.hypot(hit.point.x - player.position.x, hit.point.z - player.position.z);
      if (u.kind === 'chair' && Number.isInteger(hit.instanceId) && dd < 18) return sitChair(chairs[hit.instanceId]);
      if (u.kind === 'seat' && dd < 14) {
        const free = u.seats.filter((s) => !seatTaken(s)).sort((a, b) => Math.hypot(a.x - hit.point.x, a.z - hit.point.z) - Math.hypot(b.x - hit.point.x, b.z - hit.point.z));
        if (free[0]) return sitAt(free[0]);
        return toast('누군가 앉아 있는 자리예요 🙂', 1600);
      }
      // 선물 상자 — 관람석 · 무대(16m 안)면 바로 열고, 멀면 무대로 걸어감
      if (u.kind === 'gift') {
        if (dd < 16) return festive.openGift(u.rank);
        goStage();
        return toast('🎁 시상대로 가는 중 — 도착하면 선물 상자를 눌러 보세요', 2600);
      }
      // 액자 — 가까우면 정면에서 보기, 멀면 그 부스로 걸어감
      if (u.kind === 'frame') {
        const b = boothByNo(u.no);
        if (b && boothAt(player.position.x, player.position.z) === b) return viewFrame(u.no);
        return goBooth(u.no);
      }
    }
    const g = raycaster.intersectObjects(groundMeshes, false)[0];
    if (g) {
      if (camMode === 'frame') stopFrameView();
      pending = null;
      arriveYaw = null;
      // 같은 곳을 0.4초 안에 두 번 누르면 달리기
      const now = performance.now();
      running = !!(lastTap && now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40);
      lastTap = running ? null : { t: now, x: e.clientX, y: e.clientY };
      moveTarget = g.point.clone();
      const mdx = moveTarget.x - player.position.x, mdz = moveTarget.z - player.position.z;
      const md = Math.hypot(mdx, mdz);
      const MAX_STEP = running ? 14 : 9;
      if (md > MAX_STEP) {
        moveTarget.x = player.position.x + (mdx / md) * MAX_STEP;
        moveTarget.z = player.position.z + (mdz / md) * MAX_STEP;
      }
      if (md < 0.6) moveTarget = null;
      else {
        if (player.userData.pose !== 'stand') standUp();
        pushOut(moveTarget, 3);
        bestD = Infinity; stuckT = 0; detouring = false; waypoints = [];
        markSpot(moveTarget);
      }
    }
  }

  // 대화창
  const chatInput = $('#chat-input');
  if (TOUCH) chatInput.placeholder = chatInput.placeholder.replace(/\s*\(Enter\)/, '');
  const openChat = (open) => {
    $('#chat').classList.toggle('open', open);
    if (open) setTimeout(() => chatInput.focus(), 30); else chatInput.blur();
  };
  $('#btn-chat').onclick = () => openChat(!$('#chat').classList.contains('open'));
  $('#chat-close').onclick = () => openChat(false);
  $('#btn-places').onclick = () => $('#places').classList.toggle('open');
  for (const b2 of document.querySelectorAll('#places button')) {
    b2.addEventListener('click', () => { if (window.innerWidth <= 760) $('#places').classList.remove('open'); });
  }
  const openLook = (open) => {
    buildLookPicker();
    lookOpen = open;
    if (open) refreshPreview();
    $('#look').classList.toggle('show', open);
  };
  $('#look-open').onclick = () => openLook(true);
  $('#look-open2').onclick = () => openLook(true);
  $('#look-done').onclick = () => openLook(false);
  $('#chat-send').onclick = () => { if (chatInput.value.trim()) { sendChat(chatInput.value); chatInput.value = ''; } };
  chatInput.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) { if (chatInput.value.trim()) { sendChat(chatInput.value); chatInput.value = ''; } }
    if (e.key === 'Escape') openChat(false);
  };
  for (const b2 of document.querySelectorAll('#chat-quick button')) b2.onclick = () => sendChat(b2.textContent);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !typing() && !introOn) { openChat(true); e.preventDefault(); }
  });
  $('#room-code').textContent = room;
  $('#room-change').onclick = async () => {
    const raw = await askText('들어갈 방 코드 (비우면 공개 방)', '예) FAMILY');
    if (raw === null) return;
    const code = roomCode(raw);
    if (String(raw).trim() && !code) { toast('방 코드는 한글 · 영문 · 숫자로 적어 주세요', 2400); return; }
    const want = code || 'MAIN';
    localStorage.setItem('gallery:lastRoom', want);
    if (want === room) { toast(`이미 "${want}" 방에 있어요`, 2000); return; }
    toast(`"${want}" 방으로 옮겨 가요…`, 2000);
    const u = new URL(location.href); u.pathname = u.pathname.replace(/\/room\/.*/, '/'); u.search = '?room=' + encodeURIComponent(want);
    location.assign(u.toString());
  };
  $('#room-copy').onclick = async () => {
    const url = location.origin + location.pathname.replace(/\/room\/.*/, '') + '?room=' + encodeURIComponent(room);
    try { await navigator.clipboard.writeText(url); toast('초대 주소를 복사했어요 — 친구에게 붙여넣기 하세요', 3000); }
    catch (e) { toast(url, 5000); }
  };
  $('#g-wave').onclick = () => gesture('wave');
  $('#g-bow').onclick = () => gesture('bow');
  $('#g-dance').onclick = () => gesture('dance');
  $('#g-balloon').onclick = () => gesture('balloon');
  $('#g-popper').onclick = () => gesture('popper');
  const EMOJIS = ['😊', '😂', '🥰', '👍', '👏', '🎉', '💡', '🖼', '🙏', '❤️', '⭐', '🔥'];
  $('#g-emoji').onclick = () => pickFrom('이모지 보내기', EMOJIS, (i) => {
    if (!cool('emoji', 800)) return;
    floatEmoji(EMOJIS[i], player.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 0.8, 1.6);
    store.send('act', { id: me.id, type: 'emoji', e: i });
  });
  $('#people').onclick = () => {
    const box = $('#who');
    box.classList.toggle('open');
    $('#hud').classList.toggle('expanded', box.classList.contains('open'));
    if (box.classList.contains('open')) renderWho();
    layoutPlaces();
  };
  function layoutPlaces() {
    const pl = $('#places');
    if (window.innerWidth <= 760) { pl.style.top = ''; return; }
    pl.style.top = Math.round($('#hud').getBoundingClientRect().bottom + 14) + 'px';
  }
  window.addEventListener('resize', layoutPlaces);
  setTimeout(layoutPlaces, 0);
  $('#btn-help').onclick = () => $('#help').classList.add('show');
  $('#prize-ok').onclick = () => $('#prize').classList.remove('show');
  $('#prize').addEventListener('click', (e) => { if (e.target.id === 'prize') $('#prize').classList.remove('show'); });
  $('#help-close').onclick = () => $('#help').classList.remove('show');
  // 소리 장치를 통째로 새로 — 다른 앱에 다녀와 소리가 안 날 때. 바람 · 나뭇잎 소리를 다시 켭니다.
  function rebuildAudio() {
    const old = actx;
    for (const k of Object.keys(amb)) delete amb[k];
    actx = null; master = null; noiseBuf = null; music.bus = null;
    try { if (old) old.close(); } catch (e) { /* 이미 닫힘 */ }
    ensureAudio();
    if (actx) startAmbient();
  }
  // 소리 깨우기 — 휴대폰은 다른 앱(카톡 등)에 다녀오면 소리 장치가 멈춥니다.
  //   아이폰은 상태가 'suspended' 가 아니라 'interrupted' 라서, 예전 코드(suspended 일 때만 resume)로는 다시 켜지지 않았고
  //   🔊 버튼을 누르면 오히려 '꺼짐'으로 바뀌어 새로고침밖에 방법이 없었습니다.
  //   ※ 아이폰은 카톡 등에 다녀오면 소리 권한을 '몇 초 뒤에야' 돌려줍니다. 예전엔 다시 켜기를 한 번만 시도하고 끝나서
  //     우연히 다시 켜질 때까지 오래 걸렸음 → 돌아오면 0.25초마다 계속 다시 켜기를 시도 (글자 안내는 없음).
  // 아이폰에 '음악처럼 재생하는 소리'라고 알림 — 다른 앱 전환 · 무음 스위치에 덜 끊김 (사파리 16.4+)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 없는 브라우저 */ }
  let wasAway = false, retryTimer = null;
  const soundAsleep = () => !!actx && actx.state !== 'running';
  function wakeAudio() {
    if (!actx || muted) return;
    if (actx.state !== 'running') actx.resume().then(() => { if (actx && actx.state === 'running') $('#sound-tap').classList.remove('show'); }).catch(() => {});
  }
  // 돌아온 뒤 소리가 날 때까지 0.25초마다 다시 켜기 (최대 30초) — 켜지는 순간 표시를 걷음
  function retryWake() {
    clearInterval(retryTimer);
    const t0 = performance.now();
    retryTimer = setInterval(() => {
      if (!actx || muted || document.hidden) { clearInterval(retryTimer); return; }
      if (actx.state === 'running') { clearInterval(retryTimer); $('#sound-tap').classList.remove('show'); wasAway = false; return; }
      actx.resume().catch(() => {});
      if (performance.now() - t0 > 30000) clearInterval(retryTimer);
    }, 250);
  }
  // 화면을 만지거나 키를 누르면 그 순간에도 바로 시도 (휴대폰은 '손을 떼는 순간(touchend)'이 가장 확실)
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, wakeAudio, { capture: true, passive: true });
  // 다른 앱으로 나가면 스스로 쉬고, 돌아오면 계속 다시 켜기 + 아직 안 켜졌으면 '다시 켜는 중' 표시
  document.addEventListener('visibilitychange', () => {
    if (!actx) return;
    if (document.hidden) {
      wasAway = true;
      clearInterval(retryTimer);
      if (actx.state === 'running') actx.suspend().catch(() => {});
      return;
    }
    if (muted) return;
    wakeAudio();
    retryWake();
    // (돌아온 뒤 '다시 켜는 중' 글자는 띄우지 않음 — 조용히 다시 켜기만)
  });
  window.addEventListener('pageshow', () => { wakeAudio(); if (actx && !muted) retryWake(); });
  $('#sound-tap').addEventListener('click', () => { wakeAudio(); });
  const musicLabel = () => { $('#btn-music').innerHTML = music.on ? '🎵<span> 음악 켜짐</span>' : '🎵<span> 음악 꺼짐</span>'; $('#btn-music').classList.toggle('off', !music.on); };
  musicLabel();
  $('#btn-music').onclick = () => {
    ensureAudio();
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
    music.on = !music.on;
    localStorage.setItem('gallery:music', music.on ? 'on' : 'off');
    musicLabel();
    toast(music.on ? '🎵 축제 음악을 켰어요' : '🎵 음악을 껐어요 (효과음은 그대로)', 1500);
  };
  $('#btn-sound').onclick = () => {
    ensureAudio();
    // 소리가 멈춰 있으면(다른 앱에 다녀온 뒤 등) 이 버튼은 '다시 켜기' — 끄지 않습니다
    if (soundAsleep() && !muted) {
      // 직접 눌렀는데도 멈춰 있으면 — 마지막 수단으로 소리 장치를 새로 만듦 (아이폰의 '켜짐인데 소리 없음' 문제 대비)
      if (wasAway) { wasAway = false; clearInterval(retryTimer); rebuildAudio(); } else actx.resume().catch(() => {});
      startAmbient();
      $('#sound-tap').classList.remove('show');
      toast('🔊 소리를 다시 켰어요', 1500);
      return;
    }
    if (actx && actx.state !== 'running') actx.resume().catch(() => {});
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, actx.currentTime, 0.2);
    if (!muted) startAmbient();
    $('#btn-sound').innerHTML = muted ? '🔇<span> 소리 꺼짐</span>' : '🔊<span> 소리 켜짐</span>';
  };
  // 휴대폰 첫 안내 카드 — "어떻게 움직여야 하는지 모르겠다"는 분들을 위해. 길찾기 버튼도 반짝이게 합니다.
  //   '알겠어요'를 누르거나 길찾기를 한 번 쓰면 다시 안 띄웁니다 (안 눌러도 3번까지만)
  function showCoach(lines) {
    const K = 'gallery:coach';
    const n = Number(localStorage.getItem(K) || 0);
    if (n >= 3) return;
    localStorage.setItem(K, String(n + 1));
    const card = el('div', { id: 'coach', className: 'glass' }, [
      el('h4', { textContent: '이렇게 움직여요' }),
      ...lines.map((t) => { const p = el('p'); p.innerHTML = t; return p; }),
      el('button', { type: 'button', textContent: '알겠어요' }),
    ]);
    document.body.append(card);
    const btn = $('#btn-places');
    btn.classList.add('coach-pulse');
    const done = () => { localStorage.setItem(K, '9'); card.classList.remove('show'); btn.classList.remove('coach-pulse'); setTimeout(() => card.remove(), 400); };
    card.querySelector('button').onclick = done;
    btn.addEventListener('click', done, { once: true });
    setTimeout(() => card.classList.add('show'), 700);
  }
  $('#myname').textContent = me.name;
  $('#rename').onclick = () => {
    me.name = randomName();
    localStorage.setItem('shelter:name', me.name);
    $('#myname').textContent = me.name;
    const old = player.userData.label;
    const nl = makeLabel(me.name, { size: 32, scale: 0.44 });
    nl.position.copy(old.position);
    player.remove(old);
    disposeObj(old);
    player.add(nl);
    player.userData.label = nl;
    netDirty = true;
  };
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------------
  // 내 캐릭터 — 입구 아치 앞마당, 통로(북쪽)를 바라보고 시작
  // ------------------------------------------------------------------
  player = makeAvatar(me.look.color, me.name, { hair: me.look.hair, hairColor: me.look.hairColor, skin: me.look.skin });
  {
    const x = 0, z = ENTRY_Z - 6;
    player.position.set(x, standY(x, z), z);
    player.rotation.y = 0;
  }
  scene.add(player);

  // ------------------------------------------------------------------
  // 시작 화면
  // ------------------------------------------------------------------
  document.title = C.title;
  $('#hud-title').textContent = C.title;
  $('#intro-title').textContent = C.title;
  $('#intro-sub').textContent = C.subtitle;
  $('#intro-mode').textContent = store.mode === 'supabase'
    ? `함께 모드 · 방 "${room}"`
    : '혼자 모드 · config.js 에 Supabase 공개 키를 넣으면 함께 모드';
  if (store.mode === 'local') $('#people').textContent = '혼자 모드로 둘러보는 중';
  await setupComposer();   // 빛 효과 준비 (내일 부스 데이터를 불러올 땐 여기서 Promise.all 로 함께)
  // 셰이더 미리 준비 — 들어가는 순간 처음 그릴 때 멈추지 않게.
  //   예전엔 네 방향을 실제로 한 번씩 그려 보며 데웠는데, 쉼터는 장면이 커서 이 단계만 10~24초가 걸려
  //   공간 사이 이동이 매우 느렸습니다. 이제 셰이더만 비동기로 준비해서 '불러오는 중 · 가는 중' 표시도 멈추지 않습니다.
  //   (처음 몇 프레임은 시작 화면 · 이동 막 뒤에서 그려져 사용자에게 보이지 않습니다)
  try {
    // ① 장면의 모든 재질(숨겨진 것 포함) 셰이더를 비동기로 준비
    // 빛 번짐(블룸)을 쓰면 장면은 화면이 아니라 '중간 그림판'에 그려집니다 — 셰이더도 그 대상으로 준비해야 다시 만들지 않음
    if (composer) renderer.setRenderTarget(composer.readBuffer);
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    renderer.setRenderTarget(null);
    // ② 지금 시점에서 딱 한 번 그려 그림자 · 빛 번짐 셰이더까지 준비 (예전엔 네 방향을 그려서 매우 느렸음)
    if (composer) composer.render(0.016); else renderer.render(scene, camera);
  } catch (e) { console.warn('미리 준비 생략', e); }
  const enterBtn = $('#enter');
  enterBtn.disabled = false;
  enterBtn.textContent = '전시관으로 들어가기';
  $('#intro').classList.add('ready');
  const nameInput = $('#intro-name');
  nameInput.value = me.name;
  // 시작 화면에서 명단은 고르지 않음 — 시상 때 그 조 학생이 '시상대에 서기'를 직접 누름
  nameInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  const codeInput = $('#intro-code');
  codeInput.value = room === 'MAIN' ? '' : room;
  {
    const urlHasRoom = params.get('room') || pathCode;
    const last = localStorage.getItem('gallery:lastRoom');
    if (!urlHasRoom && last && last !== 'MAIN') {
      codeInput.value = last;
      $('#intro-mode').textContent = `지난번 방 "${last}" 으로 들어가요 · 공개 방은 코드를 지우세요`;
    }
  }
  codeInput.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) enterBtn.click(); };
  enterBtn.onclick = () => {
    const want = roomCode(codeInput.value) || 'MAIN';
    localStorage.setItem('gallery:lastRoom', want);
    if (want !== room) { location.href = location.pathname.replace(/\/room\/.*/, '') + '?room=' + encodeURIComponent(want); return; }
    const nm = nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (nm && nm !== me.name) {
      me.name = nm;
      localStorage.setItem('shelter:name', nm);
      $('#myname').textContent = nm;
      applyLook();
    }
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    startAmbient();
    $('#btn-sound').innerHTML = '🔊<span> 소리 켜짐</span>';
    $('#intro').classList.remove('show');
    document.body.classList.remove('intro');
    introOn = false;
    camYaw = player.rotation.y + Math.PI;
    camPitch = 0.22;
    camera.position.set(player.position.x - Math.sin(player.rotation.y) * 8, player.position.y + 4, player.position.z - Math.cos(player.rotation.y) * 8);
    // 휴대폰은 안내 카드(길찾기 · 톡 · 끌기), 컴퓨터는 예전처럼 한 줄 안내
    //   (다른 공간에서 건너온 경우엔 이미 길찾기를 쓴 것이라 띄우지 않음)
    // 휴대폰은 들어올 때마다 길찾기 버튼이 반짝 — 이번 방문에서 한 번 누르면 멈춤 (안내 카드는 처음 몇 번만)
    if (TOUCH && params.get('go') !== '1') {
      const pb = $('#btn-places');
      pb.classList.add('coach-pulse');
      pb.addEventListener('click', () => pb.classList.remove('coach-pulse'), { once: true });
    }
    if (TOUCH) { if (params.get('go') !== '1') showCoach([
          '📍 위쪽 <b>길찾기</b>를 누르면 입구 · 부스 · 발표 무대로 <b>바로 이동</b>해요',
          '👆 화면을 <b>터치</b>하면 그곳으로 이동할 수 있어요',
        ]); }
    else if (!localStorage.getItem('gallery:viewHint')) {
      localStorage.setItem('gallery:viewHint', '1');
      const touch = window.matchMedia('(pointer: coarse)').matches;
      setTimeout(() => toast(touch
        ? '👆 바닥을 누르면 걸어가요 · 아치를 지나 부스를 둘러보세요'
        : '🖱 바닥을 클릭하거나 W A S D 로 걸어요 · 아치를 지나 부스를 둘러보세요', 5200), 1200);
    }
    joinQuietUntil = performance.now() + 4000;
    if (room !== 'MAIN') localStorage.setItem('gallery:lastRoom', room);
    store.connect(handlers);
    netDirty = true;
  };
  // ------------------------------------------------------------------
  // 다른 공간 오가기 — ⚠️ 지금은 막아 둠 (전시관은 아직 쉼터 · 불멍 · 바닷가와 오가지 않음)
  //   나중에 열 때는 OTHERS 에 공간을 넣고, 다른 공간 쪽 버튼과 vercel.json(/gallery/)도 함께 손볼 것
  //   (이름 · 모습(localStorage)과 방 코드(?room=)가 따라가고, ?go=1 이면 시작 화면 없이 들어감)
  // ------------------------------------------------------------------
  {
    const OTHERS = [];
    const fade = $('#fade');
    for (const OTHER of OTHERS) {
      const otherUrl = () => {
        const base = location.protocol === 'file:' ? new URL(OTHER.local, location.href).href : new URL(OTHER.web, location.origin).href;
        return base + '?room=' + encodeURIComponent(room) + '&go=1';
      };
      const portalBtn = el('button', { type: 'button', className: 'portal' }, [el('span', { textContent: OTHER.label }), el('span', { className: 'cnt' })]);
      portalBtn.onclick = () => {
        if (window.innerWidth <= 760) $('#places').classList.remove('open');
        fade.querySelector('.go-text').textContent = OTHER.goText;               // '○○로 가는 중'
        fade.classList.add('on');                                               // 화면이 천천히 어두워지고
        if (master && actx) master.gain.setTargetAtTime(0, actx.currentTime, 0.15);   // 소리도 함께 잦아든 뒤
        setTimeout(() => location.assign(otherUrl()), 350);                      // 건너갑니다 (기다림은 짧게)
      };
      $('#places').append(portalBtn);
      // 건너편 공간에 지금 몇 명 있는지 (함께 모드일 때만)
      if (store.watchCount) store.watchCount(`${OTHER.ch}:${room}`, (n) => { portalBtn.querySelector('.cnt').textContent = n > 0 ? ` · 지금 ${n}명` : ''; });
    }
    // 건너왔으면 — 시작 화면 없이 바로 들어갑니다. 주소의 go=1 은 지워서, 그 주소를 공유하면 시작 화면부터 보이게.
    if (params.get('go') === '1') {
      const u = new URL(location.href);
      u.searchParams.delete('go');
      history.replaceState(null, '', u.toString());
      // 바로 아래에서 선언되는 루프 변수가 준비된 뒤에 들어가도록 한 박자 늦춥니다
      setTimeout(() => {
        enterBtn.click();
        document.documentElement.classList.remove('arriving');
        fade.classList.remove('instant');
        // 처음 몇 프레임(셰이더 · 그림자 첫 준비)은 막 뒤에서 그린 다음 걷습니다
        let frames = 0;
        const reveal = () => (++frames < 5 ? requestAnimationFrame(reveal) : fade.classList.remove('on'));
        requestAnimationFrame(reveal);
      }, 0);
      // 브라우저가 새 화면의 소리를 막았으면 — 한 번 누르면 켜지도록 안내
      setTimeout(() => {
        if (!actx || actx.state === 'running' || muted) return;
        const pill = $('#sound-tap');
        pill.classList.add('show');
        const on = () => {
          actx.resume();
          startAmbient();
          pill.classList.remove('show');
          window.removeEventListener('pointerdown', on, true);
          window.removeEventListener('keydown', on, true);
        };
        window.addEventListener('pointerdown', on, true);
        window.addEventListener('keydown', on, true);
      }, 500);
    }
  }
  // 확인용 — 그래픽 메모리(지오메트리 · 텍스처 수)와 셰이더 수
  window.__dbg = () => ({ ...renderer.info.memory, programs: renderer.info.programs.length, others: others.size });
  const clock = new THREE.Clock();
  const perfMon = { n: 0, t: 0, level: 0, low: 0 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const tmpMove = new THREE.Vector3(), tmpMove2 = new THREE.Vector3();
  const camRay = new THREE.Raycaster();
  window.__gal = {   // 확인용 (검증 스크립트 · 콘솔에서)
    openGift: (r) => festive.openGift(r),
    degrade: () => { perfMon.t = 5; perfMon.n = 1; perfMon.low = 1; },
    net: () => ({ rate: +netRate().toFixed(3), n: presentIds.length }),
    perf: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, shadow: renderer.shadowMap.enabled, bloom: !!composer, pr: renderer.getPixelRatio() }),
    npcs: () => npcs.map((n) => ({ x: +n.av.position.x.toFixed(2), z: +n.av.position.z.toFixed(2), g: n.av.userData.gesture ? n.av.userData.gesture.type : null })),
    npcNear: () => npcs.forEach((n, i) => { n.to = null; n.pause = 30; const x = player.position.x + (i ? 1.6 : -1.6), z = player.position.z - 2.4; n.av.position.set(x, standY(x, z), z); }),
    pos: () => player.position.clone(), cam: () => camera.position.clone(), camMode: () => camMode,
    booths: () => BOOTHS.map((b) => ({ no: b.no, side: b.side, x: b.x, z: b.z, facing: b.facing, color: b.color, front: b.front })),
    goBooth: (no) => goBooth(no), viewFrame: (no) => viewFrame(no), goStage: () => goStage(),
    place: () => (currentPlace ? currentPlace.name : null), moving: () => !!moveTarget,
    blockers: () => blockers.length, stage: () => ({ ...STAGE }), plaza: () => ({ ...PLAZA }),
    teleport: (x, z, ry = 0) => { if (player.userData.pose !== 'stand') setPose('stand'); if (camMode !== 'follow') camMode = 'follow'; player.position.set(x, standY(x, z), z); player.rotation.y = ry; moveTarget = null; pending = null; camYaw = ry + Math.PI; },
    key: (code, on) => { keys[code] = !!on; },
    // ---- 함께 모드 흉내 (키 없이 broadcast 경로를 그대로 태움) ----
    standOnAward: () => standOnAward(),
    standOnAward: () => standOnAward(),
    me: () => ({ id: me.id, name: me.name, team: me.team, mi: me.mi, seat: mySeat ? mySeat.i : null, pose: player.userData.pose }),
    setMe: (team, mi = -1) => { me.team = team; me.mi = mi; const t = teamOf(team); if (t && t.members[mi]) me.name = t.members[mi]; netDirty = true; },
    awardState: () => ({ ...award }),
    chairs: () => chairs.map((c) => ({ i: c.i, x: c.x, z: c.z, taken: seatTaken(c) })),
    // 가짜 접속자 추가 — list: [{ team, mi, name?, id? }] 또는 숫자(관람객 n명)
    addFakes: (list) => {
      if (typeof list === 'number') list = Array.from({ length: list }, () => ({ team: 0, mi: -1 }));
      list.forEach((f, k) => {
        const id = f.id || `sim-${String(SIM.size + 1).padStart(3, '0')}`;
        const t = teamOf(f.team);
        const x = (k % 6 - 2.5) * 1.1, z = ROW_Z0 + 2 + Math.floor(k / 6) * 1.2;
        SIM.set(id, { id, name: f.name || (t && t.members[f.mi]) || `관람객${SIM.size + 1}`, team: f.team || 0, mi: Number.isInteger(f.mi) ? f.mi : -1,
          color: COLORS[SIM.size % COLORS.length], hair: SIM.size % 4, x, z, ry: 0, pose: 'stand', lift: 0, seat: -1, onStage: false });
      });
      simSync();
      return SIM.size;
    },
    clearFakes: () => { SIM.clear(); simSync(); },
    // 가짜 접속자가 각자 '관람석에 앉기'를 누른 것처럼 (앞줄 · 가운데부터)
    simSeatAll: () => { for (const f of SIM.values()) if (f.pose !== 'sit') simSit(f); return [...SIM.values()].filter((f) => f.pose === 'sit').length; },
    simSit: (id, chairIdx) => { const f = SIM.get(id); if (f) simSit(f, chairs[chairIdx]); },
    // 진행자가 award(N) 를 보낸 것처럼 — 내 화면은 받은 broadcast 그대로, 가짜 접속자는 같은 규칙으로 움직임
    award: (N) => {
      handlers.onAct({ id: 'sim-host', type: 'award', team: N });
      for (const f of SIM.values()) {
        if (f.onStage && f.team !== N) { f.onStage = false; simSit(f); }
        if (N && f.team === N) { const sl = slotFor(N, f.id, f.mi); Object.assign(f, { x: sl.x, z: sl.z, ry: sl.ry, pose: 'stand', lift: 0, seat: -1, onStage: true }); }
      }
      simSync();
      return award.team;
    },
    onStage: () => {
      const pts = [...SIM.values()].filter((f) => f.onStage).map((f) => ({ who: f.name, x: f.x, z: f.z }));
      if (award.mine) pts.push({ who: me.name + ' (나)', x: player.position.x, z: player.position.z, y: player.position.y });
      let minD = Infinity;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
      return { n: pts.length, minDist: pts.length > 1 ? +minD.toFixed(3) : null, pts };
    },
  };
  const SIM = new Map();
  function simSync() {
    handlers.onPresence([me.id, ...SIM.keys()]);
    for (const f of SIM.values()) handlers.onMove({ id: f.id, name: f.name, color: f.color, look: { hair: f.hair }, x: f.x, z: f.z, ry: f.ry, pose: f.pose, lift: f.lift, seat: f.seat, team: f.team, mi: f.mi });
  }
  function simSit(f, pref) {
    f.pose = 'stand'; f.seat = -1;
    handlers.onMove({ id: f.id, name: f.name, color: f.color, look: { hair: f.hair }, x: f.x, z: f.z, ry: f.ry, pose: 'stand', seat: -1, team: f.team, mi: f.mi });
    const c = pref || freeChair(null);
    if (!c) return;
    Object.assign(f, { x: c.x, z: c.z, ry: 0, pose: 'sit', lift: c.off, seat: c.i });
    handlers.onMove({ id: f.id, name: f.name, color: f.color, look: { hair: f.hair }, x: f.x, z: f.z, ry: f.ry, pose: 'sit', lift: f.lift, seat: f.seat, team: f.team, mi: f.mi });
  }
  let infoT = 0, lastRun = false, seatCheckT = 0;
  // 걸음 — 발이 땅에 닿을 때마다 (내 발이면 발소리)
  function stepCheck(av, mine) {
    const u = av.userData;
    const n = Math.floor(u.gait / Math.PI);
    if (u.stepN === undefined || n === u.stepN) { u.stepN = n; return; }
    u.stepN = n;
    if (!mine || u.pose !== 'stand' || u.walk < 0.3 || u.jumpV != null) return;
    const x = av.position.x, z = av.position.z;
    const kind = stageY(x, z) > 0.05 ? 'wood' : outside(x, z) > 0 ? 'grass' : (Math.abs(x) < 1.7 && z < STAGE.zf - 0.9 && z > ENTRY_Z - 2.5) || boothAt(x, z) ? 'soft' : 'stone';
    stepSound(kind, u.run ? 1.3 : 1);
  }
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    festive.update(t, dt);

    // ---------- 이동 (쉼터와 같은 규칙: 키보드 정면 충돌은 멈춤 · 클릭 이동은 우회) ----------
    let mx = 0, mz = 0;
    if (!typing() && !introOn) {
      if (keys.KeyW || keys.ArrowUp) mz += 1;
      if (keys.KeyS || keys.ArrowDown) mz -= 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
    }
    let vx = 0, vz = 0;
    if (mx || mz) {
      moveTarget = null; pending = null;
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      vx = fx * mz + rx * mx;
      vz = fz * mz + rz * mx;
    } else if (moveTarget) {
      vx = moveTarget.x - player.position.x;
      vz = moveTarget.z - player.position.z;
      if (Math.hypot(vx, vz) < 0.5) {
        if (waypoints.length) { moveTarget = waypoints.shift(); bestD = Infinity; stuckT = 0; }
        else { moveTarget = null; vx = vz = 0; }
      }
    }
    const len = Math.hypot(vx, vz);
    let moving = len > 0.001;
    const beforeX = player.position.x, beforeZ = player.position.z;
    if (moving) {
      if (player.userData.pose !== 'stand') standUp();
      if (camMode === 'frame') stopFrameView();
      if (camMode === 'award') camMode = 'follow';
      const runNow = (mx || mz) ? !!(keys.ShiftLeft || keys.ShiftRight) : (running && !!moveTarget);
      player.userData.run = runNow;
      const sp = (runNow ? 9.0 : 4.8) * dt;
      const ux = vx / len, uz = vz / len;
      const stepTo = (dirx, dirz, out) => {
        out.set(beforeX + dirx * sp, 0, beforeZ + dirz * sp);
        pushOut(out);
        return Math.hypot(out.x - beforeX, out.z - beforeZ);
      };
      let gotX, gotZ, got = stepTo(ux, uz, tmpMove);
      gotX = tmpMove.x; gotZ = tmpMove.z;
      if (got < sp * 0.5) {
        if (moveTarget) {
          // 목적지가 있으면 벽을 돌아갑니다. 한 번 정한 방향은 길이 뚫릴 때까지 유지 (뱅글뱅글 방지)
          if (!detouring) {
            const tx = moveTarget.x - beforeX, tz = moveTarget.z - beforeZ;
            detour = (-uz * tx + ux * tz) > 0 ? 1 : -1;
            detouring = true;
          }
          detourT = 0.2;
          const px2 = -uz * detour, pz2 = ux * detour;
          const mxl = ux + px2, mzl = uz + pz2, ml2 = Math.hypot(mxl, mzl) || 1;
          for (const [dx2, dz2] of [[mxl / ml2, mzl / ml2], [px2, pz2]]) {
            const d2 = stepTo(dx2, dz2, tmpMove2);
            if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
            if (got > sp * 0.6) break;
          }
        } else {
          // 키보드 — 비스듬히 닿았으면 미끄러지고, 정면(35° 이내)이면 그냥 섭니다
          const pushX = tmpMove.x - (beforeX + ux * sp), pushZ = tmpMove.z - (beforeZ + uz * sp);
          const pl = Math.hypot(pushX, pushZ);
          if (pl > 1e-5) {
            const nx2 = pushX / pl, nz2 = pushZ / pl;
            const dotv = ux * nx2 + uz * nz2;
            if (Math.abs(dotv) <= 0.82) {
              const sx = ux - dotv * nx2, sz = uz - dotv * nz2;
              const sl = Math.hypot(sx, sz);
              if (sl > 1e-5) {
                const d2 = stepTo(sx / sl, sz / sl, tmpMove2);
                if (d2 > got) { gotX = tmpMove2.x; gotZ = tmpMove2.z; got = d2; }
              }
            }
          }
        }
      } else { detouring = false; detourT = 0; }
      detourT -= dt;
      if (got < sp * 0.3) { gotX = beforeX; gotZ = beforeZ; got = 0; }
      player.position.x = gotX;
      player.position.z = gotZ;
      if (got > sp * 0.35) {
        player.rotation.y = Math.atan2(gotX - beforeX, gotZ - beforeZ);
        noWayT = 0;
      } else {
        moving = false;
        noWayT += dt;
        if (moveTarget && Math.hypot(moveTarget.x - beforeX, moveTarget.z - beforeZ) < 2.2) { moveTarget = null; noWayT = 0; }
        else if (moveTarget && noWayT > 1.2) {
          moveTarget = null; noWayT = 0;
          blockedMsg -= dt;
          if (blockedMsg <= 0) { toast('이쪽은 막혀 있어요. 다른 쪽을 클릭해 보세요 🙂', 1800); blockedMsg = 8; }
        }
      }
      if (moveTarget) {
        const curD = Math.hypot(moveTarget.x - player.position.x, moveTarget.z - player.position.z);
        if (curD < bestD - 0.3) { bestD = curD; stuckT = 0; }
        else if ((stuckT += dt) > 3.5) {
          moveTarget = null; detouring = false; stuckT = 0; bestD = Infinity;
          toast('돌아갈 길을 못 찾았어요. 다른 쪽을 클릭해 보세요 🙂', 1800);
        }
      } else { bestD = Infinity; stuckT = 0; }
      if (moveTarget && !drag && moving && detourT <= 0) {
        const mvx = gotX - beforeX, mvz = gotZ - beforeZ;
        const tgx = moveTarget.x - beforeX, tgz = moveTarget.z - beforeZ;
        const ml3 = Math.hypot(mvx, mvz) * Math.hypot(tgx, tgz);
        if (ml3 > 1e-6 && Math.hypot(mvx, mvz) > sp * 0.6 && (mvx * tgx + mvz * tgz) / ml3 > 0.6) {
          let d = Math.atan2(-mvx, -mvz) - camYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          camYaw += d * Math.min(1, dt * 1.6);
        }
      }
      netDirty = true;
    } else if (player.userData.pose === 'stand') {
      pushOut(player.position);
    }
    if (!moveTarget) running = false;
    if (!moving) player.userData.run = false;
    if (player.userData.run !== lastRun) { lastRun = player.userData.run; netDirty = true; }
    // 걸어간 뒤 할 일 (부스 앞 도착 · 액자 정면 보기 · 무대)
    if (pending && !moveTarget) {
      const job = pending;
      pending = null;
      if (job.type === 'booth') {
        const b = boothByNo(job.no);
        if (b && Math.hypot(b.front.x - player.position.x, b.front.z - player.position.z) < 2.0) arriveBooth(b);
      }
      if (job.type === 'frame') {
        const b = boothByNo(job.no);
        const spot = b && toWorld(b.x, b.z, b.facing, 1.9, 0.6);
        if (b && Math.hypot(spot.x - player.position.x, spot.z - player.position.z) < 1.6) startFrameView(b);
      }
      if (job.type === 'chairs' && Math.hypot(player.position.x, player.position.z - (CHAIR_BACK - 1.2)) < 2.5) sitChair();
      if (job.type === 'stage' && stageY(player.position.x, player.position.z) > 0.3) { player.rotation.y = Math.PI; netDirty = true; }
    }
    if (mySeat && mySeat.kind === 'chair' && (seatCheckT -= dt) <= 0) {
      seatCheckT = 0.3;
      for (const [id, o] of others) {
        if (o.av.userData.pose !== 'sit' || !(id < me.id)) continue;
        if (o.seat !== mySeat.i && Math.hypot(o.tx - mySeat.x, o.tz - mySeat.z) >= 0.3) continue;
        const c = freeChair(mySeat, mySeat);
        if (c) { sitAt(c); toast('같은 자리에 먼저 앉은 분이 있어 옆자리로 옮겼어요 🙂', 2200); }
        else { standUp(); toast('관람석이 다 찼어요 🙂', 1600); }
        netTimer = 1;
        break;
      }
    }
    const still = player.userData.pose === 'stand' || player.userData.pose === 'crouch';
    const wantY = standY(player.position.x, player.position.z) + (still ? 0 : seatOff);
    player.position.y = lerp(player.position.y, wantY, Math.min(1, dt * 12));
    animateAvatar(player, dt, moving);
    stepCheck(player, true);
    player.visible = camMode !== 'frame';          // 액자 정면 보기 중엔 내 캐릭터가 액자를 가리지 않게 (내 화면에서만)
    player.userData.label.visible = player.userData.pose === 'stand' && camera.position.distanceTo(player.position) > 9;

    // ---------- 하늘 · 빛 ----------
    SKY_U.uTime.value = t;
    skyGroup.position.set(camera.position.x, 0, camera.position.z);
    sunLight.target.position.set(player.position.x, 0, player.position.z);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sunLight.userData.dir, 90);
    for (let i = 0; i < archFlags.length; i++) archFlags[i].rotation.y = Math.sin(t * 2.2 + i * 1.3) * 0.35;
    for (let i = 0; i < lamps.length; i++) lamps[i].flag.rotation.x = Math.sin(t * 1.7 + i) * 0.06;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt / (r.mark ? 0.7 : 1.6);
      r.m.scale.setScalar(r.size * (1 + r.t * (r.mark ? 1.2 : 4)));
      r.m.material.opacity = (r.mark ? 0.85 : 0.5) * (1 - r.t);
      if (r.t >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }

    // ---------- 다른 사람들 ----------
    for (const o of others.values()) {
      const px2 = o.av.position.x, pz = o.av.position.z;
      // 받은 위치까지 걸음 속도로 이어 걷습니다 — 위치를 드물게 받아도 뚝뚝 끊기지 않게. 멀리 떨어졌거나 앉을 땐 바로.
      const dxr = o.tx - px2, dzr = o.tz - pz, dr = Math.hypot(dxr, dzr);
      if (dr > 1e-4) {
        const stepR = dr > 4 || o.av.userData.pose !== 'stand' ? dr : Math.min(dr, (o.av.userData.run ? 10 : 5.6) * dt * (dr > 1.2 ? 1.5 : 1));
        o.av.position.x = px2 + (dxr / dr) * stepR;
        o.av.position.z = pz + (dzr / dr) * stepR;
      }
      const st = o.av.userData.pose === 'stand' || o.av.userData.pose === 'crouch';
      o.av.position.y = standY(o.av.position.x, o.av.position.z) + (st ? 0 : (o.lift || 0));
      o.av.rotation.y = o.ry;
      animateAvatar(o.av, dt, Math.hypot(o.tx - px2, o.tz - pz) > 0.05);
      if (camMode === 'award' && stageY(o.av.position.x, o.av.position.z) < 0.3) o.av.userData.label.visible = false;   // 시상 화면 — 관람석 이름표가 무대를 가리지 않게
      stepCheck(o.av, false);
    }

    // ---------- 둘러보는 관람객 ----------
    for (const n of npcs) {
      const u = n.av.userData;
      let walking = false;
      if (n.to) {
        const dx = n.to.x - n.av.position.x, dz = n.to.z - n.av.position.z, d = Math.hypot(dx, dz);
        if (d < 0.08) { n.at = n.to.b; n.to = null; n.pause = 6 + Math.random() * 9; }
        else {
          const s = Math.min(d, 1.05 * dt);
          n.av.position.x += dx / d * s; n.av.position.z += dz / d * s;
          let a = Math.atan2(dx, dz) - n.av.rotation.y;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          n.av.rotation.y += a * Math.min(1, dt * 6);
          walking = true;
        }
      } else {
        // 부스 액자를 바라보며 잠시 머무름
        if (n.at) {
          let a = n.at.facing + Math.PI - n.av.rotation.y;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          n.av.rotation.y += a * Math.min(1, dt * 2);
        }
        n.pause -= dt;
        if (n.pause <= 0 && BOOTHS.length > 1) {
          // 옆 부스로 (다른 관람객이 서 있는 부스는 피해서)
          const cands = BOOTHS.filter((b) => b !== n.at && !npcs.some((m) => m !== n && (m.at === b || (m.to && m.to.b === b))));
          const nearB = cands.sort((a, b) => Math.abs(a.z - n.av.position.z) - Math.abs(b.z - n.av.position.z)).slice(0, 3);
          const nb = nearB[Math.floor(Math.random() * nearB.length)];
          if (nb) n.to = npcSpot(nb); else n.pause = 4;
        }
      }
      // 따라 하기 — 잠깐 멈춰 그쪽을 바라본 뒤 같은 동작
      n.reactCool = Math.max(0, (n.reactCool || 0) - dt);
      if (n.react) {
        const r = n.react;
        r.delay -= dt;
        if (n.to) { n.to = null; n.pause = 5 + Math.random() * 4; walking = false; }
        let a = Math.atan2(r.look.x - n.av.position.x, r.look.z - n.av.position.z) - n.av.rotation.y;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        n.av.rotation.y += a * Math.min(1, dt * 5);
        if (r.delay <= 0 && !u.gesture) {
          if (r.type === 'balloon') setBalloonColor(n.av, Math.floor(Math.random() * 1000));
          if (r.type === 'popper') u.popN = Math.floor(Math.random() * 1000);
          u.gesture = { type: r.type, t: 0, dur: GESTURE_DUR[r.type] };
          n.pause = Math.max(n.pause, GESTURE_DUR[r.type] + 1);
          n.react = null;
          n.reactCool = 1;
        }
      }
      n.av.position.y = standY(n.av.position.x, n.av.position.z);
      const dp = n.av.position.distanceTo(player.position);
      n.greet -= dt;
      if (n.greet <= 0 && dp < 5 && player.userData.pose === 'stand' && !u.gesture) {
        u.gesture = { type: 'wave', t: 0, dur: 2.2 };
        n.greet = 45;
      }
      n.talk -= dt;
      if (n.talk <= 0) {
        if (dp < 12 && camMode === 'follow') sayBubble(n.av, NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)]);
        n.talk = 40 + Math.random() * 50;
      }
      animateAvatar(n.av, dt, walking);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      if (f.hold) {
        const pop = f.t < 0.25 ? 0.6 + 0.6 * (f.t / 0.25) : 1.2 - 0.2 * smooth(0.25, 0.45, f.t);
        f.s.scale.copy(f.base).multiplyScalar(pop);
        if (f.t >= f.hold) f.s.position.y += dt * 0.55;
        f.s.material.opacity = 1 - smooth(f.hold, f.hold + 1.6, f.t);
        if (f.t > f.hold + 1.6) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
        continue;
      }
      f.s.position.y += dt * 1.2;
      f.s.position.x += f.vx * dt;
      f.s.material.opacity = 1 - f.t / 2;
      if (f.t > 2) { scene.remove(f.s); disposeObj(f.s); floaters.splice(i, 1); }
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const bb = bubbles[i];
      bb.t += dt;
      if (bb.t > 6) {
        if (bb.av.userData.bubble === bb.lb) { bb.av.remove(bb.lb); bb.av.userData.bubble = null; }
        if (!bb.lb.parent) disposeObj(bb.lb);
        bubbles.splice(i, 1);
      }
    }

    // ---------- 장소 근접 ----------
    showPanel(placeAt(player.position.x, player.position.z));
    infoT -= dt;
    if (infoT <= 0) { infoT = 2; refreshPanelInfo(); }

    // ---------- 카메라 ----------
    if (arriveYaw !== null && !moveTarget && camMode === 'follow') {   // 도착하면 정한 방향을 바라보는 시점으로 천천히
      let d = arriveYaw - camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      camYaw += d * Math.min(1, dt * 2.2);
      camPitch = lerp(camPitch, 0.24, Math.min(1, dt * 2));
      if (Math.abs(d) < 0.02) arriveYaw = null;
    }
    if (!typing() && !introOn && camMode === 'follow') {
      if (keys.KeyQ) camYaw += dt * 1.9;
      if (keys.KeyE) camYaw -= dt * 1.9;
      if (keys.KeyR) camPitch = clamp(camPitch + dt * 1.1, 0.04, 1.2);
      if (keys.KeyF) camPitch = clamp(camPitch - dt * 1.1, 0.04, 1.2);
    }
    const head = tmp.set(player.position.x, player.position.y + 1.5, player.position.z);
    if (introOn) {
      // 시작 화면 — 입구 앞마당에서 아치 너머 통로를 천천히 둘러봅니다
      const a = Math.sin(t * 0.05) * 0.35;
      camera.position.set(Math.sin(a) * 9, 2.6 + Math.sin(t * 0.13) * 0.1, ENTRY_Z - 13 + Math.cos(a) * 0.5);
      camera.lookAt(Math.sin(a) * 2, 2.4, ENTRY_Z + 14);
    } else if (camMode === 'award') {
      // 시상 — 무대 앞 관람석 쪽 높은 곳에서 무대 위 한 줄을 정면으로 (세로 화면은 더 멀리)
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
      const dist = Math.max(9.5, 4.8 / half);
      camera.position.lerp(tmpV.set(0, STAGE.h + 2.2 + dist * 0.08, STAGE.z - 0.6 - dist), Math.min(1, dt * 3));
      camera.lookAt(0, STAGE.h + 1.25, STAGE.z - 0.6);
      const wf = fovFor(camera.aspect);
      if (Math.abs(camera.fov - wf) > 0.05) { camera.fov = lerp(camera.fov, wf, Math.min(1, dt * 2)); camera.updateProjectionMatrix(); }
    } else if (camMode === 'frame' && frameView) {
      // 액자 정면 — 액자 앞 4.8m, 액자 높이에서 (아래 안내 상자에 가리지 않게 시선을 조금 낮춤)
      const b = frameView;
      const w = toWorld(b.x, b.z, b.facing, 0, -BOOTH_D / 2 + 4.8);
      const c = toWorld(b.x, b.z, b.facing, 0, -BOOTH_D / 2);
      camera.position.lerp(tmpV.set(w.x, FRAME.y + 0.1, w.z), Math.min(1, dt * 3));
      camera.lookAt(c.x, FRAME.y - 0.45, c.z);
      const wf = fovFor(camera.aspect);
      if (Math.abs(camera.fov - wf) > 0.05) { camera.fov = lerp(camera.fov, wf, Math.min(1, dt * 2)); camera.updateProjectionMatrix(); }
    } else {
      const dir = new THREE.Vector3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
      camRay.set(head, dir);
      camRay.far = camDist;
      const hit = camRay.intersectObjects(occluders, false)[0];
      if (hit) { camBlockD = camBlockT > 0 ? Math.min(camBlockD, hit.distance) : hit.distance; camBlockT = 0.8; }
      else if ((camBlockT -= dt) <= 0) camBlockD = Infinity;
      const wantDist = camBlockD < Infinity ? Math.max(0.8, camBlockD - 0.45) : camDist;
      camDistNow = lerp(camDistNow, wantDist, Math.min(1, dt * (wantDist < camDistNow ? 12 : 2.2)));
      const want = head.clone().addScaledVector(dir, camDistNow);
      want.y = Math.max(want.y, groundY(want.x, want.z) + 0.6);
      if (showCam && (moveTarget || mx || mz)) endShowCam();   // 걷기 시작하면 원래 시점으로
      const scp = showCamPose(dt);
      if (scp) want.lerp(scp.pos, scp.w);
      camera.position.lerp(want, Math.min(1, dt * (scp ? 3.5 : 5)));
      const pnl = $('#panel');
      const cover = pnl.classList.contains('show') ? Math.min(0.6, pnl.offsetHeight / window.innerHeight) : 0;
      const viewH = 2 * camDistNow * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      lookDrop = lerp(lookDrop, cover * viewH * 0.5, Math.min(1, dt * 3));
      const lk = tmpV.set(head.x, head.y - 0.15 - lookDrop, head.z);
      if (scp) lk.lerp(scp.look, scp.w);
      camera.lookAt(lk);
      const wf = fovFor(camera.aspect);
      if (Math.abs(camera.fov - wf) > 0.05) { camera.fov = lerp(camera.fov, wf, Math.min(1, dt * 2)); camera.updateProjectionMatrix(); }
    }
    camFill.position.copy(camera.position);
    camFill.intensity = camMode === 'follow' ? 0.4 : 0;
    updateAudio(dt, t);

    // ---------- 네트워크 (초당 4회까지, 움직였거나 상태가 바뀌었을 때만) ----------
    netTimer += dt;
    const movedEnough = Math.hypot(player.position.x - lastSentX, player.position.z - lastSentZ) > 0.08;
    // 사람이 많을수록 덜 자주 — 예산(netTake)이 허락할 때만. 못 보내면 다음 틈에 다시
    if (netTimer > 0.25 && (netDirty || movedEnough) && !introOn && netTake()) {
      lastSentX = player.position.x;
      lastSentZ = player.position.z;
      netTimer = 0;
      netDirty = false;
      const u = player.userData;
      store.send('move', {
        id: me.id, name: me.name, color: me.look.color, look: me.look,
        x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), ry: +player.rotation.y.toFixed(2),
        pose: u.pose, lift: +(u.pose === 'stand' || u.pose === 'crouch' ? 0 : seatOff).toFixed(2),
        run: u.run ? 1 : 0,
        seat: mySeat && mySeat.kind === 'chair' ? mySeat.i : -1,
        team: me.team, mi: me.mi,
      });
    }

    if (lookOpen && prevR && prevAv) {
      prevT += dt;
      prevAv.rotation.y = Math.sin(prevT * 0.55) * 0.75;
      animateAvatar(prevAv, dt, false);
      prevR.render(prevScene, prevCam);
    }
    // 버벅임 감시 — 4초 평균이 초당 28프레임 아래로 두 번 연속(8초)이면 한 단계씩 가볍게 (사람이 몰려 들어올 때의 잠깐 버벅임은 무시)
    perfMon.n++; perfMon.t += dt;
    if (perfMon.t > 4 && !introOn) {
      const fps = perfMon.n / perfMon.t;
      perfMon.n = 0; perfMon.t = 0;
      perfMon.low = fps < 28 ? perfMon.low + 1 : 0;
      if (perfMon.low >= 2 && perfMon.level < 3) {
        perfMon.low = 0;
        perfMon.level++;
        if (perfMon.level === 1) composer = null;                                     // 빛 번짐 끔
        if (perfMon.level === 2) { renderer.setPixelRatio(1); renderer.setSize(window.innerWidth, window.innerHeight); }  // 해상도 낮춤
        if (perfMon.level === 3) { sunLight.castShadow = false; renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); }   // 그림자 끔
        if (perfMon.level === 1) toast('💻 컴퓨터가 버거워해서 화면을 조금 가볍게 했어요', 2500);
      }
    }
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})().catch((e) => {
  console.error(e);
  const b = document.getElementById('enter');
  if (b) b.textContent = '불러오지 못했어요 (인터넷 연결 확인)';
});
