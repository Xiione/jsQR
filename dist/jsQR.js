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

var h=moduleArg,aa,ba,ca=new Promise((a,b)=>{aa=a;ba=b;}),da=Object.assign({},h),ea="./this.program",fa="",ha,ia,ja,fs=require("fs"),ka=require("path");fa=require("url").fileURLToPath(new URL("./",import.meta.url));ha=a=>{a=la(a)?new URL(a):ka.normalize(a);return fs.readFileSync(a,void 0)};ja=a=>{a=ha(a);a.buffer||(a=new Uint8Array(a));return a};ia=(a,b,c)=>{a=la(a)?new URL(a):ka.normalize(a);fs.readFile(a,void 0,(d,e)=>{d?c(d):b(e.buffer);});};
!h.thisProgram&&1<process.argv.length&&(ea=process.argv[1].replace(/\\/g,"/"));process.argv.slice(2);var ma=h.print||console.log.bind(console),n=h.printErr||console.error.bind(console);Object.assign(h,da);da=null;h.thisProgram&&(ea=h.thisProgram);var na;h.wasmBinary&&(na=h.wasmBinary);var oa,pa=!1,t,x,z,qa,B,C,ra,sa,ta=[],ua=[],va=[];function wa(){var a=h.preRun.shift();ta.unshift(a);}var D=0,E=null;
function F(a){h.onAbort?.(a);a="Aborted("+a+")";n(a);pa=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");ba(a);throw a;}var ya=a=>a.startsWith("data:application/octet-stream;base64,"),la=a=>a.startsWith("file://"),za;function Aa(a){if(a==za&&na)return new Uint8Array(na);if(ja)return ja(a);throw "both async and sync fetching of the wasm failed";}
function Ba(){var a=za;return na?Promise.resolve().then(()=>Aa(a)):new Promise((b,c)=>{ia(a,d=>b(new Uint8Array(d)),()=>{try{b(Aa(a));}catch(d){c(d);}});})}function Ca(a,b){return Ba().then(c=>WebAssembly.instantiate(c,a)).then(b,c=>{n(`failed to asynchronously prepare wasm: ${c}`);F(c);})}function Da(a,b){return Ca(a,b)}var G,Ea,Fa=a=>{for(;0<a.length;)a.shift()(h);};class Ga{constructor(a){this.ma=a-24;}}
var Ha=0,Ja,I=a=>{for(var b="";x[a];)b+=Ja[x[a++]];return b},J={},K={},Ka={},L,La=a=>{throw new L(a);},Ma,Na=(a,b)=>{function c(m){m=b(m);if(m.length!==d.length)throw new Ma("Mismatched type converter count");for(var p=0;p<d.length;++p)M(d[p],m[p]);}var d=[];d.forEach(function(m){Ka[m]=a;});var e=Array(a.length),f=[],l=0;a.forEach((m,p)=>{K.hasOwnProperty(m)?e[p]=K[m]:(f.push(m),J.hasOwnProperty(m)||(J[m]=[]),J[m].push(()=>{e[p]=K[m];++l;l===f.length&&c(e);}));});0===f.length&&c(e);};
function Oa(a,b,c={}){var d=b.name;if(!a)throw new L(`type "${d}" must have a positive integer typeid pointer`);if(K.hasOwnProperty(a)){if(c.Da)return;throw new L(`Cannot register type '${d}' twice`);}K[a]=b;delete Ka[a];J.hasOwnProperty(a)&&(b=J[a],delete J[a],b.forEach(e=>e()));}function M(a,b,c={}){if(!("argPackAdvance"in b))throw new TypeError("registerType registeredInstance requires argPackAdvance");return Oa(a,b,c)}
var Qa=[],N=[],Ra=a=>{9<a&&0===--N[a+1]&&(N[a]=void 0,Qa.push(a));},O=a=>{if(!a)throw new L("Cannot use deleted val. handle = "+a);return N[a]},P=a=>{switch(a){case void 0:return 2;case null:return 4;case !0:return 6;case !1:return 8;default:const b=Qa.pop()||N.length;N[b]=a;N[b+1]=1;return b}};function Sa(a){return this.fromWireType(C[a>>2])}
var Ta={name:"emscripten::val",fromWireType:a=>{var b=O(a);Ra(a);return b},toWireType:(a,b)=>P(b),argPackAdvance:8,readValueFromPointer:Sa,aa:null},Ua=(a,b)=>{switch(b){case 4:return function(c){return this.fromWireType(ra[c>>2])};case 8:return function(c){return this.fromWireType(sa[c>>3])};default:throw new TypeError(`invalid float width (${b}): ${a}`);}},Va=(a,b)=>Object.defineProperty(b,"name",{value:a}),Wa=a=>{for(;a.length;){var b=a.pop();a.pop()(b);}};
function Xa(a){for(var b=1;b<a.length;++b)if(null!==a[b]&&void 0===a[b].aa)return !0;return !1}function Ya(a){var b=Function;if(!(b instanceof Function))throw new TypeError(`new_ called with constructor type ${typeof b} which is not a function`);var c=Va(b.name||"unknownFunctionName",function(){});c.prototype=b.prototype;c=new c;a=b.apply(c,a);return a instanceof Object?a:c}
var Za=(a,b)=>{if(void 0===h[a].Y){var c=h[a];h[a]=function(...d){if(!h[a].Y.hasOwnProperty(d.length))throw new L(`Function '${b}' called with an invalid number of arguments (${d.length}) - expects one of (${h[a].Y})!`);return h[a].Y[d.length].apply(this,d)};h[a].Y=[];h[a].Y[c.Ba]=c;}},$a=(a,b,c)=>{if(h.hasOwnProperty(a)){if(void 0===c||void 0!==h[a].Y&&void 0!==h[a].Y[c])throw new L(`Cannot register public name '${a}' twice`);Za(a,a);if(h.hasOwnProperty(c))throw new L(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`);
h[a].Y[c]=b;}else h[a]=b,void 0!==c&&(h[a].Wa=c);},ab=(a,b)=>{for(var c=[],d=0;d<a;d++)c.push(C[b+4*d>>2]);return c},bb=[],cb,db=a=>{var b=bb[a];b||(a>=bb.length&&(bb.length=a+1),bb[a]=b=cb.get(a));return b},eb=(a,b,c=[])=>{a.includes("j")?(a=a.replace(/p/g,"i"),b=(0, h["dynCall_"+a])(b,...c)):b=db(b)(...c);return b},fb=(a,b)=>(...c)=>eb(a,b,c),gb=(a,b)=>{a=I(a);var c=a.includes("j")?fb(a,b):db(b);if("function"!=typeof c)throw new L(`unknown function pointer with signature ${a}: ${b}`);return c},hb,
jb=a=>{a=ib(a);var b=I(a);Q(a);return b},kb=(a,b)=>{function c(f){e[f]||K[f]||(Ka[f]?Ka[f].forEach(c):(d.push(f),e[f]=!0));}var d=[],e={};b.forEach(c);throw new hb(`${a}: `+d.map(jb).join([", "]));},lb=a=>{a=a.trim();const b=a.indexOf("(");return -1!==b?a.substr(0,b):a},mb=(a,b,c)=>{switch(b){case 1:return c?d=>t[d]:d=>x[d];case 2:return c?d=>z[d>>1]:d=>qa[d>>1];case 4:return c?d=>B[d>>2]:d=>C[d>>2];default:throw new TypeError(`invalid integer width (${b}): ${a}`);}},nb=(a,b,c,d)=>{if(!(0<d))return 0;
var e=c;d=c+d-1;for(var f=0;f<a.length;++f){var l=a.charCodeAt(f);if(55296<=l&&57343>=l){var m=a.charCodeAt(++f);l=65536+((l&1023)<<10)|m&1023;}if(127>=l){if(c>=d)break;b[c++]=l;}else {if(2047>=l){if(c+1>=d)break;b[c++]=192|l>>6;}else {if(65535>=l){if(c+2>=d)break;b[c++]=224|l>>12;}else {if(c+3>=d)break;b[c++]=240|l>>18;b[c++]=128|l>>12&63;}b[c++]=128|l>>6&63;}b[c++]=128|l&63;}}b[c]=0;return c-e},ob=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);127>=d?b++:2047>=d?b+=2:55296<=d&&57343>=d?(b+=4,++c):
b+=3;}return b},pb="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0,R=(a,b,c)=>{var d=b+c;for(c=b;a[c]&&!(c>=d);)++c;if(16<c-b&&a.buffer&&pb)return pb.decode(a.subarray(b,c));for(d="";b<c;){var e=a[b++];if(e&128){var f=a[b++]&63;if(192==(e&224))d+=String.fromCharCode((e&31)<<6|f);else {var l=a[b++]&63;e=224==(e&240)?(e&15)<<12|f<<6|l:(e&7)<<18|f<<12|l<<6|a[b++]&63;65536>e?d+=String.fromCharCode(e):(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023));}}else d+=String.fromCharCode(e);}return d},
qb="undefined"!=typeof TextDecoder?new TextDecoder("utf-16le"):void 0,rb=(a,b)=>{var c=a>>1;for(var d=c+b/2;!(c>=d)&&qa[c];)++c;c<<=1;if(32<c-a&&qb)return qb.decode(x.subarray(a,c));c="";for(d=0;!(d>=b/2);++d){var e=z[a+2*d>>1];if(0==e)break;c+=String.fromCharCode(e);}return c},sb=(a,b,c)=>{c??=2147483647;if(2>c)return 0;c-=2;var d=b;c=c<2*a.length?c/2:a.length;for(var e=0;e<c;++e)z[b>>1]=a.charCodeAt(e),b+=2;z[b>>1]=0;return b-d},tb=a=>2*a.length,ub=(a,b)=>{for(var c=0,d="";!(c>=b/4);){var e=B[a+
4*c>>2];if(0==e)break;++c;65536<=e?(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023)):d+=String.fromCharCode(e);}return d},vb=(a,b,c)=>{c??=2147483647;if(4>c)return 0;var d=b;c=d+c-4;for(var e=0;e<a.length;++e){var f=a.charCodeAt(e);if(55296<=f&&57343>=f){var l=a.charCodeAt(++e);f=65536+((f&1023)<<10)|l&1023;}B[b>>2]=f;b+=4;if(b+4>c)break}B[b>>2]=0;return b-d},wb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);55296<=d&&57343>=d&&++c;b+=4;}return b},xb=(a,b)=>{var c=K[a];if(void 0===
c)throw a=`${b} has unknown type ${jb(a)}`,new L(a);return c},yb=(a,b,c)=>{var d=[];a=a.toWireType(d,c);d.length&&(C[b>>2]=P(d));return a},zb=[],Ab={},Bb=a=>{var b=Ab[a];return void 0===b?I(a):b},Cb=()=>"object"==typeof globalThis?globalThis:Function("return this")(),Db=a=>{var b=zb.length;zb.push(a);return b},Eb=(a,b)=>{for(var c=Array(a),d=0;d<a;++d)c[d]=xb(C[b+4*d>>2],"parameter "+d);return c},Fb={},Hb=()=>{if(!Gb){var a={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",
LANG:("object"==typeof navigator&&navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8",_:ea||"./this.program"},b;for(b in Fb)void 0===Fb[b]?delete a[b]:a[b]=Fb[b];var c=[];for(b in a)c.push(`${b}=${a[b]}`);Gb=c;}return Gb},Gb,Ib=(a,b)=>{for(var c=0,d=a.length-1;0<=d;d--){var e=a[d];"."===e?a.splice(d,1):".."===e?(a.splice(d,1),c++):c&&(a.splice(d,1),c--);}if(b)for(;c;c--)a.unshift("..");return a},Jb=a=>{var b="/"===a.charAt(0),c="/"===a.substr(-1);(a=Ib(a.split("/").filter(d=>
!!d),!b).join("/"))||b||(a=".");a&&c&&(a+="/");return (b?"/":"")+a},Kb=a=>{var b=/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);a=b[0];b=b[1];if(!a&&!b)return ".";b&&=b.substr(0,b.length-1);return a+b},Lb=a=>{if("/"===a)return "/";a=Jb(a);a=a.replace(/\/$/,"");var b=a.lastIndexOf("/");return -1===b?a:a.substr(b+1)},Mb=()=>{if("object"==typeof crypto&&"function"==typeof crypto.getRandomValues)return c=>crypto.getRandomValues(c);try{var a=require("crypto");if(a.randomFillSync)return c=>
a.randomFillSync(c);var b=a.randomBytes;return c=>(c.set(b(c.byteLength)),c)}catch(c){}F("initRandomDevice");},Nb=a=>(Nb=Mb())(a),Ob=(...a)=>{for(var b="",c=!1,d=a.length-1;-1<=d&&!c;d--){c=0<=d?a[d]:"/";if("string"!=typeof c)throw new TypeError("Arguments to path.resolve must be strings");if(!c)return "";b=c+"/"+b;c="/"===c.charAt(0);}b=Ib(b.split("/").filter(e=>!!e),!c).join("/");return (c?"/":"")+b||"."},Pb=[];function Qb(a,b){var c=Array(ob(a)+1);a=nb(a,c,0,c.length);b&&(c.length=a);return c}
var Tb=[];function Ub(a,b){Tb[a]={input:[],output:[],ha:b};Vb(a,Wb);}
var Wb={open(a){var b=Tb[a.node.rdev];if(!b)throw new S(43);a.tty=b;a.seekable=!1;},close(a){a.tty.ha.fsync(a.tty);},fsync(a){a.tty.ha.fsync(a.tty);},read(a,b,c,d){if(!a.tty||!a.tty.ha.xa)throw new S(60);for(var e=0,f=0;f<d;f++){try{var l=a.tty.ha.xa(a.tty);}catch(m){throw new S(29);}if(void 0===l&&0===e)throw new S(6);if(null===l||void 0===l)break;e++;b[c+f]=l;}e&&(a.node.timestamp=Date.now());return e},write(a,b,c,d){if(!a.tty||!a.tty.ha.qa)throw new S(60);try{for(var e=0;e<d;e++)a.tty.ha.qa(a.tty,b[c+
e]);}catch(f){throw new S(29);}d&&(a.node.timestamp=Date.now());return e}},Xb={xa(){a:{if(!Pb.length){var a=null;var b=Buffer.alloc(256),c=0,d=process.stdin.fd;try{c=fs.readSync(d,b,0,256);}catch(e){if(e.toString().includes("EOF"))c=0;else throw e;}0<c&&(a=b.slice(0,c).toString("utf-8"));if(!a){a=null;break a}Pb=Qb(a,!0);}a=Pb.shift();}return a},qa(a,b){null===b||10===b?(ma(R(a.output,0)),a.output=[]):0!=b&&a.output.push(b);},fsync(a){a.output&&0<a.output.length&&(ma(R(a.output,0)),a.output=[]);},Ta(){return {Pa:25856,
Ra:5,Oa:191,Qa:35387,Na:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},Ua(){return 0},Va(){return [24,80]}},Yb={qa(a,b){null===b||10===b?(n(R(a.output,0)),a.output=[]):0!=b&&a.output.push(b);},fsync(a){a.output&&0<a.output.length&&(n(R(a.output,0)),a.output=[]);}};function Zb(a,b){var c=a.U?a.U.length:0;c>=b||(b=Math.max(b,c*(1048576>c?2:1.125)>>>0),0!=c&&(b=Math.max(b,256)),c=a.U,a.U=new Uint8Array(b),0<a.W&&a.U.set(c.subarray(0,a.W),0));}
var T={X:null,ba(){return T.createNode(null,"/",16895,0)},createNode(a,b,c,d){if(24576===(c&61440)||4096===(c&61440))throw new S(63);T.X||(T.X={dir:{node:{da:T.O.da,Z:T.O.Z,lookup:T.O.lookup,ka:T.O.ka,rename:T.O.rename,unlink:T.O.unlink,rmdir:T.O.rmdir,readdir:T.O.readdir,symlink:T.O.symlink},stream:{ea:T.V.ea}},file:{node:{da:T.O.da,Z:T.O.Z},stream:{ea:T.V.ea,read:T.V.read,write:T.V.write,ta:T.V.ta,ya:T.V.ya,Aa:T.V.Aa}},link:{node:{da:T.O.da,Z:T.O.Z,readlink:T.O.readlink},stream:{}},ua:{node:{da:T.O.da,
Z:T.O.Z},stream:$b}});c=ac(a,b,c,d);16384===(c.mode&61440)?(c.O=T.X.dir.node,c.V=T.X.dir.stream,c.U={}):32768===(c.mode&61440)?(c.O=T.X.file.node,c.V=T.X.file.stream,c.W=0,c.U=null):40960===(c.mode&61440)?(c.O=T.X.link.node,c.V=T.X.link.stream):8192===(c.mode&61440)&&(c.O=T.X.ua.node,c.V=T.X.ua.stream);c.timestamp=Date.now();a&&(a.U[b]=c,a.timestamp=c.timestamp);return c},Sa(a){return a.U?a.U.subarray?a.U.subarray(0,a.W):new Uint8Array(a.U):new Uint8Array(0)},O:{da(a){var b={};b.dev=8192===(a.mode&
61440)?a.id:1;b.ino=a.id;b.mode=a.mode;b.nlink=1;b.uid=0;b.gid=0;b.rdev=a.rdev;16384===(a.mode&61440)?b.size=4096:32768===(a.mode&61440)?b.size=a.W:40960===(a.mode&61440)?b.size=a.link.length:b.size=0;b.atime=new Date(a.timestamp);b.mtime=new Date(a.timestamp);b.ctime=new Date(a.timestamp);b.Ca=4096;b.blocks=Math.ceil(b.size/b.Ca);return b},Z(a,b){void 0!==b.mode&&(a.mode=b.mode);void 0!==b.timestamp&&(a.timestamp=b.timestamp);if(void 0!==b.size&&(b=b.size,a.W!=b))if(0==b)a.U=null,a.W=0;else {var c=
a.U;a.U=new Uint8Array(b);c&&a.U.set(c.subarray(0,Math.min(b,a.W)));a.W=b;}},lookup(){throw bc[44];},ka(a,b,c,d){return T.createNode(a,b,c,d)},rename(a,b,c){if(16384===(a.mode&61440)){try{var d=cc(b,c);}catch(f){}if(d)for(var e in d.U)throw new S(55);}delete a.parent.U[a.name];a.parent.timestamp=Date.now();a.name=c;b.U[c]=a;b.timestamp=a.parent.timestamp;},unlink(a,b){delete a.U[b];a.timestamp=Date.now();},rmdir(a,b){var c=cc(a,b),d;for(d in c.U)throw new S(55);delete a.U[b];a.timestamp=Date.now();},readdir(a){var b=
[".",".."],c;for(c of Object.keys(a.U))b.push(c);return b},symlink(a,b,c){a=T.createNode(a,b,41471,0);a.link=c;return a},readlink(a){if(40960!==(a.mode&61440))throw new S(28);return a.link}},V:{read(a,b,c,d,e){var f=a.node.U;if(e>=a.node.W)return 0;a=Math.min(a.node.W-e,d);if(8<a&&f.subarray)b.set(f.subarray(e,e+a),c);else for(d=0;d<a;d++)b[c+d]=f[e+d];return a},write(a,b,c,d,e,f){if(!d)return 0;a=a.node;a.timestamp=Date.now();if(b.subarray&&(!a.U||a.U.subarray)){if(f)return a.U=b.subarray(c,c+d),
a.W=d;if(0===a.W&&0===e)return a.U=b.slice(c,c+d),a.W=d;if(e+d<=a.W)return a.U.set(b.subarray(c,c+d),e),d}Zb(a,e+d);if(a.U.subarray&&b.subarray)a.U.set(b.subarray(c,c+d),e);else for(f=0;f<d;f++)a.U[e+f]=b[c+f];a.W=Math.max(a.W,e+d);return d},ea(a,b,c){1===c?b+=a.position:2===c&&32768===(a.node.mode&61440)&&(b+=a.node.W);if(0>b)throw new S(28);return b},ta(a,b,c){Zb(a.node,b+c);a.node.W=Math.max(a.node.W,b+c);},ya(a,b,c,d,e){if(32768!==(a.node.mode&61440))throw new S(43);a=a.node.U;if(e&2||a.buffer!==
t.buffer){if(0<c||c+b<a.length)a.subarray?a=a.subarray(c,c+b):a=Array.prototype.slice.call(a,c,c+b);c=!0;F();b=void 0;if(!b)throw new S(48);t.set(a,b);}else c=!1,b=a.byteOffset;return {ma:b,Ma:c}},Aa(a,b,c,d){T.V.write(a,b,0,d,c,!1);return 0}}},dc=(a,b)=>{var c=0;a&&(c|=365);b&&(c|=146);return c},ec=null,fc={},gc=[],hc=1,U=null,ic=!0,S=class{constructor(a){this.name="ErrnoError";this.ja=a;}},bc={},jc=class{constructor(){this.ia={};this.node=null;}get flags(){return this.ia.flags}set flags(a){this.ia.flags=
a;}get position(){return this.ia.position}set position(a){this.ia.position=a;}},kc=class{constructor(a,b,c,d){a||=this;this.parent=a;this.ba=a.ba;this.la=null;this.id=hc++;this.name=b;this.mode=c;this.O={};this.V={};this.rdev=d;}get read(){return 365===(this.mode&365)}set read(a){a?this.mode|=365:this.mode&=-366;}get write(){return 146===(this.mode&146)}set write(a){a?this.mode|=146:this.mode&=-147;}};
function V(a,b={}){a=Ob(a);if(!a)return {path:"",node:null};b=Object.assign({wa:!0,ra:0},b);if(8<b.ra)throw new S(32);a=a.split("/").filter(l=>!!l);for(var c=ec,d="/",e=0;e<a.length;e++){var f=e===a.length-1;if(f&&b.parent)break;c=cc(c,a[e]);d=Jb(d+"/"+a[e]);c.la&&(!f||f&&b.wa)&&(c=c.la.root);if(!f||b.va)for(f=0;40960===(c.mode&61440);)if(c=lc(d),d=Ob(Kb(d),c),c=V(d,{ra:b.ra+1}).node,40<f++)throw new S(32);}return {path:d,node:c}}
function mc(a){for(var b;;){if(a===a.parent)return a=a.ba.za,b?"/"!==a[a.length-1]?`${a}/${b}`:a+b:a;b=b?`${a.name}/${b}`:a.name;a=a.parent;}}function nc(a,b){for(var c=0,d=0;d<b.length;d++)c=(c<<5)-c+b.charCodeAt(d)|0;return (a+c>>>0)%U.length}function cc(a,b){var c=16384===(a.mode&61440)?(c=oc(a,"x"))?c:a.O.lookup?0:2:54;if(c)throw new S(c);for(c=U[nc(a.id,b)];c;c=c.Ga){var d=c.name;if(c.parent.id===a.id&&d===b)return c}return a.O.lookup(a,b)}
function ac(a,b,c,d){a=new kc(a,b,c,d);b=nc(a.parent.id,a.name);a.Ga=U[b];return U[b]=a}function pc(a){var b=["r","w","rw"][a&3];a&512&&(b+="w");return b}function oc(a,b){if(ic)return 0;if(!b.includes("r")||a.mode&292){if(b.includes("w")&&!(a.mode&146)||b.includes("x")&&!(a.mode&73))return 2}else return 2;return 0}function qc(a,b){try{return cc(a,b),20}catch(c){}return oc(a,"wx")}function W(a){a=gc[a];if(!a)throw new S(8);return a}
var $b={open(a){a.V=fc[a.node.rdev].V;a.V.open?.(a);},ea(){throw new S(70);}};function Vb(a,b){fc[a]={V:b};}function rc(a,b){var c="/"===b;if(c&&ec)throw new S(10);if(!c&&b){var d=V(b,{wa:!1});b=d.path;d=d.node;if(d.la)throw new S(10);if(16384!==(d.mode&61440))throw new S(54);}b={type:a,Xa:{},za:b,Fa:[]};a=a.ba(b);a.ba=b;b.root=a;c?ec=a:d&&(d.la=b,d.ba&&d.ba.Fa.push(b));}
function sc(a,b,c){var d=V(a,{parent:!0}).node;a=Lb(a);if(!a||"."===a||".."===a)throw new S(28);var e=qc(d,a);if(e)throw new S(e);if(!d.O.ka)throw new S(63);return d.O.ka(d,a,b,c)}function X(a){return sc(a,16895,0)}function tc(a,b,c){"undefined"==typeof c&&(c=b,b=438);sc(a,b|8192,c);}function uc(a,b){if(!Ob(a))throw new S(44);var c=V(b,{parent:!0}).node;if(!c)throw new S(44);b=Lb(b);var d=qc(c,b);if(d)throw new S(d);if(!c.O.symlink)throw new S(63);c.O.symlink(c,b,a);}
function lc(a){a=V(a).node;if(!a)throw new S(44);if(!a.O.readlink)throw new S(28);return Ob(mc(a.parent),a.O.readlink(a))}
function vc(a,b){if(""===a)throw new S(44);if("string"==typeof b){var c={r:0,"r+":2,w:577,"w+":578,a:1089,"a+":1090}[b];if("undefined"==typeof c)throw Error(`Unknown file open mode: ${b}`);b=c;}var d=b&64?("undefined"==typeof d?438:d)&4095|32768:0;if("object"==typeof a)var e=a;else {a=Jb(a);try{e=V(a,{va:!(b&131072)}).node;}catch(f){}}c=!1;if(b&64)if(e){if(b&128)throw new S(20);}else e=sc(a,d,0),c=!0;if(!e)throw new S(44);8192===(e.mode&61440)&&(b&=-513);if(b&65536&&16384!==(e.mode&61440))throw new S(54);
if(!c&&(d=e?40960===(e.mode&61440)?32:16384===(e.mode&61440)&&("r"!==pc(b)||b&512)?31:oc(e,pc(b)):44))throw new S(d);if(b&512&&!c){d=e;d="string"==typeof d?V(d,{va:!0}).node:d;if(!d.O.Z)throw new S(63);if(16384===(d.mode&61440))throw new S(31);if(32768!==(d.mode&61440))throw new S(28);if(c=oc(d,"w"))throw new S(c);d.O.Z(d,{size:0,timestamp:Date.now()});}b&=-131713;e={node:e,path:mc(e),flags:b,seekable:!0,position:0,V:e.V,La:[],error:!1};d=-1;e=Object.assign(new jc,e);if(-1==d)a:{for(d=0;4096>=d;d++)if(!gc[d])break a;
throw new S(33);}e.fd=d;gc[d]=e;e.V.open&&e.V.open(e);!h.logReadFiles||b&1||(wc||={},a in wc||(wc[a]=1));}function xc(a,b,c){if(null===a.fd)throw new S(8);if(!a.seekable||!a.V.ea)throw new S(70);if(0!=c&&1!=c&&2!=c)throw new S(28);a.position=a.V.ea(a,b,c);a.La=[];}var yc;
function Y(a,b,c){a=Jb("/dev/"+a);var d=dc(!!b,!!c);zc||=64;var e=zc++<<8|0;Vb(e,{open(f){f.seekable=!1;},close(){c?.buffer?.length&&c(10);},read(f,l,m,p){for(var k=0,q=0;q<p;q++){try{var y=b();}catch(u){throw new S(29);}if(void 0===y&&0===k)throw new S(6);if(null===y||void 0===y)break;k++;l[m+q]=y;}k&&(f.node.timestamp=Date.now());return k},write(f,l,m,p){for(var k=0;k<p;k++)try{c(l[m+k]);}catch(q){throw new S(29);}p&&(f.node.timestamp=Date.now());return k}});tc(a,d,e);}
for(var zc,Ac={},wc,Bc=a=>0===a%4&&(0!==a%100||0===a%400),Cc=[31,29,31,30,31,30,31,31,30,31,30,31],Dc=[31,28,31,30,31,30,31,31,30,31,30,31],Ec=(a,b,c,d)=>{function e(g,r,v){for(g="number"==typeof g?g.toString():g||"";g.length<r;)g=v[0]+g;return g}function f(g,r){return e(g,r,"0")}function l(g,r){function v(A){return 0>A?-1:0<A?1:0}var w;0===(w=v(g.getFullYear()-r.getFullYear()))&&0===(w=v(g.getMonth()-r.getMonth()))&&(w=v(g.getDate()-r.getDate()));return w}function m(g){switch(g.getDay()){case 0:return new Date(g.getFullYear()-
1,11,29);case 1:return g;case 2:return new Date(g.getFullYear(),0,3);case 3:return new Date(g.getFullYear(),0,2);case 4:return new Date(g.getFullYear(),0,1);case 5:return new Date(g.getFullYear()-1,11,31);case 6:return new Date(g.getFullYear()-1,11,30)}}function p(g){var r=g.fa;for(g=new Date((new Date(g.ga+1900,0,1)).getTime());0<r;){var v=g.getMonth(),w=(Bc(g.getFullYear())?Cc:Dc)[v];if(r>w-g.getDate())r-=w-g.getDate()+1,g.setDate(1),11>v?g.setMonth(v+1):(g.setMonth(0),g.setFullYear(g.getFullYear()+
1));else {g.setDate(g.getDate()+r);break}}v=new Date(g.getFullYear()+1,0,4);r=m(new Date(g.getFullYear(),0,4));v=m(v);return 0>=l(r,g)?0>=l(v,g)?g.getFullYear()+1:g.getFullYear():g.getFullYear()-1}var k=C[d+40>>2];d={Ja:B[d>>2],Ia:B[d+4>>2],na:B[d+8>>2],sa:B[d+12>>2],oa:B[d+16>>2],ga:B[d+20>>2],$:B[d+24>>2],fa:B[d+28>>2],Ya:B[d+32>>2],Ha:B[d+36>>2],Ka:k?k?R(x,k):"":""};c=c?R(x,c):"";k={"%c":"%a %b %d %H:%M:%S %Y","%D":"%m/%d/%y","%F":"%Y-%m-%d","%h":"%b","%r":"%I:%M:%S %p","%R":"%H:%M","%T":"%H:%M:%S",
"%x":"%m/%d/%y","%X":"%H:%M:%S","%Ec":"%c","%EC":"%C","%Ex":"%m/%d/%y","%EX":"%H:%M:%S","%Ey":"%y","%EY":"%Y","%Od":"%d","%Oe":"%e","%OH":"%H","%OI":"%I","%Om":"%m","%OM":"%M","%OS":"%S","%Ou":"%u","%OU":"%U","%OV":"%V","%Ow":"%w","%OW":"%W","%Oy":"%y"};for(var q in k)c=c.replace(new RegExp(q,"g"),k[q]);var y="Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),u="January February March April May June July August September October November December".split(" ");k={"%a":g=>y[g.$].substring(0,
3),"%A":g=>y[g.$],"%b":g=>u[g.oa].substring(0,3),"%B":g=>u[g.oa],"%C":g=>f((g.ga+1900)/100|0,2),"%d":g=>f(g.sa,2),"%e":g=>e(g.sa,2," "),"%g":g=>p(g).toString().substring(2),"%G":p,"%H":g=>f(g.na,2),"%I":g=>{g=g.na;0==g?g=12:12<g&&(g-=12);return f(g,2)},"%j":g=>{for(var r=0,v=0;v<=g.oa-1;r+=(Bc(g.ga+1900)?Cc:Dc)[v++]);return f(g.sa+r,3)},"%m":g=>f(g.oa+1,2),"%M":g=>f(g.Ia,2),"%n":()=>"\n","%p":g=>0<=g.na&&12>g.na?"AM":"PM","%S":g=>f(g.Ja,2),"%t":()=>"\t","%u":g=>g.$||7,"%U":g=>f(Math.floor((g.fa+7-
g.$)/7),2),"%V":g=>{var r=Math.floor((g.fa+7-(g.$+6)%7)/7);2>=(g.$+371-g.fa-2)%7&&r++;if(r)53==r&&(v=(g.$+371-g.fa)%7,4==v||3==v&&Bc(g.ga)||(r=1));else {r=52;var v=(g.$+7-g.fa-1)%7;(4==v||5==v&&Bc(g.ga%400-1))&&r++;}return f(r,2)},"%w":g=>g.$,"%W":g=>f(Math.floor((g.fa+7-(g.$+6)%7)/7),2),"%y":g=>(g.ga+1900).toString().substring(2),"%Y":g=>g.ga+1900,"%z":g=>{g=g.Ha;var r=0<=g;g=Math.abs(g)/60;return (r?"+":"-")+String("0000"+(g/60*100+g%60)).slice(-4)},"%Z":g=>g.Ka,"%%":()=>"%"};c=c.replace(/%%/g,"\x00\x00");
for(q in k)c.includes(q)&&(c=c.replace(new RegExp(q,"g"),k[q](d)));c=c.replace(/\0\0/g,"%");q=Qb(c,!1);if(q.length>b)return 0;t.set(q,a);return q.length-1},Fc=Array(256),Gc=0;256>Gc;++Gc)Fc[Gc]=String.fromCharCode(Gc);Ja=Fc;L=h.BindingError=class extends Error{constructor(a){super(a);this.name="BindingError";}};Ma=h.InternalError=class extends Error{constructor(a){super(a);this.name="InternalError";}};N.push(0,1,void 0,1,null,1,!0,1,!1,1);h.count_emval_handles=()=>N.length/2-5-Qa.length;
hb=h.UnboundTypeError=((a,b)=>{var c=Va(b,function(d){this.name=b;this.message=d;d=Error(d).stack;void 0!==d&&(this.stack=this.toString()+"\n"+d.replace(/^Error(:[^\n]*)?\n/,""));});c.prototype=Object.create(a.prototype);c.prototype.constructor=c;c.prototype.toString=function(){return void 0===this.message?this.name:`${this.name}: ${this.message}`};return c})(Error,"UnboundTypeError");[44].forEach(a=>{bc[a]=new S(a);bc[a].stack="<generic error, no stack>";});U=Array(4096);rc(T,"/");X("/tmp");X("/home");
X("/home/web_user");(function(){X("/dev");Vb(259,{read:()=>0,write:(d,e,f,l)=>l});tc("/dev/null",259);Ub(1280,Xb);Ub(1536,Yb);tc("/dev/tty",1280);tc("/dev/tty1",1536);var a=new Uint8Array(1024),b=0,c=()=>{0===b&&(b=Nb(a).byteLength);return a[--b]};Y("random",c);Y("urandom",c);X("/dev/shm");X("/dev/shm/tmp");})();
(function(){X("/proc");var a=X("/proc/self");X("/proc/self/fd");rc({ba(){var b=ac(a,"fd",16895,73);b.O={lookup(c,d){var e=W(+d);c={parent:null,ba:{za:"fake"},O:{readlink:()=>e.path}};return c.parent=c}};return b}},"/proc/self/fd");})();
var Ic={o:(a,b,c)=>{var d=new Ga(a);C[d.ma+16>>2]=0;C[d.ma+4>>2]=b;C[d.ma+8>>2]=c;Ha=a;throw Ha;},B:()=>{F("");},t:()=>{},D:(a,b,c,d)=>{b=I(b);M(a,{name:b,fromWireType:function(e){return !!e},toWireType:function(e,f){return f?c:d},argPackAdvance:8,readValueFromPointer:function(e){return this.fromWireType(x[e])},aa:null});},C:a=>M(a,Ta),n:(a,b,c)=>{b=I(b);M(a,{name:b,fromWireType:d=>d,toWireType:(d,e)=>e,argPackAdvance:8,readValueFromPointer:Ua(b,c),aa:null});},f:(a,b,c,d,e,f,l)=>{var m=ab(b,c);a=
I(a);a=lb(a);e=gb(d,e);$a(a,function(){kb(`Cannot call ${a} due to unbound types`,m);},b-1);Na(m,p=>{var k=[p[0],null].concat(p.slice(1));p=a;var q=a;var y=e,u=k.length;if(2>u)throw new L("argTypes array size mismatch! Must at least get return value and 'this' types!");var g=null!==k[1]&&!1,r=Xa(k),v="void"!==k[0].name;y=[q,La,y,f,Wa,k[0],k[1]];for(var w=0;w<u-2;++w)y.push(k[w+2]);if(!r)for(w=g?1:2;w<k.length;++w)null!==k[w].aa&&y.push(k[w].aa);r=Xa(k);w=k.length;var A="",H="";for(u=0;u<w-2;++u)A+=
(0!==u?", ":"")+"arg"+u,H+=(0!==u?", ":"")+"arg"+u+"Wired";A=`\n        return function (${A}) {\n        if (arguments.length !== ${w-2}) {\n          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ${w-2}');\n        }`;r&&(A+="var destructors = [];\n");var Rb=r?"destructors":"null",Pa="humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");g&&(A+="var thisWired = classParam['toWireType']("+Rb+", this);\n");for(u=
0;u<w-2;++u)A+="var arg"+u+"Wired = argType"+u+"['toWireType']("+Rb+", arg"+u+");\n",Pa.push("argType"+u);g&&(H="thisWired"+(0<H.length?", ":"")+H);A+=(v||l?"var rv = ":"")+"invoker(fn"+(0<H.length?", ":"")+H+");\n";if(r)A+="runDestructors(destructors);\n";else for(u=g?1:2;u<k.length;++u)g=1===u?"thisWired":"arg"+(u-2)+"Wired",null!==k[u].aa&&(A+=`${g}_dtor(${g});\n`,Pa.push(`${g}_dtor`));v&&(A+="var ret = retType['fromWireType'](rv);\nreturn ret;\n");let [Sb,Kc]=[Pa,A+"}\n"];Sb.push(Kc);k=Ya(Sb)(...y);
q=Va(q,k);k=b-1;if(!h.hasOwnProperty(p))throw new Ma("Replacing nonexistent public symbol");void 0!==h[p].Y&&void 0!==k?h[p].Y[k]=q:(h[p]=q,h[p].Ba=k);return []});},c:(a,b,c,d,e)=>{b=I(b);-1===e&&(e=4294967295);e=m=>m;if(0===d){var f=32-8*c;e=m=>m<<f>>>f;}var l=b.includes("unsigned")?function(m,p){return p>>>0}:function(m,p){return p};M(a,{name:b,fromWireType:e,toWireType:l,argPackAdvance:8,readValueFromPointer:mb(b,c,0!==d),aa:null});},a:(a,b,c)=>{function d(f){return new e(t.buffer,C[f+4>>2],C[f>>2])}
var e=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array][b];c=I(c);M(a,{name:c,fromWireType:d,argPackAdvance:8,readValueFromPointer:d},{Da:!0});},m:(a,b)=>{b=I(b);var c="std::string"===b;M(a,{name:b,fromWireType:function(d){var e=C[d>>2],f=d+4;if(c)for(var l=f,m=0;m<=e;++m){var p=f+m;if(m==e||0==x[p]){l=l?R(x,l,p-l):"";if(void 0===k)var k=l;else k+=String.fromCharCode(0),k+=l;l=p+1;}}else {k=Array(e);for(m=0;m<e;++m)k[m]=String.fromCharCode(x[f+m]);k=k.join("");}Q(d);
return k},toWireType:function(d,e){e instanceof ArrayBuffer&&(e=new Uint8Array(e));var f="string"==typeof e;if(!(f||e instanceof Uint8Array||e instanceof Uint8ClampedArray||e instanceof Int8Array))throw new L("Cannot pass non-string to std::string");var l=c&&f?ob(e):e.length;var m=Hc(4+l+1),p=m+4;C[m>>2]=l;if(c&&f)nb(e,x,p,l+1);else if(f)for(f=0;f<l;++f){var k=e.charCodeAt(f);if(255<k)throw Q(p),new L("String has UTF-16 code units that do not fit in 8 bits");x[p+f]=k;}else for(f=0;f<l;++f)x[p+f]=e[f];
null!==d&&d.push(Q,m);return m},argPackAdvance:8,readValueFromPointer:Sa,aa(d){Q(d);}});},g:(a,b,c)=>{c=I(c);if(2===b){var d=rb;var e=sb;var f=tb;var l=m=>qa[m>>1];}else 4===b&&(d=ub,e=vb,f=wb,l=m=>C[m>>2]);M(a,{name:c,fromWireType:m=>{for(var p=C[m>>2],k,q=m+4,y=0;y<=p;++y){var u=m+4+y*b;if(y==p||0==l(u))q=d(q,u-q),void 0===k?k=q:(k+=String.fromCharCode(0),k+=q),q=u+b;}Q(m);return k},toWireType:(m,p)=>{if("string"!=typeof p)throw new L(`Cannot pass non-string to C++ string type ${c}`);var k=f(p),q=Hc(4+
k+b);C[q>>2]=k/b;e(p,q+4,k+b);null!==m&&m.push(Q,q);return q},argPackAdvance:8,readValueFromPointer:Sa,aa(m){Q(m);}});},E:(a,b)=>{b=I(b);M(a,{Ea:!0,name:b,argPackAdvance:0,fromWireType:()=>{},toWireType:()=>{}});},A:(a,b,c)=>x.copyWithin(a,b,b+c),r:(a,b,c)=>{a=O(a);b=xb(b,"emval::as");return yb(b,c,a)},p:(a,b,c,d)=>{a=zb[a];b=O(b);return a(null,b,c,d)},q:(a,b,c,d,e)=>{a=zb[a];b=O(b);c=Bb(c);return a(b,b[c],d,e)},b:Ra,H:(a,b)=>{a=O(a);b=O(b);return a==b},i:a=>{if(0===a)return P(Cb());a=Bb(a);return P(Cb()[a])},
e:(a,b,c)=>{b=Eb(a,b);var d=b.shift();a--;var e="return function (obj, func, destructorsRef, args) {\n",f=0,l=[];0===c&&l.push("obj");for(var m=["retType"],p=[d],k=0;k<a;++k)l.push("arg"+k),m.push("argType"+k),p.push(b[k]),e+=`  var arg${k} = argType${k}.readValueFromPointer(args${f?"+"+f:""});\n`,f+=b[k].argPackAdvance;e+=`  var rv = ${1===c?"new func":"func.call"}(${l.join(", ")});\n`;d.Ea||(m.push("emval_returnValue"),p.push(yb),e+="  return emval_returnValue(retType, destructorsRef, rv);\n");
m.push(e+"};\n");a=Ya(m)(...p);c=`methodCaller<(${b.map(q=>q.name).join(", ")}) => ${d.name}>`;return Db(Va(c,a))},G:a=>{a=Bb(a);return P(h[a])},j:(a,b)=>{a=O(a);b=O(b);return P(a[b])},h:a=>{9<a&&(N[a+1]+=1);},l:a=>P(Bb(a)),d:a=>{var b=O(a);Wa(b);Ra(a);},F:(a,b)=>{a=xb(a,"_emval_take_value");a=a.readValueFromPointer(b);return P(a)},y:()=>{F("OOM");},v:(a,b)=>{var c=0;Hb().forEach((d,e)=>{var f=b+c;e=C[a+4*e>>2]=f;for(f=0;f<d.length;++f)t[e++]=d.charCodeAt(f);t[e]=0;c+=d.length+1;});return 0},w:(a,b)=>
{var c=Hb();C[a>>2]=c.length;var d=0;c.forEach(e=>d+=e.length+1);C[b>>2]=d;return 0},z:function(a){try{var b=W(a);if(null===b.fd)throw new S(8);b.pa&&(b.pa=null);try{b.V.close&&b.V.close(b);}catch(c){throw c;}finally{gc[b.fd]=null;}b.fd=null;return 0}catch(c){if("undefined"==typeof Ac||"ErrnoError"!==c.name)throw c;return c.ja}},x:function(a,b,c,d){try{a:{var e=W(a);a=b;for(var f,l=b=0;l<c;l++){var m=C[a>>2],p=C[a+4>>2];a+=8;var k=e,q=f,y=t;if(0>p||0>q)throw new S(28);if(null===k.fd)throw new S(8);
if(1===(k.flags&2097155))throw new S(8);if(16384===(k.node.mode&61440))throw new S(31);if(!k.V.read)throw new S(28);var u="undefined"!=typeof q;if(!u)q=k.position;else if(!k.seekable)throw new S(70);var g=k.V.read(k,y,m,p,q);u||(k.position+=g);var r=g;if(0>r){var v=-1;break a}b+=r;if(r<p)break;"undefined"!=typeof f&&(f+=r);}v=b;}C[d>>2]=v;return 0}catch(w){if("undefined"==typeof Ac||"ErrnoError"!==w.name)throw w;return w.ja}},s:function(a,b,c,d,e){b=c+2097152>>>0<4194305-!!b?(b>>>0)+4294967296*c:NaN;
try{if(isNaN(b))return 61;var f=W(a);xc(f,b,d);Ea=[f.position>>>0,(G=f.position,1<=+Math.abs(G)?0<G?+Math.floor(G/4294967296)>>>0:~~+Math.ceil((G-+(~~G>>>0))/4294967296)>>>0:0)];B[e>>2]=Ea[0];B[e+4>>2]=Ea[1];f.pa&&0===b&&0===d&&(f.pa=null);return 0}catch(l){if("undefined"==typeof Ac||"ErrnoError"!==l.name)throw l;return l.ja}},k:function(a,b,c,d){try{a:{var e=W(a);a=b;for(var f,l=b=0;l<c;l++){var m=C[a>>2],p=C[a+4>>2];a+=8;var k=e,q=m,y=p,u=f,g=t;if(0>y||0>u)throw new S(28);if(null===k.fd)throw new S(8);
if(0===(k.flags&2097155))throw new S(8);if(16384===(k.node.mode&61440))throw new S(31);if(!k.V.write)throw new S(28);k.seekable&&k.flags&1024&&xc(k,0,2);var r="undefined"!=typeof u;if(!r)u=k.position;else if(!k.seekable)throw new S(70);var v=k.V.write(k,g,q,y,u,void 0);r||(k.position+=v);var w=v;if(0>w){var A=-1;break a}b+=w;"undefined"!=typeof f&&(f+=w);}A=b;}C[d>>2]=A;return 0}catch(H){if("undefined"==typeof Ac||"ErrnoError"!==H.name)throw H;return H.ja}},u:(a,b,c,d)=>Ec(a,b,c,d)},Z=function(){function a(c){Z=
c.exports;oa=Z.I;c=oa.buffer;h.HEAP8=t=new Int8Array(c);h.HEAP16=z=new Int16Array(c);h.HEAPU8=x=new Uint8Array(c);h.HEAPU16=qa=new Uint16Array(c);h.HEAP32=B=new Int32Array(c);h.HEAPU32=C=new Uint32Array(c);h.HEAPF32=ra=new Float32Array(c);h.HEAPF64=sa=new Float64Array(c);cb=Z.L;ua.unshift(Z.J);D--;h.monitorRunDependencies?.(D);0==D&&(E&&(c=E,E=null,c()));return Z}var b={a:Ic};D++;h.monitorRunDependencies?.(D);if(h.instantiateWasm)try{return h.instantiateWasm(b,
a)}catch(c){n(`Module.instantiateWasm callback failed with error: ${c}`),ba(c);}za||=h.locateFile?ya("rsiscool.wasm")?"rsiscool.wasm":h.locateFile?h.locateFile("rsiscool.wasm",fa):fa+"rsiscool.wasm":(new URL("rsiscool.wasm",import.meta.url)).href;Da(b,function(c){a(c.instance);}).catch(ba);return {}}(),ib=a=>(ib=Z.K)(a),Q=a=>(Q=Z.M)(a),Hc=a=>(Hc=Z.N)(a);h.dynCall_jiji=(a,b,c,d,e)=>(h.dynCall_jiji=Z.P)(a,b,c,d,e);h.dynCall_viijii=(a,b,c,d,e,f,l)=>(h.dynCall_viijii=Z.Q)(a,b,c,d,e,f,l);
h.dynCall_iiiiij=(a,b,c,d,e,f,l)=>(h.dynCall_iiiiij=Z.R)(a,b,c,d,e,f,l);h.dynCall_iiiiijj=(a,b,c,d,e,f,l,m,p)=>(h.dynCall_iiiiijj=Z.S)(a,b,c,d,e,f,l,m,p);h.dynCall_iiiiiijj=(a,b,c,d,e,f,l,m,p,k)=>(h.dynCall_iiiiiijj=Z.T)(a,b,c,d,e,f,l,m,p,k);var Jc;E=function Lc(){Jc||Mc();Jc||(E=Lc);};
function Mc(){function a(){if(!Jc&&(Jc=!0,h.calledRun=!0,!pa)){h.noFSInit||yc||(yc=!0,h.stdin=h.stdin,h.stdout=h.stdout,h.stderr=h.stderr,h.stdin?Y("stdin",h.stdin):uc("/dev/tty","/dev/stdin"),h.stdout?Y("stdout",null,h.stdout):uc("/dev/tty","/dev/stdout"),h.stderr?Y("stderr",null,h.stderr):uc("/dev/tty1","/dev/stderr"),vc("/dev/stdin",0),vc("/dev/stdout",1),vc("/dev/stderr",1));ic=!1;Fa(ua);aa(h);if(h.onRuntimeInitialized)h.onRuntimeInitialized();if(h.postRun)for("function"==typeof h.postRun&&(h.postRun=
[h.postRun]);h.postRun.length;){var b=h.postRun.shift();va.unshift(b);}Fa(va);}}if(!(0<D)){if(h.preRun)for("function"==typeof h.preRun&&(h.preRun=[h.preRun]);h.preRun.length;)wa();Fa(ta);0<D||(h.setStatus?(h.setStatus("Running..."),setTimeout(function(){setTimeout(function(){h.setStatus("");},1);a();},1)):a());}}if(h.preInit)for("function"==typeof h.preInit&&(h.preInit=[h.preInit]);0<h.preInit.length;)h.preInit.pop()();Mc();moduleRtn=ca;


  return moduleRtn;
}
);
})();

let wasmModule;
async function initWASM() {
    let module = await rsiscool();
    wasmModule = module;
    module.initGF2E();
}
await initWASM();
function decodeWASM(bytes, twoS) {
    if (!wasmModule) {
        throw new Error("decodeWASM not yet initialized");
    }
    const input = new Uint8ClampedArray(bytes);
    return wasmModule.decodeWASM(input, twoS);
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
        const correctedBytes = decodeWASM(dataBlock.codewords, dataBlock.codewords.length - dataBlock.numDataCodewords);
        if (!correctedBytes) {
            return null;
        }
        for (let i = 0; i < dataBlock.numDataCodewords; i++) {
            resultBytes[resultIndex++] = correctedBytes[i];
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
