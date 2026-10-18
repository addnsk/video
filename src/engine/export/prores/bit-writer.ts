export class BitWriter {
  private bytes: Uint8Array;
  private length = 0;
  private accumulator = 0;
  private pending = 0;

  constructor(capacity = 1 << 16) {
    this.bytes = new Uint8Array(capacity);
  }

  reset(): void {
    this.length = 0;
    this.accumulator = 0;
    this.pending = 0;
  }

  put(bits: number, value: number): void {
    for (let remaining = bits; remaining > 0; ) {
      const take = Math.min(remaining, 24 - this.pending);
      remaining -= take;
      this.accumulator = (this.accumulator << take) | ((value >>> remaining) & ((1 << take) - 1));
      this.pending += take;
      while (this.pending >= 8) {
        this.pending -= 8;
        this.push((this.accumulator >>> this.pending) & 0xff);
      }
      this.accumulator &= (1 << this.pending) - 1;
    }
  }

  zeros(count: number): void {
    for (let left = count; left > 0; left -= 16) this.put(Math.min(16, left), 0);
  }

  align(): void {
    if (this.pending) this.put(8 - this.pending, 0);
  }

  get bitLength(): number {
    return this.length * 8 + this.pending;
  }

  get byteLength(): number {
    return this.length;
  }

  copyTo(target: Uint8Array, offset: number): void {
    target.set(this.bytes.subarray(0, this.length), offset);
  }

  private push(byte: number) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }
}

export function writeCodeword(writer: BitWriter, codebook: number, value: number): void {
  const switchBits = (codebook & 3) + 1;
  const riceOrder = codebook >> 5;
  const expOrder = (codebook >> 2) & 7;
  const switchValue = switchBits << riceOrder;
  if (value >= switchValue) {
    const shifted = value - (switchValue - (1 << expOrder));
    const exponent = 31 - Math.clz32(shifted);
    writer.zeros(exponent - expOrder + switchBits);
    writer.put(exponent + 1, shifted);
    return;
  }
  const exponent = value >> riceOrder;
  if (exponent) writer.zeros(exponent);
  writer.put(1, 1);
  if (riceOrder) writer.put(riceOrder, value & ((1 << riceOrder) - 1));
}
