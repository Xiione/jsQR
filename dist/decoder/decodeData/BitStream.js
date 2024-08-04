// tslint:disable:no-bitwise
var StreamMapping;
(function (StreamMapping) {
    StreamMapping[StreamMapping["Padding"] = -1] = "Padding";
    StreamMapping[StreamMapping["Mode"] = -2] = "Mode";
    StreamMapping[StreamMapping["CharacterCountInfo"] = -3] = "CharacterCountInfo";
    // structured append
    StreamMapping[StreamMapping["SACurrentSequence"] = -4] = "SACurrentSequence";
    StreamMapping[StreamMapping["SATotalSequence"] = -5] = "SATotalSequence";
    StreamMapping[StreamMapping["SAParity"] = -6] = "SAParity";
    StreamMapping[StreamMapping["ECIData"] = -7] = "ECIData";
})(StreamMapping || (StreamMapping = {}));
class BitStream {
    constructor(bytes, doMapping = true) {
        this.byteOffset = 0;
        this.bitOffset = 0;
        this.charsRead = 0;
        // {start bit, [length, mapping]}
        this.mappings = null;
        this.bytes = bytes;
        if (doMapping) {
            this.mappings = new Map();
        }
    }
    readBits(numBits, mode, mapping) {
        var _a;
        if (numBits < 1 || numBits > 32 || numBits > this.available()) {
            throw new Error("Cannot read " + numBits.toString() + " bits");
        }
        (_a = this.mappings) === null || _a === void 0 ? void 0 : _a.set(this.byteOffset * 8 + this.bitOffset, {
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
    available() {
        return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
    }
    getMappings() {
        return this.mappings;
    }
}

export { BitStream, StreamMapping };
//# sourceMappingURL=BitStream.js.map
