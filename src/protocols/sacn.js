const { Receiver } = require("sacn");

function startSacnReceiver({ universes, port, iface, reuseAddr, onDmx, onError }) {
  const state = new Map();

  const receiverOptions = { universes, port, reuseAddr };
  if (iface) receiverOptions.iface = iface;

  const receiver = new Receiver(receiverOptions);

  receiver.on("error", (err) => onError(err));

  receiver.on("packet", (packet) => {
    const data = packet.payloadAsBuffer;
    if (!data) return;

    const universe = packet.universe;
    const priority = packet.priority ?? 100;
    const sequence = packet.sequence ?? 0;

    const prev = state.get(universe);
    if (prev) {
      if (priority < prev.priority) return;
      if (priority === prev.priority && sequence === prev.sequence) return;
      if (priority === prev.priority) {
        const diff = (sequence - prev.sequence + 256) % 256;
        if (diff > 128) return;
      }
    }

    state.set(universe, { priority, sequence, data });
    onDmx(universe, data, "sacn", {
      sourceName: packet.sourceName,
      priority,
    });
  });

  console.log(`sACN listening on UDP port ${port} (universes: ${universes.join(", ")})`);

  return {
    close: (cb) => receiver.close(cb),
    shouldFlush: () => true,
    markFlushed: () => {},
    forceFlush: () => {},
  };
}

module.exports = { startSacnReceiver };
