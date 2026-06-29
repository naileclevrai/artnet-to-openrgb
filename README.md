# Art-Net / sACN to OpenRGB Bridge

A Node.js bridge that receives **Art-Net** or **sACN (E1.31)** DMX over UDP and drives any addressable RGB device in [OpenRGB](https://openrgb.org/). Includes a **fixture patch UI** to map DMX channels to OpenRGB pixels — like patching a lighting fixture, but for keyboard LEDs, RAM, strips, and more.

## Features

- Art-Net ArtDMX (UDP 6454) and sACN E1.31 (UDP 5568 multicast)
- **Fixture-based config** — multiple targets, custom DMX channel mapping per LED
- **Web UI** (always on) at `http://localhost:3000` — protocol setup, fixture editor, live monitor
- OpenRGB zones, color order (RGB/GRB/BGR…), DMX start offset
- Art-Net universe filter, Art-Net Sync mode, sACN priority merging
- Multi-universe DMX (>512 channels), skip unchanged frames, OpenRGB auto-reconnect
- CLI `--list-devices`, Docker, Windows `.exe` build via `pkg`

## Quick start

```bash
npm install
cp config.example.json config.json   # or let the app create it on first run
npm start
```

Open **http://localhost:3000** to configure fixtures and monitor live output.

Requires OpenRGB with **SDK Server** enabled.

## Architecture

```
DMX (Art-Net / sACN) → Bridge → Mapping Engine → OpenRGB SDK → RGB device
                              ↘ Web UI (REST + WebSocket)
```

Each **fixture** maps a DMX source (universe(s)) to one OpenRGB device or zone.

## Configuration

Settings live in `config.json` (editable via UI or file). Environment variables override file values.

| Key | Default | Description |
|-----|---------|-------------|
| `protocol` | `both` | `artnet`, `sacn`, or `both` |
| `fps` | `30` | Max OpenRGB update rate |
| `ui.port` | `3000` | Web UI port |
| `openrgb.host` / `port` | `127.0.0.1` / `6742` | OpenRGB SDK |
| `artnet.port` | `6454` | Art-Net listen port |
| `artnet.universe` | `null` | Filter by port address (`null` = all) |
| `artnet.sync` | `false` | Wait for ArtSync before output |
| `sacn.universes` | `[1]` | Multicast universes to join |
| `fixtures[]` | `[]` | Fixture patch list (see below) |

### Fixture schema

```json
{
  "id": "keyboard",
  "name": "Keyboard Main",
  "deviceId": 0,
  "zoneId": null,
  "source": { "type": "artnet", "universes": [1] },
  "dmxStart": 1,
  "colorOrder": "RGB",
  "mapping": "linear",
  "pixels": []
}
```

- **linear** — LED `i` uses DMX channels `dmxStart + 3i`, `+1`, `+2`
- **custom** — explicit per-LED channels:

```json
{ "ledIndex": 42, "label": "Space", "channels": [127, 128, 129] }
```

For >512 channels, use `"universes": [1, 2]` — channel 513 reads universe 2.

## CLI

```bash
npm start                          # Bridge + UI
npm run list-devices               # List OpenRGB devices/zones/LEDs
node src/index.js --config path    # Custom config file
```

## Docker

```bash
cp config.example.json config.json
docker compose up --build
```

Uses `network_mode: host` for Art-Net and sACN multicast.

## Windows executable

```bash
npm run build:win
# Output: dist/artnet-to-openrgb.exe
```

## UI panels

1. **Setup** — protocol, ports, OpenRGB connection
2. **Fixtures** — add/remove fixtures
3. **Patch Editor** — per-LED DMX channel grid, auto-patch, import/export JSON
4. **Live Monitor** — FPS, packet rate, source/universe, color preview

## Troubleshooting

| Issue | Check |
|-------|-------|
| UI loads but no LEDs change | Fixture device ID, universe, enough DMX channels |
| OpenRGB disconnected | SDK server enabled; bridge auto-reconnects |
| sACN not received | Multicast enabled; correct universe; try `sacn.iface` |
| Wrong colors | `colorOrder` setting per fixture |

## License

MIT
