const path = require("path");
const fs = require("fs");
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require("./config");
const { OpenRgbManager, listDevicesCli } = require("./openrgb/client");
const { Bridge } = require("./bridge");
const { createServer } = require("./server/api");

function parseArgs(argv) {
  const args = { configPath: path.join(process.cwd(), "config.json"), listDevices: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--list-devices") args.listDevices = true;
    else if (argv[i] === "--config" && argv[i + 1]) {
      args.configPath = path.resolve(argv[++i]);
    }
  }
  return args;
}

function ensureConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    const example = path.join(process.cwd(), "config.example.json");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, configPath);
      console.log(`Created ${configPath} from config.example.json`);
    } else {
      saveConfig(configPath, DEFAULT_CONFIG);
      console.log(`Created default ${configPath}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.listDevices) {
    const config = loadConfig(args.configPath);
    await listDevicesCli(config);
    return;
  }

  ensureConfigFile(args.configPath);
  let config = loadConfig(args.configPath);

  const openRgb = new OpenRgbManager(config);
  const bridge = new Bridge(config, openRgb, args.configPath);

  let shutdownPromise = null;
  const shutdown = async (signal) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log(`\n${signal} received, shutting down...`);
      bridge.stop();
      openRgb.disconnect();
      if (serverRef?.server) {
        await new Promise((resolve) => serverRef.server.close(resolve));
      }
      process.exit(0);
    })();
    return shutdownPromise;
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const setConfig = (c) => {
    config = c;
    openRgb.config = c;
  };

  const serverRef = createServer({
    configPath: args.configPath,
    getConfig: () => config,
    setConfig,
    bridge,
    openRgb,
  });

  const port = config.ui?.port ?? 3000;
  await new Promise((resolve) => {
    serverRef.server.listen(port, () => {
      console.log(`UI available at http://localhost:${port}`);
      resolve();
    });
  });

  await bridge.start();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
