const state = {
  config: null,
  devices: [],
  selectedFixtureId: null,
  previews: {},
  status: null,
  ws: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let toastTimer;

function toast(msg, ok = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (ok ? " ok" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "init") {
      state.config = msg.config;
      state.status = msg.status;
      renderAll();
    }
    if (msg.type === "frame" || msg.type === "stats") {
      state.status = msg.status;
      if (msg.previews) state.previews = msg.previews;
      updateMonitor();
      updateSwatches();
    }
    if (msg.type === "openrgb") {
      updateOpenRgbPill(msg.status);
    }
  };

  state.ws.onclose = () => setTimeout(connectWs, 2000);
}

function updateOpenRgbPill(s) {
  const el = $("#openrgb-status");
  const label = s === "connected" ? "online" : s === "reconnecting" ? "retry" : "offline";
  el.querySelector(".tel-val").textContent = label;
  el.className =
    "tel " + (s === "connected" ? "tel-on" : s === "reconnecting" ? "tel-warn" : "tel-off");
}

function updateMonitor() {
  if (!state.status?.stats) return;
  const s = state.status.stats;

  $("#fps-status .tel-val").textContent = `${s.fps} FPS`;
  $("#mon-fps").textContent = s.fps;
  $("#mon-pps").textContent = s.packetRate;
  $("#mon-updates").textContent = s.updates;
  $("#mon-skips").textContent = s.skips;
  $("#mon-source").textContent = s.lastSource || "—";
  $("#mon-universe").textContent = s.lastUniverse ?? "—";

  const ch = s.lastChannels || [0, 0, 0];
  $("#val-r").textContent = ch[0];
  $("#val-g").textContent = ch[1];
  $("#val-b").textContent = ch[2];
  $("#meter-r").style.width = `${(ch[0] / 255) * 100}%`;
  $("#meter-g").style.width = `${(ch[1] / 255) * 100}%`;
  $("#meter-b").style.width = `${(ch[2] / 255) * 100}%`;

  const vuFps = $("#vu-fps");
  const vuPps = $("#vu-pps");
  if (vuFps) vuFps.style.width = `${Math.min(100, (s.fps / 60) * 100)}%`;
  if (vuPps) vuPps.style.width = `${Math.min(100, (s.packetRate / 120) * 100)}%`;

  renderPreviewGrid();
}

function renderPreviewGrid() {
  const grid = $("#preview-grid");
  grid.innerHTML = "";

  if (!Object.keys(state.previews).length) {
    grid.innerHTML = '<p class="empty-state">Waiting for DMX data…</p>';
    return;
  }

  for (const [fid, colors] of Object.entries(state.previews)) {
    const block = document.createElement("div");
    block.className = "preview-fixture";
    block.innerHTML = `<div class="preview-fixture-name">${fid}</div>`;
    const strip = document.createElement("div");
    strip.className = "preview-strip";
    for (const c of colors) {
      const d = document.createElement("div");
      d.className = "preview-pixel";
      d.style.background = `rgb(${c.red},${c.green},${c.blue})`;
      d.title = `rgb(${c.red}, ${c.green}, ${c.blue})`;
      strip.appendChild(d);
    }
    block.appendChild(strip);
    grid.appendChild(block);
  }
}

function fillSetupForm() {
  const c = state.config;
  if (!c) return;
  const f = $("#setup-form");
  f.protocol.value = c.protocol;
  f.fps.value = c.fps;
  f.debug.checked = c.debug;
  f.openrgbHost.value = c.openrgb.host;
  f.openrgbPort.value = c.openrgb.port;
  f.artnetPort.value = c.artnet.port;
  f.artnetUniverse.value = c.artnet.universe ?? "";
  f.artnetSync.checked = c.artnet.sync;
  f.sacnPort.value = c.sacn.port;
  f.sacnUniverses.value = (c.sacn.universes || []).join(", ");
  f.sacnIface.value = c.sacn.iface || "";
}

