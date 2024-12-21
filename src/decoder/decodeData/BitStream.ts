// tslint:disable:no-bitwise

import { Mode, ModeByte } from ".";

export enum StreamMapping {
  Padding = -1,
  Mode = -2,
  CharacterCountInfo = -3,
  // structured append
  SACurrentSequence = -4,
  SATotalSequence = -5,
  SAParity = -6,
  ECIData = -7,
}

export interface StreamInfo {
  mode: Mode;
  length: number;
  mapping?: StreamMapping;
  charIndex?: number;
  data: number;
}

export class BitStream {
  private bytes: Uint8ClampedArray;
  private byteOffset: number = 0;
  private bitOffset: number = 0;

  private charsRead: number = 0;
  // {start bit, [length, mapping]}
  private mappings: Map<number, StreamInfo> = null;

  constructor(bytes: Uint8ClampedArray, doMapping = true) {
    this.bytes = bytes;
    if (doMapping) {
      this.mappings = new Map<number, StreamInfo>();
    }
  }

  public readBits(
    numBits: number,
    mode: Mode,
    mapping?: StreamMapping,
  ): number {
    if (numBits < 1 || numBits > 32 || numBits > this.available()) {
      throw new Error("Cannot read " + numBits.toString() + " bits");
    }
    let remaining = numBits;

    const key = this.byteOffset * 8 + this.bitOffset;
    let result = 0;
    // First, read remainder from current byte
    if (this.bitOffset > 0) {
      const bitsLeft = 8 - this.bitOffset;
      const toRead = remaining < bitsLeft ? remaining : bitsLeft;
      const bitsToNotRead = bitsLeft - toRead;
      const mask = (0xff >> (8 - toRead)) << bitsToNotRead;
      result = (this.bytes[this.byteOffset] & mask) >> bitsToNotRead;
      remaining -= toRead;
      this.bitOffset += toRead;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
    }

    // Next read whole bytes
    if (remaining > 0) {
      while (remaining >= 8) {
        result = (result << 8) | (this.bytes[this.byteOffset] & 0xff);
        this.byteOffset++;
        remaining -= 8;
      }

      // Finally read a partial byte
      if (remaining > 0) {
        const bitsToNotRead = 8 - remaining;
        const mask = (0xff >> bitsToNotRead) << bitsToNotRead;
        result =
          (result << remaining) |
          ((this.bytes[this.byteOffset] & mask) >> bitsToNotRead);
        this.bitOffset += remaining;
      }
    }

    if (mapping === StreamMapping.Mode) {
      switch (result as ModeByte) {
        case ModeByte.Terminator:
          mode = Mode.None;
          break;
        case ModeByte.Numeric:
          mode = Mode.Numeric;
          break;
        case ModeByte.Alphanumeric:
          mode = Mode.Alphanumeric;
          break;
        case ModeByte.Byte:
          mode = Mode.Byte;
          break;
        case ModeByte.Kanji:
          mode = Mode.Kanji;
          break;
        case ModeByte.ECI:
          mode = Mode.ECI;
          break;
        case ModeByte.StructuredAppend:
          mode = Mode.StructuredAppend;
          break;
      }
    }

    this.mappings?.set(key, {
      mode,
      length: numBits,
      mapping,
      charIndex: mapping ? undefined : this.charsRead++,
      data: result,
    });

    return result;
  }

  public available(): number {
    return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
  }

  public getMappings() {
    return this.mappings;
  }
}
