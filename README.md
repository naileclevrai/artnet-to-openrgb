# Art-Net / sACN to OpenRGB Bridge

A lightweight Node.js bridge that receives **Art-Net** or **sACN (E1.31)** DMX packets over UDP and forwards RGB values to any addressable RGB device controlled by [OpenRGB](https://openrgb.org/).

Use it to drive per-LED lighting from lighting consoles (ETC, Onyx), QLC+, Resolume, or any Art-Net / sACN source.

> **Branch `feature/sacn`:** adds sACN support alongside Art-Net. Use `PROTOCOL` to choose the input protocol.

## How it works

```
DMX source (Art-Net or sACN)  --UDP-->  main.js  --OpenRGB SDK-->  OpenRGB  -->  RGB device LEDs
```

1. The script connects to the OpenRGB SDK server (default `127.0.0.1:6742`).
2. It selects a target device (first device with LEDs by default, or via `DEVICE_ID` / `DEVICE_NAME_MATCH`).
3. It listens for DMX data:
   - **Art-Net:** UDP port **6454**, ArtDMX packets (`opcode 0x5000`)
   - **sACN:** UDP port **5568**, multicast universes (default universe **1**)
4. The first `LED count × 3` DMX channels are mapped to RGB values (channel order: R, G, B per LED).
5. LED updates are sent to OpenRGB at a fixed rate (default **30 FPS**). If multiple frames arrive between ticks, only the latest one is applied.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- [OpenRGB](https://openrgb.org/) running with **SDK Server** enabled
- A compatible RGB device detected by OpenRGB (keyboard, mouse, RAM, motherboard, strips, etc.)
- For sACN: multicast enabled on your network (standard for E1.31)

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

By default, both Art-Net and sACN are enabled (`PROTOCOL=both`).

Expected output:

```
Device selected: Corsair G512 RGB (ID 0)
LED count: 104 (312 DMX channels)
Protocol mode: both
Art-Net listening on UDP port 6454
sACN listening on UDP port 5568 (universes: 1)
Pushing LED updates to OpenRGB at 30 FPS
```

4. Send DMX to this machine. Map universe channels **1–N** to your device LEDs (3 channels per LED, RGB order).

### Protocol examples

Art-Net only:

```powershell
$env:PROTOCOL = "artnet"
npm start
```

sACN only (universe 1):

```powershell
$env:PROTOCOL = "sacn"
$env:SACN_UNIVERSES = "1"
npm start
```

sACN universe 2 on a specific network interface:

```powershell
$env:PROTOCOL = "sacn"
$env:SACN_UNIVERSES = "2"
$env:SACN_IFACE = "192.168.1.50"
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PROTOCOL` | `both` | Input protocol: `artnet`, `sacn`, or `both` |
| `DEVICE_ID` | *(auto)* | OpenRGB device index (e.g. `0`, `1`). Takes priority over name matching |
| `DEVICE_NAME_MATCH` | *(none)* | Case-insensitive substring matched against device names |
| `OPENRGB_HOST` | `127.0.0.1` | OpenRGB SDK server host |
| `OPENRGB_PORT` | `6742` | OpenRGB SDK server port |
| `OPENRGB_CLIENT_NAME` | `ArtNet/sACN RGB Bridge` | Client name shown in OpenRGB |
| `ARTNET_PORT` | `6454` | UDP port for incoming Art-Net |
| `SACN_UNIVERSES` | `1` | Comma-separated sACN universes to join (e.g. `1,2,3`) |
| `SACN_PORT` | `5568` | UDP port for incoming sACN |
| `SACN_IFACE` | *(auto)* | Local IPv4 address of the network interface for multicast |
| `SACN_REUSE_ADDR` | `true` | Allow multiple apps to listen on the same sACN universe |
| `FPS` | `30` | Maximum LED update rate sent to OpenRGB |

**Device selection** (first match wins):

1. `DEVICE_ID` — exact OpenRGB device index
2. `DEVICE_NAME_MATCH` — partial name match (e.g. `Corsair`, `Wooting`)
3. If neither is set — first device that has at least one LED

When several devices are connected and no filter is set, the bridge lists them at startup.

## DMX channel mapping

For a device with `N` LEDs, channels are laid out as:

| LED index | Red | Green | Blue |
|-----------|-----|-------|------|
| 0 | 1 | 2 | 3 |
| 1 | 4 | 5 | 6 |
| … | … | … | … |
| N−1 | 3N−2 | 3N−1 | 3N |

Channel numbering follows typical DMX convention (1-based in lighting software; the bridge reads raw byte offsets from the start of the DMX payload).

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `Failed to connect to OpenRGB` | OpenRGB is running and SDK Server is enabled on the configured host/port |
| `No device matching "…" found` | Check device names in OpenRGB; set `DEVICE_ID` or `DEVICE_NAME_MATCH` |
| No LED changes (Art-Net) | Firewall allows UDP 6454; packets are ArtDMX with enough channels |
| No LED changes (sACN) | Multicast enabled; correct `SACN_UNIVERSES`; try `SACN_IFACE` if multiple NICs |
| Choppy updates | Lower source send rate or increase `FPS` (OpenRGB/hardware may limit throughput) |

## License

MIT
