const path = require("path");
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { saveConfig, validateConfig, normalizeFixture } = require("../config");

function createServer({ configPath, getConfig, setConfig, bridge, openRgb }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(path.join(__dirname, "../../public")));

  app.get("/api/devices", async (_req, res) => {
    try {
      const devices = await openRgb.refreshDevices();
      res.json(openRgb.serializeDevices());
    } catch (err) {
      res.status(503).json({ error: err.message });
    }
  });

  app.get("/api/config", (_req, res) => {
    res.json(getConfig());
  });

  app.put("/api/config", async (req, res) => {
    try {
      const validated = validateConfig(req.body);
      saveConfig(configPath, validated);
      setConfig(validated);
      await bridge.reload(validated);
      res.json(validated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/status", (_req, res) => {
    res.json(bridge.getStatus());
  });

  app.post("/api/fixtures", async (req, res) => {
    try {
      const config = structuredClone(getConfig());
      const fixture = normalizeFixture(req.body, config.fixtures.length);
      if (config.fixtures.some((f) => f.id === fixture.id)) {
        return res.status(400).json({ error: `Fixture "${fixture.id}" already exists` });
      }
      config.fixtures.push(fixture);
      const validated = saveConfig(configPath, config);
      setConfig(validated);
      await bridge.reload(validated);
      res.json(fixture);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/fixtures/:id", async (req, res) => {
    try {
      const config = structuredClone(getConfig());
      const idx = config.fixtures.findIndex((f) => f.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: "Fixture not found" });
      config.fixtures[idx] = normalizeFixture(
        { ...config.fixtures[idx], ...req.body, id: req.params.id },
        idx
      );
      const validated = saveConfig(configPath, config);
      setConfig(validated);
      await bridge.reload(validated);
      res.json(config.fixtures[idx]);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/fixtures/:id", async (req, res) => {
    try {
      const config = structuredClone(getConfig());
      config.fixtures = config.fixtures.filter((f) => f.id !== req.params.id);
      const validated = saveConfig(configPath, config);
      setConfig(validated);
      await bridge.reload(validated);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const broadcast = (data) => {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  };

  bridge.on("frame", ({ previews, stats }) => {
    broadcast({ type: "frame", previews, status: stats });
  });

  bridge.on("stats", (status) => {
    broadcast({ type: "stats", status });
  });

  openRgb.on("status", (status, detail) => {
    broadcast({ type: "openrgb", status, detail });
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "init", status: bridge.getStatus(), config: getConfig() }));
  });

  return { app, server, broadcast };
}

module.exports = { createServer };
