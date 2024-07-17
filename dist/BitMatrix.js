class BitMatrix {
    static createEmpty(width, height) {
        const mat = new BitMatrix(width, height);
        mat.data = new Uint8ClampedArray(Math.ceil((width * height) / 8));
        return mat;
    }
    static createFromBinarization(data, width) {
        const mat = new BitMatrix(width, data.length / width);
        mat.data = new Uint8ClampedArray(Math.ceil((width * mat.height) / 8));
        mat.data.fill(0);
        for (let k = 0; k < data.length; k++) {
            const i = Math.floor(k / 8);
            const j = k % 8;
            if (data[k])
                mat.data[i] |= 1 << j;
        }
        return mat;
    }
    static createFromPacked(dataPacked, width, height) {
        const mat = new BitMatrix(width, height);
        mat.data = new Uint8ClampedArray(dataPacked);
        return mat;
    }
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }
    coordsToPackedIndices(x, y) {
        const i = y * this.width + x;
        return [Math.floor(i / 8), i % 8];
    }
    get(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }
        const [i, j] = this.coordsToPackedIndices(x, y);
        return !!((this.data[i] >> j) & 1);
    }
    set(x, y, v) {
        const [i, j] = this.coordsToPackedIndices(x, y);
        if (v) {
            this.data[i] |= 1 << j;
        }
        else {
            this.data[i] &= ~(1 << j);
        }
    }
    setRegion(left, top, width, height, v) {
        for (let y = top; y < top + height; y++) {
            for (let x = left; x < left + width; x++) {
                this.set(x, y, !!v);
            }
        }
    }
    mirror() {
        for (let x = 0; x < this.width; x++) {
            for (let y = x + 1; y < this.height; y++) {
                if (this.get(x, y) !== this.get(y, x)) {
                    this.set(x, y, !this.get(x, y));
                    this.set(y, x, !this.get(y, x));
                }
            }
        }
    }
}

export { BitMatrix };
//# sourceMappingURL=BitMatrix.js.map
