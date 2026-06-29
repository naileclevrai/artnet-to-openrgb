# Art-Net to OpenRGB Bridge

A lightweight Node.js bridge that receives **Art-Net ArtDMX** packets over UDP and forwards RGB values to any addressable RGB device controlled by [OpenRGB](https://openrgb.org/).

Use it to drive per-LED lighting from any Art-Net source (lighting consoles, QLC+, Resolume, custom software, etc.).

## How it works

```
Art-Net source  --UDP:6454-->  main.js  --OpenRGB SDK-->  OpenRGB  -->  RGB device LEDs
```

1. The script connects to the OpenRGB SDK server (default `127.0.0.1:6742`).
2. It selects a target device (first device with LEDs by default, or via `DEVICE_ID` / `DEVICE_NAME_MATCH`).
3. It listens on the standard Art-Net port **6454** for **ArtDMX** packets (`opcode 0x5000`).
4. The first `LED count × 3` DMX channels are mapped to RGB values (channel order: R, G, B per LED).
5. LED updates are sent to OpenRGB at a fixed rate (default **30 FPS**). If multiple Art-Net frames arrive between ticks, only the latest one is applied.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- [OpenRGB](https://openrgb.org/) running with **SDK Server** enabled
- A compatible RGB device detected by OpenRGB (keyboard, mouse, RAM, motherboard, strips, etc.)

## Installation

```bash
npm install
```

## Usage

1. Start OpenRGB and enable the SDK server (Settings → SDK Server).
2. Confirm your target device appears in OpenRGB.
3. Run the bridge:

```bash
npm start
```

Expected output:

```
Device selected: Corsair G512 RGB (ID 0)
LED count: 104 (312 DMX channels)
Art-Net bridge listening on UDP port 6454
Pushing LED updates to OpenRGB at 30 FPS
```

4. Send Art-Net DMX to this machine on port **6454**. Map universe channels **1–N** to your device LEDs (3 channels per LED, RGB order).

## Configuration

All settings are optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVICE_ID` | *(auto)* | OpenRGB device index (e.g. `0`, `1`). Takes priority over name matching |
| `DEVICE_NAME_MATCH` | *(none)* | Case-insensitive substring matched against device names |
| `OPENRGB_HOST` | `127.0.0.1` | OpenRGB SDK server host |
| `OPENRGB_PORT` | `6742` | OpenRGB SDK server port |
| `OPENRGB_CLIENT_NAME` | `ArtNet RGB Bridge` | Client name shown in OpenRGB |
| `ARTNET_PORT` | `6454` | UDP port for incoming Art-Net |
| `FPS` | `30` | Maximum LED update rate sent to OpenRGB |

**Device selection** (first match wins):

1. `DEVICE_ID` — exact OpenRGB device index
2. `DEVICE_NAME_MATCH` — partial name match (e.g. `Corsair`, `Wooting`)
3. If neither is set — first device that has at least one LED

When several devices are connected and no filter is set, the bridge lists them at startup.

Example (PowerShell):

```powershell
$env:DEVICE_ID = "1"
$env:FPS = "60"
npm start
```

Or by name:

```powershell
$env:DEVICE_NAME_MATCH = "RAM"
npm start
```

## DMX channel mapping

For a device with `N` LEDs, channels are laid out as:

| LED index | Red | Green | Blue |
|-----------|-----|-------|------|
| 0 | 1 | 2 | 3 |
| 1 | 4 | 5 | 6 |
| … | … | … | … |
| N−1 | 3N−2 | 3N−1 | 3N |

Channel numbering follows typical DMX convention (1-based in lighting software; the bridge reads the raw byte offset from the start of the ArtDMX payload).

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `Failed to connect to OpenRGB` | OpenRGB is running and SDK Server is enabled on the configured host/port |
| `No device matching "…" found` | Check device names in OpenRGB; set `DEVICE_ID` or `DEVICE_NAME_MATCH` |
| No LED changes | Art-Net is reaching this host (firewall), packets are ArtDMX, and the universe contains enough channels for all LEDs |
| Choppy updates | Lower Art-Net send rate or increase `FPS` (OpenRGB/hardware may limit practical throughput) |

## License

MIT
