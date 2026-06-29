const { EventEmitter } = require("events");
const OpenRGB = require("openrgb-sdk");

class OpenRgbManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.status = "disconnected";
    this.retryMs = 1000;
    this.maxRetryMs = 30000;
    this.devices = [];
  }

  async connect() {
    this.status = "connecting";
    this.emit("status", this.status);

    const { host, port, clientName } = this.config.openrgb;
    this.client = new OpenRGB.Client(clientName, port, host);

    try {
      await this.client.connect();
      this.devices = await this.client.getAllControllerData();
      this.status = "connected";
      this.retryMs = 1000;
      this.emit("status", this.status);
      return this.devices;
    } catch (err) {
      this.status = "error";
      this.emit("status", this.status, err.message);
      throw err;
    }
  }

  async ensureConnected() {
    if (this.client?.isConnected) return;
    await this.connectWithRetry();
  }

  async connectWithRetry() {
    while (true) {
      try {
        await this.connect();
        return;
      } catch (err) {
        this.status = "reconnecting";
        this.emit("status", this.status, err.message);
        console.error(`OpenRGB reconnect in ${this.retryMs}ms: ${err.message}`);
        await new Promise((r) => setTimeout(r, this.retryMs));
        this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
      }
    }
  }

  async refreshDevices() {
    await this.ensureConnected();
    this.devices = await this.client.getAllControllerData();
    return this.devices;
  }

  getDevice(deviceId) {
    return this.devices.find((d) => d.deviceId === deviceId);
  }

  async updateFixture(compiled) {
    await this.ensureConnected();
    const { deviceId, zoneId, colors } = compiled;

    try {
      if (zoneId != null) {
        await this.client.updateZoneLeds(deviceId, zoneId, colors);
      } else {
        await this.client.updateLeds(deviceId, colors);
      }
      if (this.status !== "connected") {
        this.status = "connected";
        this.emit("status", this.status);
      }
    } catch (err) {
      this.status = "error";
      this.emit("status", this.status, err.message);
      this.client.isConnected = false;
      throw err;
    }
  }

  disconnect() {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.status = "disconnected";
    this.emit("status", this.status);
  }

  serializeDevices() {
    return this.devices.map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      ledCount: d.leds.length,
      leds: d.leds.map((l, i) => ({ index: i, name: l.name })),
      zones: d.zones.map((z, i) => ({
        id: i,
        name: z.name,
        ledsCount: z.ledsCount,
      })),
    }));
  }
}

function formatDeviceList(devices) {
  return devices
    .filter((d) => d.leds.length > 0)
    .map((d) => `  [${d.deviceId}] ${d.name} (${d.leds.length} LEDs)`)
    .join("\n");
}

async function listDevicesCli(config) {
  const mgr = new OpenRgbManager(config);
  try {
    const devices = await mgr.connect();
    if (devices.length === 0) {
      console.log("No OpenRGB devices found.");
      return;
    }
    for (const d of devices) {
      console.log(`[${d.deviceId}] ${d.name} — ${d.leds.length} LEDs`);
      for (const z of d.zones) {
        console.log(`  Zone ${z.id ?? ""} ${z.name}: ${z.ledsCount} LEDs`);
      }
      for (let i = 0; i < Math.min(d.leds.length, 20); i++) {
        console.log(`    LED ${i}: ${d.leds[i].name}`);
      }
      if (d.leds.length > 20) console.log(`    ... and ${d.leds.length - 20} more`);
    }
  } finally {
    mgr.disconnect();
  }
}

module.exports = { OpenRgbManager, formatDeviceList, listDevicesCli };
