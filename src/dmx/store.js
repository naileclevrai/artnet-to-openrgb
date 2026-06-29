class DmxStore {
  constructor() {
    this.buffers = new Map();
    this.lastUpdate = new Map();
  }

  _key(protocol, universe) {
    return `${protocol}:${universe}`;
  }

  set(protocol, universe, data) {
    const key = this._key(protocol, universe);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = Buffer.alloc(512);
      this.buffers.set(key, buffer);
    }
    const len = Math.min(data.length, 512);
    data.copy(buffer, 0, 0, len);
    this.lastUpdate.set(key, Date.now());
  }

  _getLatestBuffer(protocol) {
    let latest = null;
    let latestTs = 0;
    for (const [key, ts] of this.lastUpdate) {
      if (!key.startsWith(`${protocol}:`)) continue;
      if (ts > latestTs) {
        latestTs = ts;
        latest = this.buffers.get(key);
      }
    }
    return latest;
  }

  getChannel(protocol, universes, channel) {
    if (channel < 1) return 0;
    const index = Math.floor((channel - 1) / 512);
    if (index >= universes.length) return 0;
    const universe = universes[index];
    const offset = (channel - 1) % 512;
    const key = this._key(protocol, universe);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = this._getLatestBuffer(protocol);
    }
    return buffer ? buffer[offset] : 0;
  }

  getActiveUniverses() {
    return [...this.lastUpdate.entries()].map(([key, ts]) => ({
      key,
      lastUpdate: ts,
    }));
  }
}

module.exports = { DmxStore };
