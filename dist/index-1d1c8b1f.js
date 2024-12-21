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
            switch (result) {
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
        (_a = this.mappings) === null || _a === void 0 ? void 0 : _a.set(key, {
            mode,
            length: numBits,
            mapping,
            charIndex: mapping ? undefined : this.charsRead++,
            data: result,
        });
        return result;
    }
    available() {
        return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
    }
    getMappings() {
        return this.mappings;
    }
}

// tslint:disable:no-bitwise
var Mode;
(function (Mode) {
    Mode["Numeric"] = "numeric";
    Mode["Alphanumeric"] = "alphanumeric";
    Mode["Byte"] = "byte";
    Mode["Kanji"] = "kanji";
    Mode["ECI"] = "eci";
    Mode["StructuredAppend"] = "structuredappend";
    Mode["None"] = "none";
})(Mode || (Mode = {}));
var ModeByte;
(function (ModeByte) {
    ModeByte[ModeByte["Terminator"] = 0] = "Terminator";
    ModeByte[ModeByte["Numeric"] = 1] = "Numeric";
    ModeByte[ModeByte["Alphanumeric"] = 2] = "Alphanumeric";
    ModeByte[ModeByte["Byte"] = 4] = "Byte";
    ModeByte[ModeByte["Kanji"] = 8] = "Kanji";
    ModeByte[ModeByte["ECI"] = 7] = "ECI";
    ModeByte[ModeByte["StructuredAppend"] = 3] = "StructuredAppend";
    // FNC1FirstPosition = 0x5,
    // FNC1SecondPosition = 0x9,
})(ModeByte || (ModeByte = {}));
function decodeNumeric(stream, size, textOnly = false) {
    let bytes;
    if (!textOnly)
        bytes = [];
    let text = "";
    const characterCountSize = [10, 12, 14][size];
    let length = stream.readBits(characterCountSize, Mode.Numeric, StreamMapping.CharacterCountInfo);
    // Read digits in groups of 3
    while (length >= 3) {
        const num = stream.readBits(10, Mode.Numeric);
        if (num >= 1000) {
            throw new Error("Invalid numeric value above 999");
        }
        const a = Math.floor(num / 100);
        const b = Math.floor(num / 10) % 10;
        const c = num % 10;
        if (!textOnly)
            bytes.push(48 + a, 48 + b, 48 + c);
        text += a.toString() + b.toString() + c.toString();
        length -= 3;
    }
    // If the number of digits aren't a multiple of 3, the remaining digits are special cased.
    if (length === 2) {
        const num = stream.readBits(7, Mode.Numeric);
        if (num >= 100) {
            throw new Error("Invalid numeric value above 99");
        }
        const a = Math.floor(num / 10);
        const b = num % 10;
        if (!textOnly)
            bytes.push(48 + a, 48 + b);
        text += a.toString() + b.toString();
    }
    else if (length === 1) {
        const num = stream.readBits(4, Mode.Numeric);
        if (num >= 10) {
            throw new Error("Invalid numeric value above 9");
        }
        if (!textOnly)
            bytes.push(48 + num);
        text += num.toString();
    }
    if (!textOnly)
        return { bytes, text };
    else
        return text;
}
const AlphanumericCharacterCodes = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    " ",
    "$",
    "%",
    "*",
    "+",
    "-",
    ".",
    "/",
    ":",
];
function decodeAlphanumeric(stream, size, textOnly = false) {
    let bytes;
    if (!textOnly)
        bytes = [];
    let text = "";
    const characterCountSize = [9, 11, 13][size];
    let length = stream.readBits(characterCountSize, Mode.Alphanumeric, StreamMapping.CharacterCountInfo);
    while (length >= 2) {
        const v = stream.readBits(11, Mode.Alphanumeric);
        const a = Math.floor(v / 45);
        const b = v % 45;
        if (!textOnly)
            bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0), AlphanumericCharacterCodes[b].charCodeAt(0));
        text += AlphanumericCharacterCodes[a] + AlphanumericCharacterCodes[b];
        length -= 2;
    }
    if (length === 1) {
        const a = stream.readBits(6, Mode.Alphanumeric);
        if (!textOnly)
            bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0));
        text += AlphanumericCharacterCodes[a];
    }
    if (!textOnly)
        return { bytes, text };
    else
        return text;
}
function decodeByte(stream, size, textOnly = false) {
    const bytes = [];
    let text = "";
    const characterCountSize = [8, 16, 16][size];
    const length = stream.readBits(characterCountSize, Mode.Byte, StreamMapping.CharacterCountInfo);
    for (let i = 0; i < length; i++) {
        const b = stream.readBits(8, Mode.Byte);
        bytes.push(b);
    }
    const decoder = new TextDecoder("utf-8");
    // for (const byte of bytes) {
    //   try {
    //     // text += decodeURIComponent(`%${("0" + byte.toString(16)).slice(-2)}`);
    //   } catch {
    //     console.error("Failed to decode ASCII character:", byte.toString(16));
    //   }
    // }
    text += decoder.decode(new Uint8Array(bytes));
    if (!textOnly)
        return { bytes, text };
    else
        return text;
}
function decodeKanji(stream, size, textOnly = false) {
    const bytes = [];
    const characterCountSize = [8, 10, 12][size];
    const length = stream.readBits(characterCountSize, Mode.Kanji, StreamMapping.CharacterCountInfo);
    for (let i = 0; i < length; i++) {
        const k = stream.readBits(13, Mode.Kanji);
        let c = (Math.floor(k / 0xc0) << 8) | k % 0xc0;
        if (c < 0x1f00) {
            c += 0x8140;
        }
        else {
            c += 0xc140;
        }
        bytes.push(c >> 8, c & 0xff);
    }
    const text = new TextDecoder("shift-jis").decode(Uint8Array.from(bytes));
    if (!textOnly)
        return { bytes, text };
    else
        return text;
}
function decode(data, version) {
    const stream = new BitStream(data);
    // There are 3 'sizes' based on the version. 1-9 is small (0), 10-26 is medium (1) and 27-40 is large (2).
    const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    const result = {
        text: "",
        bytes: [],
        chunks: [],
        version,
        mirrored: false,
        ecLevel: -1,
        dataMask: -1,
        streamMappings: null,
    };
    while (stream.available() >= 4) {
        const mode = stream.readBits(4, Mode.None, StreamMapping.Mode);
        if (mode === ModeByte.Terminator) {
            result.streamMappings = stream.getMappings();
            return result;
        }
        else if (mode === ModeByte.ECI) {
            if (stream.readBits(1, Mode.ECI, StreamMapping.ECIData) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(7, Mode.ECI),
                });
            }
            else if (stream.readBits(1, Mode.ECI, StreamMapping.ECIData) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(14, Mode.ECI),
                });
            }
            else if (stream.readBits(1, Mode.ECI, StreamMapping.ECIData) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(21, Mode.ECI),
                });
            }
            else {
                // ECI data seems corrupted
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: -1,
                });
            }
        }
        else if (mode === ModeByte.Numeric) {
            const numericResult = decodeNumeric(stream, size);
            result.text += numericResult.text;
            result.bytes.push(...numericResult.bytes);
            result.chunks.push({
                type: Mode.Numeric,
                text: numericResult.text,
            });
        }
        else if (mode === ModeByte.Alphanumeric) {
            const alphanumericResult = decodeAlphanumeric(stream, size);
            result.text += alphanumericResult.text;
            result.bytes.push(...alphanumericResult.bytes);
            result.chunks.push({
                type: Mode.Alphanumeric,
                text: alphanumericResult.text,
            });
        }
        else if (mode === ModeByte.Byte) {
            const byteResult = decodeByte(stream, size);
            result.text += byteResult.text;
            result.bytes.push(...byteResult.bytes);
            result.chunks.push({
                type: Mode.Byte,
                bytes: byteResult.bytes,
                text: byteResult.text,
            });
        }
        else if (mode === ModeByte.Kanji) {
            const kanjiResult = decodeKanji(stream, size);
            result.text += kanjiResult.text;
            result.bytes.push(...kanjiResult.bytes);
            result.chunks.push({
                type: Mode.Kanji,
                bytes: kanjiResult.bytes,
                text: kanjiResult.text,
            });
        }
        else if (mode === ModeByte.StructuredAppend) {
            result.chunks.push({
                type: Mode.StructuredAppend,
                currentSequence: stream.readBits(4, Mode.StructuredAppend, StreamMapping.SACurrentSequence),
                totalSequence: stream.readBits(4, Mode.StructuredAppend, StreamMapping.SATotalSequence),
                parity: stream.readBits(8, Mode.StructuredAppend, StreamMapping.SAParity),
            });
        }
    }
    // If there is no data left, or the remaining bits are all 0, then that counts as a termination marker
    if (stream.available() === 0 ||
        stream.readBits(stream.available(), Mode.None, StreamMapping.Padding) === 0) {
        result.streamMappings = stream.getMappings();
        return result;
    }
}

export { AlphanumericCharacterCodes as A, BitStream as B, Mode as M, StreamMapping as S, ModeByte as a, decodeNumeric as b, decodeAlphanumeric as c, decode as d, decodeByte as e, decodeKanji as f };
//# sourceMappingURL=index-1d1c8b1f.js.map
