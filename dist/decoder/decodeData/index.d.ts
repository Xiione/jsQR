import { BitStream, StreamInfo } from "./BitStream";
export interface Chunk {
    type: Mode;
    text: string;
}
export interface ByteChunk {
    type: Mode.Byte | Mode.Kanji;
    bytes: number[];
}
export interface ECIChunk {
    type: Mode.ECI;
    assignmentNumber: number;
}
export interface StructuredAppend {
    type: Mode.StructuredAppend;
    currentSequence: number;
    totalSequence: number;
    parity: number;
}
export type Chunks = Array<Chunk | ByteChunk | ECIChunk | StructuredAppend>;
export interface DecodedQR {
    text: string;
    bytes: number[];
    chunks: Chunks;
    version: number;
    mirrored: boolean;
    ecLevel: number;
    dataMask: number;
    streamMappings: Map<number, StreamInfo>;
}
interface DecodeTextResult {
    bytes: number[];
    text: string;
}
export declare enum Mode {
    Numeric = "numeric",
    Alphanumeric = "alphanumeric",
    Byte = "byte",
    Kanji = "kanji",
    ECI = "eci",
    StructuredAppend = "structuredappend",
    None = "none"
}
export declare enum ModeByte {
    Terminator = 0,
    Numeric = 1,
    Alphanumeric = 2,
    Byte = 4,
    Kanji = 8,
    ECI = 7,
    StructuredAppend = 3
}
export declare function decodeNumeric(stream: BitStream, size: number, textOnly?: boolean): DecodeTextResult | string;
export declare const AlphanumericCharacterCodes: string[];
export declare function decodeAlphanumeric(stream: BitStream, size: number, textOnly?: boolean): DecodeTextResult | string;
export declare function decodeByte(stream: BitStream, size: number, textOnly?: boolean): DecodeTextResult | string;
export declare function decodeKanji(stream: BitStream, size: number, textOnly?: boolean): DecodeTextResult | string;
export declare function decode(data: Uint8ClampedArray, version: number): DecodedQR;
export {};
