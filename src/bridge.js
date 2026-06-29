const { EventEmitter } = require("events");
const { compileFixture, mapFixture, colorsHash, validateFixtureChannels } = require("./mapping/engine");
const { startArtNetReceiver } = require("./protocols/artnet");
const { startSacnReceiver } = require("./protocols/sacn");
const { DmxStore } = require("./dmx/store");
const { collectRequiredUniverses } = require("./config");

class Bridge extends EventEmitter {
  constructor(config, openRgb, configPath) {
    super();
    this.config = config;
    this.configPath = configPath;
    this.openRgb = openRgb;
    this.store = new DmxStore();
    this.compiledFixtures = [];
    this.receivers = [];
    this.interval = null;
    this.running = false;
    this.framePending = false;
    this.updating = false;
    this.stats = {
      fps: 0,
      packets: 0,
      packetRate: 0,
      updates: 0,
      skips: 0,
      lastSource: null,
      lastUniverse: null,
      lastChannels: [0, 0, 0],
    };
    this._fpsFrames = 0;
    this._fpsTimer = null;
    this._packetCount = 0;
    this._packetTimer = null;
  }

  async reload(config) {
    this.config = config;
    await this.compileFixtures();
    this.restartReceivers();
  }

  async compileFixtures() {
    try {
      const devices = await this.openRgb.refreshDevices();
      this.compiledFixtures = [];

      for (const fixture of this.config.fixtures) {
        const device = devices.find((d) => d.deviceId === fixture.deviceId);
        if (!device) {
          console.warn(`Fixture "${fixture.id}": device ${fixture.deviceId} not found, skipped`);
          continue;
        }
        this.compiledFixtures.push(compileFixture(fixture, device));
      }

      const warnings = validateFixtureChannels(this.config.fixtures);
      for (const w of warnings) console.warn(w);

      if (this.compiledFixtures.length === 0 && this.config.fixtures.length > 0) {
        console.warn("No fixtures could be compiled. Check device IDs in the UI.");
      }
    } catch (err) {
      this.compiledFixtures = [];
      if (this.openRgb.isConnected()) {
        console.warn(`Fixture compile failed: ${err.message}`);
      }
    }
  }

  restartReceivers() {
    for (const r of this.receivers) r.close?.();
    this.receivers = [];

    const protocol = this.config.protocol;
    const useArtNet = protocol === "artnet" || protocol === "both";
    const useSacn = protocol === "sacn" || protocol === "both";
    const required = collectRequiredUniverses(this.config);

    const onDmx = (universe, data, source, meta) => {
      this.store.set(source, universe, data);
      if (source !== "artnet" || !this.config.artnet.sync) {
        this.framePending = true;
      }
      this._packetCount++;
      this.stats.lastSource = source;
      this.stats.lastUniverse = universe;
      this.stats.lastChannels = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      if (this.config.debug) {
        console.log(
          `[${source}] universe ${universe} ch1-3=${this.stats.lastChannels.join(",")}${meta?.sourceName ? ` from ${meta.sourceName}` : ""}`
        );
      }
      this.emit("dmx", { universe, source, meta });
    };

    const onError = (err) => {
      console.error("Protocol receiver error:", err.message);
      this.emit("error", err);
    };

    if (useArtNet) {
      this.receivers.push(
        startArtNetReceiver({
          port: this.config.artnet.port,
          universeFilter: this.config.artnet.universe,
          syncMode: this.config.artnet.sync,
          onDmx,
          onSync: () => {
            this.framePending = true;
          },
          onError,
        })
      );
    }

    if (useSacn) {
      const universes = required.sacn.length > 0 ? required.sacn : [1];
      this.receivers.push(
        startSacnReceiver({
          universes,
          port: this.config.sacn.port,
          iface: this.config.sacn.iface,
          reuseAddr: this.config.sacn.reuseAddr !== false,
          onDmx,
          onError,
        })
      );
    }
  }

  shouldFlush() {
    if (!this.framePending) return false;
    if (this.config.artnet.sync) {
      return this.receivers.some((r) => r.shouldFlush?.());
    }
    return true;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    this.openRgb.on("ready", () => {
      this.compileFixtures().catch(() => {});
    });
    this.openRgb.startBackgroundConnect();
    await this.compileFixtures();
    this.restartReceivers();

    const frameMs = 1000 / this.config.fps;
    console.log(`Pushing LED updates at ${this.config.fps} FPS`);

    this._fpsTimer = setInterval(() => {
      this.stats.fps = this._fpsFrames;
      this._fpsFrames = 0;
      this.emit("stats", this.getStatus());
    }, 1000);

    this._packetTimer = setInterval(() => {
      this.stats.packetRate = this._packetCount;
      this._packetCount = 0;
    }, 1000);

    this.interval = setInterval(() => this.tick(), frameMs);
  }

  async tick() {
    if (!this.shouldFlush() || this.updating) return;

    this.updating = true;
    this.framePending = false;
    for (const r of this.receivers) r.markFlushed?.();

    const previews = {};

    for (const compiled of this.compiledFixtures) {
      mapFixture(compiled, this.store);
      const hash = colorsHash(compiled.colors);

      if (hash === compiled.lastHash) {
        this.stats.skips++;
        previews[compiled.id] = compiled.colors;
        continue;
      }

      try {
        const updated = await this.openRgb.updateFixture(compiled);
        if (!updated) continue;
        compiled.lastHash = hash;
        this.stats.updates++;
        previews[compiled.id] = compiled.colors;
      } catch (err) {
        console.error(`Fixture "${compiled.id}" update failed:`, err.message);
      }
    }

    this._fpsFrames++;
    this.emit("frame", { previews, stats: this.getStatus() });
    this.updating = false;
  }

  getStatus() {
    return {
      openrgb: this.openRgb.status,
      protocol: this.config.protocol,
      fixtures: this.compiledFixtures.map((f) => ({
        id: f.id,
        name: f.name,
        deviceId: f.deviceId,
        zoneId: f.zoneId,
        pixelCount: f.zoneCount,
        mapping: f.mapping,
      })),
      stats: { ...this.stats },
      activeUniverses: this.store.getActiveUniverses(),
    };
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    if (this._fpsTimer) clearInterval(this._fpsTimer);
    if (this._packetTimer) clearInterval(this._packetTimer);
    for (const r of this.receivers) r.close?.();
    this.receivers = [];
  }
}

module.exports = { Bridge };
