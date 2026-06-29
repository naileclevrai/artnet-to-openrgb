const fs = require("fs");
const path = require("path");
const { normalizeColorOrder } = require("./mapping/color-order");

const DEFAULT_CONFIG = {
  protocol: "both",
  fps: 30,
  debug: false,
  ui: { port: 3000 },
  openrgb: {
    host: "127.0.0.1",
    port: 6742,
    clientName: "ArtNet/sACN RGB Bridge",
  },
  artnet: { port: 6454, universe: null, sync: false },
  sacn: { port: 5568, universes: [1], iface: null, reuseAddr: true },
  fixtures: [],
};

function parseArtNetUniverse(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const str = String(value);
  if (str.includes(".")) {
    const [net, sub] = str.split(".").map(Number);
    if (!Number.isInteger(net) || !Number.isInteger(sub)) {
      throw new Error(`Invalid artnet.universe: "${value}"`);
    }
    return (net << 8) | sub;
  }
  const num = Number(str);
  if (!Number.isInteger(num)) throw new Error(`Invalid artnet.universe: "${value}"`);
  return num;
}

function parseUniversesList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(Number))];
  const raw = value ?? "1";
  const list = String(raw)
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => !Number.isNaN(n));
  if (list.length === 0 || list.some((u) => u < 1 || u > 63999)) {
    throw new Error(`Invalid universes list: "${raw}"`);
  }
  return [...new Set(list)];
}

function normalizeFixture(fixture, index) {
  const id = fixture.id || `fixture-${index}`;
  const source = fixture.source || { type: "artnet", universe: 1 };
  const type = source.type || "artnet";
  const universes =
    source.universes != null
      ? parseUniversesList(source.universes)
      : [source.universe ?? 1];

  return {
    id,
    name: fixture.name || id,
    deviceId: fixture.deviceId ?? 0,
    zoneId: fixture.zoneId ?? null,
    source: { type, universes },
    dmxStart: fixture.dmxStart ?? 1,
    colorOrder: normalizeColorOrder(fixture.colorOrder || "RGB"),
    mapping: fixture.mapping === "custom" ? "custom" : "linear",
    pixels: Array.isArray(fixture.pixels) ? fixture.pixels : [],
  };
}

function validateConfig(config) {
  const protocol = String(config.protocol || "both").toLowerCase();
  if (!["artnet", "sacn", "both"].includes(protocol)) {
    throw new Error(`Invalid protocol: "${config.protocol}"`);
  }
  if (!Array.isArray(config.fixtures)) {
    throw new Error("config.fixtures must be an array");
  }
  config.fixtures = config.fixtures.map(normalizeFixture);
  return config;
}

function applyEnvOverrides(config) {
  const out = structuredClone(config);
  if (process.env.PROTOCOL) out.protocol = process.env.PROTOCOL.toLowerCase();
  if (process.env.FPS) out.fps = Number(process.env.FPS);
  if (process.env.DEBUG) out.debug = process.env.DEBUG === "true";
  if (process.env.UI_PORT) out.ui.port = Number(process.env.UI_PORT);
  if (process.env.OPENRGB_HOST) out.openrgb.host = process.env.OPENRGB_HOST;
  if (process.env.OPENRGB_PORT) out.openrgb.port = Number(process.env.OPENRGB_PORT);
  if (process.env.OPENRGB_CLIENT_NAME) out.openrgb.clientName = process.env.OPENRGB_CLIENT_NAME;
  if (process.env.ARTNET_PORT) out.artnet.port = Number(process.env.ARTNET_PORT);
  if (process.env.ARTNET_UNIVERSE !== undefined) {
    out.artnet.universe = parseArtNetUniverse(process.env.ARTNET_UNIVERSE);
  }
  if (process.env.ARTNET_SYNC) out.artnet.sync = process.env.ARTNET_SYNC === "true";
  if (process.env.SACN_PORT) out.sacn.port = Number(process.env.SACN_PORT);
  if (process.env.SACN_UNIVERSES) out.sacn.universes = parseUniversesList(process.env.SACN_UNIVERSES);
  if (process.env.SACN_IFACE) out.sacn.iface = process.env.SACN_IFACE;
  if (process.env.SACN_REUSE_ADDR) out.sacn.reuseAddr = process.env.SACN_REUSE_ADDR !== "false";
  return out;
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  let base = structuredClone(DEFAULT_CONFIG);
  if (fs.existsSync(resolved)) {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
    base = { ...base, ...raw, openrgb: { ...base.openrgb, ...raw.openrgb }, artnet: { ...base.artnet, ...raw.artnet }, sacn: { ...base.sacn, ...raw.sacn }, ui: { ...base.ui, ...raw.ui } };
  }
  const merged = applyEnvOverrides(base);
  if (merged.artnet.universe !== null && merged.artnet.universe !== undefined) {
    merged.artnet.universe = parseArtNetUniverse(merged.artnet.universe);
  }
  if (merged.sacn.universes) {
    merged.sacn.universes = parseUniversesList(merged.sacn.universes);
  }
  return validateConfig(merged);
}

function saveConfig(configPath, config) {
  const validated = validateConfig(structuredClone(config));
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(validated, null, 2));
  return validated;
}

function collectRequiredUniverses(config) {
  const artnet = new Set();
  const sacn = new Set(config.sacn?.universes || [1]);

  for (const fixture of config.fixtures) {
    const { type, universes } = fixture.source;
    for (const u of universes) {
      if (type === "artnet") artnet.add(u);
      else if (type === "sacn") sacn.add(u);
    }
  }

  return { artnet: [...artnet], sacn: [...sacn] };
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  validateConfig,
  parseArtNetUniverse,
  parseUniversesList,
  normalizeFixture,
  collectRequiredUniverses,
};
