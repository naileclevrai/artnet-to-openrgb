const { applyColorOrder } = require("./color-order");

function getZoneLedRange(device, zoneId) {
  if (zoneId === null || zoneId === undefined) {
    return { start: 0, count: device.leds.length };
  }
  let start = 0;
  for (let i = 0; i < zoneId; i++) {
    start += device.zones[i]?.ledsCount ?? 0;
  }
  const count = device.zones[zoneId]?.ledsCount ?? 0;
  return { start, count };
}

function buildLinearPixels(ledCount, dmxStart, ledNames, zoneStart) {
  const pixels = [];
  for (let i = 0; i < ledCount; i++) {
    const base = dmxStart + i * 3;
    pixels.push({
      ledIndex: zoneStart + i,
      label: ledNames[i] || `LED ${zoneStart + i}`,
      channels: [base, base + 1, base + 2],
    });
  }
  return pixels;
}

function compileFixture(fixture, device) {
  const { start: zoneStart, count: zoneCount } = getZoneLedRange(device, fixture.zoneId);
  const ledNames =
    fixture.zoneId != null
      ? device.leds.slice(zoneStart, zoneStart + zoneCount).map((l) => l.name)
      : device.leds.map((l) => l.name);

  let pixels;
  if (fixture.mapping === "custom" && fixture.pixels.length > 0) {
    pixels = Array.from({ length: zoneCount }, (_, i) => ({
      ledIndex: zoneStart + i,
      label: ledNames[i] || `LED ${zoneStart + i}`,
      channels: null,
    }));
    for (const p of fixture.pixels) {
      const rel = p.ledIndex - zoneStart;
      if (rel >= 0 && rel < zoneCount) {
        pixels[rel] = {
          ledIndex: p.ledIndex,
          label: p.label || ledNames[rel] || `LED ${p.ledIndex}`,
          channels: [...p.channels],
        };
      }
    }
  } else {
    pixels = buildLinearPixels(zoneCount, fixture.dmxStart, ledNames, zoneStart);
  }

  const maxChannel = pixels.reduce((max, p) => {
    if (!p.channels) return max;
    return Math.max(max, ...p.channels);
  }, 0);
  const universesNeeded = Math.max(1, Math.ceil(maxChannel / 512));

  return {
    ...fixture,
    zoneStart,
    zoneCount,
    pixels,
    universesNeeded,
    colors: Array.from({ length: zoneCount }, () => ({ red: 0, green: 0, blue: 0 })),
    lastHash: null,
  };
}

function mapFixture(compiled, store) {
  const { source, colorOrder, pixels } = compiled;
  const protocol = source.type;

  for (let i = 0; i < compiled.colors.length; i++) {
    const pixel = pixels[i];
    if (!pixel || !pixel.channels) continue;
    const [r, g, b] = pixel.channels;
    const values = [
      store.getChannel(protocol, source.universes, r),
      store.getChannel(protocol, source.universes, g),
      store.getChannel(protocol, source.universes, b),
    ];
    const color = applyColorOrder(values, colorOrder);
    compiled.colors[i].red = color.red;
    compiled.colors[i].green = color.green;
    compiled.colors[i].blue = color.blue;
  }

  return compiled.colors;
}

function colorsHash(colors) {
  const buf = Buffer.alloc(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    buf[i * 3] = colors[i].red;
    buf[i * 3 + 1] = colors[i].green;
    buf[i * 3 + 2] = colors[i].blue;
  }
  return buf.toString("base64");
}

function validateFixtureChannels(fixtures) {
  const warnings = [];
  const seen = new Map();
  for (const f of fixtures) {
    const pixels = f.pixels || [];
    for (const p of pixels) {
      if (!p.channels) continue;
      for (const ch of p.channels) {
        const key = `${f.source?.type}:${(f.source?.universes || []).join("+")}:${ch}`;
        if (seen.has(key)) {
          warnings.push(
            `Channel ${ch} used by fixture "${f.id}" and "${seen.get(key)}" (may cause conflicts)`
          );
        } else {
          seen.set(key, f.id);
        }
      }
    }
  }
  return warnings;
}

module.exports = {
  getZoneLedRange,
  buildLinearPixels,
  compileFixture,
  mapFixture,
  colorsHash,
  validateFixtureChannels,
};
