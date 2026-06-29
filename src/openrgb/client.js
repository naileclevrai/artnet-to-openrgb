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
    this._backgroundConnect = false;
    this._warnedOffline = false;
    this._directModeDevices = new Set();
  }

  _resetDeviceState() {
    this._directModeDevices.clear();
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
      this._warnedOffline = false;
      this.emit("status", this.status);
      this.emit("ready", this.devices);
      return this.devices;
    } catch (err) {
      this.status = "error";
      this.emit("status", this.status, err.message);
      this._resetDeviceState();
      throw err;
    }
  }

  startBackgroundConnect() {
    if (this._backgroundConnect) return;
    this._backgroundConnect = true;

    const loop = async () => {
      while (this._backgroundConnect) {
        if (this.client?.isConnected) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        try {
          await this.connect();
        } catch (err) {
          this.status = "reconnecting";
          this.emit("status", this.status, err.message);
          if (!this._warnedOffline) {
            const { host, port } = this.config.openrgb;
            console.warn(`OpenRGB not available at ${host}:${port} (${err.message})`);
            console.warn("Bridge and UI are running — enable OpenRGB SDK Server to drive LEDs.");
            this._warnedOffline = true;
          }
          await new Promise((r) => setTimeout(r, this.retryMs));
          this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
        }
      }
    };

    loop().catch(() => {});
  }

  stopBackgroundConnect() {
    this._backgroundConnect = false;
  }

  isConnected() {
    return Boolean(this.client?.isConnected);
  }

  async refreshDevices() {
    if (!this.isConnected()) {
      throw new Error("OpenRGB not connected");
    }
    this.devices = await this.client.getAllControllerData();
    return this.devices;
  }

  getDevice(deviceId) {
    return this.devices.find((d) => d.deviceId === deviceId);
  }

  async ensureDirectMode(deviceId) {
    if (!this.isConnected() || this._directModeDevices.has(deviceId)) return;

    let device = this.getDevice(deviceId);
    if (!device) {
      this.devices = await this.client.getAllControllerData();
      device = this.getDevice(deviceId);
    }
    if (!device) {
      throw new Error(`OpenRGB device ${deviceId} not found`);
    }

    const direct = device.modes?.find((m) => m.name === "Direct");
    if (direct) {
      await this.client.updateMode(deviceId, "Direct");
    } else {
      this.client.setCustomMode(deviceId);
    }
    this._directModeDevices.add(deviceId);
  }

  async updateFixture(compiled) {
    if (!this.isConnected()) return false;
    const { deviceId, zoneId, colors } = compiled;

    try {
      await this.ensureDirectMode(deviceId);

      const device = this.getDevice(deviceId);
      const useFullDevice =
        zoneId == null ||
        (device?.zones?.length === 1 && zoneId === 0);

      if (useFullDevice) {
        this.client.updateLeds(deviceId, colors);
      } else {
        this.client.updateZoneLeds(deviceId, zoneId, colors);
      }

      if (this.status !== "connected") {
        this.status = "connected";
        this.emit("status", this.status);
      }
      return true;
    } catch (err) {
      console.error(`OpenRGB device ${deviceId}: ${err.message}`);
      this.emit("status", "connected", err.message);
      return false;
    }
  }

  disconnect() {
    this.stopBackgroundConnect();
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        /* ignore */
      }
    }
    this._resetDeviceState();
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
