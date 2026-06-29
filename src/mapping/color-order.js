const ORDERS = {
  RGB: [0, 1, 2],
  RBG: [0, 2, 1],
  GRB: [1, 0, 2],
  GBR: [1, 2, 0],
  BRG: [2, 0, 1],
  BGR: [2, 1, 0],
};

function normalizeColorOrder(order) {
  const key = String(order || "RGB").toUpperCase();
  if (!ORDERS[key]) {
    throw new Error(`Invalid colorOrder: "${order}" (expected RGB, GRB, BGR, RBG, GBR, or BRG)`);
  }
  return key;
}

function applyColorOrder(values, order) {
  const map = ORDERS[normalizeColorOrder(order)];
  return {
    red: values[map[0]] ?? 0,
    green: values[map[1]] ?? 0,
    blue: values[map[2]] ?? 0,
  };
}

module.exports = { ORDERS, normalizeColorOrder, applyColorOrder };
