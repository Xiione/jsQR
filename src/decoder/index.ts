import { BitMatrix } from "../BitMatrix";
import type { Point } from "../locator";
import { decode as decodeData, type DecodedQR } from "./decodeData";
import {
  decodeWASM as rsDecode,
  decodeJS as rsDecodeExpected,
} from "./reedsolomon";
import { type Version, VERSIONS } from "./version";

// tslint:disable:no-bitwise
function numBitsDiffering(x: number, y: number) {
  let z = x ^ y;
  let bitCount = 0;
  while (z) {
    bitCount++;
    z &= z - 1;
  }
  return bitCount;
}

function pushBit(bit: any, byte: number) {
  return (byte << 1) | bit;
}
// tslint:enable:no-bitwise

export const FORMAT_INFO_TABLE: FormatInformationWithBits[] = [
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

export const DATA_MASKS = [
  (p: Point) => (p.y + p.x) % 2 === 0,
  (p: Point) => p.y % 2 === 0,
  (p: Point) => p.x % 3 === 0,
  (p: Point) => (p.y + p.x) % 3 === 0,
  (p: Point) => (Math.floor(p.y / 2) + Math.floor(p.x / 3)) % 2 === 0,
  (p: Point) => ((p.x * p.y) % 2) + ((p.x * p.y) % 3) === 0,
  (p: Point) => (((p.y * p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
  (p: Point) => (((p.y + p.x) % 2) + ((p.y * p.x) % 3)) % 2 === 0,
];

export interface FormatInformation {
  errorCorrectionLevel: number;
  dataMask: number;
}

export interface FormatInformationWithBits {
  bits: number;
  formatInfo: FormatInformation;
}

export interface DataBlock {
  numDataCodewords: number;
  codewords: number[];
  codewordsCorrected: number[];
}

export interface VersionResult {
  // can be guessed instead of decoded
  version: number;
  topRightBestDiff: number;
  bottomLeftBestDiff: number;
  topRightCorrectedVersion: Version | null;
  bottomLeftCorrectedVersion: Version | null;
}

export interface FormatResult {
  format: FormatInformationWithBits | null;
  topLeftBestDiff: number;
  topRightBottomLeftBestDiff: number;
  topLeftCorrectedFormat: FormatInformationWithBits | null;
  topRightBottomLeftCorrectedFormat: FormatInformationWithBits | null;
}

export interface DecodeResult {
  decodedQR: DecodedQR | null;
  versionResult: VersionResult;
  formatResult: FormatResult;
  blockErrors: (number | null)[];
}

export function buildFunctionPatternMask(version: Version): BitMatrix {
  const dimension = 17 + 4 * version.versionNumber;
  const matrix = BitMatrix.createEmpty(dimension, dimension);

  matrix.setRegion(0, 0, 9, 9, true); // Top left finder pattern + separator + format
  matrix.setRegion(dimension - 8, 0, 8, 9, true); // Top right finder pattern + separator + format
  matrix.setRegion(0, dimension - 8, 9, 8, true); // Bottom left finder pattern + separator + format

  // Alignment patterns
  for (const x of version.alignmentPatternCenters) {
    for (const y of version.alignmentPatternCenters) {
      if (
        !(
          (x === 6 && y === 6) ||
          (x === 6 && y === dimension - 7) ||
          (x === dimension - 7 && y === 6)
        )
      ) {
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

export function readCodewords(
  matrix: BitMatrix,
  version: Version,
  formatInfo: FormatInformation,
) {
  const dataMask = DATA_MASKS[formatInfo.dataMask];
  const dimension = matrix.height;

  const functionPatternMask = buildFunctionPatternMask(version);

  const codewords: number[] = [];
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

export function readVersion(
  matrix: BitMatrix,
  returnOnMatch = true,
): VersionResult {
  const dimension = matrix.height;

  const provisionalVersion = Math.floor((dimension - 17) / 4);
  if (provisionalVersion <= 6) {
    // 6 and under don't have version info in the QR code
    return {
      topRightBestDiff: null,
      bottomLeftBestDiff: null,
      version: provisionalVersion,
      topRightCorrectedVersion: null,
      bottomLeftCorrectedVersion: null,
    };
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
  let topRightBestDiff = Infinity;
  let bottomLeftBestDiff = Infinity;
  let bestVersion: number;
  let topRightCorrectedVersion = null;
  let bottomLeftCorrectedVersion = null;

  for (let version = 7; version <= VERSIONS.length; version++) {
    const cur = VERSIONS[version - 1];
    if (returnOnMatch) {
      if (
        cur.infoBits === topRightVersionBits ||
        cur.infoBits === bottomLeftVersionBits
      ) {
        topRightBestDiff = Math.min(
          topRightBestDiff,
          numBitsDiffering(topRightVersionBits, cur.infoBits),
        );
        bottomLeftBestDiff = Math.min(
          bottomLeftBestDiff,
          numBitsDiffering(bottomLeftVersionBits, cur.infoBits),
        );
        return {
          version,
          topRightBestDiff,
          bottomLeftBestDiff,
          topRightCorrectedVersion,
          bottomLeftCorrectedVersion,
        };
      }
    }
    let difference = numBitsDiffering(topRightVersionBits, cur.infoBits);

    if (difference <= 3 && difference < topRightBestDiff) {
      topRightCorrectedVersion = cur;
    }

    topRightBestDiff = Math.min(topRightBestDiff, difference);
    if (difference < bestDifference) {
      bestVersion = version;
      bestDifference = difference;
    }

    difference = numBitsDiffering(bottomLeftVersionBits, cur.infoBits);

    if (difference <= 3 && difference < bottomLeftBestDiff) {
      bottomLeftCorrectedVersion = cur;
    }

    bottomLeftBestDiff = Math.min(bottomLeftBestDiff, difference);
    if (difference < bestDifference) {
      bestVersion = version;
      bestDifference = difference;
    }
  }
  // We can tolerate up to 3 bits of error since no two version info codewords will
  // differ in less than 8 bits.
  if (bestDifference <= 3) {
    return {
      version: bestVersion,
      topRightBestDiff,
      bottomLeftBestDiff,
      topRightCorrectedVersion,
      bottomLeftCorrectedVersion,
    };
  }
  return {
    version: provisionalVersion,
    topRightBestDiff,
    bottomLeftBestDiff,
    topRightCorrectedVersion,
    bottomLeftCorrectedVersion,
  };
}

export function readFormatInformation(
  matrix: BitMatrix,
  returnOnMatch = true,
): FormatResult {
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
    topRightBottomLeftFormatInfoBits = pushBit(
      matrix.get(8, y),
      topRightBottomLeftFormatInfoBits,
    );
  }
  for (let x = dimension - 8; x < dimension; x++) {
    // top right
    topRightBottomLeftFormatInfoBits = pushBit(
      matrix.get(x, 8),
      topRightBottomLeftFormatInfoBits,
    );
  }

  let bestDifference = Infinity;
  let topLeftBestDiff = Infinity;
  let topRightBottomLeftBestDiff = Infinity;
  let bestFormatInfo = null;
  let topLeftCorrectedFormat = null;
  let topRightBottomLeftCorrectedFormat = null;
  for (const format of FORMAT_INFO_TABLE) {
    if (returnOnMatch) {
      if (
        format.bits === topLeftFormatInfoBits ||
        format.bits === topRightBottomLeftFormatInfoBits
      ) {
        topLeftBestDiff = Math.min(
          topLeftBestDiff,
          numBitsDiffering(topLeftFormatInfoBits, format.bits),
        );
        topRightBottomLeftBestDiff = Math.min(
          topRightBottomLeftBestDiff,
          numBitsDiffering(topRightBottomLeftFormatInfoBits, format.bits),
        );
        return {
          format,
          topLeftBestDiff,
          topRightBottomLeftBestDiff,
          topLeftCorrectedFormat,
          topRightBottomLeftCorrectedFormat,
        };
      }
    }
    let difference = numBitsDiffering(topLeftFormatInfoBits, format.bits);
    if (difference <= 3 && difference < topLeftBestDiff) {
      topLeftCorrectedFormat = format;
    }
    topLeftBestDiff = Math.min(topLeftBestDiff, difference);
    if (difference < bestDifference) {
      bestFormatInfo = format;
      bestDifference = difference;
    }

    difference = numBitsDiffering(
      topRightBottomLeftFormatInfoBits,
      format.bits,
    );

    if (difference <= 3 && difference < topRightBottomLeftBestDiff) {
      topRightBottomLeftCorrectedFormat = format;
    }
    topRightBottomLeftBestDiff = Math.min(
      topRightBottomLeftBestDiff,
      difference,
    );
    if (difference < bestDifference) {
      bestFormatInfo = format;
      bestDifference = difference;
    }
  }
  // Hamming distance of the 32 masked codes is 7, by construction, so <= 3 bits differing means we found a match
  if (bestDifference <= 3) {
    return {
      format: bestFormatInfo,
      topLeftBestDiff,
      topRightBottomLeftBestDiff,
      topLeftCorrectedFormat,
      topRightBottomLeftCorrectedFormat,
    };
  }
  return {
    format: null,
    topLeftBestDiff,
    topRightBottomLeftBestDiff,
    topLeftCorrectedFormat,
    topRightBottomLeftCorrectedFormat,
  };
}

export function getDataBlocks(
  codewords: number[],
  version: Version,
  ecLevel: number,
) {
  const ecInfo = version.errorCorrectionLevels[ecLevel];
  const dataBlocks: DataBlock[] = [];

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
  if (!codewords || codewords.length < totalCodewords) {
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

function decodeMatrix(matrix: BitMatrix, doCorrection = true): DecodedQR {
  const versionResult = readVersion(matrix);
  const version = VERSIONS[versionResult.version - 1];
  const formatResult = readFormatInformation(matrix);
  // const decodeResult: DecodeResult = {
  //   decodedQR: null,
  //   versionResult,
  //   formatResult,
  //   blockErrors: [],
  // };
  if (!version) {
    return null;
  }
  if (!formatResult.format) {
    return null;
  }

  const codewords = readCodewords(
    matrix,
    version,
    formatResult.format.formatInfo,
  );
  const dataBlocks = getDataBlocks(
    codewords,
    version,
    formatResult.format.formatInfo.errorCorrectionLevel,
  );
  if (!dataBlocks) {
    return null;
  }
  // decodeResult.blockErrors = new Array(dataBlocks.length).fill(null);

  // Count total number of data bytes
  const totalBytes = dataBlocks.reduce((a, b) => a + b.numDataCodewords, 0);
  const resultBytes = new Uint8ClampedArray(totalBytes);

  let resultIndex = 0;
  let anyBlockFailed = false;
  for (let i = 0; i < dataBlocks.length; i++) {
    const dataBlock = dataBlocks[i];
    const decodeRes = rsDecode(
      Uint8Array.from(dataBlock.codewords),
      dataBlock.codewords.length - dataBlock.numDataCodewords,
    );

    // const bytesCorrected = rsDecodeExpected(dataBlock.codewords, dataBlock.codewords.length - dataBlock.numDataCodewords);
    const { errors, bytesCorrected } = decodeRes;
    if (!bytesCorrected) {
      anyBlockFailed = true;
      continue;
    }

    for (let i = 0; i < dataBlock.numDataCodewords; i++) {
      resultBytes[resultIndex++] = bytesCorrected["get"](i);
    }

    dataBlock.codewordsCorrected.length = dataBlock.codewords.length;
    for (let i = 0; i < dataBlock.codewords.length; i++) {
      dataBlock.codewordsCorrected[i] = bytesCorrected["get"](i);
    }
    bytesCorrected["delete"]();
  }
  if (anyBlockFailed) {
    // return decodeResult;
    return null;
  }

  try {
    const res = decodeData(resultBytes, version.versionNumber);
    // patch fix for random erroneous successful scans, an empty result is
    // useless anyways
    if (res && res.text) {
      res.ecLevel = formatResult.format.formatInfo.errorCorrectionLevel;
      res.dataMask = formatResult.format.formatInfo.dataMask;
      if (doCorrection) {
        correctMatrix(matrix, version, formatResult.format, dataBlocks);
      }
      // decodeResult.decodedQR = res;
      return res;
    } else {
      return null;
    }
  } catch {
    return null;
  }
}

export function decode(matrix: BitMatrix): DecodedQR {
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
  return res ? { ...res, mirrored: true } : null;
}

function correctMatrix(
  matrix: BitMatrix,
  version: Version,
  format: FormatInformationWithBits,
  dataBlocks: DataBlock[],
) {
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
      if (
        !(
          (x === 6 && y === 6) ||
          (x === 6 && y === dimension - 7) ||
          (x === dimension - 7 && y === 6)
        )
      ) {
        matrix.setRegion(x - 2, y - 2, 5, 5, true);
        matrix.setRegion(x - 1, y - 1, 3, 3, false);
        matrix.set(x, y, true);
      }
    }
  }

  const codewords: number[] = [];
  const dataBlockIdx: number[] = new Array(dataBlocks.length).fill(0);
  let numDone = 0;

  function collectCodewords(getLimit: (block: DataBlock) => number) {
    numDone = 0;
    while (numDone < dataBlocks.length) {
      for (let i = 0; i < dataBlocks.length; i++) {
        const j = dataBlockIdx[i];
        if (j < getLimit(dataBlocks[i])) {
          codewords.push(dataBlocks[i].codewordsCorrected[j]);
          if (++dataBlockIdx[i] >= getLimit(dataBlocks[i])) numDone++;
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
          let bit =
            bytesRead < codewords.length
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
