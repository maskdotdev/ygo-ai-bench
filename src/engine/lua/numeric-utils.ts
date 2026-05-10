export function normalizeLuaUnsignedInteger(value: number): number {
  const integer = Math.trunc(value);
  return integer < 0 ? integer >>> 0 : integer;
}

export function toLuaSigned32(value: number): number | undefined {
  if (!Number.isInteger(value)) return undefined;
  if (value >= -0x80000000 && value <= 0x7fffffff) return value;
  if (value > 0x7fffffff && value <= 0xffffffff) return value - 0x100000000;
  return undefined;
}

export function normalizeLuaDamageModifier(value: number): number {
  const integer = Math.trunc(value);
  if (integer === -0x80000000) return 0x80000000;
  if (integer === -0x7fffffff) return 0x80000001;
  return integer;
}