async function saveSetup() {
  const f = $("#setup-form");
  const c = structuredClone(state.config);
  c.protocol = f.protocol.value;
  c.fps = Number(f.fps.value);
  c.debug = f.debug.checked;
  c.openrgb.host = f.openrgbHost.value;
  c.openrgb.port = Number(f.openrgbPort.value);
  c.artnet.port = Number(f.artnetPort.value);
  const u = f.artnetUniverse.value.trim();
  c.artnet.universe = u === "" ? null : isNaN(Number(u)) ? u : Number(u);
  c.artnet.sync = f.artnetSync.checked;
  c.sacn.port = Number(f.sacnPort.value);
  c.sacn.universes = f.sacnUniverses.value.split(",").map((x) => Number(x.trim())).filter(Boolean);
  c.sacn.iface = f.sacnIface.value.trim() || null;
  state.config = await api("/api/config", { method: "PUT", body: JSON.stringify(c) });
  toast("Configuration applied", true);
}

function renderFixtureCards() {
  const list = $("#fixture-list");
  const empty = $("#fixture-empty");
  const fixtures = state.config?.fixtures || [];
  list.innerHTML = "";

  if (!fixtures.length) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  fixtures.forEach((fx, i) => {
    const card = document.createElement("article");
    card.className = "fixture-card";
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <h3>${fx.name}</h3>
      <div class="fixture-meta">
        <span>ID <strong>${fx.id}</strong></span>
        <span>Device <strong>${fx.deviceId}</strong>${fx.zoneId != null ? ` · Zone ${fx.zoneId}` : ""}</span>
        <span>${fx.source.type.toUpperCase()} · U${fx.source.universes?.join("+") || "?"}</span>
        <span>DMX ${fx.dmxStart} · ${fx.mapping} · ${fx.colorOrder}</span>
      </div>
      <div class="actions">
        <button class="btn edit-fixture" data-id="${fx.id}">Edit patch</button>
        <button class="btn delete-fixture" data-id="${fx.id}">Remove</button>
      </div>`;
    list.appendChild(card);
  });

  list.querySelectorAll(".edit-fixture").forEach((btn) => {
    btn.onclick = () => {
      state.selectedFixtureId = btn.dataset.id;
      showPanel("editor");
      loadEditorFixture();
    };
  });

  list.querySelectorAll(".delete-fixture").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Remove fixture "${btn.dataset.id}"?`)) return;
      await api(`/api/fixtures/${btn.dataset.id}`, { method: "DELETE" });
      state.config = await api("/api/config");
      renderFixtureCards();
      populateEditorSelect();
      toast("Fixture removed", true);
    };
  });
}

async function loadDevices() {
  try {
    state.devices = await api("/api/devices");
  } catch {
    state.devices = [];
  }
}

function populateEditorSelect() {
  const sel = $("#editor-fixture-select");
  sel.innerHTML = "";
  for (const fx of state.config?.fixtures || []) {
    const o = document.createElement("option");
    o.value = fx.id;
    o.textContent = fx.name;
    sel.appendChild(o);
  }
  if (!state.selectedFixtureId && sel.options.length) {
    state.selectedFixtureId = sel.options[0].value;
  }
  sel.value = state.selectedFixtureId || "";
}

function populateDeviceSelect(deviceId) {
  const sel = $("#editor-device");
  sel.innerHTML = "";
  for (const d of state.devices) {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = `[${d.deviceId}] ${d.name} (${d.ledCount} LEDs)`;
    sel.appendChild(o);
  }
  if (deviceId != null) sel.value = deviceId;
  populateZoneSelect(Number(sel.value), $("#editor-form").zoneId?.value);
}

function populateZoneSelect(deviceId, zoneId) {
  const sel = $("#editor-zone");
  const device = state.devices.find((d) => d.deviceId === deviceId);
  sel.innerHTML = '<option value="">Full device</option>';
  if (!device) return;
  for (const z of device.zones) {
    const o = document.createElement("option");
    o.value = z.id;
    o.textContent = `${z.name} (${z.ledsCount} LEDs)`;
    sel.appendChild(o);
  }
  if (zoneId != null && zoneId !== "") sel.value = zoneId;
}

