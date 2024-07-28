export declare class BitMatrix {
    static createEmpty(width: number, height: number): BitMatrix;
    static createFromBinarization(data: Uint8ClampedArray, width: number): BitMatrix;
    static createFromPacked(dataPacked: Uint8ClampedArray, width: number, height: number): BitMatrix;
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(width: number, height: number);
    private coordsToPackedIndices;
    get(x: number, y: number): boolean;
    set(x: number, y: number, v: boolean): void;
    setRegion(left: number, top: number, width: number, height: number, v: boolean): void;
    mirror(): void;
    equals(matrix: BitMatrix): boolean;
}
