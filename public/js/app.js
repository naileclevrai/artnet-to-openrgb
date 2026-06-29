const state = {
  config: null,
  devices: [],
  fixtures: [],
  selectedFixtureId: null,
  previews: {},
  status: null,
  ws: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  el.textContent = `OpenRGB: ${s}`;
  el.className = "pill " + (s === "connected" ? "pill-on" : s === "reconnecting" ? "pill-warn" : "pill-off");
}

function updateMonitor() {
  if (!state.status?.stats) return;
  const s = state.status.stats;
  $("#fps-status").textContent = `${s.fps} FPS`;
  $("#mon-fps").textContent = s.fps;
  $("#mon-pps").textContent = s.packetRate;
  $("#mon-updates").textContent = s.updates;
  $("#mon-skips").textContent = s.skips;
  $("#mon-source").textContent = s.lastSource || "—";
  $("#mon-universe").textContent = s.lastUniverse ?? "—";
  $("#mon-ch").textContent = (s.lastChannels || [0, 0, 0]).join(", ");
  renderPreviewGrid();
}

function renderPreviewGrid() {
  const grid = $("#preview-grid");
  grid.innerHTML = "";
  for (const [fid, colors] of Object.entries(state.previews)) {
    const label = document.createElement("div");
    label.style.width = "100%";
    label.style.fontSize = "0.7rem";
    label.style.color = "#8b95a8";
    label.textContent = fid;
    grid.appendChild(label);
    for (const c of colors) {
      const d = document.createElement("div");
      d.className = "preview-pixel";
      d.style.background = `rgb(${c.red},${c.green},${c.blue})`;
      d.title = `rgb(${c.red},${c.green},${c.blue})`;
      grid.appendChild(d);
    }
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
  f.sacnUniverses.value = (c.sacn.universes || []).join(",");
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
}

function renderFixtureCards() {
  const list = $("#fixture-list");
  list.innerHTML = "";
  for (const fx of state.config?.fixtures || []) {
    const card = document.createElement("div");
    card.className = "fixture-card";
    card.innerHTML = `
      <h3>${fx.name}</h3>
      <p>ID: ${fx.id}</p>
      <p>Device ${fx.deviceId}${fx.zoneId != null ? ` / Zone ${fx.zoneId}` : ""}</p>
      <p>${fx.source.type.toUpperCase()} universe ${fx.source.universes?.join("+") || "?"}</p>
      <p>DMX start ${fx.dmxStart} · ${fx.mapping} · ${fx.colorOrder}</p>
      <div class="actions">
        <button class="btn edit-fixture" data-id="${fx.id}">Edit</button>
        <button class="btn delete-fixture" data-id="${fx.id}">Delete</button>
      </div>`;
    list.appendChild(card);
  }
  list.querySelectorAll(".edit-fixture").forEach((btn) => {
    btn.onclick = () => {
      state.selectedFixtureId = btn.dataset.id;
      showPanel("editor");
      loadEditorFixture();
    };
  });
  list.querySelectorAll(".delete-fixture").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Delete fixture "${btn.dataset.id}"?`)) return;
      await api(`/api/fixtures/${btn.dataset.id}`, { method: "DELETE" });
      state.config = await api("/api/config");
      renderFixtureCards();
      populateEditorSelect();
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

    const tr = document.createElement("tr");
    tr.dataset.ledIndex = absIndex;
    tr.innerHTML = `
      <td>${absIndex}</td>
      <td>${led.name}</td>
      <td><input type="number" class="ch-r" min="1" max="2048" value="${ch[0]}" /></td>
      <td><input type="number" class="ch-g" min="1" max="2048" value="${ch[1]}" /></td>
      <td><input type="number" class="ch-b" min="1" max="2048" value="${ch[2]}" /></td>
      <td><span class="swatch" style="background:rgb(${preview?.red ?? 0},${preview?.green ?? 0},${preview?.blue ?? 0})"></span></td>`;
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
    if (sw) sw.style.background = `rgb(${c.red},${c.green},${c.blue})`;
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
}

function autoPatch() {
  const f = $("#editor-form");
  f.mapping.value = "custom";
  renderPatchTable({
    ...state.config.fixtures.find((x) => x.id === state.selectedFixtureId),
    mapping: "linear",
    dmxStart: Number(f.dmxStart.value),
  });
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
}

function showPanel(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
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
  $$(".nav-btn").forEach((btn) => {
    btn.onclick = () => showPanel(btn.dataset.panel);
  });
  $("#save-setup").onclick = () => saveSetup().catch((e) => alert(e.message));
  $("#add-fixture").onclick = () => addFixture().catch((e) => alert(e.message));
  $("#save-fixture").onclick = () => saveFixture().catch((e) => alert(e.message));
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
  }
}

init();
