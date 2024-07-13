import { BitMatrix } from "../BitMatrix";
import { Point } from "../Point";
import { DecodedQR } from "./decodeData";
import { Version } from "./version";
export declare const DATA_MASKS: ((p: Point) => boolean)[];
export declare function buildFunctionPatternMask(version: Version): BitMatrix;
export declare function decode(matrix: BitMatrix): DecodedQR;
