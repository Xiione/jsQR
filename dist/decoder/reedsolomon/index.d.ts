export declare function initDecoder(): Promise<void>;
export declare function getDecoderInitialized(): boolean;
export declare function decodeJS(bytes: number[], twoS: number): Uint8ClampedArray;
export declare function decodeWASM(bytes: number[], twoS: number): any;
