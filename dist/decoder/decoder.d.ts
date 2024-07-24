import { BitMatrix } from "../BitMatrix";
import { Point } from "../Point";
import { DecodedQR } from "./decodeData";
import { Version } from "./version";
export declare const DATA_MASKS: ((p: Point) => boolean)[];
interface FormatInformation {
    errorCorrectionLevel: number;
    dataMask: number;
}
interface FormatInformationWithBits {
    bits: number;
    formatInfo: FormatInformation;
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
export declare function decode(matrix: BitMatrix): DecodedQR;
export {};
