import { createRequire } from 'module';

class BitMatrix {
    static createEmpty(width, height) {
        return new BitMatrix(new Uint8ClampedArray(width * height), width);
    }
    constructor(data, width) {
        this.width = width;
        this.height = data.length / width;
        this.data = data;
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
}

const REGION_SIZE = 8;
const MIN_DYNAMIC_RANGE = 24;
function numBetween(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
// Like BitMatrix but accepts arbitry Uint8 values
class Matrix {
    constructor(width, height, buffer) {
        this.width = width;
        const bufferSize = width * height;
        if (buffer && buffer.length !== bufferSize) {
            throw new Error("Wrong buffer size");
        }
        this.data = buffer || new Uint8ClampedArray(bufferSize);
    }
    get(x, y) {
        return this.data[y * this.width + x];
    }
    set(x, y, value) {
        this.data[y * this.width + x] = value;
    }
}
function binarize(data, width, height, returnInverted, greyscaleWeights, canOverwriteImage) {
    const pixelCount = width * height;
    if (data.length !== pixelCount * 4) {
        throw new Error("Malformed data passed to binarizer.");
    }
    // assign the greyscale and binary image within the rgba buffer as the rgba image will not be needed after conversion
    let bufferOffset = 0;
    // Convert image to greyscale
    let greyscaleBuffer;
    if (canOverwriteImage) {
        greyscaleBuffer = new Uint8ClampedArray(data.buffer, bufferOffset, pixelCount);
        bufferOffset += pixelCount;
    }
    const greyscalePixels = new Matrix(width, height, greyscaleBuffer);
    if (greyscaleWeights.useIntegerApproximation) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelPosition = (y * width + x) * 4;
                const r = data[pixelPosition];
                const g = data[pixelPosition + 1];
                const b = data[pixelPosition + 2];
                greyscalePixels.set(x, y, 
                // tslint:disable-next-line no-bitwise
                (greyscaleWeights.red * r + greyscaleWeights.green * g + greyscaleWeights.blue * b + 128) >> 8);
            }
        }
    }
    else {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelPosition = (y * width + x) * 4;
                const r = data[pixelPosition];
                const g = data[pixelPosition + 1];
                const b = data[pixelPosition + 2];
                greyscalePixels.set(x, y, greyscaleWeights.red * r + greyscaleWeights.green * g + greyscaleWeights.blue * b);
            }
        }
    }
    const horizontalRegionCount = Math.ceil(width / REGION_SIZE);
    const verticalRegionCount = Math.ceil(height / REGION_SIZE);
    const blackPointsCount = horizontalRegionCount * verticalRegionCount;
    let blackPointsBuffer;
    if (canOverwriteImage) {
        blackPointsBuffer = new Uint8ClampedArray(data.buffer, bufferOffset, blackPointsCount);
        bufferOffset += blackPointsCount;
    }
    const blackPoints = new Matrix(horizontalRegionCount, verticalRegionCount, blackPointsBuffer);
    for (let verticalRegion = 0; verticalRegion < verticalRegionCount; verticalRegion++) {
        for (let hortizontalRegion = 0; hortizontalRegion < horizontalRegionCount; hortizontalRegion++) {
            let min = Infinity;
            let max = 0;
            for (let y = 0; y < REGION_SIZE; y++) {
                for (let x = 0; x < REGION_SIZE; x++) {
                    const pixelLumosity = greyscalePixels.get(hortizontalRegion * REGION_SIZE + x, verticalRegion * REGION_SIZE + y);
                    min = Math.min(min, pixelLumosity);
                    max = Math.max(max, pixelLumosity);
                }
            }
            // We could also compute the real average of all pixels but following the assumption that the qr code consists
            // of bright and dark pixels and essentially not much in between, by (min + max)/2 we make the cut really between
            // those two classes. If using the average over all pixel in a block of mostly bright pixels and few dark pixels,
            // the avg would tend to the bright side and darker bright pixels could be interpreted as dark.
            let average = (min + max) / 2;
            // Small bias towards black by moving the threshold up. We do this, as in the finder patterns white holes tend
            // to appear which makes them undetectable.
            const blackBias = 1.11;
            average = Math.min(255, average * blackBias);
            if (max - min <= MIN_DYNAMIC_RANGE) {
                // If variation within the block is low, assume this is a block with only light or only
                // dark pixels. In that case we do not want to use the average, as it would divide this
                // low contrast area into black and white pixels, essentially creating data out of noise.
                //
                // Default the blackpoint for these blocks to be half the min - effectively white them out
                average = min / 2;
                if (verticalRegion > 0 && hortizontalRegion > 0) {
                    // Correct the "white background" assumption for blocks that have neighbors by comparing
                    // the pixels in this block to the previously calculated black points. This is based on
                    // the fact that dark barcode symbology is always surrounded by some amount of light
                    // background for which reasonable black point estimates were made. The bp estimated at
                    // the boundaries is used for the interior.
                    // The (min < bp) is arbitrary but works better than other heuristics that were tried.
                    const averageNeighborBlackPoint = (blackPoints.get(hortizontalRegion, verticalRegion - 1) +
                        (2 * blackPoints.get(hortizontalRegion - 1, verticalRegion)) +
                        blackPoints.get(hortizontalRegion - 1, verticalRegion - 1)) / 4;
                    if (min < averageNeighborBlackPoint) {
                        average = averageNeighborBlackPoint; // no need to apply black bias as already applied to neighbors
                    }
                }
            }
            blackPoints.set(hortizontalRegion, verticalRegion, average);
        }
    }
    let binarized;
    if (canOverwriteImage) {
        const binarizedBuffer = new Uint8ClampedArray(data.buffer, bufferOffset, pixelCount);
        bufferOffset += pixelCount;
        binarized = new BitMatrix(binarizedBuffer, width);
    }
    else {
        binarized = BitMatrix.createEmpty(width, height);
    }
    let inverted = null;
    if (returnInverted) {
        if (canOverwriteImage) {
            const invertedBuffer = new Uint8ClampedArray(data.buffer, bufferOffset, pixelCount);
            inverted = new BitMatrix(invertedBuffer, width);
        }
        else {
            inverted = BitMatrix.createEmpty(width, height);
        }
    }
    for (let verticalRegion = 0; verticalRegion < verticalRegionCount; verticalRegion++) {
        for (let hortizontalRegion = 0; hortizontalRegion < horizontalRegionCount; hortizontalRegion++) {
            const left = numBetween(hortizontalRegion, 2, horizontalRegionCount - 3);
            const top = numBetween(verticalRegion, 2, verticalRegionCount - 3);
            let sum = 0;
            for (let xRegion = -2; xRegion <= 2; xRegion++) {
                for (let yRegion = -2; yRegion <= 2; yRegion++) {
                    sum += blackPoints.get(left + xRegion, top + yRegion);
                }
            }
            const threshold = sum / 25;
            for (let xRegion = 0; xRegion < REGION_SIZE; xRegion++) {
                for (let yRegion = 0; yRegion < REGION_SIZE; yRegion++) {
                    const x = hortizontalRegion * REGION_SIZE + xRegion;
                    const y = verticalRegion * REGION_SIZE + yRegion;
                    const lum = greyscalePixels.get(x, y);
                    binarized.set(x, y, lum <= threshold);
                    if (returnInverted) {
                        inverted.set(x, y, !(lum <= threshold));
                    }
                }
            }
        }
    }
    if (returnInverted) {
        return { binarized, inverted };
    }
    return { binarized };
}

// tslint:disable:no-bitwise
class BitStream {
    constructor(bytes) {
        this.byteOffset = 0;
        this.bitOffset = 0;
        this.bytes = bytes;
    }
    readBits(numBits) {
        if (numBits < 1 || numBits > 32 || numBits > this.available()) {
            throw new Error("Cannot read " + numBits.toString() + " bits");
        }
        let result = 0;
        // First, read remainder from current byte
        if (this.bitOffset > 0) {
            const bitsLeft = 8 - this.bitOffset;
            const toRead = numBits < bitsLeft ? numBits : bitsLeft;
            const bitsToNotRead = bitsLeft - toRead;
            const mask = (0xFF >> (8 - toRead)) << bitsToNotRead;
            result = (this.bytes[this.byteOffset] & mask) >> bitsToNotRead;
            numBits -= toRead;
            this.bitOffset += toRead;
            if (this.bitOffset === 8) {
                this.bitOffset = 0;
                this.byteOffset++;
            }
        }
        // Next read whole bytes
        if (numBits > 0) {
            while (numBits >= 8) {
                result = (result << 8) | (this.bytes[this.byteOffset] & 0xFF);
                this.byteOffset++;
                numBits -= 8;
            }
            // Finally read a partial byte
            if (numBits > 0) {
                const bitsToNotRead = 8 - numBits;
                const mask = (0xFF >> bitsToNotRead) << bitsToNotRead;
                result = (result << numBits) | ((this.bytes[this.byteOffset] & mask) >> bitsToNotRead);
                this.bitOffset += numBits;
            }
        }
        return result;
    }
    available() {
        return 8 * (this.bytes.length - this.byteOffset) - this.bitOffset;
    }
}

// tslint:disable:no-bitwise
var Mode;
(function (Mode) {
    Mode["Numeric"] = "numeric";
    Mode["Alphanumeric"] = "alphanumeric";
    Mode["Byte"] = "byte";
    Mode["Kanji"] = "kanji";
    Mode["ECI"] = "eci";
    Mode["StructuredAppend"] = "structuredappend";
})(Mode || (Mode = {}));
var ModeByte;
(function (ModeByte) {
    ModeByte[ModeByte["Terminator"] = 0] = "Terminator";
    ModeByte[ModeByte["Numeric"] = 1] = "Numeric";
    ModeByte[ModeByte["Alphanumeric"] = 2] = "Alphanumeric";
    ModeByte[ModeByte["Byte"] = 4] = "Byte";
    ModeByte[ModeByte["Kanji"] = 8] = "Kanji";
    ModeByte[ModeByte["ECI"] = 7] = "ECI";
    ModeByte[ModeByte["StructuredAppend"] = 3] = "StructuredAppend";
    // FNC1FirstPosition = 0x5,
    // FNC1SecondPosition = 0x9,
})(ModeByte || (ModeByte = {}));
function decodeNumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [10, 12, 14][size];
    let length = stream.readBits(characterCountSize);
    // Read digits in groups of 3
    while (length >= 3) {
        const num = stream.readBits(10);
        if (num >= 1000) {
            throw new Error("Invalid numeric value above 999");
        }
        const a = Math.floor(num / 100);
        const b = Math.floor(num / 10) % 10;
        const c = num % 10;
        bytes.push(48 + a, 48 + b, 48 + c);
        text += a.toString() + b.toString() + c.toString();
        length -= 3;
    }
    // If the number of digits aren't a multiple of 3, the remaining digits are special cased.
    if (length === 2) {
        const num = stream.readBits(7);
        if (num >= 100) {
            throw new Error("Invalid numeric value above 99");
        }
        const a = Math.floor(num / 10);
        const b = num % 10;
        bytes.push(48 + a, 48 + b);
        text += a.toString() + b.toString();
    }
    else if (length === 1) {
        const num = stream.readBits(4);
        if (num >= 10) {
            throw new Error("Invalid numeric value above 9");
        }
        bytes.push(48 + num);
        text += num.toString();
    }
    return { bytes, text };
}
const AlphanumericCharacterCodes = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8",
    "9", "A", "B", "C", "D", "E", "F", "G", "H",
    "I", "J", "K", "L", "M", "N", "O", "P", "Q",
    "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    " ", "$", "%", "*", "+", "-", ".", "/", ":",
];
function decodeAlphanumeric(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [9, 11, 13][size];
    let length = stream.readBits(characterCountSize);
    while (length >= 2) {
        const v = stream.readBits(11);
        const a = Math.floor(v / 45);
        const b = v % 45;
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0), AlphanumericCharacterCodes[b].charCodeAt(0));
        text += AlphanumericCharacterCodes[a] + AlphanumericCharacterCodes[b];
        length -= 2;
    }
    if (length === 1) {
        const a = stream.readBits(6);
        bytes.push(AlphanumericCharacterCodes[a].charCodeAt(0));
        text += AlphanumericCharacterCodes[a];
    }
    return { bytes, text };
}
function decodeByte(stream, size) {
    const bytes = [];
    let text = "";
    const characterCountSize = [8, 16, 16][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const b = stream.readBits(8);
        bytes.push(b);
    }
    try {
        text += decodeURIComponent(bytes.map(b => `%${("0" + b.toString(16)).substr(-2)}`).join(""));
    }
    catch (_a) {
        // failed to decode
    }
    return { bytes, text };
}
function decodeKanji(stream, size) {
    const bytes = [];
    const characterCountSize = [8, 10, 12][size];
    const length = stream.readBits(characterCountSize);
    for (let i = 0; i < length; i++) {
        const k = stream.readBits(13);
        let c = (Math.floor(k / 0xC0) << 8) | (k % 0xC0);
        if (c < 0x1F00) {
            c += 0x8140;
        }
        else {
            c += 0xC140;
        }
        bytes.push(c >> 8, c & 0xFF);
    }
    const text = new TextDecoder("shift-jis").decode(Uint8Array.from(bytes));
    return { bytes, text };
}
function decode$1(data, version) {
    const stream = new BitStream(data);
    // There are 3 'sizes' based on the version. 1-9 is small (0), 10-26 is medium (1) and 27-40 is large (2).
    const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    const result = {
        text: "",
        bytes: [],
        chunks: [],
        version,
    };
    while (stream.available() >= 4) {
        const mode = stream.readBits(4);
        if (mode === ModeByte.Terminator) {
            return result;
        }
        else if (mode === ModeByte.ECI) {
            if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(7),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(14),
                });
            }
            else if (stream.readBits(1) === 0) {
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: stream.readBits(21),
                });
            }
            else {
                // ECI data seems corrupted
                result.chunks.push({
                    type: Mode.ECI,
                    assignmentNumber: -1,
                });
            }
        }
        else if (mode === ModeByte.Numeric) {
            const numericResult = decodeNumeric(stream, size);
            result.text += numericResult.text;
            result.bytes.push(...numericResult.bytes);
            result.chunks.push({
                type: Mode.Numeric,
                text: numericResult.text,
            });
        }
        else if (mode === ModeByte.Alphanumeric) {
            const alphanumericResult = decodeAlphanumeric(stream, size);
            result.text += alphanumericResult.text;
            result.bytes.push(...alphanumericResult.bytes);
            result.chunks.push({
                type: Mode.Alphanumeric,
                text: alphanumericResult.text,
            });
        }
        else if (mode === ModeByte.Byte) {
            const byteResult = decodeByte(stream, size);
            result.text += byteResult.text;
            result.bytes.push(...byteResult.bytes);
            result.chunks.push({
                type: Mode.Byte,
                bytes: byteResult.bytes,
                text: byteResult.text,
            });
        }
        else if (mode === ModeByte.Kanji) {
            const kanjiResult = decodeKanji(stream, size);
            result.text += kanjiResult.text;
            result.bytes.push(...kanjiResult.bytes);
            result.chunks.push({
                type: Mode.Kanji,
                bytes: kanjiResult.bytes,
                text: kanjiResult.text,
            });
        }
        else if (mode === ModeByte.StructuredAppend) {
            result.chunks.push({
                type: Mode.StructuredAppend,
                currentSequence: stream.readBits(4),
                totalSequence: stream.readBits(4),
                parity: stream.readBits(8),
            });
        }
    }
    // If there is no data left, or the remaining bits are all 0, then that counts as a termination marker
    if (stream.available() === 0 || stream.readBits(stream.available()) === 0) {
        return result;
    }
}

