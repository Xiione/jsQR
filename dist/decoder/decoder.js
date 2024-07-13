import { BitMatrix } from '../BitMatrix.js';
import { decodeWASM } from './reedsolomon/index.js';
import { VERSIONS } from './version.js';

// tslint:disable:no-bitwise
class BitStream {
    constructor(bytes) {
        this.byteOffset = 0;
        this.bitOffset = 0;
        this.bytes = bytes;
    }
    readBits(numBits) {
        if (numBits < 1 || numBits > 32 || numBits > this.available()) {
            throw new Error("Cannot read " + numBits.toString() + " bits");
        }
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
function decodeNumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [10, 12, 14][size];
    let length = stream.readBits(characterCountSize);
    // Read digits in groups of 3
    while (length >= 3) {
        const num = stream.readBits(10);
        if (num >= 1000) {
            throw new Error("Invalid numeric value above 999");
        }
        const a = Math.floor(num / 100);
        const b = Math.floor(num / 10) % 10;
        const c = num % 10;
        bytes.push(48 + a, 48 + b, 48 + c);
        text += a.toString() + b.toString() + c.toString();
        length -= 3;
    }
    // If the number of digits aren't a multiple of 3, the remaining digits are special cased.
    if (length === 2) {
        const num = stream.readBits(7);
        if (num >= 100) {
            throw new Error("Invalid numeric value above 99");
        }
        const a = Math.floor(num / 10);
        const b = num % 10;
        bytes.push(48 + a, 48 + b);
        text += a.toString() + b.toString();
    }
    else if (length === 1) {
        const num = stream.readBits(4);
        if (num >= 10) {
            throw new Error("Invalid numeric value above 9");
        }
        bytes.push(48 + num);
        text += num.toString();
    }
    return { bytes, text };
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
function decodeAlphanumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [9, 11, 13][size];
    let length = stream.readBits(characterCountSize);
    while (length >= 2) {
        const v = stream.readBits(11);
        const a = Math.floor(v / 45);
        const b = v % 45;
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0), AlphanumericCharacterCodes[b].charCodeAt(0));
        text += AlphanumericCharacterCodes[a] + AlphanumericCharacterCodes[b];
        length -= 2;
    }
    if (length === 1) {
        const a = stream.readBits(6);
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0));
        text += AlphanumericCharacterCodes[a];
    }
    return { bytes, text };
}
function decodeByte(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [8, 16, 16][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const b = stream.readBits(8);
        bytes.push(b);
    }
    try {
        text += decodeURIComponent(bytes.map((b) => `%${("0" + b.toString(16)).substr(-2)}`).join(""));
    }
    catch (_a) {
        // failed to decode
    }
    return { bytes, text };
}
function decodeKanji(stream, size) {
    const bytes = [];
    const characterCountSize = [8, 10, 12][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const k = stream.readBits(13);
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
    return { bytes, text };
}
function decode$1(data, version) {
    const stream = new BitStream(data);
    // There are 3 'sizes' based on the version. 1-9 is small (0), 10-26 is medium (1) and 27-40 is large (2).
    const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    const result = {
        text: "",
        bytes: [],
        chunks: [],
        version,
        mirrored: false,
    };
    while (stream.available() >= 4) {
        const mode = stream.readBits(4);
        if (mode === ModeByte.Terminator) {
            return result;
        }
        else if (mode === ModeByte.ECI) {
            if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(7),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(14),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(21),
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
                currentSequence: stream.readBits(4),
                totalSequence: stream.readBits(4),
                parity: stream.readBits(8),
            });
        }
    }
    // If there is no data left, or the remaining bits are all 0, then that counts as a termination marker
    if (stream.available() === 0 || stream.readBits(stream.available()) === 0) {
        return result;
    }
}

