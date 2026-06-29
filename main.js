const dgram = require("dgram");
const OpenRGB = require("openrgb-sdk");
const { Receiver } = require("sacn");

const PROTOCOL = (process.env.PROTOCOL || "both").toLowerCase();
const ARTNET_PORT = Number(process.env.ARTNET_PORT) || 6454;
const ARTNET_OPCODE_DMX = 0x5000;
const ARTNET_HEADER = "Art-Net";
const SACN_PORT = Number(process.env.SACN_PORT) || 5568;
const SACN_REUSE_ADDR = process.env.SACN_REUSE_ADDR !== "false";
const FPS = Number(process.env.FPS) || 30;
const FRAME_MS = 1000 / FPS;

const OPENRGB_CONFIG = {
  name: process.env.OPENRGB_CLIENT_NAME || "ArtNet/sACN RGB Bridge",
  host: process.env.OPENRGB_HOST || "127.0.0.1",
  port: Number(process.env.OPENRGB_PORT) || 6742,
};

function listDevices(devices) {
  return devices
    .map((d) => `  [${d.deviceId}] ${d.name} (${d.leds.length} LEDs)`)
    .join("\n");
}

function selectDevice(devices) {
  const withLeds = devices.filter((d) => d.leds.length > 0);

  if (withLeds.length === 0) {
    console.error("No OpenRGB device with addressable LEDs found.");
    if (devices.length > 0) {
      console.error("Connected devices:");
      console.error(listDevices(devices));
    }
    process.exit(1);
  }

  const deviceIdEnv = process.env.DEVICE_ID;
  if (deviceIdEnv !== undefined && deviceIdEnv !== "") {
    const id = Number(deviceIdEnv);
    if (!Number.isInteger(id) || id < 0) {
      console.error(`Invalid DEVICE_ID: "${deviceIdEnv}" (expected a non-negative integer)`);
      process.exit(1);
    }

    const device = withLeds.find((d) => d.deviceId === id);
    if (!device) {
      console.error(`Device ID ${id} not found or has no LEDs.`);
      console.error("Available devices with LEDs:");
      console.error(listDevices(withLeds));
      process.exit(1);
    }

    return device;
  }

  const nameMatch = process.env.DEVICE_NAME_MATCH;
  if (nameMatch) {
    const needle = nameMatch.toLowerCase();
    const matches = withLeds.filter((d) => d.name.toLowerCase().includes(needle));

    if (matches.length === 0) {
      console.error(`No device matching "${nameMatch}" found.`);
      console.error("Available devices with LEDs:");
      console.error(listDevices(withLeds));
      process.exit(1);
    }

    if (matches.length > 1) {
      console.log(`Multiple devices match "${nameMatch}", using: ${matches[0].name}`);
    }

    return matches[0];
  }

  if (withLeds.length > 1) {
    console.log("Multiple devices available, using the first one with LEDs:");
    console.log(listDevices(withLeds));
    console.log("Set DEVICE_ID or DEVICE_NAME_MATCH to target a specific device.");
  }

  return withLeds[0];
}

function parseUniverses(value) {
  const raw = value || "1";
  const universes = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((universe) => !Number.isNaN(universe));

  if (
    universes.length === 0 ||
    universes.some((universe) => !Number.isInteger(universe) || universe < 1 || universe > 63999)
  ) {
    console.error(`Invalid SACN_UNIVERSES: "${raw}" (expected comma-separated values from 1 to 63999)`);
    process.exit(1);
  }

  return [...new Set(universes)];
}

function parseProtocol() {
  if (PROTOCOL === "artnet" || PROTOCOL === "sacn" || PROTOCOL === "both") {
    return PROTOCOL;
  }

  console.error(`Invalid PROTOCOL: "${PROTOCOL}" (expected artnet, sacn, or both)`);
  process.exit(1);
}

