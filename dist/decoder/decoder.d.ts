import { BitMatrix } from "../BitMatrix";
import { DecodedQR } from "./decodeData";
import { Version } from "./version";
export declare function buildFunctionPatternMask(version: Version): BitMatrix;
export declare function decode(matrix: BitMatrix): DecodedQR;