// tslint:disable:no-bitwise
function numBitsDiffering(x, y) {
    let z = x ^ y;
    let bitCount = 0;
    while (z) {
        bitCount++;
        z &= z - 1;
    }
    return bitCount;
}
function pushBit(bit, byte) {
    return (byte << 1) | bit;
}
// tslint:enable:no-bitwise
const FORMAT_INFO_TABLE = [
    { bits: 0x5412, formatInfo: { errorCorrectionLevel: 1, dataMask: 0 } },
    { bits: 0x5125, formatInfo: { errorCorrectionLevel: 1, dataMask: 1 } },
    { bits: 0x5e7c, formatInfo: { errorCorrectionLevel: 1, dataMask: 2 } },
    { bits: 0x5b4b, formatInfo: { errorCorrectionLevel: 1, dataMask: 3 } },
    { bits: 0x45f9, formatInfo: { errorCorrectionLevel: 1, dataMask: 4 } },
    { bits: 0x40ce, formatInfo: { errorCorrectionLevel: 1, dataMask: 5 } },
    { bits: 0x4f97, formatInfo: { errorCorrectionLevel: 1, dataMask: 6 } },
    { bits: 0x4aa0, formatInfo: { errorCorrectionLevel: 1, dataMask: 7 } },
    { bits: 0x77c4, formatInfo: { errorCorrectionLevel: 0, dataMask: 0 } },
    { bits: 0x72f3, formatInfo: { errorCorrectionLevel: 0, dataMask: 1 } },
    { bits: 0x7daa, formatInfo: { errorCorrectionLevel: 0, dataMask: 2 } },
    { bits: 0x789d, formatInfo: { errorCorrectionLevel: 0, dataMask: 3 } },
    { bits: 0x662f, formatInfo: { errorCorrectionLevel: 0, dataMask: 4 } },
    { bits: 0x6318, formatInfo: { errorCorrectionLevel: 0, dataMask: 5 } },
    { bits: 0x6c41, formatInfo: { errorCorrectionLevel: 0, dataMask: 6 } },
    { bits: 0x6976, formatInfo: { errorCorrectionLevel: 0, dataMask: 7 } },
    { bits: 0x1689, formatInfo: { errorCorrectionLevel: 3, dataMask: 0 } },
    { bits: 0x13be, formatInfo: { errorCorrectionLevel: 3, dataMask: 1 } },
    { bits: 0x1ce7, formatInfo: { errorCorrectionLevel: 3, dataMask: 2 } },
    { bits: 0x19d0, formatInfo: { errorCorrectionLevel: 3, dataMask: 3 } },
    { bits: 0x0762, formatInfo: { errorCorrectionLevel: 3, dataMask: 4 } },
    { bits: 0x0255, formatInfo: { errorCorrectionLevel: 3, dataMask: 5 } },
    { bits: 0x0d0c, formatInfo: { errorCorrectionLevel: 3, dataMask: 6 } },
    { bits: 0x083b, formatInfo: { errorCorrectionLevel: 3, dataMask: 7 } },
    { bits: 0x355f, formatInfo: { errorCorrectionLevel: 2, dataMask: 0 } },
    { bits: 0x3068, formatInfo: { errorCorrectionLevel: 2, dataMask: 1 } },
    { bits: 0x3f31, formatInfo: { errorCorrectionLevel: 2, dataMask: 2 } },
    { bits: 0x3a06, formatInfo: { errorCorrectionLevel: 2, dataMask: 3 } },
    { bits: 0x24b4, formatInfo: { errorCorrectionLevel: 2, dataMask: 4 } },
    { bits: 0x2183, formatInfo: { errorCorrectionLevel: 2, dataMask: 5 } },
    { bits: 0x2eda, formatInfo: { errorCorrectionLevel: 2, dataMask: 6 } },
    { bits: 0x2bed, formatInfo: { errorCorrectionLevel: 2, dataMask: 7 } },
];
const DATA_MASKS = [
    (p) => (p.y + p.x) % 2 === 0,
    (p) => p.y % 2 === 0,
    (p) => p.x % 3 === 0,
    (p) => (p.y + p.x) % 3 === 0,
    (p) => (Math.floor(p.y / 2) + Math.floor(p.x / 3)) % 2 === 0,
    (p) => ((p.x * p.y) % 2) + ((p.x * p.y) % 3) === 0,
    (p) => (((p.y * p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
    (p) => (((p.y + p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
];
function buildFunctionPatternMask(version) {
    const dimension = 17 + 4 * version.versionNumber;
    const matrix = BitMatrix.createEmpty(dimension, dimension);
    matrix.setRegion(0, 0, 9, 9, true); // Top left finder pattern + separator + format
    matrix.setRegion(dimension - 8, 0, 8, 9, true); // Top right finder pattern + separator + format
    matrix.setRegion(0, dimension - 8, 9, 8, true); // Bottom left finder pattern + separator + format
    // Alignment patterns
    for (const x of version.alignmentPatternCenters) {
        for (const y of version.alignmentPatternCenters) {
            if (!((x === 6 && y === 6) ||
                (x === 6 && y === dimension - 7) ||
                (x === dimension - 7 && y === 6))) {
                matrix.setRegion(x - 2, y - 2, 5, 5, true);
            }
        }
    }
    matrix.setRegion(6, 9, 1, dimension - 17, true); // Vertical timing pattern
    matrix.setRegion(9, 6, dimension - 17, 1, true); // Horizontal timing pattern
    if (version.versionNumber > 6) {
        matrix.setRegion(dimension - 11, 0, 3, 6, true); // Version info, top right
        matrix.setRegion(0, dimension - 11, 6, 3, true); // Version info, bottom left
    }
    return matrix;
}
function readCodewords(matrix, version, formatInfo) {
    const dataMask = DATA_MASKS[formatInfo.dataMask];
    const dimension = matrix.height;
    const functionPatternMask = buildFunctionPatternMask(version);
    const codewords = [];
    let currentByte = 0;
    let bitsRead = 0;
    // Read columns in pairs, from right to left
    let readingUp = true;
    for (let columnIndex = dimension - 1; columnIndex > 0; columnIndex -= 2) {
        if (columnIndex === 6) {
            // Skip whole column with vertical alignment pattern;
            columnIndex--;
        }
        for (let i = 0; i < dimension; i++) {
            const y = readingUp ? dimension - 1 - i : i;
            for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
                const x = columnIndex - columnOffset;
                if (!functionPatternMask.get(x, y)) {
                    bitsRead++;
                    let bit = matrix.get(x, y);
                    if (dataMask({ y, x })) {
                        bit = !bit;
                    }
                    currentByte = pushBit(bit, currentByte);
                    if (bitsRead === 8) {
                        // Whole bytes
                        codewords.push(currentByte);
                        bitsRead = 0;
                        currentByte = 0;
                    }
                }
            }
        }
        readingUp = !readingUp;
    }
    return codewords;
}
function readVersion(matrix) {
    const dimension = matrix.height;
    const provisionalVersion = Math.floor((dimension - 17) / 4);
    if (provisionalVersion <= 6) {
        // 6 and under dont have version info in the QR code
        return VERSIONS[provisionalVersion - 1];
    }
    let topRightVersionBits = 0;
    for (let y = 5; y >= 0; y--) {
        for (let x = dimension - 9; x >= dimension - 11; x--) {
            topRightVersionBits = pushBit(matrix.get(x, y), topRightVersionBits);
        }
    }
    let bottomLeftVersionBits = 0;
    for (let x = 5; x >= 0; x--) {
        for (let y = dimension - 9; y >= dimension - 11; y--) {
            bottomLeftVersionBits = pushBit(matrix.get(x, y), bottomLeftVersionBits);
        }
    }
    let bestDifference = Infinity;
    let bestVersion;
    for (const version of VERSIONS) {
        if (version.infoBits === topRightVersionBits ||
            version.infoBits === bottomLeftVersionBits) {
            return version;
        }
        let difference = numBitsDiffering(topRightVersionBits, version.infoBits);
        if (difference < bestDifference) {
            bestVersion = version;
            bestDifference = difference;
        }
        difference = numBitsDiffering(bottomLeftVersionBits, version.infoBits);
        if (difference < bestDifference) {
            bestVersion = version;
            bestDifference = difference;
        }
    }
    // We can tolerate up to 3 bits of error since no two version info codewords will
    // differ in less than 8 bits.
    if (bestDifference <= 3) {
        return bestVersion;
    }
}
function readFormatInformation(matrix) {
    let topLeftFormatInfoBits = 0;
    for (let x = 0; x <= 8; x++) {
        if (x !== 6) {
            // Skip timing pattern bit
            topLeftFormatInfoBits = pushBit(matrix.get(x, 8), topLeftFormatInfoBits);
        }
    }
    for (let y = 7; y >= 0; y--) {
        if (y !== 6) {
            // Skip timing pattern bit
            topLeftFormatInfoBits = pushBit(matrix.get(8, y), topLeftFormatInfoBits);
        }
    }
    const dimension = matrix.height;
    let topRightBottomLeftFormatInfoBits = 0;
    for (let y = dimension - 1; y >= dimension - 7; y--) {
        // bottom left
        topRightBottomLeftFormatInfoBits = pushBit(matrix.get(8, y), topRightBottomLeftFormatInfoBits);
    }
    for (let x = dimension - 8; x < dimension; x++) {
        // top right
        topRightBottomLeftFormatInfoBits = pushBit(matrix.get(x, 8), topRightBottomLeftFormatInfoBits);
    }
    let bestDifference = Infinity;
    let bestFormatInfo = null;
    for (const format of FORMAT_INFO_TABLE) {
        if (format.bits === topLeftFormatInfoBits ||
            format.bits === topRightBottomLeftFormatInfoBits) {
            return format;
        }
        let difference = numBitsDiffering(topLeftFormatInfoBits, format.bits);
        if (difference < bestDifference) {
            bestFormatInfo = format;
        }
        if (topLeftFormatInfoBits !== topRightBottomLeftFormatInfoBits) {
            // also try the other option
            difference = numBitsDiffering(topRightBottomLeftFormatInfoBits, format.bits);
            if (difference < bestDifference) {
                bestFormatInfo = format;
                bestDifference = difference;
            }
        }
    }
    // Hamming distance of the 32 masked codes is 7, by construction, so <= 3 bits differing means we found a match
    if (bestDifference <= 3) {
        return bestFormatInfo;
    }
    return null;
}
function getDataBlocks(codewords, version, ecLevel) {
    const ecInfo = version.errorCorrectionLevels[ecLevel];
    const dataBlocks = [];
    let totalCodewords = 0;
    ecInfo.ecBlocks.forEach((block) => {
        for (let i = 0; i < block.numBlocks; i++) {
            dataBlocks.push({
                numDataCodewords: block.dataCodewordsPerBlock,
                codewords: [],
                codewordsCorrected: [],
            });
            totalCodewords +=
                block.dataCodewordsPerBlock + ecInfo.ecCodewordsPerBlock;
        }
    });
    // In some cases the QR code will be malformed enough that we pull off more or less than we should.
    // If we pull off less there's nothing we can do.
    // If we pull off more we can safely truncate
    if (codewords.length < totalCodewords) {
        return null;
    }
    codewords = codewords.slice(0, totalCodewords);
    const shortBlockSize = ecInfo.ecBlocks[0].dataCodewordsPerBlock;
    // Pull codewords to fill the blocks up to the minimum size
    for (let i = 0; i < shortBlockSize; i++) {
        for (const dataBlock of dataBlocks) {
            dataBlock.codewords.push(codewords.shift());
        }
    }
    // If there are any large blocks, pull codewords to fill the last element of those
    if (ecInfo.ecBlocks.length > 1) {
        const smallBlockCount = ecInfo.ecBlocks[0].numBlocks;
        const largeBlockCount = ecInfo.ecBlocks[1].numBlocks;
        for (let i = 0; i < largeBlockCount; i++) {
            dataBlocks[smallBlockCount + i].codewords.push(codewords.shift());
        }
    }
    // Add the rest of the codewords to the blocks. These are the error correction codewords.
    while (codewords.length > 0) {
        for (const dataBlock of dataBlocks) {
            dataBlock.codewords.push(codewords.shift());
        }
    }
    return dataBlocks;
}
function decodeMatrix(matrix) {
    const version = readVersion(matrix);
    if (!version) {
        return null;
    }
    const format = readFormatInformation(matrix);
    if (!format) {
        return null;
    }
    const codewords = readCodewords(matrix, version, format.formatInfo);
    const dataBlocks = getDataBlocks(codewords, version, format.formatInfo.errorCorrectionLevel);
    if (!dataBlocks) {
        return null;
    }
    // Count total number of data bytes
    const totalBytes = dataBlocks.reduce((a, b) => a + b.numDataCodewords, 0);
    const resultBytes = new Uint8ClampedArray(totalBytes);
    let resultIndex = 0;
    for (const dataBlock of dataBlocks) {
        const decodeRes = decodeWASM(dataBlock.codewords, dataBlock.codewords.length - dataBlock.numDataCodewords);
        const errors = decodeRes["errors"];
        if (errors >= 0)
            console.log(errors);
        // const bytesCorrected = rsDecodeExpected(dataBlock.codewords, dataBlock.codewords.length - dataBlock.numDataCodewords);
        const bytesCorrected = decodeRes["bytesCorrected"];
        if (!bytesCorrected) {
            return null;
        }
        for (let i = 0; i < dataBlock.numDataCodewords; i++) {
            resultBytes[resultIndex++] = bytesCorrected["get"](i);
            // resultBytes[resultIndex++] = bytesCorrected[i];
        }
        for (let i = 0; i < dataBlock.codewords.length; i++) {
            dataBlock.codewordsCorrected.push(bytesCorrected["get"](i));
        }
    }
    try {
        const res = decode$1(resultBytes, version.versionNumber);
        // patch fix for random erroneous successful scans, an empty result is
        // useless anyways
        if (res.text) {
            correctMatrix(matrix, version, format, dataBlocks);
            return res;
        }
        else {
            return null;
        }
    }
    catch (_a) {
        return null;
    }
}
function decode(matrix) {
    if (matrix == null) {
        return null;
    }
    const result = decodeMatrix(matrix);
    if (result) {
        return result;
    }
    // Decoding didn't work, try mirroring the QR across the topLeft -> bottomRight line.
    matrix.mirror();
    const res = decodeMatrix(matrix);
    return res ? Object.assign(Object.assign({}, res), { mirrored: true }) : null;
}
function correctMatrix(matrix, version, format, dataBlocks) {
    const dimension = matrix.width;
    // version info if applicable
    if (version.versionNumber + 1 > 6) {
        // top right
        for (let y = 0, i = 0; y <= 5; y++) {
            for (let x = dimension - 11; x <= dimension - 9; x++, i++) {
                matrix.set(x, y, !!((version.infoBits >> i) & 1));
            }
        }
        // bottom left
        for (let x = 0, i = 0; x <= 5; x++) {
            for (let y = dimension - 11; y <= dimension - 9; y++, i++) {
                matrix.set(x, y, !!((version.infoBits >> i) & 1));
            }
        }
    }
    // format info
    {
        // top left
        let i = 0;
        for (let y = 0; y <= 7; y++) {
            if (y !== 6) {
                matrix.set(8, y, !!((format.bits >> i) & 1));
                i++;
            }
        }
        for (let x = 8; x >= 0; x--) {
            if (x !== 6) {
                matrix.set(x, 8, !!((format.bits >> i) & 1));
                i++;
            }
        }
    }
    {
        let i = 0;
        for (let x = dimension - 1; x >= dimension - 8; x--, i++) {
            // top right
            matrix.set(x, 8, !!((format.bits >> i) & 1));
        }
        for (let y = dimension - 7; y <= dimension - 1; y++, i++) {
            // bottom left
            matrix.set(8, y, !!((format.bits >> i) & 1));
        }
    }
    // function patterns
    matrix.setRegion(0, 0, 8, 8, false); // top left separator
    matrix.setRegion(0, 0, 7, 7, true); // top left finder outer ring
    matrix.setRegion(1, 1, 5, 5, false); // top left finder gap
    matrix.setRegion(2, 2, 3, 3, true); // top left finder center
    matrix.setRegion(dimension - 8, 0, 8, 8, false); // top right separator
    matrix.setRegion(dimension - 7, 0, 7, 7, true); // top right finder outer ring
    matrix.setRegion(dimension - 6, 1, 5, 5, false); // and so forth...
    matrix.setRegion(dimension - 5, 2, 3, 3, true);
    matrix.setRegion(0, dimension - 8, 8, 8, false); // bottom left separator + finder
    matrix.setRegion(0, dimension - 7, 7, 7, true);
    matrix.setRegion(1, dimension - 6, 5, 5, false);
    matrix.setRegion(2, dimension - 5, 3, 3, true);
    for (let y = 9; y < 9 + dimension - 17; y++) {
        matrix.set(6, y, y % 2 === 0); // Vertical timing pattern
    }
    for (let x = 9; x < 9 + dimension - 17; x++) {
        matrix.set(x, 6, x % 2 === 0); // Horizontal timing pattern
    }
    // Alignment patterns
    for (const x of version.alignmentPatternCenters) {
        for (const y of version.alignmentPatternCenters) {
            if (!((x === 6 && y === 6) ||
                (x === 6 && y === dimension - 7) ||
                (x === dimension - 7 && y === 6))) {
                matrix.setRegion(x - 2, y - 2, 5, 5, true);
                matrix.setRegion(x - 1, y - 1, 3, 3, false);
                matrix.set(x, y, true);
            }
        }
    }
    const codewords = [];
    const dataBlockIdx = new Array(dataBlocks.length).fill(0);
    let numDone = 0;
    function collectCodewords(getLimit) {
        numDone = 0;
        while (numDone < dataBlocks.length) {
            for (let i = 0; i < dataBlocks.length; i++) {
                const j = dataBlockIdx[i];
                if (j < getLimit(dataBlocks[i])) {
                    codewords.push(dataBlocks[i].codewordsCorrected[j]);
                    if (++dataBlockIdx[i] >= getLimit(dataBlocks[i]))
                        numDone++;
                }
            }
        }
    }
    // collect data codewords in original order
    collectCodewords((block) => block.numDataCodewords);
    // collect ec codewords
    collectCodewords((block) => block.codewordsCorrected.length);
    const dataMask = DATA_MASKS[format.formatInfo.dataMask];
    const functionPatternMask = buildFunctionPatternMask(version);
    let bytesRead = 0;
    let bitsRead = 0;
    let readingUp = true;
    for (let columnIndex = dimension - 1; columnIndex > 0; columnIndex -= 2) {
        if (columnIndex === 6) {
            // Skip whole column with vertical alignment pattern;
            columnIndex--;
        }
        for (let i = 0; i < dimension; i++) {
            const y = readingUp ? dimension - 1 - i : i;
            for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
                const x = columnIndex - columnOffset;
                if (!functionPatternMask.get(x, y)) {
                    bitsRead++;
                    let bit = bytesRead < codewords.length
                        ? !!((codewords[bytesRead] >> (8 - bitsRead)) & 1)
                        : false;
                    if (dataMask({ y, x })) {
                        bit = !bit;
                    }
                    matrix.set(x, y, bit);
                    if (bitsRead === 8) {
                        // Whole bytes
                        bytesRead++;
                        bitsRead = 0;
                    }
                }
            }
        }
        readingUp = !readingUp;
    }
    return codewords;
}

export { DATA_MASKS, buildFunctionPatternMask, decode };
//# sourceMappingURL=decoder.js.map