function getEditorLeds() {
  const deviceId = Number($("#editor-device").value);
  const zoneVal = $("#editor-zone").value;
  const device = state.devices.find((d) => d.deviceId === deviceId);
  if (!device) return { leds: [], zoneStart: 0 };

  if (zoneVal === "") {
    return { leds: device.leds, zoneStart: 0 };
  }
  const zoneId = Number(zoneVal);
  let start = 0;
  for (let i = 0; i < zoneId; i++) start += device.zones[i]?.ledsCount || 0;
  const count = device.zones[zoneId]?.ledsCount || 0;
  return { leds: device.leds.slice(start, start + count), zoneStart: start };
}

function loadEditorFixture() {
  const fx = state.config?.fixtures?.find((f) => f.id === state.selectedFixtureId);
  if (!fx) return;
  const f = $("#editor-form");
  f.name.value = fx.name;
  populateDeviceSelect(fx.deviceId);
  populateZoneSelect(fx.deviceId, fx.zoneId ?? "");
  f.sourceType.value = fx.source.type;
  f.sourceUniverses.value = (fx.source.universes || []).join(",");
  f.dmxStart.value = fx.dmxStart;
  f.colorOrder.value = fx.colorOrder;
  f.mapping.value = fx.mapping;
  renderPatchTable(fx);
}

function renderPatchTable(fx) {
  const { leds, zoneStart } = getEditorLeds();
  const tbody = $("#patch-body");
  tbody.innerHTML = "";

  const pixelMap = new Map();
  if (fx.mapping === "custom" && fx.pixels?.length) {
    for (const p of fx.pixels) pixelMap.set(p.ledIndex, p.channels);
  }

  leds.forEach((led, i) => {
    const absIndex = zoneStart + i;
    const dmxStart = Number($("#editor-form").dmxStart.value) || 1;
    const defaultCh = [dmxStart + i * 3, dmxStart + i * 3 + 1, dmxStart + i * 3 + 2];
    const ch = pixelMap.get(absIndex) || defaultCh;
    const preview = state.previews[fx.id]?.[i];
    const r = preview?.red ?? 0;
    const g = preview?.green ?? 0;
    const b = preview?.blue ?? 0;
    const live = r + g + b > 0;

    const tr = document.createElement("tr");
    tr.dataset.ledIndex = absIndex;
    tr.innerHTML = `
      <td>${absIndex}</td>
      <td>${led.name}</td>
      <td><input type="number" class="ch-r" min="1" max="2048" value="${ch[0]}" /></td>
      <td><input type="number" class="ch-g" min="1" max="2048" value="${ch[1]}" /></td>
      <td><input type="number" class="ch-b" min="1" max="2048" value="${ch[2]}" /></td>
      <td><span class="swatch${live ? " swatch-live" : ""}" style="background:rgb(${r},${g},${b});color:rgb(${r},${g},${b})"></span></td>`;
    tbody.appendChild(tr);
  });
}

function updateSwatches() {
  const fx = state.config?.fixtures?.find((f) => f.id === state.selectedFixtureId);
  if (!fx || !state.previews[fx.id]) return;
  const rows = $("#patch-body").querySelectorAll("tr");
  rows.forEach((row, i) => {
    const c = state.previews[fx.id][i];
    if (!c) return;
    const sw = row.querySelector(".swatch");
    if (!sw) return;
    sw.style.background = `rgb(${c.red},${c.green},${c.blue})`;
    sw.style.color = `rgb(${c.red},${c.green},${c.blue})`;
    sw.classList.toggle("swatch-live", c.red + c.green + c.blue > 0);
  });
}

function collectPixelsFromTable() {
  const pixels = [];
  $("#patch-body").querySelectorAll("tr").forEach((row) => {
    pixels.push({
      ledIndex: Number(row.dataset.ledIndex),
      channels: [
        Number(row.querySelector(".ch-r").value),
        Number(row.querySelector(".ch-g").value),
        Number(row.querySelector(".ch-b").value),
      ],
    });
  });
  return pixels;
}

