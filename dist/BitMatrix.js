class BitMatrix {
    static createEmpty(width, height) {
        return new BitMatrix(new Uint8ClampedArray(width * height), width);
    }
    constructor(data, width) {
        this.width = width;
        this.height = data.length / width;
        this.data = new Uint8ClampedArray(data);
    }
    get(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return false;
        }
        return !!this.data[y * this.width + x];
    }
    set(x, y, v) {
        this.data[y * this.width + x] = v ? 1 : 0;
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
