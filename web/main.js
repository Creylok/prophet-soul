// Soul in Omniscient: the page "Soul" in the menu, a 3D graph of memory's
// things and links. Omniscient calls activate(prophet) once per page load;
// the page draws only while it is open. Data comes from the owner's API
// (/api/entities) through prophet.api and is shown as text, never as HTML.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  buildGraph,
  distances,
  edgeBrightness,
  layout,
  nodeBrightness,
  placeLabels,
  search,
  sectors,
} from "./graph.js";

const SPACING = 14;
const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const FONT = "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
const DEFAULTS = { labels: 60, fade_levels: 4, speed: 1, spin: false };
const HELP =
  "Drag — rotate · right drag or Shift — pan · wheel — zoom · " +
  "WASD or arrows — fly · Q/E — down/up · 1–9 — sectors · 0 — overview · " +
  "F — fly to selected · Esc — clear";

export function activate(prophet) {
  try {
    let view = null;
    const page = prophet.ui.page({
      id: "soul",
      title: "Soul",
      icon: "spark",
      render(body) {
        try {
          view = createView(prophet, body);
        } catch (err) {
          console.error("Soul:", err);
          const p = document.createElement("p");
          p.className = "hint";
          p.textContent = `Soul could not open: ${err?.message || err}`;
          body.append(p);
        }
      },
    });
    prophet.on("page", ({ tab }) => view?.shown(tab === `plugin:${prophet.plugin.name}:soul`));
    prophet.on("theme", () => view?.theme());
    prophet.on("settings", (s) => view?.settings(s));
    return page;
  } catch (err) {
    console.error("Soul failed to start:", err);
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(node.style, v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function createView(prophet, body) {
  let opts = { ...DEFAULTS, ...prophet.settings() };
  let graph = { nodes: [], edges: [] };
  let list = [];
  let pos = new Float64Array(0);
  let selected = -1;
  let hovered = -1;
  let found = [];
  let currentSector = -1;
  let running = false;

  // ---- the page --------------------------------------------------------------
  body.style.maxWidth = "none";
  const search_ = el("input", { class: "input", type: "search", placeholder: "Search memory…", "aria-label": "Search" });
  search_.style.width = "16rem";
  const projectSel = el("select", { class: "input", "aria-label": "Project" });
  projectSel.style.width = "auto";
  projectSel.append(el("option", { value: "" }, "All projects"));
  const reload = el("button", { type: "button", class: "btn btn-sm" }, "Refresh");
  const overview = el("button", { type: "button", class: "btn btn-sm" }, "Overview");
  const full = el("button", { type: "button", class: "btn btn-sm" }, "Full screen");
  const status = el("span", { class: "hint" });
  const toolbar = el(
    "div",
    { style: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px" } },
    el("div", { style: { position: "relative" } }, search_),
    projectSel,
    reload,
    overview,
    full,
    status,
  );
  const results = el("div", { class: "panel", style: { position: "absolute", zIndex: 5, display: "none", padding: "4px", minWidth: "16rem", maxHeight: "18rem", overflowY: "auto" } });
  search_.parentElement.append(results);

  const root = el("div", {
    style: { position: "relative", width: "100%", height: "calc(100vh - 230px)", minHeight: "420px", overflow: "hidden", borderRadius: "12px", outline: "none" },
    tabindex: "0",
  });
  const canvas = el("canvas", { style: { display: "block", width: "100%", height: "100%", cursor: "grab" } });
  const labels = el("div", { style: { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" } });
  const sectorBox = el("div", {
    class: "panel",
    style: { position: "absolute", left: "10px", top: "10px", maxHeight: "calc(100% - 64px)", overflowY: "auto", padding: "6px", width: "13rem", fontSize: "12px", opacity: "0.92" },
  });
  const info = el("div", {
    class: "panel",
    style: { position: "absolute", right: "10px", top: "10px", maxHeight: "calc(100% - 64px)", overflowY: "auto", padding: "10px 12px", width: "17rem", fontSize: "13px", display: "none", opacity: "0.95" },
  });
  const help = el("div", { class: "hint", style: { position: "absolute", left: "10px", right: "10px", bottom: "8px", fontSize: "11px", pointerEvents: "none", textAlign: "center" } }, HELP);
  const empty = el("div", { class: "hint", style: { position: "absolute", inset: "0", display: "none", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px" } });
  root.append(canvas, labels, sectorBox, info, help, empty);
  body.append(
    el("p", { class: "hint", style: { marginTop: "-8px", marginBottom: "10px" } }, "Memory visualisation: the things confirmed facts are about, and the links between them."),
    toolbar,
    root,
  );

  // ---- three.js ----------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
  camera.position.set(0, 0, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 1.1;
  controls.autoRotateSpeed = 0.35;
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  camera.add(sun);
  sun.position.set(1, 1, 2);
  scene.add(camera);
  scene.fog = new THREE.Fog(0x000000, 100, 1000);

  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const nodeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  let nodeMesh = null;
  const baseLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 }),
  );
  scene.add(baseLines);
  const glowMaterial = new LineMaterial({ vertexColors: true, linewidth: 1.6, worldUnits: false, transparent: true, opacity: 0.9 });
  let glowLines = null;

  const colours = { bg: new THREE.Color(), fg: new THREE.Color(), hl: new THREE.Color(), panel: "" };
  const tmp = new THREE.Color();
  const mix = (a, b, t) => tmp.copy(a).lerp(b, t);

  function readTheme() {
    const dark = document.documentElement.classList.contains("dark");
    const style = getComputedStyle(document.body);
    const bg = style.backgroundColor;
    const fg = style.color;
    colours.bg.set((bg && cssColour(bg)) || (dark ? "#1c1c1f" : "#fafafa"));
    colours.fg.set((fg && cssColour(fg)) || (dark ? "#e4e4e7" : "#27272a"));
    colours.hl.set(dark ? "#93c5fd" : "#3b82f6");
    colours.dark = dark;
    renderer.setClearColor(colours.bg, 1);
    scene.fog.color.copy(colours.bg);
    root.style.background = `#${colours.bg.getHexString()}`;
    const b = colours.bg;
    colours.labelBg = `rgba(${Math.round(b.r * 255)},${Math.round(b.g * 255)},${Math.round(b.b * 255)},0.62)`;
  }

  // ---- data --------------------------------------------------------------------
  async function loadProjects() {
    try {
      const projects = await prophet.api("/api/projects");
      for (const p of projects || []) projectSel.append(el("option", { value: String(p.id) }, p.name));
    } catch {
      /* without projects the list stays "all" */
    }
  }

  async function load() {
    status.textContent = "Reading memory…";
    empty.style.display = "none";
    let things;
    try {
      const q = projectSel.value ? `?project_id=${encodeURIComponent(projectSel.value)}` : "";
      things = await prophet.api(`/api/entities${q}`);
    } catch (err) {
      status.textContent = `Could not read memory: ${err?.message || err}`;
      return;
    }
    status.textContent = "Laying out…";
    await new Promise((r) => setTimeout(r, 20));
    graph = buildGraph(Array.isArray(things) ? things : []);
    list = sectors(graph);
    const big = Math.max(0, ...list.map((s) => (s.lonely ? 0 : s.members.length)));
    pos = layout(graph, list, { spacing: SPACING, iterations: big > 1500 ? 90 : big > 600 ? 160 : 260 });
    selected = -1;
    hovered = -1;
    found = [];
    currentSector = -1;
    labelWidths.clear();
    buildScene();
    drawSectors();
    drawInfo();
    status.textContent = `${graph.nodes.length} things · ${graph.edges.length} links · ${list.length} sectors`;
    if (!graph.nodes.length) {
      empty.textContent = "No things in memory yet. Links appear when links are switched on on the Memory page and there are confirmed facts.";
      empty.style.display = "flex";
    }
    flyOverview(true);
    start();
  }

  function radius(n) {
    return 1.8 + Math.log2(1 + n.degree) * 0.9 + Math.min(n.facts, 40) * 0.02;
  }

  function buildScene() {
    if (nodeMesh) {
      scene.remove(nodeMesh);
      nodeMesh.dispose();
    }
    const count = graph.nodes.length;
    nodeMesh = new THREE.InstancedMesh(sphere, nodeMaterial, Math.max(count, 1));
    nodeMesh.count = count;
    const m = new THREE.Matrix4();
    for (const n of graph.nodes) {
      const r = radius(n);
      m.makeScale(r, r, r).setPosition(pos[n.index * 3], pos[n.index * 3 + 1], pos[n.index * 3 + 2]);
      nodeMesh.setMatrixAt(n.index, m);
      nodeMesh.setColorAt(n.index, colours.fg);
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    scene.add(nodeMesh);
    const p = new Float32Array(graph.edges.length * 6);
    graph.edges.forEach((e, k) => {
      p.set([pos[e.a * 3], pos[e.a * 3 + 1], pos[e.a * 3 + 2], pos[e.b * 3], pos[e.b * 3 + 1], pos[e.b * 3 + 2]], k * 6);
    });
    baseLines.geometry.dispose();
    baseLines.geometry = new THREE.BufferGeometry();
    baseLines.geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
    baseLines.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(p.length), 3));
    let far = SPACING * 10;
    for (const s of list) far = Math.max(far, Math.hypot(...s.centre) + s.radius);
    scene.fog.near = far * 0.6;
    scene.fog.far = far * 3.2;
    camera.far = far * 8;
    camera.updateProjectionMatrix();
    resetGlow();
    paint();
  }

  // ---- the highlight -------------------------------------------------------------
  // The thing under the mouse wins over the chosen one; nothing chosen and nothing
  // under the mouse is the calm graph. The highlight is soft: it fades in and out,
  // tints rather than recolours, and the rest of the graph dims only a little.
  const SOFT = 0.55; // how far the brightest link moves from calm towards the accent
  const FADE_MS = 380;
  let lit = { dist: new Map(), edges: new Map(), focus: -1 };
  let glow = 0; // 0 calm … 1 fully lit
  let glowTarget = 0;
  let glowLast = 0;

  function paint() {
    if (!nodeMesh) return;
    const focus = hovered >= 0 ? hovered : selected;
    if (focus >= 0 && focus !== lit.focus) {
      const levels = opts.fade_levels;
      const dist = distances(graph, focus, levels);
      lit = { dist, edges: edgeBrightness(graph, dist, levels), focus };
      glow = Math.min(glow, 0.35); // a new thing: fade in again from soft
      buildGlow();
    }
    glowTarget = focus >= 0 ? 1 : 0;
    recolour();
    start();
  }

  function resetGlow() {
    lit = { dist: new Map(), edges: new Map(), focus: -1 };
    glow = 0;
    glowTarget = 0;
    buildGlow();
  }

  function buildGlow() {
    if (glowLines) {
      scene.remove(glowLines);
      glowLines.geometry.dispose();
      glowLines = null;
    }
    if (!lit.edges.size) return;
    const p = [];
    for (const k of lit.edges.keys()) {
      const e = graph.edges[k];
      p.push(pos[e.a * 3], pos[e.a * 3 + 1], pos[e.a * 3 + 2], pos[e.b * 3], pos[e.b * 3 + 1], pos[e.b * 3 + 2]);
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(p);
    glowLines = new LineSegments2(g, glowMaterial);
    glowLines.renderOrder = 1;
    scene.add(glowLines);
  }

  const calmNode = new THREE.Color();
  const calmEdge = new THREE.Color();
  function recolour() {
    if (!nodeMesh) return;
    const k = glow * glow * (3 - 2 * glow); // smoothstep
    calmNode.copy(mix(colours.bg, colours.fg, colours.dark ? 0.62 : 0.55));
    for (const n of graph.nodes) {
      const steps = lit.dist.get(n.index);
      const base = list[n.sector]?.lonely ? mix(colours.bg, calmNode, 0.7).clone() : calmNode.clone();
      let c;
      if (steps !== undefined) c = base.lerp(colours.hl, Math.max(0.3, nodeBrightness(steps)) * 0.8 * k);
      else if (found.includes(n.index)) c = base.lerp(colours.hl, 0.5);
      else c = base.lerp(colours.bg, 0.3 * k);
      nodeMesh.setColorAt(n.index, c);
    }
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;

    const colour = baseLines.geometry.getAttribute("color");
    calmEdge.copy(mix(colours.bg, colours.fg, 0.2 - 0.07 * k));
    if (colour) {
      for (let i = 0; i < graph.edges.length * 2; i++) colour.setXYZ(i, calmEdge.r, calmEdge.g, calmEdge.b);
      colour.needsUpdate = true;
    }
    if (glowLines) {
      const c = [];
      for (const b of lit.edges.values()) {
        const col = calmEdge.clone().lerp(colours.hl, b * SOFT * k);
        c.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
      glowLines.geometry.setColors(c);
      glowLines.visible = k > 0.01;
    }
    labelsDirty = true;
  }

  function stepGlow(now) {
    const dt = glowLast ? now - glowLast : 16;
    glowLast = now;
    if (glow === glowTarget) return;
    const step = dt / FADE_MS;
    glow = glowTarget > glow ? Math.min(glowTarget, glow + step) : Math.max(glowTarget, glow - step);
    if (glow === 0 && glowTarget === 0) {
      lit = { dist: new Map(), edges: new Map(), focus: -1 };
      buildGlow();
    }
    recolour();
  }

  function setHover(i) {
    if (i === hovered) return;
    hovered = i;
    canvas.style.cursor = i >= 0 ? "pointer" : "grab";
    paint();
  }

  function select(i, fly = false) {
    selected = i;
    if (i >= 0) currentSector = graph.nodes[i].sector;
    paint();
    drawInfo();
    drawSectors();
    if (fly && i >= 0) flyToNode(i);
  }

  // ---- panels ----------------------------------------------------------------------
  function drawSectors() {
    sectorBox.replaceChildren(el("div", { class: "section-title", style: { fontSize: "12px", padding: "2px 6px 6px" } }, "Sectors"));
    if (!list.length) {
      sectorBox.style.display = "none";
      return;
    }
    sectorBox.style.display = "";
    list.forEach((s, i) => {
      const b = el(
        "button",
        { type: "button", class: `btn btn-sm ${i === currentSector ? "" : "btn-ghost"}`, title: s.name },
        el("span", { style: { opacity: "0.6", width: "1.4em", display: "inline-block" } }, i < 9 ? String(i + 1) : "·"),
        el("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" } }, s.name),
        el("span", { style: { opacity: "0.6" } }, String(s.members.length)),
      );
      Object.assign(b.style, { display: "flex", width: "100%", gap: "6px", justifyContent: "flex-start", marginBottom: "2px" });
      b.onclick = () => flyToSector(i);
      sectorBox.append(b);
    });
  }

  function drawInfo() {
    if (selected < 0) {
      info.style.display = "none";
      return;
    }
    const n = graph.nodes[selected];
    info.style.display = "";
    const close = el("button", { type: "button", class: "btn btn-ghost btn-sm", title: "Clear selection", style: { float: "right" } }, "×");
    close.onclick = () => select(-1);
    info.replaceChildren(close, el("div", { class: "section-title" }, n.name));
    const meta = [n.label, n.project, `facts: ${n.facts}`, `links: ${n.degree}`].filter(Boolean).join(" · ");
    info.append(el("p", { class: "hint", style: { marginTop: "2px" } }, meta));
    if (n.aliases.length) info.append(el("p", { class: "hint", style: { marginTop: "4px" } }, `Other names: ${n.aliases.join(", ")}`));
    if (n.links.length) {
      const ul = el("ul", { style: { marginTop: "8px", display: "grid", gap: "4px" } });
      const sorted = [...n.links].sort((x, y) => graph.nodes[y.other].degree - graph.nodes[x.other].degree);
      for (const { edge, other } of sorted.slice(0, 80)) {
        const e = graph.edges[edge];
        const o = graph.nodes[other];
        const arrow = e.a === selected ? "→" : "←";
        const go = el("button", { type: "button", class: "btn btn-ghost btn-sm", style: { padding: "0 4px" } }, o.name);
        go.onclick = () => select(other, true);
        go.onmouseenter = () => setHover(other);
        go.onmouseleave = () => setHover(-1);
        ul.append(el("li", {}, el("span", { class: "hint" }, `${arrow} ${e.relations.join("; ")} `), go));
      }
      if (sorted.length > 80) ul.append(el("li", { class: "hint" }, `and ${sorted.length - 80} more`));
      info.append(ul);
    }
    const fly = el("button", { type: "button", class: "btn btn-sm", style: { marginTop: "10px" } }, "Fly to it");
    fly.onclick = () => flyToNode(selected);
    info.append(fly);
  }

  function drawResults() {
    const q = search_.value;
    const hits = search(graph, q, 10);
    found = q.trim() ? search(graph, q, 40).map((n) => n.index) : [];
    paint();
    results.replaceChildren();
    if (!q.trim()) {
      results.style.display = "none";
      return;
    }
    results.style.display = "";
    if (!hits.length) {
      results.append(el("div", { class: "hint", style: { padding: "6px 8px" } }, "Nothing found"));
      return;
    }
    for (const n of hits) {
      const b = el(
        "button",
        { type: "button", class: "btn btn-ghost btn-sm" },
        el("span", { style: { flex: "1", textAlign: "left" } }, n.name),
        el("span", { class: "hint" }, n.label || ""),
      );
      Object.assign(b.style, { display: "flex", width: "100%", gap: "8px" });
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => pick(n.index);
      b.onmouseenter = () => setHover(n.index);
      b.onmouseleave = () => setHover(-1);
      results.append(b);
    }
  }

  function pick(i) {
    results.style.display = "none";
    setHover(-1);
    select(i, true);
    root.focus({ preventScroll: true });
  }

  // ---- flight ----------------------------------------------------------------------
  let fly = null;
  function flyTo(target, distance, instant = false) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const to = new THREE.Vector3(...target);
    const cam = to.clone().add(dir.multiplyScalar(distance));
    if (instant) {
      controls.target.copy(to);
      camera.position.copy(cam);
      fly = null;
      return;
    }
    fly = { t0: performance.now(), from: [camera.position.clone(), controls.target.clone()], to: [cam, to] };
    start();
  }
  function stepFly(now) {
    if (!fly) return;
    const k = Math.min(1, (now - fly.t0) / 750);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    camera.position.lerpVectors(fly.from[0], fly.to[0], e);
    controls.target.lerpVectors(fly.from[1], fly.to[1], e);
    if (k >= 1) fly = null;
  }
  function flyToNode(i) {
    currentSector = graph.nodes[i].sector;
    drawSectors();
    // Close enough to read it, far enough to see its neighbours.
    let reach = SPACING * 2;
    for (const { other } of graph.nodes[i].links) {
      reach = Math.max(reach, Math.hypot(pos[other * 3] - pos[i * 3], pos[other * 3 + 1] - pos[i * 3 + 1], pos[other * 3 + 2] - pos[i * 3 + 2]));
    }
    flyTo([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], Math.min(reach, SPACING * 12) * 1.9);
  }
  function flyToSector(i) {
    const s = list[i];
    if (!s) return;
    currentSector = i;
    drawSectors();
    flyTo(s.centre, Math.max(SPACING * 3, s.radius * 2.4));
  }
  function flyOverview(instant = false) {
    currentSector = -1;
    drawSectors();
    let r = SPACING * 3;
    for (const s of list) r = Math.max(r, Math.hypot(...s.centre) + s.radius);
    flyTo([0, 0, 0], r * 2.1, instant);
  }

  // ---- free movement -------------------------------------------------------------------
  const keys = new Set();
  const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  function onKeyDown(ev) {
    if (!running || typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (MOVE_KEYS.includes(ev.code)) {
      keys.add(ev.code);
      ev.preventDefault();
    } else if (/^Digit[1-9]$/.test(ev.code)) {
      flyToSector(Number(ev.code.slice(5)) - 1);
    } else if (ev.code === "Digit0") {
      flyOverview();
    } else if (ev.code === "KeyF") {
      if (selected >= 0) flyToNode(selected);
    } else if (k === "escape") {
      search_.value = "";
      drawResults();
      select(-1);
    } else if (k === "/") {
      ev.preventDefault();
      search_.focus();
    }
  }
  const onKeyUp = (ev) => keys.delete(ev.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => keys.clear());

  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const move = new THREE.Vector3();
  function stepKeys(dt) {
    if (!keys.size) return;
    const has = (...k) => k.some((x) => keys.has(x));
    camera.getWorldDirection(fwd);
    side.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0);
    if (has("KeyW", "ArrowUp")) move.add(fwd);
    if (has("KeyS", "ArrowDown")) move.sub(fwd);
    if (has("KeyD", "ArrowRight")) move.add(side);
    if (has("KeyA", "ArrowLeft")) move.sub(side);
    if (has("KeyE")) move.add(camera.up);
    if (has("KeyQ")) move.sub(camera.up);
    if (!move.lengthSq()) return;
    const dist = camera.position.distanceTo(controls.target);
    const speed = Math.max(SPACING * 2, dist * 0.9) * opts.speed;
    move.normalize().multiplyScalar(speed * dt);
    fly = null;
    camera.position.add(move);
    controls.target.add(move);
  }

  // ---- labels and picking ---------------------------------------------------------------
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = FONT;
  const labelWidths = new Map();
  const textOf = (n) => n.name;
  const widthOf = (n) => {
    if (!labelWidths.has(n.index)) labelWidths.set(n.index, Math.ceil(measure.measureText(textOf(n)).width) + 10);
    return labelWidths.get(n.index);
  };
  const pool = new Map(); // node index → its label
  let underMouse = null; // {node, x, y}: the label the mouse is on
  let labelsDirty = true;
  let lastCam = "";
  let moving = false;
  let sx = new Float32Array(0);
  let sy = new Float32Array(0);
  let sr = new Float32Array(0);
  let sd = new Float32Array(0);
  const v = new THREE.Vector3();

  function project(w, h) {
    const count = graph.nodes.length;
    if (sx.length !== count) {
      sx = new Float32Array(count);
      sy = new Float32Array(count);
      sr = new Float32Array(count);
      sd = new Float32Array(count);
    }
    const f = h / 2 / Math.tan((camera.fov * Math.PI) / 360);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    for (let i = 0; i < count; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(inv);
      const d = -v.z;
      sd[i] = d;
      if (d <= camera.near) {
        sr[i] = -1;
        continue;
      }
      sx[i] = w / 2 + (v.x / d) * f;
      sy[i] = h / 2 - (v.y / d) * f;
      sr[i] = (radius(graph.nodes[i]) / d) * f;
    }
  }

  function drawLabels(w, h) {
    const count = graph.nodes.length;
    // Nearer than the point the camera looks at: labelled first; behind it: fading.
    const look = Math.max(SPACING * 2, camera.position.distanceTo(controls.target));
    const cand = [];
    const pts = [];
    for (let i = 0; i < count; i++) {
      if (sr[i] < 0 || sx[i] < -50 || sx[i] > w + 50 || sy[i] < -20 || sy[i] > h + 20) continue;
      const steps = lit.dist.get(i);
      const isLit = steps !== undefined;
      const isFound = found.includes(i);
      // Far things fade and lose their labels first; lit and found ones keep them.
      const nearness = Math.max(0, Math.min(1, 1.6 - sd[i] / look));
      if (!isLit && !isFound && nearness <= 0.05) continue;
      const n = graph.nodes[i];
      let score = nearness * 4 + Math.log2(1 + n.degree) * 0.6 + sr[i] * 0.08;
      if (isFound) score += 50;
      if (isLit) score += 100 - steps * 10;
      if (i === selected) score += 200;
      if (i === hovered) score += 300;
      cand.push({ node: i, x: sx[i], y: sy[i], r: Math.max(sr[i], 2), w: widthOf(n), h: 18, score, isLit, nearness });
      if (isLit || i === selected) pts.push({ node: i, x: sx[i], y: sy[i], r: Math.max(sr[i], 3) });
    }
    if (underMouse) {
      const c = cand.find((x) => x.node === underMouse.node);
      if (c && !moving) {
        c.fixed = { x: underMouse.x, y: underMouse.y };
        c.score = Infinity;
      } else underMouse = null;
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, opts.labels)) if (!c.isLit) pts.push({ node: c.node, x: c.x, y: c.y, r: Math.max(c.r, 2) });
    const most = Math.max(opts.labels, Math.min(lit.dist.size, 60));
    const box = root.getBoundingClientRect();
    const blocked = [sectorBox, info, help, toolbar]
      .filter((b) => b.style.display !== "none" && root.contains(b))
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
      });
    const placed = placeLabels(cand, { width: w, height: h, most, points: pts, blocked });
    const byNode = new Map(cand.map((c) => [c.node, c]));
    const shown = new Set(placed.map((p) => p.node));
    for (const [node, d] of pool) {
      if (!shown.has(node)) {
        d.remove();
        pool.delete(node);
      }
    }
    const gk = glow * glow * (3 - 2 * glow);
    const fg = `#${colours.fg.getHexString()}`;
    const soft = `#${colours.fg.clone().lerp(colours.hl, 0.75 * gk).getHexString()}`;
    const hl = `#${colours.hl.getHexString()}`;
    for (const p of placed) {
      const c = byNode.get(p.node);
      const n = graph.nodes[p.node];
      let d = pool.get(p.node);
      if (!d) {
        d = el("div", {
          style: { position: "absolute", left: "0", top: "0", font: FONT, lineHeight: "18px", height: "18px", padding: "0 5px", borderRadius: "5px", whiteSpace: "nowrap", pointerEvents: "auto", cursor: "pointer", userSelect: "none" },
        });
        d.textContent = textOf(n);
        const node = p.node;
        d.onmouseenter = () => {
          underMouse = { node, x: d._x, y: d._y };
          setHover(node);
        };
        d.onmouseleave = () => {
          underMouse = null;
          setHover(-1);
        };
        d.onclick = () => select(node);
        d.ondblclick = () => select(node, true);
        labels.append(d);
        pool.set(p.node, d);
      }
      d._x = p.x;
      d._y = p.y;
      d.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      const strong = p.node === hovered || p.node === selected;
      d.style.color = c.isLit ? soft : found.includes(p.node) ? hl : fg;
      d.style.fontWeight = strong ? "600" : "400";
      d.style.background = strong ? colours.labelBg : "transparent";
      const calm = 0.35 + c.nearness * 0.6;
      const lit_ = c.isLit ? Math.max(0.5, nodeBrightness(lit.dist.get(p.node))) : 0;
      d.style.opacity = String(c.isLit ? calm + (lit_ - calm) * gk : found.includes(p.node) ? 1 : calm * (1 - 0.35 * gk));
    }
  }

  let mouse = null;
  let down = null;
  canvas.addEventListener("pointermove", (ev) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (!down) hoverAt(mouse.x, mouse.y);
  });
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
    setHover(-1);
  });
  canvas.addEventListener("pointerdown", (ev) => {
    down = { x: ev.clientX, y: ev.clientY };
    canvas.style.cursor = "grabbing";
    root.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointerup", (ev) => {
    const click = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
    down = null;
    canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
    if (click) select(hovered);
  });
  canvas.addEventListener("dblclick", () => {
    if (hovered >= 0) select(hovered, true);
  });
  function hoverAt(x, y) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < graph.nodes.length; i++) {
      if (sr[i] < 0) continue;
      const d = Math.hypot(sx[i] - x, sy[i] - y);
      if (d <= Math.max(sr[i] + 3, 8) && sd[i] < bestD) {
        best = i;
        bestD = sd[i];
      }
    }
    setHover(best);
  }

  // ---- the loop ------------------------------------------------------------------------
  let w = 0;
  let h = 0;
  const size = () => {
    const nw = root.clientWidth;
    const nh = root.clientHeight;
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw;
    h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    glowMaterial.resolution.set(w, h);
    labelsDirty = true;
  };
  new ResizeObserver(() => {
    size();
    start();
  }).observe(root);

  const visible = () => root.isConnected && (root.offsetParent !== null || document.fullscreenElement === root);
  let last = 0;
  function frame(now) {
    if (!visible()) {
      running = false;
      keys.clear();
      return;
    }
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    size();
    stepFly(now);
    stepGlow(now);
    stepKeys(dt);
    controls.autoRotate = opts.spin && !fly && !keys.size && hovered < 0;
    controls.update();
    renderer.render(scene, camera);
    const cam = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)},${controls.target.x.toFixed(2)},${w},${h}`;
    moving = cam !== lastCam;
    if (moving || labelsDirty) {
      lastCam = cam;
      labelsDirty = false;
      project(w, h);
      drawLabels(w, h);
    }
  }
  function start() {
    if (running || !visible()) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  // ---- wiring ------------------------------------------------------------------------
  search_.addEventListener("input", drawResults);
  search_.addEventListener("focus", () => search_.value && drawResults());
  search_.addEventListener("blur", () => setTimeout(() => (results.style.display = "none"), 150));
  search_.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = search(graph, search_.value, 1)[0];
      if (first) pick(first.index);
    } else if (ev.key === "Escape") {
      search_.value = "";
      drawResults();
      search_.blur();
    }
  });
  projectSel.addEventListener("change", load);
  reload.onclick = load;
  overview.onclick = () => flyOverview();
  full.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener("fullscreenchange", () => {
    full.textContent = document.fullscreenElement === root ? "Exit full screen" : "Full screen";
    if (document.fullscreenElement === root) root.prepend(toolbar);
    else if (toolbar.parentElement === root) root.before(toolbar);
    Object.assign(toolbar.style, document.fullscreenElement === root
      ? { position: "absolute", zIndex: 6, left: "50%", transform: "translateX(-50%)", top: "10px", marginBottom: "0" }
      : { position: "", zIndex: "", left: "", transform: "", top: "", marginBottom: "10px" });
    sectorBox.style.top = info.style.top = document.fullscreenElement === root ? "56px" : "10px";
    start();
  });

  readTheme();
  loadProjects();
  load();

  return {
    shown(on) {
      if (on) start();
    },
    theme() {
      readTheme();
      paint();
      start();
    },
    settings(s) {
      opts = { ...DEFAULTS, ...s };
      lit.focus = -1;
      paint();
    },
  };
}

// Any CSS colour (Omniscient's are oklch) as rgb(), read back from one pixel.
const pixel = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
function cssColour(value) {
  if (!pixel) return value;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = "#000";
  pixel.fillStyle = value;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : `rgb(${r}, ${g}, ${b})`;
}
