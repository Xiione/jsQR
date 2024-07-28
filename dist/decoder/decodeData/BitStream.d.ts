import { Mode } from ".";
export declare enum StreamMapping {
    Padding = -1,
    Mode = -2,
    CharacterCountInfo = -3,
    SACurrentSequence = -4,
    SATotalSequence = -5,
    SAParity = -6,
    ECIData = -7
}
export interface StreamInfo {
    length: number;
    mapping?: StreamMapping;
    charIndex?: number;
    mode: Mode;
}
export declare class BitStream {
    private bytes;
    private byteOffset;
    private bitOffset;
    private charsRead;
    private mappings;
    constructor(bytes: Uint8ClampedArray);
    readBits(numBits: number, mode: Mode, mapping?: StreamMapping): number;
    available(): number;
    getMappings(): Map<number, StreamInfo>;
}