const require = createRequire(import.meta.url);

var rsiscool = (() => {
  
  return (
function(moduleArg = {}) {
  var moduleRtn;

var n=moduleArg,aa,p,ba=new Promise((a,b)=>{aa=a;p=b;}),ca=Object.assign({},n),da="./this.program",ea="",fa,ha,ia,fs=require("fs"),ja=require("path");ea=require("url").fileURLToPath(new URL("./",import.meta.url));fa=a=>{a=ka(a)?new URL(a):ja.normalize(a);return fs.readFileSync(a,void 0)};ia=a=>{a=fa(a);a.buffer||(a=new Uint8Array(a));return a};ha=(a,b,c)=>{a=ka(a)?new URL(a):ja.normalize(a);fs.readFile(a,void 0,(d,e)=>{d?c(d):b(e.buffer);});};
!n.thisProgram&&1<process.argv.length&&(da=process.argv[1].replace(/\\/g,"/"));process.argv.slice(2);n.print||console.log.bind(console);var la=n.printErr||console.error.bind(console);Object.assign(n,ca);ca=null;n.thisProgram&&(da=n.thisProgram);var ma;n.wasmBinary&&(ma=n.wasmBinary);var na,oa=!1,v,x,y,pa,A,B,qa,ra,sa=[],ta=[],ua=[];function va(){var a=n.preRun.shift();sa.unshift(a);}var C=0,D=null;
function xa(a){n.onAbort?.(a);a="Aborted("+a+")";la(a);oa=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");p(a);throw a;}var ya=a=>a.startsWith("data:application/octet-stream;base64,"),ka=a=>a.startsWith("file://"),za;function Aa(a){if(a==za&&ma)return new Uint8Array(ma);if(ia)return ia(a);throw "both async and sync fetching of the wasm failed";}
function Ba(){var a=za;return ma?Promise.resolve().then(()=>Aa(a)):new Promise((b,c)=>{ha(a,d=>b(new Uint8Array(d)),()=>{try{b(Aa(a));}catch(d){c(d);}});})}function Ca(a,b){return Ba().then(c=>WebAssembly.instantiate(c,a)).then(b,c=>{la(`failed to asynchronously prepare wasm: ${c}`);xa(c);})}function Da(a,b){return Ca(a,b)}var Ea=a=>{for(;0<a.length;)a.shift()(n);};class Fa{constructor(a){this.S=a-24;}}var Ga=0,Ia={},Ka=a=>{for(;a.length;){var b=a.pop();a.pop()(b);}};
function E(a){return this.fromWireType(B[a>>2])}
var G={},H={},La={},I,K=(a,b,c)=>{function d(f){f=c(f);if(f.length!==a.length)throw new I("Mismatched type converter count");for(var l=0;l<a.length;++l)J(a[l],f[l]);}a.forEach(function(f){La[f]=b;});var e=Array(b.length),h=[],g=0;b.forEach((f,l)=>{H.hasOwnProperty(f)?e[l]=H[f]:(h.push(f),G.hasOwnProperty(f)||(G[f]=[]),G[f].push(()=>{e[l]=H[f];++g;g===h.length&&d(e);}));});0===h.length&&d(e);},Ma,L=a=>{for(var b="";x[a];)b+=Ma[x[a++]];return b},M,Na=a=>{throw new M(a);};
function Oa(a,b,c={}){var d=b.name;if(!a)throw new M(`type "${d}" must have a positive integer typeid pointer`);if(H.hasOwnProperty(a)){if(c.wa)return;throw new M(`Cannot register type '${d}' twice`);}H[a]=b;delete La[a];G.hasOwnProperty(a)&&(b=G[a],delete G[a],b.forEach(e=>e()));}function J(a,b,c={}){if(!("argPackAdvance"in b))throw new TypeError("registerType registeredInstance requires argPackAdvance");return Oa(a,b,c)}
var Pa=a=>{throw new M(a.P.T.R.name+" instance already deleted");},Qa=!1,Ra=()=>{},Sa=(a,b,c)=>{if(b===c)return a;if(void 0===c.W)return null;a=Sa(a,b,c.W);return null===a?null:c.pa(a)},Ta={},N=[],Ua=()=>{for(;N.length;){var a=N.pop();a.P.aa=!1;a["delete"]();}},O,P={},Va=(a,b)=>{if(void 0===b)throw new M("ptr should not be undefined");for(;a.W;)b=a.ea(b),a=a.W;return P[b]},Wa=(a,b)=>{if(!b.T||!b.S)throw new I("makeClassHandle requires ptr and ptrType");if(!!b.X!==!!b.U)throw new I("Both smartPtrType and smartPtr must be specified");
b.count={value:1};return Q(Object.create(a,{P:{value:b,writable:!0}}))},Q=a=>{if("undefined"===typeof FinalizationRegistry)return Q=b=>b,a;Qa=new FinalizationRegistry(b=>{b=b.P;--b.count.value;0===b.count.value&&(b.U?b.X.Z(b.U):b.T.R.Z(b.S));});Q=b=>{var c=b.P;c.U&&Qa.register(b,{P:c},b);return b};Ra=b=>{Qa.unregister(b);};return Q(a)};function Xa(){}
var R=(a,b)=>Object.defineProperty(b,"name",{value:a}),Ya=(a,b,c)=>{if(void 0===a[b].V){var d=a[b];a[b]=function(...e){if(!a[b].V.hasOwnProperty(e.length))throw new M(`Function '${c}' called with an invalid number of arguments (${e.length}) - expects one of (${a[b].V})!`);return a[b].V[e.length].apply(this,e)};a[b].V=[];a[b].V[d.fa]=d;}},Za=(a,b,c)=>{if(n.hasOwnProperty(a)){if(void 0===c||void 0!==n[a].V&&void 0!==n[a].V[c])throw new M(`Cannot register public name '${a}' twice`);Ya(n,a,a);if(n.hasOwnProperty(c))throw new M(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`);
n[a].V[c]=b;}else n[a]=b,void 0!==c&&(n[a].Fa=c);},$a=a=>{if(void 0===a)return "_unknown";a=a.replace(/[^a-zA-Z0-9_]/g,"$");var b=a.charCodeAt(0);return 48<=b&&57>=b?`_${a}`:a};function ab(a,b,c,d,e,h,g,f){this.name=a;this.constructor=b;this.ba=c;this.Z=d;this.W=e;this.ra=h;this.ea=g;this.pa=f;this.za=[];}var bb=(a,b,c)=>{for(;b!==c;){if(!b.ea)throw new M(`Expected null or instance of ${c.name}, got an instance of ${b.name}`);a=b.ea(a);b=b.W;}return a};
function cb(a,b){if(null===b){if(this.ia)throw new M(`null is not a valid ${this.name}`);return 0}if(!b.P)throw new M(`Cannot pass "${db(b)}" as a ${this.name}`);if(!b.P.S)throw new M(`Cannot pass deleted object as a pointer of type ${this.name}`);return bb(b.P.S,b.P.T.R,this.R)}
function eb(a,b){if(null===b){if(this.ia)throw new M(`null is not a valid ${this.name}`);if(this.ha){var c=this.ja();null!==a&&a.push(this.Z,c);return c}return 0}if(!b||!b.P)throw new M(`Cannot pass "${db(b)}" as a ${this.name}`);if(!b.P.S)throw new M(`Cannot pass deleted object as a pointer of type ${this.name}`);if(!this.ga&&b.P.T.ga)throw new M(`Cannot convert argument of type ${b.P.X?b.P.X.name:b.P.T.name} to parameter type ${this.name}`);c=bb(b.P.S,b.P.T.R,this.R);if(this.ha){if(void 0===b.P.U)throw new M("Passing raw pointer to smart pointer is illegal");
switch(this.Ea){case 0:if(b.P.X===this)c=b.P.U;else throw new M(`Cannot convert argument of type ${b.P.X?b.P.X.name:b.P.T.name} to parameter type ${this.name}`);break;case 1:c=b.P.U;break;case 2:if(b.P.X===this)c=b.P.U;else {var d=b.clone();c=this.Aa(c,S(()=>d["delete"]()));null!==a&&a.push(this.Z,c);}break;default:throw new M("Unsupporting sharing policy");}}return c}
function fb(a,b){if(null===b){if(this.ia)throw new M(`null is not a valid ${this.name}`);return 0}if(!b.P)throw new M(`Cannot pass "${db(b)}" as a ${this.name}`);if(!b.P.S)throw new M(`Cannot pass deleted object as a pointer of type ${this.name}`);if(b.P.T.ga)throw new M(`Cannot convert argument of type ${b.P.T.name} to parameter type ${this.name}`);return bb(b.P.S,b.P.T.R,this.R)}
function gb(a,b,c,d,e,h,g,f,l,m,k){this.name=a;this.R=b;this.ia=c;this.ga=d;this.ha=e;this.ya=h;this.Ea=g;this.na=f;this.ja=l;this.Aa=m;this.Z=k;e||void 0!==b.W?this.toWireType=eb:(this.toWireType=d?cb:fb,this.Y=null);}
var hb=(a,b,c)=>{if(!n.hasOwnProperty(a))throw new I("Replacing nonexistent public symbol");void 0!==n[a].V&&void 0!==c?n[a].V[c]=b:(n[a]=b,n[a].fa=c);},ib=[],jb,kb=a=>{var b=ib[a];b||(a>=ib.length&&(ib.length=a+1),ib[a]=b=jb.get(a));return b},lb=(a,b,c=[])=>{a.includes("j")?(a=a.replace(/p/g,"i"),b=(0, n["dynCall_"+a])(b,...c)):b=kb(b)(...c);return b},mb=(a,b)=>(...c)=>lb(a,b,c),T=(a,b)=>{a=L(a);var c=a.includes("j")?mb(a,b):kb(b);if("function"!=typeof c)throw new M(`unknown function pointer with signature ${a}: ${b}`);
return c},nb,pb=a=>{a=ob(a);var b=L(a);U(a);return b},qb=(a,b)=>{function c(h){e[h]||H[h]||(La[h]?La[h].forEach(c):(d.push(h),e[h]=!0));}var d=[],e={};b.forEach(c);throw new nb(`${a}: `+d.map(pb).join([", "]));},rb=(a,b)=>{for(var c=[],d=0;d<a;d++)c.push(B[b+4*d>>2]);return c};function sb(a){for(var b=1;b<a.length;++b)if(null!==a[b]&&void 0===a[b].Y)return !0;return !1}
function tb(a){var b=Function;if(!(b instanceof Function))throw new TypeError(`new_ called with constructor type ${typeof b} which is not a function`);var c=R(b.name||"unknownFunctionName",function(){});c.prototype=b.prototype;c=new c;a=b.apply(c,a);return a instanceof Object?a:c}
function ub(a,b,c,d,e,h){var g=b.length;if(2>g)throw new M("argTypes array size mismatch! Must at least get return value and 'this' types!");var f=null!==b[1]&&null!==c,l=sb(b);c="void"!==b[0].name;d=[a,Na,d,e,Ka,b[0],b[1]];for(e=0;e<g-2;++e)d.push(b[e+2]);if(!l)for(e=f?1:2;e<b.length;++e)null!==b[e].Y&&d.push(b[e].Y);l=sb(b);e=b.length;var m="",k="";for(g=0;g<e-2;++g)m+=(0!==g?", ":"")+"arg"+g,k+=(0!==g?", ":"")+"arg"+g+"Wired";m=`\n        return function (${m}) {\n        if (arguments.length !== ${e-
2}) {\n          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ${e-2}');\n        }`;l&&(m+="var destructors = [];\n");var r=l?"destructors":"null",q="humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");f&&(m+="var thisWired = classParam['toWireType']("+r+", this);\n");for(g=0;g<e-2;++g)m+="var arg"+g+"Wired = argType"+g+"['toWireType']("+r+", arg"+g+");\n",q.push("argType"+g);f&&(k="thisWired"+(0<k.length?", ":
"")+k);m+=(c||h?"var rv = ":"")+"invoker(fn"+(0<k.length?", ":"")+k+");\n";if(l)m+="runDestructors(destructors);\n";else for(g=f?1:2;g<b.length;++g)h=1===g?"thisWired":"arg"+(g-2)+"Wired",null!==b[g].Y&&(m+=`${h}_dtor(${h});\n`,q.push(`${h}_dtor`));c&&(m+="var ret = retType['fromWireType'](rv);\nreturn ret;\n");let [w,u]=[q,m+"}\n"];w.push(u);b=tb(w)(...d);return R(a,b)}
var wb=a=>{a=a.trim();const b=a.indexOf("(");return -1!==b?a.substr(0,b):a},xb=[],V=[],yb=a=>{9<a&&0===--V[a+1]&&(V[a]=void 0,xb.push(a));},W=a=>{if(!a)throw new M("Cannot use deleted val. handle = "+a);return V[a]},S=a=>{switch(a){case void 0:return 2;case null:return 4;case !0:return 6;case !1:return 8;default:const b=xb.pop()||V.length;V[b]=a;V[b+1]=1;return b}},zb={name:"emscripten::val",fromWireType:a=>{var b=W(a);yb(a);return b},toWireType:(a,b)=>S(b),argPackAdvance:8,readValueFromPointer:E,Y:null},
db=a=>{if(null===a)return "null";var b=typeof a;return "object"===b||"array"===b||"function"===b?a.toString():""+a},Ab=(a,b)=>{switch(b){case 4:return function(c){return this.fromWireType(qa[c>>2])};case 8:return function(c){return this.fromWireType(ra[c>>3])};default:throw new TypeError(`invalid float width (${b}): ${a}`);}},Bb=(a,b,c)=>{switch(b){case 1:return c?d=>v[d]:d=>x[d];case 2:return c?d=>y[d>>1]:d=>pa[d>>1];case 4:return c?d=>A[d>>2]:d=>B[d>>2];default:throw new TypeError(`invalid integer width (${b}): ${a}`);
}},Cb="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0,Db="undefined"!=typeof TextDecoder?new TextDecoder("utf-16le"):void 0,Eb=(a,b)=>{var c=a>>1;for(var d=c+b/2;!(c>=d)&&pa[c];)++c;c<<=1;if(32<c-a&&Db)return Db.decode(x.subarray(a,c));c="";for(d=0;!(d>=b/2);++d){var e=y[a+2*d>>1];if(0==e)break;c+=String.fromCharCode(e);}return c},Fb=(a,b,c)=>{c??=2147483647;if(2>c)return 0;c-=2;var d=b;c=c<2*a.length?c/2:a.length;for(var e=0;e<c;++e)y[b>>1]=a.charCodeAt(e),b+=2;y[b>>1]=0;return b-d},
Gb=a=>2*a.length,Hb=(a,b)=>{for(var c=0,d="";!(c>=b/4);){var e=A[a+4*c>>2];if(0==e)break;++c;65536<=e?(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023)):d+=String.fromCharCode(e);}return d},Ib=(a,b,c)=>{c??=2147483647;if(4>c)return 0;var d=b;c=d+c-4;for(var e=0;e<a.length;++e){var h=a.charCodeAt(e);if(55296<=h&&57343>=h){var g=a.charCodeAt(++e);h=65536+((h&1023)<<10)|g&1023;}A[b>>2]=h;b+=4;if(b+4>c)break}A[b>>2]=0;return b-d},Jb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);55296<=
d&&57343>=d&&++c;b+=4;}return b},Kb=(a,b)=>{var c=H[a];if(void 0===c)throw a=`${b} has unknown type ${pb(a)}`,new M(a);return c},Lb=(a,b,c)=>{var d=[];a=a.toWireType(d,c);d.length&&(B[b>>2]=S(d));return a},Mb=[],Nb={},Ob=a=>{var b=Nb[a];return void 0===b?L(a):b},Pb=()=>"object"==typeof globalThis?globalThis:Function("return this")(),Qb=a=>{var b=Mb.length;Mb.push(a);return b},Rb=(a,b)=>{for(var c=Array(a),d=0;d<a;++d)c[d]=Kb(B[b+4*d>>2],"parameter "+d);return c},Sb={},Ub=()=>{if(!Tb){var a={USER:"web_user",
LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:("object"==typeof navigator&&navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8",_:da||"./this.program"},b;for(b in Sb)void 0===Sb[b]?delete a[b]:a[b]=Sb[b];var c=[];for(b in a)c.push(`${b}=${a[b]}`);Tb=c;}return Tb},Tb;I=n.InternalError=class extends Error{constructor(a){super(a);this.name="InternalError";}};for(var Vb=Array(256),Wb=0;256>Wb;++Wb)Vb[Wb]=String.fromCharCode(Wb);Ma=Vb;
M=n.BindingError=class extends Error{constructor(a){super(a);this.name="BindingError";}};
Object.assign(Xa.prototype,{isAliasOf:function(a){if(!(this instanceof Xa&&a instanceof Xa))return !1;var b=this.P.T.R,c=this.P.S;a.P=a.P;var d=a.P.T.R;for(a=a.P.S;b.W;)c=b.ea(c),b=b.W;for(;d.W;)a=d.ea(a),d=d.W;return b===d&&c===a},clone:function(){this.P.S||Pa(this);if(this.P.da)return this.P.count.value+=1,this;var a=Q,b=Object,c=b.create,d=Object.getPrototypeOf(this),e=this.P;a=a(c.call(b,d,{P:{value:{count:e.count,aa:e.aa,da:e.da,S:e.S,T:e.T,U:e.U,X:e.X}}}));a.P.count.value+=1;a.P.aa=!1;return a},
["delete"](){this.P.S||Pa(this);if(this.P.aa&&!this.P.da)throw new M("Object already scheduled for deletion");Ra(this);var a=this.P;--a.count.value;0===a.count.value&&(a.U?a.X.Z(a.U):a.T.R.Z(a.S));this.P.da||(this.P.U=void 0,this.P.S=void 0);},isDeleted:function(){return !this.P.S},deleteLater:function(){this.P.S||Pa(this);if(this.P.aa&&!this.P.da)throw new M("Object already scheduled for deletion");N.push(this);1===N.length&&O&&O(Ua);this.P.aa=!0;return this}});n.getInheritedInstanceCount=()=>Object.keys(P).length;
n.getLiveInheritedInstances=()=>{var a=[],b;for(b in P)P.hasOwnProperty(b)&&a.push(P[b]);return a};n.flushPendingDeletes=Ua;n.setDelayFunction=a=>{O=a;N.length&&O&&O(Ua);};
Object.assign(gb.prototype,{sa(a){this.na&&(a=this.na(a));return a},la(a){this.Z?.(a);},argPackAdvance:8,readValueFromPointer:E,fromWireType:function(a){function b(){return this.ha?Wa(this.R.ba,{T:this.ya,S:c,X:this,U:a}):Wa(this.R.ba,{T:this,S:a})}var c=this.sa(a);if(!c)return this.la(a),null;var d=Va(this.R,c);if(void 0!==d){if(0===d.P.count.value)return d.P.S=c,d.P.U=a,d.clone();d=d.clone();this.la(a);return d}d=this.R.ra(c);d=Ta[d];if(!d)return b.call(this);d=this.ga?d.oa:d.pointerType;var e=Sa(c,
this.R,d.R);return null===e?b.call(this):this.ha?Wa(d.R.ba,{T:d,S:e,X:this,U:a}):Wa(d.R.ba,{T:d,S:e})}});nb=n.UnboundTypeError=((a,b)=>{var c=R(b,function(d){this.name=b;this.message=d;d=Error(d).stack;void 0!==d&&(this.stack=this.toString()+"\n"+d.replace(/^Error(:[^\n]*)?\n/,""));});c.prototype=Object.create(a.prototype);c.prototype.constructor=c;c.prototype.toString=function(){return void 0===this.message?this.name:`${this.name}: ${this.message}`};return c})(Error,"UnboundTypeError");
V.push(0,1,void 0,1,null,1,!0,1,!1,1);n.count_emval_handles=()=>V.length/2-5-xb.length;
var Yb={l:(a,b,c)=>{var d=new Fa(a);B[d.S+16>>2]=0;B[d.S+4>>2]=b;B[d.S+8>>2]=c;Ga=a;throw Ga;},y:()=>{xa("");},F:a=>{var b=Ia[a];delete Ia[a];var c=b.ja,d=b.Z,e=b.ma,h=e.map(g=>g.va).concat(e.map(g=>g.Ca));K([a],h,g=>{var f={};e.forEach((l,m)=>{var k=g[m],r=l.ta,q=l.ua,w=g[m+e.length],u=l.Ba,t=l.Da;f[l.qa]={read:F=>k.fromWireType(r(q,F)),write:(F,X)=>{var z=[];u(t,F,w.toWireType(z,X));Ka(z);}};});return [{name:b.name,fromWireType:l=>{var m={},k;for(k in f)m[k]=f[k].read(l);d(l);return m},toWireType:(l,
m)=>{for(var k in f)if(!(k in m))throw new TypeError(`Missing field: "${k}"`);var r=c();for(k in f)f[k].write(r,m[k]);null!==l&&l.push(d,r);return r},argPackAdvance:8,readValueFromPointer:E,Y:d}]});},t:()=>{},A:(a,b,c,d)=>{b=L(b);J(a,{name:b,fromWireType:function(e){return !!e},toWireType:function(e,h){return h?c:d},argPackAdvance:8,readValueFromPointer:function(e){return this.fromWireType(x[e])},Y:null});},D:(a,b,c,d,e,h,g,f,l,m,k,r,q)=>{k=L(k);h=T(e,h);f&&=T(g,f);m&&=T(l,m);q=T(r,q);var w=$a(k);Za(w,
function(){qb(`Cannot construct ${k} due to unbound types`,[d]);});K([a,b,c],d?[d]:[],u=>{u=u[0];if(d){var t=u.R;var F=t.ba;}else F=Xa.prototype;u=R(k,function(...Ja){if(Object.getPrototypeOf(this)!==X)throw new M("Use 'new' to construct "+k);if(void 0===z.$)throw new M(k+" has no accessible constructor");var vb=z.$[Ja.length];if(void 0===vb)throw new M(`Tried to invoke ctor of ${k} with invalid number of parameters (${Ja.length}) - expected (${Object.keys(z.$).toString()}) parameters instead!`);return vb.apply(this,
Ja)});var X=Object.create(F,{constructor:{value:u}});u.prototype=X;var z=new ab(k,u,X,q,t,h,f,m);if(z.W){var Y;(Y=z.W).ka??(Y.ka=[]);z.W.ka.push(z);}t=new gb(k,z,!0,!1,!1);Y=new gb(k+"*",z,!1,!1,!1);F=new gb(k+" const*",z,!1,!0,!1);Ta[a]={pointerType:Y,oa:F};hb(w,u);return [t,Y,F]});},C:(a,b,c,d,e,h)=>{var g=rb(b,c);e=T(d,e);K([],[a],f=>{f=f[0];var l=`constructor ${f.name}`;void 0===f.R.$&&(f.R.$=[]);if(void 0!==f.R.$[b-1])throw new M(`Cannot register multiple constructors with identical number of parameters (${b-
1}) for class '${f.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);f.R.$[b-1]=()=>{qb(`Cannot construct ${f.name} due to unbound types`,g);};K([],g,m=>{m.splice(1,0,null);f.R.$[b-1]=ub(l,m,null,e,h);return []});return []});},d:(a,b,c,d,e,h,g,f,l)=>{var m=rb(c,d);b=L(b);b=wb(b);h=T(e,h);K([],[a],k=>{function r(){qb(`Cannot call ${q} due to unbound types`,m);}k=k[0];var q=`${k.name}.${b}`;b.startsWith("@@")&&(b=Symbol[b.substring(2)]);f&&k.R.za.push(b);
var w=k.R.ba,u=w[b];void 0===u||void 0===u.V&&u.className!==k.name&&u.fa===c-2?(r.fa=c-2,r.className=k.name,w[b]=r):(Ya(w,b,q),w[b].V[c-2]=r);K([],m,t=>{t=ub(q,t,k,h,g,l);void 0===w[b].V?(t.fa=c-2,w[b]=t):w[b].V[c-2]=t;return []});return []});},z:a=>J(a,zb),j:(a,b,c)=>{b=L(b);J(a,{name:b,fromWireType:d=>d,toWireType:(d,e)=>e,argPackAdvance:8,readValueFromPointer:Ab(b,c),Y:null});},E:(a,b,c,d,e,h,g)=>{var f=rb(b,c);a=L(a);a=wb(a);e=T(d,e);Za(a,function(){qb(`Cannot call ${a} due to unbound types`,f);},
b-1);K([],f,l=>{l=[l[0],null].concat(l.slice(1));hb(a,ub(a,l,null,e,h,g),b-1);return []});},c:(a,b,c,d,e)=>{b=L(b);-1===e&&(e=4294967295);e=f=>f;if(0===d){var h=32-8*c;e=f=>f<<h>>>h;}var g=b.includes("unsigned")?function(f,l){return l>>>0}:function(f,l){return l};J(a,{name:b,fromWireType:e,toWireType:g,argPackAdvance:8,readValueFromPointer:Bb(b,c,0!==d),Y:null});},a:(a,b,c)=>{function d(h){return new e(v.buffer,B[h+4>>2],B[h>>2])}var e=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,
Float32Array,Float64Array][b];c=L(c);J(a,{name:c,fromWireType:d,argPackAdvance:8,readValueFromPointer:d},{wa:!0});},o:a=>{J(a,zb);},k:(a,b)=>{b=L(b);var c="std::string"===b;J(a,{name:b,fromWireType:function(d){var e=B[d>>2],h=d+4;if(c)for(var g=h,f=0;f<=e;++f){var l=h+f;if(f==e||0==x[l]){if(g){var m=g;var k=x,r=m+(l-g);for(g=m;k[g]&&!(g>=r);)++g;if(16<g-m&&k.buffer&&Cb)m=Cb.decode(k.subarray(m,g));else {for(r="";m<g;){var q=k[m++];if(q&128){var w=k[m++]&63;if(192==(q&224))r+=String.fromCharCode((q&31)<<
6|w);else {var u=k[m++]&63;q=224==(q&240)?(q&15)<<12|w<<6|u:(q&7)<<18|w<<12|u<<6|k[m++]&63;65536>q?r+=String.fromCharCode(q):(q-=65536,r+=String.fromCharCode(55296|q>>10,56320|q&1023));}}else r+=String.fromCharCode(q);}m=r;}}else m="";if(void 0===t)var t=m;else t+=String.fromCharCode(0),t+=m;g=l+1;}}else {t=Array(e);for(f=0;f<e;++f)t[f]=String.fromCharCode(x[h+f]);t=t.join("");}U(d);return t},toWireType:function(d,e){e instanceof ArrayBuffer&&(e=new Uint8Array(e));var h,g="string"==typeof e;if(!(g||e instanceof
Uint8Array||e instanceof Uint8ClampedArray||e instanceof Int8Array))throw new M("Cannot pass non-string to std::string");var f;if(c&&g)for(h=f=0;h<e.length;++h){var l=e.charCodeAt(h);127>=l?f++:2047>=l?f+=2:55296<=l&&57343>=l?(f+=4,++h):f+=3;}else f=e.length;h=f;f=Xb(4+h+1);l=f+4;B[f>>2]=h;if(c&&g){if(g=l,l=h+1,h=x,0<l){l=g+l-1;for(var m=0;m<e.length;++m){var k=e.charCodeAt(m);if(55296<=k&&57343>=k){var r=e.charCodeAt(++m);k=65536+((k&1023)<<10)|r&1023;}if(127>=k){if(g>=l)break;h[g++]=k;}else {if(2047>=
k){if(g+1>=l)break;h[g++]=192|k>>6;}else {if(65535>=k){if(g+2>=l)break;h[g++]=224|k>>12;}else {if(g+3>=l)break;h[g++]=240|k>>18;h[g++]=128|k>>12&63;}h[g++]=128|k>>6&63;}h[g++]=128|k&63;}}h[g]=0;}}else if(g)for(g=0;g<h;++g){m=e.charCodeAt(g);if(255<m)throw U(l),new M("String has UTF-16 code units that do not fit in 8 bits");x[l+g]=m;}else for(g=0;g<h;++g)x[l+g]=e[g];null!==d&&d.push(U,f);return f},argPackAdvance:8,readValueFromPointer:E,Y(d){U(d);}});},f:(a,b,c)=>{c=L(c);if(2===b){var d=Eb;var e=Fb;var h=Gb;
var g=f=>pa[f>>1];}else 4===b&&(d=Hb,e=Ib,h=Jb,g=f=>B[f>>2]);J(a,{name:c,fromWireType:f=>{for(var l=B[f>>2],m,k=f+4,r=0;r<=l;++r){var q=f+4+r*b;if(r==l||0==g(q))k=d(k,q-k),void 0===m?m=k:(m+=String.fromCharCode(0),m+=k),k=q+b;}U(f);return m},toWireType:(f,l)=>{if("string"!=typeof l)throw new M(`Cannot pass non-string to C++ string type ${c}`);var m=h(l),k=Xb(4+m+b);B[k>>2]=m/b;e(l,k+4,m+b);null!==f&&f.push(U,k);return k},argPackAdvance:8,readValueFromPointer:E,Y(f){U(f);}});},G:(a,b,c,d,e,h)=>{Ia[a]=
{name:L(b),ja:T(c,d),Z:T(e,h),ma:[]};},p:(a,b,c,d,e,h,g,f,l,m)=>{Ia[a].ma.push({qa:L(b),va:c,ta:T(d,e),ua:h,Ca:g,Ba:T(f,l),Da:m});},B:(a,b)=>{b=L(b);J(a,{xa:!0,name:b,argPackAdvance:0,fromWireType:()=>{},toWireType:()=>{}});},x:(a,b,c)=>x.copyWithin(a,b,b+c),i:(a,b,c)=>{a=W(a);b=Kb(b,"emval::as");return Lb(b,c,a)},r:(a,b,c,d)=>{a=Mb[a];b=W(b);return a(null,b,c,d)},H:(a,b,c,d,e)=>{a=Mb[a];b=W(b);c=Ob(c);return a(b,b[c],d,e)},b:yb,s:a=>{if(0===a)return S(Pb());a=Ob(a);return S(Pb()[a])},g:(a,b,c)=>{b=
Rb(a,b);var d=b.shift();a--;var e="return function (obj, func, destructorsRef, args) {\n",h=0,g=[];0===c&&g.push("obj");for(var f=["retType"],l=[d],m=0;m<a;++m)g.push("arg"+m),f.push("argType"+m),l.push(b[m]),e+=`  var arg${m} = argType${m}.readValueFromPointer(args${h?"+"+h:""});\n`,h+=b[m].argPackAdvance;e+=`  var rv = ${1===c?"new func":"func.call"}(${g.join(", ")});\n`;d.xa||(f.push("emval_returnValue"),l.push(Lb),e+="  return emval_returnValue(retType, destructorsRef, rv);\n");f.push(e+"};\n");
a=tb(f)(...l);c=`methodCaller<(${b.map(k=>k.name).join(", ")}) => ${d.name}>`;return Qb(R(c,a))},I:a=>{a=Ob(a);return S(n[a])},m:(a,b)=>{a=W(a);b=W(b);return S(a[b])},h:a=>{9<a&&(V[a+1]+=1);},q:a=>S(Ob(a)),e:a=>{var b=W(a);Ka(b);yb(a);},n:(a,b)=>{a=Kb(a,"_emval_take_value");a=a.readValueFromPointer(b);return S(a)},w:()=>{xa("OOM");},u:(a,b)=>{var c=0;Ub().forEach((d,e)=>{var h=b+c;e=B[a+4*e>>2]=h;for(h=0;h<d.length;++h)v[e++]=d.charCodeAt(h);v[e]=0;c+=d.length+1;});return 0},v:(a,b)=>{var c=Ub();B[a>>
2]=c.length;var d=0;c.forEach(e=>d+=e.length+1);B[b>>2]=d;return 0}},Z=function(){function a(c){Z=c.exports;na=Z.J;c=na.buffer;n.HEAP8=v=new Int8Array(c);n.HEAP16=y=new Int16Array(c);n.HEAPU8=x=new Uint8Array(c);n.HEAPU16=pa=new Uint16Array(c);n.HEAP32=A=new Int32Array(c);n.HEAPU32=B=new Uint32Array(c);n.HEAPF32=qa=new Float32Array(c);n.HEAPF64=ra=new Float64Array(c);jb=Z.M;ta.unshift(Z.K);C--;n.monitorRunDependencies?.(C);0==C&&(D&&(c=D,D=null,c()));return Z}
var b={a:Yb};C++;n.monitorRunDependencies?.(C);if(n.instantiateWasm)try{return n.instantiateWasm(b,a)}catch(c){la(`Module.instantiateWasm callback failed with error: ${c}`),p(c);}za||=n.locateFile?ya("rsiscool.wasm")?"rsiscool.wasm":n.locateFile?n.locateFile("rsiscool.wasm",ea):ea+"rsiscool.wasm":(new URL("rsiscool.wasm",import.meta.url)).href;Da(b,function(c){a(c.instance);}).catch(p);return {}}(),ob=a=>(ob=Z.L)(a),Xb=a=>(Xb=Z.N)(a),U=a=>(U=Z.O)(a),Zb;D=function $b(){Zb||ac();Zb||(D=$b);};
function ac(){function a(){if(!Zb&&(Zb=!0,n.calledRun=!0,!oa)){Ea(ta);aa(n);if(n.onRuntimeInitialized)n.onRuntimeInitialized();if(n.postRun)for("function"==typeof n.postRun&&(n.postRun=[n.postRun]);n.postRun.length;){var b=n.postRun.shift();ua.unshift(b);}Ea(ua);}}if(!(0<C)){if(n.preRun)for("function"==typeof n.preRun&&(n.preRun=[n.preRun]);n.preRun.length;)va();Ea(sa);0<C||(n.setStatus?(n.setStatus("Running..."),setTimeout(function(){setTimeout(function(){n.setStatus("");},1);a();},1)):a());}}
if(n.preInit)for("function"==typeof n.preInit&&(n.preInit=[n.preInit]);0<n.preInit.length;)n.preInit.pop()();ac();moduleRtn=ba;


  return moduleRtn;
}
);
})();

let wasmModule;
async function initWASM() {
    wasmModule = await rsiscool();
}
if (!wasmModule)
    await initWASM();
function decodeWASM(bytes, twoS) {
    if (!wasmModule) {
        throw new Error("decodeWASM not yet initialized");
    }
    return wasmModule["decodeWASM"](bytes, twoS);
}

const VERSIONS = [
    {
        infoBits: null,
        versionNumber: 1,
        alignmentPatternCenters: [],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 7,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 19 }],
            },
            {
                ecCodewordsPerBlock: 10,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 16 }],
            },
            {
                ecCodewordsPerBlock: 13,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 13 }],
            },
            {
                ecCodewordsPerBlock: 17,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 9 }],
            },
        ],
    },
    {
        infoBits: null,
        versionNumber: 2,
        alignmentPatternCenters: [6, 18],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 10,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 34 }],
            },
            {
                ecCodewordsPerBlock: 16,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 28 }],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 22 }],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 16 }],
            },
        ],
    },
    {
        infoBits: null,
        versionNumber: 3,
        alignmentPatternCenters: [6, 22],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 15,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 55 }],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 44 }],
            },
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 17 }],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 13 }],
            },
        ],
    },
    {
        infoBits: null,
        versionNumber: 4,
        alignmentPatternCenters: [6, 26],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 20,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 80 }],
            },
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 32 }],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 24 }],
            },
            {
                ecCodewordsPerBlock: 16,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 9 }],
            },
        ],
    },
    {
        infoBits: null,
        versionNumber: 5,
        alignmentPatternCenters: [6, 30],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [{ numBlocks: 1, dataCodewordsPerBlock: 108 }],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 43 }],
            },
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 15 },
                    { numBlocks: 2, dataCodewordsPerBlock: 16 },
                ],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 11 },
                    { numBlocks: 2, dataCodewordsPerBlock: 12 },
                ],
            },
        ],
    },
    {
        infoBits: null,
        versionNumber: 6,
        alignmentPatternCenters: [6, 34],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 68 }],
            },
            {
                ecCodewordsPerBlock: 16,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 27 }],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 19 }],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 15 }],
            },
        ],
    },
    {
        infoBits: 0x07C94,
        versionNumber: 7,
        alignmentPatternCenters: [6, 22, 38],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 20,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 78 }],
            },
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 31 }],
            },
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 14 },
                    { numBlocks: 4, dataCodewordsPerBlock: 15 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 13 },
                    { numBlocks: 1, dataCodewordsPerBlock: 14 },
                ],
            },
        ],
    },
    {
        infoBits: 0x085BC,
        versionNumber: 8,
        alignmentPatternCenters: [6, 24, 42],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 97 }],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 38 },
                    { numBlocks: 2, dataCodewordsPerBlock: 39 },
                ],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 18 },
                    { numBlocks: 2, dataCodewordsPerBlock: 19 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 14 },
                    { numBlocks: 2, dataCodewordsPerBlock: 15 },
                ],
            },
        ],
    },
    {
        infoBits: 0x09A99,
        versionNumber: 9,
        alignmentPatternCenters: [6, 26, 46],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [{ numBlocks: 2, dataCodewordsPerBlock: 116 }],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 36 },
                    { numBlocks: 2, dataCodewordsPerBlock: 37 },
                ],
            },
            {
                ecCodewordsPerBlock: 20,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 16 },
                    { numBlocks: 4, dataCodewordsPerBlock: 17 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 12 },
                    { numBlocks: 4, dataCodewordsPerBlock: 13 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0A4D3,
        versionNumber: 10,
        alignmentPatternCenters: [6, 28, 50],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 18,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 68 },
                    { numBlocks: 2, dataCodewordsPerBlock: 69 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 43 },
                    { numBlocks: 1, dataCodewordsPerBlock: 44 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 19 },
                    { numBlocks: 2, dataCodewordsPerBlock: 20 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 15 },
                    { numBlocks: 2, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0BBF6,
        versionNumber: 11,
        alignmentPatternCenters: [6, 30, 54],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 20,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 81 }],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 1, dataCodewordsPerBlock: 50 },
                    { numBlocks: 4, dataCodewordsPerBlock: 51 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 22 },
                    { numBlocks: 4, dataCodewordsPerBlock: 23 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 12 },
                    { numBlocks: 8, dataCodewordsPerBlock: 13 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0C762,
        versionNumber: 12,
        alignmentPatternCenters: [6, 32, 58],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 92 },
                    { numBlocks: 2, dataCodewordsPerBlock: 93 },
                ],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 36 },
                    { numBlocks: 2, dataCodewordsPerBlock: 37 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 20 },
                    { numBlocks: 6, dataCodewordsPerBlock: 21 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 7, dataCodewordsPerBlock: 14 },
                    { numBlocks: 4, dataCodewordsPerBlock: 15 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0D847,
        versionNumber: 13,
        alignmentPatternCenters: [6, 34, 62],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [{ numBlocks: 4, dataCodewordsPerBlock: 107 }],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 37 },
                    { numBlocks: 1, dataCodewordsPerBlock: 38 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 20 },
                    { numBlocks: 4, dataCodewordsPerBlock: 21 },
                ],
            },
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 12, dataCodewordsPerBlock: 11 },
                    { numBlocks: 4, dataCodewordsPerBlock: 12 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0E60D,
        versionNumber: 14,
        alignmentPatternCenters: [6, 26, 46, 66],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 115 },
                    { numBlocks: 1, dataCodewordsPerBlock: 116 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 40 },
                    { numBlocks: 5, dataCodewordsPerBlock: 41 },
                ],
            },
            {
                ecCodewordsPerBlock: 20,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 16 },
                    { numBlocks: 5, dataCodewordsPerBlock: 17 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 12 },
                    { numBlocks: 5, dataCodewordsPerBlock: 13 },
                ],
            },
        ],
    },
    {
        infoBits: 0x0F928,
        versionNumber: 15,
        alignmentPatternCenters: [6, 26, 48, 70],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 22,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 87 },
                    { numBlocks: 1, dataCodewordsPerBlock: 88 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 41 },
                    { numBlocks: 5, dataCodewordsPerBlock: 42 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 24 },
                    { numBlocks: 7, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 12 },
                    { numBlocks: 7, dataCodewordsPerBlock: 13 },
                ],
            },
        ],
    },
    {
        infoBits: 0x10B78,
        versionNumber: 16,
        alignmentPatternCenters: [6, 26, 50, 74],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 98 },
                    { numBlocks: 1, dataCodewordsPerBlock: 99 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 7, dataCodewordsPerBlock: 45 },
                    { numBlocks: 3, dataCodewordsPerBlock: 46 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [
                    { numBlocks: 15, dataCodewordsPerBlock: 19 },
                    { numBlocks: 2, dataCodewordsPerBlock: 20 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 15 },
                    { numBlocks: 13, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1145D,
        versionNumber: 17,
        alignmentPatternCenters: [6, 30, 54, 78],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 1, dataCodewordsPerBlock: 107 },
                    { numBlocks: 5, dataCodewordsPerBlock: 108 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 10, dataCodewordsPerBlock: 46 },
                    { numBlocks: 1, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 1, dataCodewordsPerBlock: 22 },
                    { numBlocks: 15, dataCodewordsPerBlock: 23 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 14 },
                    { numBlocks: 17, dataCodewordsPerBlock: 15 },
                ],
            },
        ],
    },
    {
        infoBits: 0x12A17,
        versionNumber: 18,
        alignmentPatternCenters: [6, 30, 56, 82],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 120 },
                    { numBlocks: 1, dataCodewordsPerBlock: 121 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 9, dataCodewordsPerBlock: 43 },
                    { numBlocks: 4, dataCodewordsPerBlock: 44 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 17, dataCodewordsPerBlock: 22 },
                    { numBlocks: 1, dataCodewordsPerBlock: 23 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 14 },
                    { numBlocks: 19, dataCodewordsPerBlock: 15 },
                ],
            },
        ],
    },
    {
        infoBits: 0x13532,
        versionNumber: 19,
        alignmentPatternCenters: [6, 30, 58, 86],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 113 },
                    { numBlocks: 4, dataCodewordsPerBlock: 114 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 44 },
                    { numBlocks: 11, dataCodewordsPerBlock: 45 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 17, dataCodewordsPerBlock: 21 },
                    { numBlocks: 4, dataCodewordsPerBlock: 22 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 9, dataCodewordsPerBlock: 13 },
                    { numBlocks: 16, dataCodewordsPerBlock: 14 },
                ],
            },
        ],
    },
    {
        infoBits: 0x149A6,
        versionNumber: 20,
        alignmentPatternCenters: [6, 34, 62, 90],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 107 },
                    { numBlocks: 5, dataCodewordsPerBlock: 108 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 41 },
                    { numBlocks: 13, dataCodewordsPerBlock: 42 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 15, dataCodewordsPerBlock: 24 },
                    { numBlocks: 5, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 15, dataCodewordsPerBlock: 15 },
                    { numBlocks: 10, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x15683,
        versionNumber: 21,
        alignmentPatternCenters: [6, 28, 50, 72, 94],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 116 },
                    { numBlocks: 4, dataCodewordsPerBlock: 117 },
                ],
            },
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 42 }],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 17, dataCodewordsPerBlock: 22 },
                    { numBlocks: 6, dataCodewordsPerBlock: 23 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 16 },
                    { numBlocks: 6, dataCodewordsPerBlock: 17 },
                ],
            },
        ],
    },
    {
        infoBits: 0x168C9,
        versionNumber: 22,
        alignmentPatternCenters: [6, 26, 50, 74, 98],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 111 },
                    { numBlocks: 7, dataCodewordsPerBlock: 112 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 46 }],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 7, dataCodewordsPerBlock: 24 },
                    { numBlocks: 16, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 24,
                ecBlocks: [{ numBlocks: 34, dataCodewordsPerBlock: 13 }],
            },
        ],
    },
    {
        infoBits: 0x177EC,
        versionNumber: 23,
        alignmentPatternCenters: [6, 30, 54, 74, 102],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 121 },
                    { numBlocks: 5, dataCodewordsPerBlock: 122 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 47 },
                    { numBlocks: 14, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 24 },
                    { numBlocks: 14, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 16, dataCodewordsPerBlock: 15 },
                    { numBlocks: 14, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x18EC4,
        versionNumber: 24,
        alignmentPatternCenters: [6, 28, 54, 80, 106],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 117 },
                    { numBlocks: 4, dataCodewordsPerBlock: 118 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 45 },
                    { numBlocks: 14, dataCodewordsPerBlock: 46 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 24 },
                    { numBlocks: 16, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 30, dataCodewordsPerBlock: 16 },
                    { numBlocks: 2, dataCodewordsPerBlock: 17 },
                ],
            },
        ],
    },
    {
        infoBits: 0x191E1,
        versionNumber: 25,
        alignmentPatternCenters: [6, 32, 58, 84, 110],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 26,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 106 },
                    { numBlocks: 4, dataCodewordsPerBlock: 107 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 47 },
                    { numBlocks: 13, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 7, dataCodewordsPerBlock: 24 },
                    { numBlocks: 22, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 22, dataCodewordsPerBlock: 15 },
                    { numBlocks: 13, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1AFAB,
        versionNumber: 26,
        alignmentPatternCenters: [6, 30, 58, 86, 114],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 10, dataCodewordsPerBlock: 114 },
                    { numBlocks: 2, dataCodewordsPerBlock: 115 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 46 },
                    { numBlocks: 4, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 28, dataCodewordsPerBlock: 22 },
                    { numBlocks: 6, dataCodewordsPerBlock: 23 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 33, dataCodewordsPerBlock: 16 },
                    { numBlocks: 4, dataCodewordsPerBlock: 17 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1B08E,
        versionNumber: 27,
        alignmentPatternCenters: [6, 34, 62, 90, 118],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 122 },
                    { numBlocks: 4, dataCodewordsPerBlock: 123 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 22, dataCodewordsPerBlock: 45 },
                    { numBlocks: 3, dataCodewordsPerBlock: 46 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 8, dataCodewordsPerBlock: 23 },
                    { numBlocks: 26, dataCodewordsPerBlock: 24 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 12, dataCodewordsPerBlock: 15 },
                    { numBlocks: 28, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1CC1A,
        versionNumber: 28,
        alignmentPatternCenters: [6, 26, 50, 74, 98, 122],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 117 },
                    { numBlocks: 10, dataCodewordsPerBlock: 118 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 3, dataCodewordsPerBlock: 45 },
                    { numBlocks: 23, dataCodewordsPerBlock: 46 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 24 },
                    { numBlocks: 31, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 15 },
                    { numBlocks: 31, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1D33F,
        versionNumber: 29,
        alignmentPatternCenters: [6, 30, 54, 78, 102, 126],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 7, dataCodewordsPerBlock: 116 },
                    { numBlocks: 7, dataCodewordsPerBlock: 117 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 21, dataCodewordsPerBlock: 45 },
                    { numBlocks: 7, dataCodewordsPerBlock: 46 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 1, dataCodewordsPerBlock: 23 },
                    { numBlocks: 37, dataCodewordsPerBlock: 24 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 15 },
                    { numBlocks: 26, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1ED75,
        versionNumber: 30,
        alignmentPatternCenters: [6, 26, 52, 78, 104, 130],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 5, dataCodewordsPerBlock: 115 },
                    { numBlocks: 10, dataCodewordsPerBlock: 116 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 47 },
                    { numBlocks: 10, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 15, dataCodewordsPerBlock: 24 },
                    { numBlocks: 25, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 23, dataCodewordsPerBlock: 15 },
                    { numBlocks: 25, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x1F250,
        versionNumber: 31,
        alignmentPatternCenters: [6, 30, 56, 82, 108, 134],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 13, dataCodewordsPerBlock: 115 },
                    { numBlocks: 3, dataCodewordsPerBlock: 116 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 46 },
                    { numBlocks: 29, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 42, dataCodewordsPerBlock: 24 },
                    { numBlocks: 1, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 23, dataCodewordsPerBlock: 15 },
                    { numBlocks: 28, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x209D5,
        versionNumber: 32,
        alignmentPatternCenters: [6, 34, 60, 86, 112, 138],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [{ numBlocks: 17, dataCodewordsPerBlock: 115 }],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 10, dataCodewordsPerBlock: 46 },
                    { numBlocks: 23, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 10, dataCodewordsPerBlock: 24 },
                    { numBlocks: 35, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 15 },
                    { numBlocks: 35, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x216F0,
        versionNumber: 33,
        alignmentPatternCenters: [6, 30, 58, 86, 114, 142],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 17, dataCodewordsPerBlock: 115 },
                    { numBlocks: 1, dataCodewordsPerBlock: 116 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 14, dataCodewordsPerBlock: 46 },
                    { numBlocks: 21, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 29, dataCodewordsPerBlock: 24 },
                    { numBlocks: 19, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 11, dataCodewordsPerBlock: 15 },
                    { numBlocks: 46, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x228BA,
        versionNumber: 34,
        alignmentPatternCenters: [6, 34, 62, 90, 118, 146],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 13, dataCodewordsPerBlock: 115 },
                    { numBlocks: 6, dataCodewordsPerBlock: 116 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 14, dataCodewordsPerBlock: 46 },
                    { numBlocks: 23, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 44, dataCodewordsPerBlock: 24 },
                    { numBlocks: 7, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 59, dataCodewordsPerBlock: 16 },
                    { numBlocks: 1, dataCodewordsPerBlock: 17 },
                ],
            },
        ],
    },
    {
        infoBits: 0x2379F,
        versionNumber: 35,
        alignmentPatternCenters: [6, 30, 54, 78, 102, 126, 150],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 12, dataCodewordsPerBlock: 121 },
                    { numBlocks: 7, dataCodewordsPerBlock: 122 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 12, dataCodewordsPerBlock: 47 },
                    { numBlocks: 26, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 39, dataCodewordsPerBlock: 24 },
                    { numBlocks: 14, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 22, dataCodewordsPerBlock: 15 },
                    { numBlocks: 41, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x24B0B,
        versionNumber: 36,
        alignmentPatternCenters: [6, 24, 50, 76, 102, 128, 154],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 121 },
                    { numBlocks: 14, dataCodewordsPerBlock: 122 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 6, dataCodewordsPerBlock: 47 },
                    { numBlocks: 34, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 46, dataCodewordsPerBlock: 24 },
                    { numBlocks: 10, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 2, dataCodewordsPerBlock: 15 },
                    { numBlocks: 64, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x2542E,
        versionNumber: 37,
        alignmentPatternCenters: [6, 28, 54, 80, 106, 132, 158],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 17, dataCodewordsPerBlock: 122 },
                    { numBlocks: 4, dataCodewordsPerBlock: 123 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 29, dataCodewordsPerBlock: 46 },
                    { numBlocks: 14, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 49, dataCodewordsPerBlock: 24 },
                    { numBlocks: 10, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 24, dataCodewordsPerBlock: 15 },
                    { numBlocks: 46, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x26A64,
        versionNumber: 38,
        alignmentPatternCenters: [6, 32, 58, 84, 110, 136, 162],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 4, dataCodewordsPerBlock: 122 },
                    { numBlocks: 18, dataCodewordsPerBlock: 123 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 13, dataCodewordsPerBlock: 46 },
                    { numBlocks: 32, dataCodewordsPerBlock: 47 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 48, dataCodewordsPerBlock: 24 },
                    { numBlocks: 14, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 42, dataCodewordsPerBlock: 15 },
                    { numBlocks: 32, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x27541,
        versionNumber: 39,
        alignmentPatternCenters: [6, 26, 54, 82, 110, 138, 166],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 20, dataCodewordsPerBlock: 117 },
                    { numBlocks: 4, dataCodewordsPerBlock: 118 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 40, dataCodewordsPerBlock: 47 },
                    { numBlocks: 7, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 43, dataCodewordsPerBlock: 24 },
                    { numBlocks: 22, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 10, dataCodewordsPerBlock: 15 },
                    { numBlocks: 67, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
    {
        infoBits: 0x28C69,
        versionNumber: 40,
        alignmentPatternCenters: [6, 30, 58, 86, 114, 142, 170],
        errorCorrectionLevels: [
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 19, dataCodewordsPerBlock: 118 },
                    { numBlocks: 6, dataCodewordsPerBlock: 119 },
                ],
            },
            {
                ecCodewordsPerBlock: 28,
                ecBlocks: [
                    { numBlocks: 18, dataCodewordsPerBlock: 47 },
                    { numBlocks: 31, dataCodewordsPerBlock: 48 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 34, dataCodewordsPerBlock: 24 },
                    { numBlocks: 34, dataCodewordsPerBlock: 25 },
                ],
            },
            {
                ecCodewordsPerBlock: 30,
                ecBlocks: [
                    { numBlocks: 20, dataCodewordsPerBlock: 15 },
                    { numBlocks: 61, dataCodewordsPerBlock: 16 },
                ],
            },
        ],
    },
];

// tslint:disable:no-bitwise
function numBitsDiffering(x, y) {
    let z = x ^ y;
    let bitCount = 0;
    while (z) {
        bitCount++;
        z &= z - 1;
    }
    return bitCount;
}
function pushBit(bit, byte) {
    return (byte << 1) | bit;
}
// tslint:enable:no-bitwise
const FORMAT_INFO_TABLE = [
    { bits: 0x5412, formatInfo: { errorCorrectionLevel: 1, dataMask: 0 } },
    { bits: 0x5125, formatInfo: { errorCorrectionLevel: 1, dataMask: 1 } },
    { bits: 0x5E7C, formatInfo: { errorCorrectionLevel: 1, dataMask: 2 } },
    { bits: 0x5B4B, formatInfo: { errorCorrectionLevel: 1, dataMask: 3 } },
    { bits: 0x45F9, formatInfo: { errorCorrectionLevel: 1, dataMask: 4 } },
    { bits: 0x40CE, formatInfo: { errorCorrectionLevel: 1, dataMask: 5 } },
    { bits: 0x4F97, formatInfo: { errorCorrectionLevel: 1, dataMask: 6 } },
    { bits: 0x4AA0, formatInfo: { errorCorrectionLevel: 1, dataMask: 7 } },
    { bits: 0x77C4, formatInfo: { errorCorrectionLevel: 0, dataMask: 0 } },
    { bits: 0x72F3, formatInfo: { errorCorrectionLevel: 0, dataMask: 1 } },
    { bits: 0x7DAA, formatInfo: { errorCorrectionLevel: 0, dataMask: 2 } },
    { bits: 0x789D, formatInfo: { errorCorrectionLevel: 0, dataMask: 3 } },
    { bits: 0x662F, formatInfo: { errorCorrectionLevel: 0, dataMask: 4 } },
    { bits: 0x6318, formatInfo: { errorCorrectionLevel: 0, dataMask: 5 } },
    { bits: 0x6C41, formatInfo: { errorCorrectionLevel: 0, dataMask: 6 } },
    { bits: 0x6976, formatInfo: { errorCorrectionLevel: 0, dataMask: 7 } },
    { bits: 0x1689, formatInfo: { errorCorrectionLevel: 3, dataMask: 0 } },
    { bits: 0x13BE, formatInfo: { errorCorrectionLevel: 3, dataMask: 1 } },
    { bits: 0x1CE7, formatInfo: { errorCorrectionLevel: 3, dataMask: 2 } },
    { bits: 0x19D0, formatInfo: { errorCorrectionLevel: 3, dataMask: 3 } },
    { bits: 0x0762, formatInfo: { errorCorrectionLevel: 3, dataMask: 4 } },
    { bits: 0x0255, formatInfo: { errorCorrectionLevel: 3, dataMask: 5 } },
    { bits: 0x0D0C, formatInfo: { errorCorrectionLevel: 3, dataMask: 6 } },
    { bits: 0x083B, formatInfo: { errorCorrectionLevel: 3, dataMask: 7 } },
    { bits: 0x355F, formatInfo: { errorCorrectionLevel: 2, dataMask: 0 } },
    { bits: 0x3068, formatInfo: { errorCorrectionLevel: 2, dataMask: 1 } },
    { bits: 0x3F31, formatInfo: { errorCorrectionLevel: 2, dataMask: 2 } },
    { bits: 0x3A06, formatInfo: { errorCorrectionLevel: 2, dataMask: 3 } },
    { bits: 0x24B4, formatInfo: { errorCorrectionLevel: 2, dataMask: 4 } },
    { bits: 0x2183, formatInfo: { errorCorrectionLevel: 2, dataMask: 5 } },
    { bits: 0x2EDA, formatInfo: { errorCorrectionLevel: 2, dataMask: 6 } },
    { bits: 0x2BED, formatInfo: { errorCorrectionLevel: 2, dataMask: 7 } },
];
const DATA_MASKS = [
    (p) => ((p.y + p.x) % 2) === 0,
    (p) => (p.y % 2) === 0,
    (p) => p.x % 3 === 0,
    (p) => (p.y + p.x) % 3 === 0,
    (p) => (Math.floor(p.y / 2) + Math.floor(p.x / 3)) % 2 === 0,
    (p) => ((p.x * p.y) % 2) + ((p.x * p.y) % 3) === 0,
    (p) => ((((p.y * p.x) % 2) + (p.y * p.x) % 3) % 2) === 0,
    (p) => ((((p.y + p.x) % 2) + (p.y * p.x) % 3) % 2) === 0,
];
function buildFunctionPatternMask(version) {
    const dimension = 17 + 4 * version.versionNumber;
    const matrix = BitMatrix.createEmpty(dimension, dimension);
    matrix.setRegion(0, 0, 9, 9, true); // Top left finder pattern + separator + format
    matrix.setRegion(dimension - 8, 0, 8, 9, true); // Top right finder pattern + separator + format
    matrix.setRegion(0, dimension - 8, 9, 8, true); // Bottom left finder pattern + separator + format
    // Alignment patterns
    for (const x of version.alignmentPatternCenters) {
        for (const y of version.alignmentPatternCenters) {
            if (!(x === 6 && y === 6 || x === 6 && y === dimension - 7 || x === dimension - 7 && y === 6)) {
                matrix.setRegion(x - 2, y - 2, 5, 5, true);
            }
        }
    }
    matrix.setRegion(6, 9, 1, dimension - 17, true); // Vertical timing pattern
    matrix.setRegion(9, 6, dimension - 17, 1, true); // Horizontal timing pattern
    if (version.versionNumber > 6) {
        matrix.setRegion(dimension - 11, 0, 3, 6, true); // Version info, top right
        matrix.setRegion(0, dimension - 11, 6, 3, true); // Version info, bottom left
    }
    return matrix;
}
function readCodewords(matrix, version, formatInfo) {
    const dataMask = DATA_MASKS[formatInfo.dataMask];
    const dimension = matrix.height;
    const functionPatternMask = buildFunctionPatternMask(version);
    const codewords = [];
    let currentByte = 0;
    let bitsRead = 0;
    // Read columns in pairs, from right to left
    let readingUp = true;
    for (let columnIndex = dimension - 1; columnIndex > 0; columnIndex -= 2) {
        if (columnIndex === 6) { // Skip whole column with vertical alignment pattern;
            columnIndex--;
        }
        for (let i = 0; i < dimension; i++) {
            const y = readingUp ? dimension - 1 - i : i;
            for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
                const x = columnIndex - columnOffset;
                if (!functionPatternMask.get(x, y)) {
                    bitsRead++;
                    let bit = matrix.get(x, y);
                    if (dataMask({ y, x })) {
                        bit = !bit;
                    }
                    currentByte = pushBit(bit, currentByte);
                    if (bitsRead === 8) { // Whole bytes
                        codewords.push(currentByte);
                        bitsRead = 0;
                        currentByte = 0;
                    }
                }
            }
        }
        readingUp = !readingUp;
    }
    return codewords;
}
function readVersion(matrix) {
    const dimension = matrix.height;
    const provisionalVersion = Math.floor((dimension - 17) / 4);
    if (provisionalVersion <= 6) { // 6 and under dont have version info in the QR code
        return VERSIONS[provisionalVersion - 1];
    }
    let topRightVersionBits = 0;
    for (let y = 5; y >= 0; y--) {
        for (let x = dimension - 9; x >= dimension - 11; x--) {
            topRightVersionBits = pushBit(matrix.get(x, y), topRightVersionBits);
        }
    }
    let bottomLeftVersionBits = 0;
    for (let x = 5; x >= 0; x--) {
        for (let y = dimension - 9; y >= dimension - 11; y--) {
            bottomLeftVersionBits = pushBit(matrix.get(x, y), bottomLeftVersionBits);
        }
    }
    let bestDifference = Infinity;
    let bestVersion;
    for (const version of VERSIONS) {
        if (version.infoBits === topRightVersionBits || version.infoBits === bottomLeftVersionBits) {
            return version;
        }
        let difference = numBitsDiffering(topRightVersionBits, version.infoBits);
        if (difference < bestDifference) {
            bestVersion = version;
            bestDifference = difference;
        }
        difference = numBitsDiffering(bottomLeftVersionBits, version.infoBits);
        if (difference < bestDifference) {
            bestVersion = version;
            bestDifference = difference;
        }
    }
    // We can tolerate up to 3 bits of error since no two version info codewords will
    // differ in less than 8 bits.
    if (bestDifference <= 3) {
        return bestVersion;
    }
}
function readFormatInformation(matrix) {
    let topLeftFormatInfoBits = 0;
    for (let x = 0; x <= 8; x++) {
        if (x !== 6) { // Skip timing pattern bit
            topLeftFormatInfoBits = pushBit(matrix.get(x, 8), topLeftFormatInfoBits);
        }
    }
    for (let y = 7; y >= 0; y--) {
        if (y !== 6) { // Skip timing pattern bit
            topLeftFormatInfoBits = pushBit(matrix.get(8, y), topLeftFormatInfoBits);
        }
    }
    const dimension = matrix.height;
    let topRightBottomRightFormatInfoBits = 0;
    for (let y = dimension - 1; y >= dimension - 7; y--) { // bottom left
        topRightBottomRightFormatInfoBits = pushBit(matrix.get(8, y), topRightBottomRightFormatInfoBits);
    }
    for (let x = dimension - 8; x < dimension; x++) { // top right
        topRightBottomRightFormatInfoBits = pushBit(matrix.get(x, 8), topRightBottomRightFormatInfoBits);
    }
    let bestDifference = Infinity;
    let bestFormatInfo = null;
    for (const { bits, formatInfo } of FORMAT_INFO_TABLE) {
        if (bits === topLeftFormatInfoBits || bits === topRightBottomRightFormatInfoBits) {
            return formatInfo;
        }
        let difference = numBitsDiffering(topLeftFormatInfoBits, bits);
        if (difference < bestDifference) {
            bestFormatInfo = formatInfo;
            bestDifference = difference;
        }
        if (topLeftFormatInfoBits !== topRightBottomRightFormatInfoBits) { // also try the other option
            difference = numBitsDiffering(topRightBottomRightFormatInfoBits, bits);
            if (difference < bestDifference) {
                bestFormatInfo = formatInfo;
                bestDifference = difference;
            }
        }
    }
    // Hamming distance of the 32 masked codes is 7, by construction, so <= 3 bits differing means we found a match
    if (bestDifference <= 3) {
        return bestFormatInfo;
    }
    return null;
}
function getDataBlocks(codewords, version, ecLevel) {
    const ecInfo = version.errorCorrectionLevels[ecLevel];
    const dataBlocks = [];
    let totalCodewords = 0;
    ecInfo.ecBlocks.forEach(block => {
        for (let i = 0; i < block.numBlocks; i++) {
            dataBlocks.push({ numDataCodewords: block.dataCodewordsPerBlock, codewords: [] });
            totalCodewords += block.dataCodewordsPerBlock + ecInfo.ecCodewordsPerBlock;
        }
    });
    // In some cases the QR code will be malformed enough that we pull off more or less than we should.
    // If we pull off less there's nothing we can do.
    // If we pull off more we can safely truncate
    if (codewords.length < totalCodewords) {
        return null;
    }
    codewords = codewords.slice(0, totalCodewords);
    const shortBlockSize = ecInfo.ecBlocks[0].dataCodewordsPerBlock;
    // Pull codewords to fill the blocks up to the minimum size
    for (let i = 0; i < shortBlockSize; i++) {
        for (const dataBlock of dataBlocks) {
            dataBlock.codewords.push(codewords.shift());
        }
    }
    // If there are any large blocks, pull codewords to fill the last element of those
    if (ecInfo.ecBlocks.length > 1) {
        const smallBlockCount = ecInfo.ecBlocks[0].numBlocks;
        const largeBlockCount = ecInfo.ecBlocks[1].numBlocks;
        for (let i = 0; i < largeBlockCount; i++) {
            dataBlocks[smallBlockCount + i].codewords.push(codewords.shift());
        }
    }
    // Add the rest of the codewords to the blocks. These are the error correction codewords.
    while (codewords.length > 0) {
        for (const dataBlock of dataBlocks) {
            dataBlock.codewords.push(codewords.shift());
        }
    }
    return dataBlocks;
}
function decodeMatrix(matrix) {
    const version = readVersion(matrix);
    if (!version) {
        return null;
    }
    const formatInfo = readFormatInformation(matrix);
    if (!formatInfo) {
        return null;
    }
    const codewords = readCodewords(matrix, version, formatInfo);
    const dataBlocks = getDataBlocks(codewords, version, formatInfo.errorCorrectionLevel);
    if (!dataBlocks) {
        return null;
    }
    // Count total number of data bytes
    const totalBytes = dataBlocks.reduce((a, b) => a + b.numDataCodewords, 0);
    const resultBytes = new Uint8ClampedArray(totalBytes);
    let resultIndex = 0;
    for (const dataBlock of dataBlocks) {
        const decodeRes = decodeWASM(dataBlock.codewords, dataBlock.codewords.length - dataBlock.numDataCodewords);
        decodeRes["errors"];
        const bytesCorrected = decodeRes["bytesCorrected"];
        if (!bytesCorrected) {
            return null;
        }
        // console.error(errors);
        for (let i = 0; i < dataBlock.numDataCodewords; i++) {
            resultBytes[resultIndex++] = bytesCorrected["get"](i);
        }
    }
    try {
        return decode$1(resultBytes, version.versionNumber);
    }
    catch (_a) {
        return null;
    }
}
function decode(matrix) {
    if (matrix == null) {
        return null;
    }
    const result = decodeMatrix(matrix);
    if (result) {
        return result;
    }
    // Decoding didn't work, try mirroring the QR across the topLeft -> bottomRight line.
    for (let x = 0; x < matrix.width; x++) {
        for (let y = x + 1; y < matrix.height; y++) {
            if (matrix.get(x, y) !== matrix.get(y, x)) {
                matrix.set(x, y, !matrix.get(x, y));
                matrix.set(y, x, !matrix.get(y, x));
            }
        }
    }
    return decodeMatrix(matrix);
}

function squareToQuadrilateral(p1, p2, p3, p4) {
    const dx3 = p1.x - p2.x + p3.x - p4.x;
    const dy3 = p1.y - p2.y + p3.y - p4.y;
    if (dx3 === 0 && dy3 === 0) { // Affine
        return {
            a11: p2.x - p1.x,
            a12: p2.y - p1.y,
            a13: 0,
            a21: p3.x - p2.x,
            a22: p3.y - p2.y,
            a23: 0,
            a31: p1.x,
            a32: p1.y,
            a33: 1,
        };
    }
    else {
        const dx1 = p2.x - p3.x;
        const dx2 = p4.x - p3.x;
        const dy1 = p2.y - p3.y;
        const dy2 = p4.y - p3.y;
        const denominator = dx1 * dy2 - dx2 * dy1;
        const a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
        const a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
        return {
            a11: p2.x - p1.x + a13 * p2.x,
            a12: p2.y - p1.y + a13 * p2.y,
            a13,
            a21: p4.x - p1.x + a23 * p4.x,
            a22: p4.y - p1.y + a23 * p4.y,
            a23,
            a31: p1.x,
            a32: p1.y,
            a33: 1,
        };
    }
}
function quadrilateralToSquare(p1, p2, p3, p4) {
    // Here, the adjoint serves as the inverse:
    const sToQ = squareToQuadrilateral(p1, p2, p3, p4);
    return {
        a11: sToQ.a22 * sToQ.a33 - sToQ.a23 * sToQ.a32,
        a12: sToQ.a13 * sToQ.a32 - sToQ.a12 * sToQ.a33,
        a13: sToQ.a12 * sToQ.a23 - sToQ.a13 * sToQ.a22,
        a21: sToQ.a23 * sToQ.a31 - sToQ.a21 * sToQ.a33,
        a22: sToQ.a11 * sToQ.a33 - sToQ.a13 * sToQ.a31,
        a23: sToQ.a13 * sToQ.a21 - sToQ.a11 * sToQ.a23,
        a31: sToQ.a21 * sToQ.a32 - sToQ.a22 * sToQ.a31,
        a32: sToQ.a12 * sToQ.a31 - sToQ.a11 * sToQ.a32,
        a33: sToQ.a11 * sToQ.a22 - sToQ.a12 * sToQ.a21,
    };
}
function times(a, b) {
    return {
        a11: a.a11 * b.a11 + a.a21 * b.a12 + a.a31 * b.a13,
        a12: a.a12 * b.a11 + a.a22 * b.a12 + a.a32 * b.a13,
        a13: a.a13 * b.a11 + a.a23 * b.a12 + a.a33 * b.a13,
        a21: a.a11 * b.a21 + a.a21 * b.a22 + a.a31 * b.a23,
        a22: a.a12 * b.a21 + a.a22 * b.a22 + a.a32 * b.a23,
        a23: a.a13 * b.a21 + a.a23 * b.a22 + a.a33 * b.a23,
        a31: a.a11 * b.a31 + a.a21 * b.a32 + a.a31 * b.a33,
        a32: a.a12 * b.a31 + a.a22 * b.a32 + a.a32 * b.a33,
        a33: a.a13 * b.a31 + a.a23 * b.a32 + a.a33 * b.a33,
    };
}
function extract(image, location) {
    const qToS = quadrilateralToSquare({ x: 3.5, y: 3.5 }, { x: location.dimension - 3.5, y: 3.5 }, { x: location.dimension - 6.5, y: location.dimension - 6.5 }, { x: 3.5, y: location.dimension - 3.5 });
    const sToQ = squareToQuadrilateral(location.topLeft, location.topRight, location.alignmentPattern, location.bottomLeft);
    const transform = times(sToQ, qToS);
    const matrix = BitMatrix.createEmpty(location.dimension, location.dimension);
    const mappingFunction = (x, y) => {
        const denominator = transform.a13 * x + transform.a23 * y + transform.a33;
        return {
            x: (transform.a11 * x + transform.a21 * y + transform.a31) / denominator,
            y: (transform.a12 * x + transform.a22 * y + transform.a32) / denominator,
        };
    };
    for (let y = 0; y < location.dimension; y++) {
        for (let x = 0; x < location.dimension; x++) {
            const xValue = x + 0.5;
            const yValue = y + 0.5;
            const sourcePixel = mappingFunction(xValue, yValue);
            matrix.set(x, y, image.get(Math.floor(sourcePixel.x), Math.floor(sourcePixel.y)));
        }
    }
    return {
        matrix,
        mappingFunction,
    };
}

const MAX_FINDERPATTERNS_TO_SEARCH = 5;
const MIN_QUAD_RATIO = 0.5;
const MAX_QUAD_RATIO = 1.5;
const distance = (a, b) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
function sum(values) {
    return values.reduce((a, b) => a + b);
}
// Takes three finder patterns and organizes them into topLeft, topRight, etc
function reorderFinderPatterns(pattern1, pattern2, pattern3) {
    // Find distances between pattern centers
    const oneTwoDistance = distance(pattern1, pattern2);
    const twoThreeDistance = distance(pattern2, pattern3);
    const oneThreeDistance = distance(pattern1, pattern3);
    let bottomLeft;
    let topLeft;
    let topRight;
    // Assume one closest to other two is B; A and C will just be guesses at first
    if (twoThreeDistance >= oneTwoDistance && twoThreeDistance >= oneThreeDistance) {
        [bottomLeft, topLeft, topRight] = [pattern2, pattern1, pattern3];
    }
    else if (oneThreeDistance >= twoThreeDistance && oneThreeDistance >= oneTwoDistance) {
        [bottomLeft, topLeft, topRight] = [pattern1, pattern2, pattern3];
    }
    else {
        [bottomLeft, topLeft, topRight] = [pattern1, pattern3, pattern2];
    }
    // Use cross product to figure out whether bottomLeft (A) and topRight (C) are correct or flipped in relation to topLeft (B)
    // This asks whether BC x BA has a positive z component, which is the arrangement we want. If it's negative, then
    // we've got it flipped around and should swap topRight and bottomLeft.
    if (((topRight.x - topLeft.x) * (bottomLeft.y - topLeft.y)) - ((topRight.y - topLeft.y) * (bottomLeft.x - topLeft.x)) < 0) {
        [bottomLeft, topRight] = [topRight, bottomLeft];
    }
    return { bottomLeft, topLeft, topRight };
}
// Computes the dimension (number of modules on a side) of the QR Code based on the position of the finder patterns
function computeDimension(topLeft, topRight, bottomLeft, matrix) {
    const moduleSize = (sum(countBlackWhiteRun(topLeft, bottomLeft, matrix, 5)) / 7 + // Divide by 7 since the ratio is 1:1:3:1:1
        sum(countBlackWhiteRun(topLeft, topRight, matrix, 5)) / 7 +
        sum(countBlackWhiteRun(bottomLeft, topLeft, matrix, 5)) / 7 +
        sum(countBlackWhiteRun(topRight, topLeft, matrix, 5)) / 7) / 4;
    if (moduleSize < 1) {
        throw new Error("Invalid module size");
    }
    const topDimension = Math.round(distance(topLeft, topRight) / moduleSize);
    const sideDimension = Math.round(distance(topLeft, bottomLeft) / moduleSize);
    let dimension = Math.floor((topDimension + sideDimension) / 2) + 7;
    switch (dimension % 4) {
        case 0:
            dimension++;
            break;
        case 2:
            dimension--;
            break;
    }
    return { dimension, moduleSize };
}
// Takes an origin point and an end point and counts the sizes of the black white run from the origin towards the end point.
// Returns an array of elements, representing the pixel size of the black white run.
// Uses a variant of http://en.wikipedia.org/wiki/Bresenham's_line_algorithm
function countBlackWhiteRunTowardsPoint(origin, end, matrix, length) {
    const switchPoints = [{ x: Math.floor(origin.x), y: Math.floor(origin.y) }];
    const steep = Math.abs(end.y - origin.y) > Math.abs(end.x - origin.x);
    let fromX;
    let fromY;
    let toX;
    let toY;
    if (steep) {
        fromX = Math.floor(origin.y);
        fromY = Math.floor(origin.x);
        toX = Math.floor(end.y);
        toY = Math.floor(end.x);
    }
    else {
        fromX = Math.floor(origin.x);
        fromY = Math.floor(origin.y);
        toX = Math.floor(end.x);
        toY = Math.floor(end.y);
    }
    const dx = Math.abs(toX - fromX);
    const dy = Math.abs(toY - fromY);
    let error = Math.floor(-dx / 2);
    const xStep = fromX < toX ? 1 : -1;
    const yStep = fromY < toY ? 1 : -1;
    let currentPixel = true;
    // Loop up until x == toX, but not beyond
    for (let x = fromX, y = fromY; x !== toX + xStep; x += xStep) {
        // Does current pixel mean we have moved white to black or vice versa?
        // Scanning black in state 0,2 and white in state 1, so if we find the wrong
        // color, advance to next state or end if we are in state 2 already
        const realX = steep ? y : x;
        const realY = steep ? x : y;
        if (matrix.get(realX, realY) !== currentPixel) {
            currentPixel = !currentPixel;
            switchPoints.push({ x: realX, y: realY });
            if (switchPoints.length === length + 1) {
                break;
            }
        }
        error += dy;
        if (error > 0) {
            if (y === toY) {
                break;
            }
            y += yStep;
            error -= dx;
        }
    }
    const distances = [];
    for (let i = 0; i < length; i++) {
        if (switchPoints[i] && switchPoints[i + 1]) {
            distances.push(distance(switchPoints[i], switchPoints[i + 1]));
        }
        else {
            distances.push(0);
        }
    }
    return distances;
}
// Takes an origin point and an end point and counts the sizes of the black white run in the origin point
// along the line that intersects with the end point. Returns an array of elements, representing the pixel sizes
// of the black white run. Takes a length which represents the number of switches from black to white to look for.
function countBlackWhiteRun(origin, end, matrix, length) {
    const rise = end.y - origin.y;
    const run = end.x - origin.x;
    const towardsEnd = countBlackWhiteRunTowardsPoint(origin, end, matrix, Math.ceil(length / 2));
    const awayFromEnd = countBlackWhiteRunTowardsPoint(origin, { x: origin.x - run, y: origin.y - rise }, matrix, Math.ceil(length / 2));
    const middleValue = towardsEnd.shift() + awayFromEnd.shift() - 1; // Substract one so we don't double count a pixel
    return awayFromEnd.concat(middleValue).concat(...towardsEnd);
}
// Takes in a black white run and an array of expected ratios. Returns the average size of the run as well as the "error" -
// that is the amount the run diverges from the expected ratio
function scoreBlackWhiteRun(sequence, ratios) {
    const averageSize = sum(sequence) / sum(ratios);
    let error = 0;
    ratios.forEach((ratio, i) => {
        error += (sequence[i] - ratio * averageSize) ** 2;
    });
    return { averageSize, error };
}
// Takes an X,Y point and an array of sizes and scores the point against those ratios.
// For example for a finder pattern takes the ratio list of 1:1:3:1:1 and checks horizontal, vertical and diagonal ratios
// against that.
function scorePattern(point, ratios, matrix) {
    try {
        const horizontalRun = countBlackWhiteRun(point, { x: -1, y: point.y }, matrix, ratios.length);
        const verticalRun = countBlackWhiteRun(point, { x: point.x, y: -1 }, matrix, ratios.length);
        const topLeftPoint = {
            x: Math.max(0, point.x - point.y) - 1,
            y: Math.max(0, point.y - point.x) - 1,
        };
        const topLeftBottomRightRun = countBlackWhiteRun(point, topLeftPoint, matrix, ratios.length);
        const bottomLeftPoint = {
            x: Math.min(matrix.width, point.x + point.y) + 1,
            y: Math.min(matrix.height, point.y + point.x) + 1,
        };
        const bottomLeftTopRightRun = countBlackWhiteRun(point, bottomLeftPoint, matrix, ratios.length);
        const horzError = scoreBlackWhiteRun(horizontalRun, ratios);
        const vertError = scoreBlackWhiteRun(verticalRun, ratios);
        const diagDownError = scoreBlackWhiteRun(topLeftBottomRightRun, ratios);
        const diagUpError = scoreBlackWhiteRun(bottomLeftTopRightRun, ratios);
        const ratioError = Math.sqrt(horzError.error * horzError.error +
            vertError.error * vertError.error +
            diagDownError.error * diagDownError.error +
            diagUpError.error * diagUpError.error);
        const avgSize = (horzError.averageSize + vertError.averageSize + diagDownError.averageSize + diagUpError.averageSize) / 4;
        const sizeError = ((horzError.averageSize - avgSize) ** 2 +
            (vertError.averageSize - avgSize) ** 2 +
            (diagDownError.averageSize - avgSize) ** 2 +
            (diagUpError.averageSize - avgSize) ** 2) / avgSize;
        return ratioError + sizeError;
    }
    catch (_a) {
        return Infinity;
    }
}
function recenterLocation(matrix, p) {
    let leftX = Math.round(p.x);
    while (matrix.get(leftX, Math.round(p.y))) {
        leftX--;
    }
    let rightX = Math.round(p.x);
    while (matrix.get(rightX, Math.round(p.y))) {
        rightX++;
    }
    const x = (leftX + rightX) / 2;
    let topY = Math.round(p.y);
    while (matrix.get(Math.round(x), topY)) {
        topY--;
    }
    let bottomY = Math.round(p.y);
    while (matrix.get(Math.round(x), bottomY)) {
        bottomY++;
    }
    const y = (topY + bottomY) / 2;
    return { x, y };
}
function locate(matrix) {
    const finderPatternQuads = [];
    let activeFinderPatternQuads = [];
    const alignmentPatternQuads = [];
    let activeAlignmentPatternQuads = [];
    for (let y = 0; y <= matrix.height; y++) {
        let length = 0;
        let lastBit = false;
        let scans = [0, 0, 0, 0, 0];
        for (let x = -1; x <= matrix.width; x++) {
            const v = matrix.get(x, y);
            if (v === lastBit) {
                length++;
            }
            else {
                scans = [scans[1], scans[2], scans[3], scans[4], length];
                length = 1;
                lastBit = v;
                // Do the last 5 color changes ~ match the expected ratio for a finder pattern? 1:1:3:1:1 of b:w:b:w:b
                const averageFinderPatternBlocksize = sum(scans) / 7;
                const validFinderPattern = Math.abs(scans[0] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
                    Math.abs(scans[1] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
                    Math.abs(scans[2] - 3 * averageFinderPatternBlocksize) < 3 * averageFinderPatternBlocksize &&
                    Math.abs(scans[3] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
                    Math.abs(scans[4] - averageFinderPatternBlocksize) < averageFinderPatternBlocksize &&
                    !v; // And make sure the current pixel is white since finder patterns are bordered in white
                // Do the last 3 color changes ~ match the expected ratio for an alignment pattern? 1:1:1 of w:b:w
                const averageAlignmentPatternBlocksize = sum(scans.slice(-3)) / 3;
                const validAlignmentPattern = Math.abs(scans[2] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
                    Math.abs(scans[3] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
                    Math.abs(scans[4] - averageAlignmentPatternBlocksize) < averageAlignmentPatternBlocksize &&
                    v; // Is the current pixel black since alignment patterns are bordered in black
                if (validFinderPattern) {
                    // Compute the start and end x values of the large center black square
                    const endX = x - scans[3] - scans[4];
                    const startX = endX - scans[2];
                    const line = { startX, endX, y };
                    // Is there a quad directly above the current spot? If so, extend it with the new line. Otherwise, create a new quad with
                    // that line as the starting point.
                    const matchingQuads = activeFinderPatternQuads.filter(q => (startX >= q.bottom.startX && startX <= q.bottom.endX) ||
                        (endX >= q.bottom.startX && startX <= q.bottom.endX) ||
                        (startX <= q.bottom.startX && endX >= q.bottom.endX && ((scans[2] / (q.bottom.endX - q.bottom.startX)) < MAX_QUAD_RATIO &&
                            (scans[2] / (q.bottom.endX - q.bottom.startX)) > MIN_QUAD_RATIO)));
                    if (matchingQuads.length > 0) {
                        matchingQuads[0].bottom = line;
                    }
                    else {
                        activeFinderPatternQuads.push({ top: line, bottom: line });
                    }
                }
                if (validAlignmentPattern) {
                    // Compute the start and end x values of the center black square
                    const endX = x - scans[4];
                    const startX = endX - scans[3];
                    const line = { startX, y, endX };
                    // Is there a quad directly above the current spot? If so, extend it with the new line. Otherwise, create a new quad with
                    // that line as the starting point.
                    const matchingQuads = activeAlignmentPatternQuads.filter(q => (startX >= q.bottom.startX && startX <= q.bottom.endX) ||
                        (endX >= q.bottom.startX && startX <= q.bottom.endX) ||
                        (startX <= q.bottom.startX && endX >= q.bottom.endX && ((scans[2] / (q.bottom.endX - q.bottom.startX)) < MAX_QUAD_RATIO &&
                            (scans[2] / (q.bottom.endX - q.bottom.startX)) > MIN_QUAD_RATIO)));
                    if (matchingQuads.length > 0) {
                        matchingQuads[0].bottom = line;
                    }
                    else {
                        activeAlignmentPatternQuads.push({ top: line, bottom: line });
                    }
                }
            }
        }
        finderPatternQuads.push(...activeFinderPatternQuads.filter(q => q.bottom.y !== y && q.bottom.y - q.top.y >= 2));
        activeFinderPatternQuads = activeFinderPatternQuads.filter(q => q.bottom.y === y);
        alignmentPatternQuads.push(...activeAlignmentPatternQuads.filter(q => q.bottom.y !== y));
        activeAlignmentPatternQuads = activeAlignmentPatternQuads.filter(q => q.bottom.y === y);
    }
    finderPatternQuads.push(...activeFinderPatternQuads.filter(q => q.bottom.y - q.top.y >= 2));
    alignmentPatternQuads.push(...activeAlignmentPatternQuads);
    // Refactored from cozmo/jsQR to (hopefully) circumvent an issue in Safari 13+ on both Mac and iOS (also including
    // iOS Chrome and other Safari iOS derivatives). Safari was very occasionally and apparently not deterministically
    // throwing a "RangeError: Array size is not a small enough positive integer." exception seemingly within the second
    // .map of the original code (here the second for-loop). This second .map contained a nested .map call over the same
    // array instance which was the chained result from previous calls to .map, .filter and .sort which potentially caused
    // this bug in Safari?
    // Also see https://github.com/cozmo/jsQR/issues/157 and https://bugs.webkit.org/show_bug.cgi?id=211619#c3
    const scoredFinderPatternPositions = [];
    for (const quad of finderPatternQuads) {
        if (quad.bottom.y - quad.top.y < 2) {
            // All quads must be at least 2px tall since the center square is larger than a block
            continue;
        }
        // calculate quad center
        const x = (quad.top.startX + quad.top.endX + quad.bottom.startX + quad.bottom.endX) / 4;
        const y = (quad.top.y + quad.bottom.y + 1) / 2;
        if (!matrix.get(Math.round(x), Math.round(y))) {
            continue;
        }
        const lengths = [quad.top.endX - quad.top.startX, quad.bottom.endX - quad.bottom.startX, quad.bottom.y - quad.top.y + 1];
        const size = sum(lengths) / lengths.length;
        // Initial scoring of finder pattern quads by looking at their ratios, not taking into account position
        const score = scorePattern({ x: Math.round(x), y: Math.round(y) }, [1, 1, 3, 1, 1], matrix);
        scoredFinderPatternPositions.push({ score, x, y, size });
    }
    if (scoredFinderPatternPositions.length < 3) {
        // A QR code has 3 finder patterns, therefore we need at least 3 candidates.
        return null;
    }
    scoredFinderPatternPositions.sort((a, b) => a.score - b.score);
    // Now take the top finder pattern options and try to find 2 other options with a similar size.
    const finderPatternGroups = [];
    for (let i = 0; i < Math.min(scoredFinderPatternPositions.length, MAX_FINDERPATTERNS_TO_SEARCH); ++i) {
        const point = scoredFinderPatternPositions[i];
        const otherPoints = [];
        for (const otherPoint of scoredFinderPatternPositions) {
            if (otherPoint === point) {
                continue;
            }
            otherPoints.push(Object.assign(Object.assign({}, otherPoint), { score: otherPoint.score + ((otherPoint.size - point.size) ** 2) / point.size }));
        }
        otherPoints.sort((a, b) => a.score - b.score);
        finderPatternGroups.push({
            points: [point, otherPoints[0], otherPoints[1]],
            score: point.score + otherPoints[0].score + otherPoints[1].score, // total combined score of the three points in the group
        });
    }
    finderPatternGroups.sort((a, b) => a.score - b.score);
    const bestFinderPatternGroup = finderPatternGroups[0];
    const { topRight, topLeft, bottomLeft } = reorderFinderPatterns(...bestFinderPatternGroup.points);
    const alignment = findAlignmentPattern(matrix, alignmentPatternQuads, topRight, topLeft, bottomLeft);
    const result = [];
    if (alignment) {
        result.push({
            alignmentPattern: { x: alignment.alignmentPattern.x, y: alignment.alignmentPattern.y },
            bottomLeft: { x: bottomLeft.x, y: bottomLeft.y },
            dimension: alignment.dimension,
            topLeft: { x: topLeft.x, y: topLeft.y },
            topRight: { x: topRight.x, y: topRight.y },
        });
    }
    // We normally use the center of the quads as the location of the tracking points, which is optimal for most cases and will account
    // for a skew in the image. However, In some cases, a slight skew might not be real and instead be caused by image compression
    // errors and/or low resolution. For those cases, we'd be better off centering the point exactly in the middle of the black area. We
    // compute and return the location data for the naively centered points as it is little additional work and allows for multiple
    // attempts at decoding harder images.
    const midTopRight = recenterLocation(matrix, topRight);
    const midTopLeft = recenterLocation(matrix, topLeft);
    const midBottomLeft = recenterLocation(matrix, bottomLeft);
    const centeredAlignment = findAlignmentPattern(matrix, alignmentPatternQuads, midTopRight, midTopLeft, midBottomLeft);
    if (centeredAlignment) {
        result.push({
            alignmentPattern: { x: centeredAlignment.alignmentPattern.x, y: centeredAlignment.alignmentPattern.y },
            bottomLeft: { x: midBottomLeft.x, y: midBottomLeft.y },
            topLeft: { x: midTopLeft.x, y: midTopLeft.y },
            topRight: { x: midTopRight.x, y: midTopRight.y },
            dimension: centeredAlignment.dimension,
        });
    }
    if (result.length === 0) {
        return null;
    }
    return result;
}
function findAlignmentPattern(matrix, alignmentPatternQuads, topRight, topLeft, bottomLeft) {
    // Now that we've found the three finder patterns we can determine the blockSize and the size of the QR code.
    // We'll use these to help find the alignment pattern but also later when we do the extraction.
    let dimension;
    let moduleSize;
    try {
        ({ dimension, moduleSize } = computeDimension(topLeft, topRight, bottomLeft, matrix));
    }
    catch (e) {
        return null;
    }
    // Now find the alignment pattern
    const bottomRightFinderPattern = {
        x: topRight.x - topLeft.x + bottomLeft.x,
        y: topRight.y - topLeft.y + bottomLeft.y,
    };
    const modulesBetweenFinderPatterns = ((distance(topLeft, bottomLeft) + distance(topLeft, topRight)) / 2 / moduleSize);
    const correctionToTopLeft = 1 - (3 / modulesBetweenFinderPatterns);
    const expectedAlignmentPattern = {
        x: topLeft.x + correctionToTopLeft * (bottomRightFinderPattern.x - topLeft.x),
        y: topLeft.y + correctionToTopLeft * (bottomRightFinderPattern.y - topLeft.y),
    };
    const alignmentPatterns = alignmentPatternQuads
        .map(q => {
        const x = (q.top.startX + q.top.endX + q.bottom.startX + q.bottom.endX) / 4;
        const y = (q.top.y + q.bottom.y + 1) / 2;
        if (!matrix.get(Math.floor(x), Math.floor(y))) {
            return;
        }
        const sizeScore = scorePattern({ x: Math.floor(x), y: Math.floor(y) }, [1, 1, 1], matrix);
        const score = sizeScore + distance({ x, y }, expectedAlignmentPattern);
        return { x, y, score };
    })
        .filter(v => !!v)
        .sort((a, b) => a.score - b.score);
    // If there are less than 15 modules between finder patterns it's a version 1 QR code and as such has no alignmemnt pattern
    // so we can only use our best guess.
    const alignmentPattern = modulesBetweenFinderPatterns >= 15 && alignmentPatterns.length ? alignmentPatterns[0] : expectedAlignmentPattern;
    return { alignmentPattern, dimension };
}

function scan(matrix) {
    const locations = locate(matrix);
    if (!locations) {
        return null;
    }
    for (const location of locations) {
        const extracted = extract(matrix, location);
        const decoded = decode(extracted.matrix);
        if (decoded) {
            return {
                binaryData: decoded.bytes,
                data: decoded.text,
                chunks: decoded.chunks,
                version: decoded.version,
                location: {
                    topRightCorner: extracted.mappingFunction(location.dimension, 0),
                    topLeftCorner: extracted.mappingFunction(0, 0),
                    bottomRightCorner: extracted.mappingFunction(location.dimension, location.dimension),
                    bottomLeftCorner: extracted.mappingFunction(0, location.dimension),
                    topRightFinderPattern: location.topRight,
                    topLeftFinderPattern: location.topLeft,
                    bottomLeftFinderPattern: location.bottomLeft,
                    bottomRightAlignmentPattern: location.alignmentPattern,
                },
                matrix: extracted.matrix,
            };
        }
    }
    return null;
}
const defaultOptions = {
    inversionAttempts: "attemptBoth",
    greyScaleWeights: {
        red: 0.2126,
        green: 0.7152,
        blue: 0.0722,
        useIntegerApproximation: false,
    },
    canOverwriteImage: true,
};
function jsQR(data, width, height, providedOptions = {}) {
    const options = Object.create(null);
    Object.assign(options, defaultOptions);
    Object.assign(options, providedOptions);
    // mergeObject(options, defaultOptions);
    // mergeObject(options, providedOptions);
    const tryInvertedFirst = options.inversionAttempts === "onlyInvert" || options.inversionAttempts === "invertFirst";
    const shouldInvert = options.inversionAttempts === "attemptBoth" || tryInvertedFirst;
    const { binarized, inverted } = binarize(data, width, height, shouldInvert, options.greyScaleWeights, options.canOverwriteImage);
    let result = scan(tryInvertedFirst ? inverted : binarized);
    if (!result && (options.inversionAttempts === "attemptBoth" || options.inversionAttempts === "invertFirst")) {
        result = scan(tryInvertedFirst ? binarized : inverted);
    }
    return result;
}
jsQR.default = jsQR;

export { jsQR as default };
//# sourceMappingURL=jsQR.js.map
