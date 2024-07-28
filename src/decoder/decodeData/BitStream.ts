// tslint:disable:no-bitwise

import { Mode } from ".";

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
  length: number;
  mapping?: StreamMapping;
  charIndex?: number;
  mode: Mode;
}

export class BitStream {
  private bytes: Uint8ClampedArray;
  private byteOffset: number = 0;
  private bitOffset: number = 0;

  private charsRead: number = 0;
  // {start bit, [length, mapping]}
  private mappings: Map<number, StreamInfo> = new Map();

  constructor(bytes: Uint8ClampedArray) {
    this.bytes = bytes;
  }

  public readBits(
    numBits: number,
    mode: Mode,
    mapping?: StreamMapping,
  ): number {
    if (numBits < 1 || numBits > 32 || numBits > this.available()) {
      throw new Error("Cannot read " + numBits.toString() + " bits");
    }

    this.mappings.set(this.byteOffset * 8 + this.bitOffset, {
      length: numBits,
      mapping,
      charIndex: mapping ? undefined : this.charsRead++,
      mode,
    });

    let result = 0;
    // First, read remainder from current byte
    if (this.bitOffset > 0) {
      const bitsLeft = 8 - this.bitOffset;
      const toRead = numBits < bitsLeft ? numBits : bitsLeft;
      const bitsToNotRead = bitsLeft - toRead;
      const mask = (0xff >> (8 - toRead)) << bitsToNotRead;
      result = (this.bytes[this.byteOffset] & mask) >> bitsToNotRead;
      numBits -= toRead;
      this.bitOffset += toRead;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
    }

    // Next read whole bytes
    if (numBits > 0) {
      while (numBits >= 8) {
        result = (result << 8) | (this.bytes[this.byteOffset] & 0xff);
        this.byteOffset++;
        numBits -= 8;
      }

      // Finally read a partial byte
      if (numBits > 0) {
        const bitsToNotRead = 8 - numBits;
        const mask = (0xff >> bitsToNotRead) << bitsToNotRead;
        result =
          (result << numBits) |
          ((this.bytes[this.byteOffset] & mask) >> bitsToNotRead);
        this.bitOffset += numBits;
      }
    }
    return result;
  }

  public available(): number {
    return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
  }

  public getMappings() {
    return this.mappings;
  }
}