async function saveFixture() {
  const f = $("#editor-form");
  const id = state.selectedFixtureId;
  const body = {
    name: f.name.value,
    deviceId: Number(f.deviceId.value),
    zoneId: f.zoneId.value === "" ? null : Number(f.zoneId.value),
    source: {
      type: f.sourceType.value,
      universes: f.sourceUniverses.value.split(",").map((x) => Number(x.trim())).filter(Boolean),
    },
    dmxStart: Number(f.dmxStart.value),
    colorOrder: f.colorOrder.value,
    mapping: f.mapping.value,
    pixels: f.mapping.value === "custom" ? collectPixelsFromTable() : [],
  };
  await api(`/api/fixtures/${id}`, { method: "PUT", body: JSON.stringify(body) });
  state.config = await api("/api/config");
  renderFixtureCards();
  toast("Fixture saved", true);
}

function autoPatch() {
  const f = $("#editor-form");
  f.mapping.value = "custom";
  renderPatchTable({
    ...state.config.fixtures.find((x) => x.id === state.selectedFixtureId),
    mapping: "linear",
    dmxStart: Number(f.dmxStart.value),
  });
  toast("Linear patch applied — save to keep", true);
}

function clearPatch() {
  $("#patch-body").querySelectorAll("tr").forEach((row) => {
    row.querySelector(".ch-r").value = 0;
    row.querySelector(".ch-g").value = 0;
    row.querySelector(".ch-b").value = 0;
  });
  $("#editor-form").mapping.value = "custom";
}

function exportPatch() {
  const data = collectPixelsFromTable();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.selectedFixtureId}-patch.json`;
  a.click();
  toast("Patch exported", true);
}

function showPanel(name) {
  $$(".rack-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  $$(".deck-panel").forEach((p) => {
    const active = p.id === `panel-${name}`;
    p.classList.toggle("active", active);
    if (active) {
      p.style.animation = "none";
      p.offsetHeight;
      p.style.animation = "";
    }
  });
}

async function addFixture() {
  const id = `fixture-${Date.now()}`;
  const body = {
    id,
    name: "New Fixture",
    deviceId: state.devices[0]?.deviceId ?? 0,
    zoneId: null,
    source: { type: "artnet", universes: [1] },
    dmxStart: 1,
    colorOrder: "RGB",
    mapping: "linear",
    pixels: [],
  };
  await api("/api/fixtures", { method: "POST", body: JSON.stringify(body) });
  state.config = await api("/api/config");
  state.selectedFixtureId = id;
  renderFixtureCards();
  populateEditorSelect();
  showPanel("editor");
  loadEditorFixture();
  toast("Fixture created", true);
}

function renderAll() {
  fillSetupForm();
  renderFixtureCards();
  populateEditorSelect();
  if (state.selectedFixtureId) loadEditorFixture();
  if (state.status) {
    updateOpenRgbPill(state.status.openrgb);
    updateMonitor();
  }
}

function bindEvents() {
  $$(".rack-btn").forEach((btn) => {
    btn.onclick = () => showPanel(btn.dataset.panel);
  });
  $("#save-setup").onclick = () => saveSetup().catch((e) => toast(e.message));
  $("#add-fixture").onclick = () => addFixture().catch((e) => toast(e.message));
  $("#save-fixture").onclick = () => saveFixture().catch((e) => toast(e.message));
  $("#auto-patch").onclick = autoPatch;
  $("#clear-patch").onclick = clearPatch;
  $("#export-patch").onclick = exportPatch;
  $("#import-patch").onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const pixels = JSON.parse(await file.text());
    const fx = state.config.fixtures.find((f) => f.id === state.selectedFixtureId);
    fx.pixels = pixels;
    fx.mapping = "custom";
    renderPatchTable(fx);
    $("#editor-form").mapping.value = "custom";
    toast("Patch imported", true);
  };
  $("#editor-fixture-select").onchange = (ev) => {
    state.selectedFixtureId = ev.target.value;
    loadEditorFixture();
  };
  $("#editor-device").onchange = (ev) => populateZoneSelect(Number(ev.target.value), "");
  $("#editor-form").dmxStart.onchange = () => {
    const fx = state.config.fixtures.find((f) => f.id === state.selectedFixtureId);
    if (fx) renderPatchTable(fx);
  };
}

async function init() {
  bindEvents();
  connectWs();
  await loadDevices();
  try {
    state.config = await api("/api/config");
    state.status = await api("/api/status");
    renderAll();
  } catch (e) {
    console.error(e);
    toast(e.message);
  }
}

init();
