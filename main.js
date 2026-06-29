const dgram = require("dgram");
const OpenRGB = require("openrgb-sdk");

const ARTNET_PORT = Number(process.env.ARTNET_PORT) || 6454;
const ARTNET_OPCODE_DMX = 0x5000;
const ARTNET_HEADER = "Art-Net";
const FPS = Number(process.env.FPS) || 30;
const FRAME_MS = 1000 / FPS;

const OPENRGB_CONFIG = {
  name: process.env.OPENRGB_CLIENT_NAME || "ArtNet Keyboard Bridge",
  host: process.env.OPENRGB_HOST || "127.0.0.1",
  port: Number(process.env.OPENRGB_PORT) || 6742,
};

const DEVICE_NAME_MATCH = process.env.DEVICE_NAME_MATCH || "G512";

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

async function main() {
  const client = new OpenRGB.Client(OPENRGB_CONFIG);

  try {
    await client.connect();
  } catch (err) {
    console.error("Failed to connect to OpenRGB:", err.message);
    process.exit(1);
  }

  const devices = await client.getAllControllerData();
  const keyboard = devices.find((d) => d.name.includes(DEVICE_NAME_MATCH));

  if (!keyboard) {
    console.error(`No device matching "${DEVICE_NAME_MATCH}" found.`);
    const names = devices.map((d) => d.name);
    console.error("Available devices:", names.length ? names.join(", ") : "(none)");
    process.exit(1);
  }

  const ledCount = keyboard.leds.length;
  const neededChannels = ledCount * 3;

  console.log(`Device found: ${keyboard.name}`);
  console.log(`LED count: ${ledCount} (${neededChannels} DMX channels)`);

  const dmxBuffer = Buffer.alloc(512);
  let framePending = false;
  let updating = false;

  const colors = Array.from({ length: ledCount }, () => ({
    red: 0,
    green: 0,
    blue: 0,
  }));

  const server = dgram.createSocket("udp4");

  server.on("error", (err) => {
    console.error("UDP socket error:", err.message);
    process.exit(1);
  });

  server.on("message", (msg) => {
    const length = parseArtDmxLength(msg);
    if (!length) return;

    const data = msg.subarray(18, 18 + length);
    if (data.length < neededChannels) return;

    data.copy(dmxBuffer, 0, 0, neededChannels);
    framePending = true;
  });

  server.bind(ARTNET_PORT, () => {
    console.log(`Art-Net bridge listening on UDP port ${ARTNET_PORT}`);
    console.log(`Pushing LED updates to OpenRGB at ${FPS} FPS`);
  });

  setInterval(async () => {
    if (!framePending || updating) return;

    updating = true;
    framePending = false;

    applyDmxToColors(dmxBuffer, ledCount, colors);

    try {
      await client.updateLeds(keyboard.deviceId, colors);
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
