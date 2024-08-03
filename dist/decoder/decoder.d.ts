import { BitMatrix } from "../BitMatrix";
import { Point } from "../Point";
import { DecodedQR } from "./decodeData";
import { Version } from "./version";
export declare const FORMAT_INFO_TABLE: FormatInformationWithBits[];
export declare const DATA_MASKS: ((p: Point) => boolean)[];
export interface FormatInformation {
    errorCorrectionLevel: number;
    dataMask: number;
}
interface FormatInformationWithBits {
    bits: number;
    formatInfo: FormatInformation;
}
export interface DataBlock {
    numDataCodewords: number;
    codewords: number[];
    codewordsCorrected: number[];
}
export interface VersionResult {
    version: number;
    topRightBestDiff: number | null;
    bottomLeftBestDiff: number | null;
}
export interface FormatResult {
    format: FormatInformationWithBits | null;
    topLeftBestDiff: number;
    topRightBottomLeftBestDiff: number;
}
export interface DecodeResult {
    decodedQR: DecodedQR | null;
    versionResult: VersionResult;
    formatResult: FormatResult;
    blockErrors: (number | null)[];
}
export declare function buildFunctionPatternMask(version: Version): BitMatrix;
export declare function readCodewords(matrix: BitMatrix, version: Version, formatInfo: FormatInformation): number[];
export declare function readVersion(matrix: BitMatrix): VersionResult;
export declare function readFormatInformation(matrix: BitMatrix): FormatResult;
export declare function getDataBlocks(codewords: number[], version: Version, ecLevel: number): DataBlock[];
export declare function decode(matrix: BitMatrix): DecodedQR;
export {};
