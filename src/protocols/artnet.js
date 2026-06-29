const dgram = require("dgram");

const ARTNET_HEADER = "Art-Net";
const OPCODE_DMX = 0x5000;
const OPCODE_SYNC = 0x5200;

function getPortAddress(msg) {
  return msg.readUInt16LE(14);
}

function parseArtDmx(msg) {
  if (msg.length < 18) return null;
  if (msg.toString("ascii", 0, 7) !== ARTNET_HEADER) return null;
  if (msg.readUInt16LE(8) !== OPCODE_DMX) return null;
  const length = msg.readUInt16BE(16);
  if (length <= 0 || length > 512) return null;
  return {
    portAddress: getPortAddress(msg),
    universe: getPortAddress(msg),
    data: msg.subarray(18, 18 + length),
  };
}

function parseArtSync(msg) {
  if (msg.length < 18) return null;
  if (msg.toString("ascii", 0, 7) !== ARTNET_HEADER) return null;
  if (msg.readUInt16LE(8) !== OPCODE_SYNC) return null;
  return { portAddress: getPortAddress(msg) };
}

function matchesUniverseFilter(portAddress, filter) {
  if (filter === null || filter === undefined) return true;
  return portAddress === filter;
}

function startArtNetReceiver({ port, universeFilter, syncMode, onDmx, onSync, onError }) {
  const server = dgram.createSocket("udp4");
  let syncPending = !syncMode;

  server.on("error", (err) => onError(err));

  server.on("message", (msg) => {
    const sync = parseArtSync(msg);
    if (sync) {
      if (matchesUniverseFilter(sync.portAddress, universeFilter)) {
        syncPending = true;
        onSync?.(sync);
      }
      return;
    }

    const packet = parseArtDmx(msg);
    if (!packet) return;
    if (!matchesUniverseFilter(packet.portAddress, universeFilter)) return;

    onDmx(packet.universe, packet.data, "artnet");

    if (!syncMode) {
      syncPending = true;
    }
  });

  server.bind(port, () => {
    console.log(`Art-Net listening on UDP port ${port}${universeFilter != null ? ` (universe filter: ${universeFilter})` : ""}${syncMode ? " (sync mode)" : ""}`);
  });

  return {
    close: () => server.close(),
    shouldFlush: () => syncPending,
    markFlushed: () => {
      syncPending = false;
    },
    forceFlush: () => {
      syncPending = true;
    },
  };
}

module.exports = { startArtNetReceiver, parseArtDmx, getPortAddress };
