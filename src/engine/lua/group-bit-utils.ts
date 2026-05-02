export function binaryFlags(mask: number): number[] {
  const values: number[] = [];
  let bit = 1;
  while (bit <= mask) {
    if ((mask & bit) !== 0) values.push(bit);
    bit <<= 1;
  }
  return values;
}

export function bitCount(value: number): number {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}