/** @returns {number|false} DMX payload length if packet is ArtDMX, otherwise false */
function parseArtDmxLength(msg) {
  if (msg.length < 18) return false;
  if (msg.toString("ascii", 0, 7) !== ARTNET_HEADER) return false;
  if (msg.readUInt16LE(8) !== ARTNET_OPCODE_DMX) return false;

  const length = msg.readUInt16BE(16);
  if (length <= 0 || length > 512) return false;

  return length;
}

function applyDmxToColors(buffer, ledCount, colors) {
  for (let i = 0; i < ledCount; i++) {
    const base = i * 3;
    const color = colors[i];
    color.red = buffer[base];
    color.green = buffer[base + 1];
    color.blue = buffer[base + 2];
  }
}

function copyDmxData(source, dmxBuffer, neededChannels, onFrame) {
  if (source.length < neededChannels) return;
  source.copy(dmxBuffer, 0, 0, neededChannels);
  onFrame();
}

function startArtNetReceiver(dmxBuffer, neededChannels, onFrame) {
  const server = dgram.createSocket("udp4");

  server.on("error", (err) => {
    console.error("Art-Net socket error:", err.message);
    process.exit(1);
  });

  server.on("message", (msg) => {
    const length = parseArtDmxLength(msg);
    if (!length) return;
    copyDmxData(msg.subarray(18, 18 + length), dmxBuffer, neededChannels, onFrame);
  });

  server.bind(ARTNET_PORT, () => {
    console.log(`Art-Net listening on UDP port ${ARTNET_PORT}`);
  });

  return server;
}

function startSacnReceiver(universes, dmxBuffer, neededChannels, onFrame) {
  const receiverOptions = {
    universes,
    port: SACN_PORT,
    reuseAddr: SACN_REUSE_ADDR,
  };

  if (process.env.SACN_IFACE) {
    receiverOptions.iface = process.env.SACN_IFACE;
  }

  const receiver = new Receiver(receiverOptions);

  receiver.on("error", (err) => {
    console.error("sACN receiver error:", err.message);
    process.exit(1);
  });

  receiver.on("packet", (packet) => {
    const data = packet.payloadAsBuffer;
    if (!data) return;
    copyDmxData(data, dmxBuffer, neededChannels, onFrame);
  });

  console.log(
    `sACN listening on UDP port ${SACN_PORT} (universes: ${universes.join(", ")})`
  );

  return receiver;
}

async function main() {
  const protocol = parseProtocol();
  const useArtNet = protocol === "artnet" || protocol === "both";
  const useSacn = protocol === "sacn" || protocol === "both";
  const sacnUniverses = useSacn ? parseUniverses(process.env.SACN_UNIVERSES) : [];

  const client = new OpenRGB.Client(OPENRGB_CONFIG);

  try {
    await client.connect();
  } catch (err) {
    console.error("Failed to connect to OpenRGB:", err.message);
    process.exit(1);
  }

  const devices = await client.getAllControllerData();
  const device = selectDevice(devices);

  const ledCount = device.leds.length;
  const neededChannels = ledCount * 3;

  console.log(`Device selected: ${device.name} (ID ${device.deviceId})`);
  console.log(`LED count: ${ledCount} (${neededChannels} DMX channels)`);
  console.log(`Protocol mode: ${protocol}`);

  const dmxBuffer = Buffer.alloc(512);
  let framePending = false;
  let updating = false;

  const colors = Array.from({ length: ledCount }, () => ({
    red: 0,
    green: 0,
    blue: 0,
  }));

  const markFrame = () => {
    framePending = true;
  };

  if (useArtNet) {
    startArtNetReceiver(dmxBuffer, neededChannels, markFrame);
  }

  if (useSacn) {
    startSacnReceiver(sacnUniverses, dmxBuffer, neededChannels, markFrame);
  }

  console.log(`Pushing LED updates to OpenRGB at ${FPS} FPS`);

  setInterval(async () => {
    if (!framePending || updating) return;

    updating = true;
    framePending = false;

    applyDmxToColors(dmxBuffer, ledCount, colors);

    try {
      await client.updateLeds(device.deviceId, colors);
    } catch (err) {
      console.error("LED update failed:", err.message);
    } finally {
      updating = false;
    }
  }, FRAME_MS);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
