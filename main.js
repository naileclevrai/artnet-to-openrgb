const dgram = require('dgram');
const OpenRGB = require('openrgb-sdk');

(async () => {

  const client = new OpenRGB.Client({
    name: "ArtNet Keyboard Bridge",
    port: 6742,
    host: "127.0.0.1"
  });

  await client.connect();

  const devices = await client.getAllControllerData();
  const keyboard = devices.find(d => d.name.includes("G512"));

  if (!keyboard) {
    console.log("Clavier non trouvé");
    return;
  }

  const ledCount = keyboard.leds.length;
  const neededChannels = ledCount * 3;

  console.log("Clavier détecté :", keyboard.name);
  console.log("LED count :", ledCount);

  let dmxBuffer = Buffer.alloc(512);
  let newFrameReceived = false;

  const server = dgram.createSocket('udp4');

  server.on('message', (msg) => {

    // Signature complète Art-Net
    if (msg.length < 18) return;
    if (msg.toString('ascii', 0, 7) !== 'Art-Net') return;

    const opcode = msg.readUInt16LE(8);

    // On accepte UNIQUEMENT ArtDMX
    if (opcode !== 0x5000) return;

    const length = msg.readUInt16BE(16);

    if (length <= 0 || length > 512) return;

    const data = msg.slice(18, 18 + length);

    if (data.length < neededChannels) return;

    dmxBuffer = Buffer.from(data);
    newFrameReceived = true;
  });

  server.bind(6454);

  console.log("Bridge Art-Net actif sur port 6454");

  const FPS = 30;
  const FRAME_TIME = 1000 / FPS;

  let updating = false;

  setInterval(async () => {

    if (!newFrameReceived) return;
    if (updating) return;

    updating = true;
    newFrameReceived = false;

    const colors = new Array(ledCount);

    for (let i = 0; i < ledCount; i++) {
      const base = i * 3;

      colors[i] = {
        red: dmxBuffer[base] || 0,
        green: dmxBuffer[base + 1] || 0,
        blue: dmxBuffer[base + 2] || 0
      };
    }

    try {
      await client.updateLeds(keyboard.deviceId, colors);
    } catch (e) {
      console.log("Erreur update:", e.message);
    }

    updating = false;

  }, FRAME_TIME);

})();
