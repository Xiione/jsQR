class GenericGFPoly {
    constructor(field, coefficients) {
        if (coefficients.length === 0) {
            throw new Error("No coefficients.");
        }
        this.field = field;
        const coefficientsLength = coefficients.length;
        if (coefficientsLength > 1 && coefficients[0] === 0) {
            // Leading term must be non-zero for anything except the constant polynomial "0"
            let firstNonZero = 1;
            while (firstNonZero < coefficientsLength &&
                coefficients[firstNonZero] === 0) {
                firstNonZero++;
            }
            if (firstNonZero === coefficientsLength) {
                this.coefficients = field.zero.coefficients;
            }
            else {
                this.coefficients = new Uint8ClampedArray(coefficientsLength - firstNonZero);
                for (let i = 0; i < this.coefficients.length; i++) {
                    this.coefficients[i] = coefficients[firstNonZero + i];
                }
            }
        }
        else {
            this.coefficients = coefficients;
        }
    }
    degree() {
        return this.coefficients.length - 1;
    }
    isZero() {
        return this.coefficients[0] === 0;
    }
    getCoefficient(degree) {
        return this.coefficients[this.coefficients.length - 1 - degree];
    }
    addOrSubtract(other) {
        if (this.isZero()) {
            return other;
        }
        if (other.isZero()) {
            return this;
        }
        let smallerCoefficients = this.coefficients;
        let largerCoefficients = other.coefficients;
        if (smallerCoefficients.length > largerCoefficients.length) {
            [smallerCoefficients, largerCoefficients] = [
                largerCoefficients,
                smallerCoefficients,
            ];
        }
        const sumDiff = new Uint8ClampedArray(largerCoefficients.length);
        const lengthDiff = largerCoefficients.length - smallerCoefficients.length;
        for (let i = 0; i < lengthDiff; i++) {
            sumDiff[i] = largerCoefficients[i];
        }
        for (let i = lengthDiff; i < largerCoefficients.length; i++) {
            sumDiff[i] = addOrSubtractGF(smallerCoefficients[i - lengthDiff], largerCoefficients[i]);
        }
        return new GenericGFPoly(this.field, sumDiff);
    }
    multiply(scalar) {
        if (scalar === 0) {
            return this.field.zero;
        }
        if (scalar === 1) {
            return this;
        }
        const size = this.coefficients.length;
        const product = new Uint8ClampedArray(size);
        for (let i = 0; i < size; i++) {
            product[i] = this.field.multiply(this.coefficients[i], scalar);
        }
        return new GenericGFPoly(this.field, product);
    }
    multiplyPoly(other) {
        if (this.isZero() || other.isZero()) {
            return this.field.zero;
        }
        const aCoefficients = this.coefficients;
        const aLength = aCoefficients.length;
        const bCoefficients = other.coefficients;
        const bLength = bCoefficients.length;
        const product = new Uint8ClampedArray(aLength + bLength - 1);
        for (let i = 0; i < aLength; i++) {
            const aCoeff = aCoefficients[i];
            for (let j = 0; j < bLength; j++) {
                product[i + j] = addOrSubtractGF(product[i + j], this.field.multiply(aCoeff, bCoefficients[j]));
            }
        }
        return new GenericGFPoly(this.field, product);
    }
    multiplyByMonomial(degree, coefficient) {
        if (degree < 0) {
            throw new Error("Invalid degree less than 0");
        }
        if (coefficient === 0) {
            return this.field.zero;
        }
        const size = this.coefficients.length;
        const product = new Uint8ClampedArray(size + degree);
        for (let i = 0; i < size; i++) {
            product[i] = this.field.multiply(this.coefficients[i], coefficient);
        }
        return new GenericGFPoly(this.field, product);
    }
    evaluateAt(a) {
        let result = 0;
        if (a === 0) {
            // Just return the x^0 coefficient
            return this.getCoefficient(0);
        }
        const size = this.coefficients.length;
        if (a === 1) {
            // Just the sum of the coefficients
            this.coefficients.forEach((coefficient) => {
                result = addOrSubtractGF(result, coefficient);
            });
            return result;
        }
        result = this.coefficients[0];
        for (let i = 1; i < size; i++) {
            result = addOrSubtractGF(this.field.multiply(a, result), this.coefficients[i]);
        }
        return result;
    }
}

function addOrSubtractGF(a, b) {
    return a ^ b; // tslint:disable-line:no-bitwise
}
class GenericGF {
    constructor(primitive, size, genBase) {
        this.primitive = primitive;
        this.size = size;
        this.generatorBase = genBase;
        this.expTable = new Array(this.size);
        this.logTable = new Array(this.size);
        let x = 1;
        for (let i = 0; i < this.size; i++) {
            this.expTable[i] = x;
            x = x * 2;
            if (x >= this.size) {
                x = (x ^ this.primitive) & (this.size - 1); // tslint:disable-line:no-bitwise
            }
        }
        for (let i = 0; i < this.size - 1; i++) {
            this.logTable[this.expTable[i]] = i;
        }
        this.zero = new GenericGFPoly(this, Uint8ClampedArray.from([0]));
        this.one = new GenericGFPoly(this, Uint8ClampedArray.from([1]));
    }
    multiply(a, b) {
        if (a === 0 || b === 0) {
            return 0;
        }
        return this.expTable[(this.logTable[a] + this.logTable[b]) % (this.size - 1)];
    }
    inverse(a) {
        if (a === 0) {
            throw new Error("Can't invert 0");
        }
        return this.expTable[this.size - this.logTable[a] - 1];
    }
    buildMonomial(degree, coefficient) {
        if (degree < 0) {
            throw new Error("Invalid monomial degree less than 0");
        }
        if (coefficient === 0) {
            return this.zero;
        }
        const coefficients = new Uint8ClampedArray(degree + 1);
        coefficients[0] = coefficient;
        return new GenericGFPoly(this, coefficients);
    }
    log(a) {
        if (a === 0) {
            throw new Error("Can't take log(0)");
        }
        return this.logTable[a];
    }
    exp(a) {
        return this.expTable[a];
    }
}

var rsiscool = (() => {
  var _scriptName = import.meta.url;
  
  return (
async function(moduleArg = {}) {
  var moduleRtn;

var m=moduleArg,aa,ba,ca=new Promise((a,b)=>{aa=a;ba=b;}),da="object"==typeof window,ea="function"==typeof importScripts,q="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node;if(q){const {createRequire:a}=await import('module');var require=a(import.meta.url);}var fa=Object.assign({},m),ha="./this.program",u="",ia,ja,ka;
if(q){var fs=require("fs"),la=require("path");u=require("url").fileURLToPath(new URL("./",import.meta.url));ia=(a,b)=>{a=ma(a)?new URL(a):la.normalize(a);return fs.readFileSync(a,b?void 0:"utf8")};ka=a=>{a=ia(a,!0);a.buffer||(a=new Uint8Array(a));return a};ja=(a,b,c)=>{a=ma(a)?new URL(a):la.normalize(a);fs.readFile(a,void 0,(d,e)=>{d?c(d):b(e.buffer);});};!m.thisProgram&&1<process.argv.length&&(ha=process.argv[1].replace(/\\/g,"/"));process.argv.slice(2);}else if(da||ea)ea?u=self.location.href:
"undefined"!=typeof document&&document.currentScript&&(u=document.currentScript.src),_scriptName&&(u=_scriptName),u.startsWith("blob:")?u="":u=u.substr(0,u.replace(/[?#].*/,"").lastIndexOf("/")+1),ia=a=>{var b=new XMLHttpRequest;b.open("GET",a,!1);b.send(null);return b.responseText},ea&&(ka=a=>{var b=new XMLHttpRequest;b.open("GET",a,!1);b.responseType="arraybuffer";b.send(null);return new Uint8Array(b.response)}),ja=(a,b,c)=>{if(ma(a)){var d=new XMLHttpRequest;d.open("GET",a,!0);d.responseType="arraybuffer";
d.onload=()=>{200==d.status||0==d.status&&d.response?b(d.response):c();};d.onerror=c;d.send(null);}else fetch(a,{credentials:"same-origin"}).then(e=>e.ok?e.arrayBuffer():Promise.reject(Error(e.status+" : "+e.url))).then(b,c);};var oa=m.print||console.log.bind(console),v=m.printErr||console.error.bind(console);Object.assign(m,fa);fa=null;m.thisProgram&&(ha=m.thisProgram);var y;m.wasmBinary&&(y=m.wasmBinary);var pa,qa=!1,A,C,D,ra,E,F,sa,ta,ua=[],va=[],wa=[];
function xa(){var a=m.preRun.shift();ua.unshift(a);}var G=0,za=null;function Aa(a){m.onAbort?.(a);a="Aborted("+a+")";v(a);qa=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");ba(a);throw a;}var Ba=a=>a.startsWith("data:application/octet-stream;base64,"),ma=a=>a.startsWith("file://"),Ca;function Da(a){if(a==Ca&&y)return new Uint8Array(y);if(ka)return ka(a);throw "both async and sync fetching of the wasm failed";}
function Ea(a){return y?Promise.resolve().then(()=>Da(a)):new Promise((b,c)=>{ja(a,d=>b(new Uint8Array(d)),()=>{try{b(Da(a));}catch(d){c(d);}});})}function Fa(a,b,c){return Ea(a).then(d=>WebAssembly.instantiate(d,b)).then(c,d=>{v(`failed to asynchronously prepare wasm: ${d}`);Aa(d);})}
function Ga(a,b){var c=Ca;return y||"function"!=typeof WebAssembly.instantiateStreaming||Ba(c)||ma(c)||q||"function"!=typeof fetch?Fa(c,a,b):fetch(c,{credentials:"same-origin"}).then(d=>WebAssembly.instantiateStreaming(d,a).then(b,function(e){v(`wasm streaming compile failed: ${e}`);v("falling back to ArrayBuffer instantiation");return Fa(c,a,b)}))}var I,Ha,Ia=a=>{for(;0<a.length;)a.shift()(m);};class Ja{constructor(a){this.$=a-24;}}var Ka=0,Ma={},Na=a=>{for(;a.length;){var b=a.pop();a.pop()(b);}};
function Oa(a){return this.fromWireType(F[a>>2])}
var J={},K={},Pa={},Qa,M=(a,b,c)=>{function d(l){l=c(l);if(l.length!==a.length)throw new Qa("Mismatched type converter count");for(var n=0;n<a.length;++n)L(a[n],l[n]);}a.forEach(function(l){Pa[l]=b;});var e=Array(b.length),f=[],h=0;b.forEach((l,n)=>{K.hasOwnProperty(l)?e[n]=K[l]:(f.push(l),J.hasOwnProperty(l)||(J[l]=[]),J[l].push(()=>{e[n]=K[l];++h;h===f.length&&d(e);}));});0===f.length&&d(e);},Ra,N=a=>{for(var b="";C[a];)b+=Ra[C[a++]];return b},O,Sa=a=>{throw new O(a);};
function Ta(a,b,c={}){var d=b.name;if(!a)throw new O(`type "${d}" must have a positive integer typeid pointer`);if(K.hasOwnProperty(a)){if(c.ib)return;throw new O(`Cannot register type '${d}' twice`);}K[a]=b;delete Pa[a];J.hasOwnProperty(a)&&(b=J[a],delete J[a],b.forEach(e=>e()));}function L(a,b,c={}){if(!("argPackAdvance"in b))throw new TypeError("registerType registeredInstance requires argPackAdvance");return Ta(a,b,c)}
var Ua=a=>{throw new O(a.R.ba.aa.name+" instance already deleted");},Va=!1,Wa=()=>{},Xa=(a,b,c)=>{if(b===c)return a;if(void 0===c.ga)return null;a=Xa(a,b,c.ga);return null===a?null:c.ab(a)},Ya={},Za=[],$a=()=>{for(;Za.length;){var a=Za.pop();a.R.ta=!1;a["delete"]();}},ab,bb={},cb=(a,b)=>{if(void 0===b)throw new O("ptr should not be undefined");for(;a.ga;)b=a.xa(b),a=a.ga;return bb[b]},eb=(a,b)=>{if(!b.ba||!b.$)throw new Qa("makeClassHandle requires ptr and ptrType");if(!!b.ha!==!!b.ea)throw new Qa("Both smartPtrType and smartPtr must be specified");
b.count={value:1};return db(Object.create(a,{R:{value:b,writable:!0}}))},db=a=>{if("undefined"===typeof FinalizationRegistry)return db=b=>b,a;Va=new FinalizationRegistry(b=>{b=b.R;--b.count.value;0===b.count.value&&(b.ea?b.ha.ka(b.ea):b.ba.aa.ka(b.$));});db=b=>{var c=b.R;c.ea&&Va.register(b,{R:c},b);return b};Wa=b=>{Va.unregister(b);};return db(a)};function fb(){}
var gb=(a,b)=>Object.defineProperty(b,"name",{value:a}),hb=(a,b,c)=>{if(void 0===a[b].fa){var d=a[b];a[b]=function(...e){if(!a[b].fa.hasOwnProperty(e.length))throw new O(`Function '${c}' called with an invalid number of arguments (${e.length}) - expects one of (${a[b].fa})!`);return a[b].fa[e.length].apply(this,e)};a[b].fa=[];a[b].fa[d.za]=d;}},ib=(a,b,c)=>{if(m.hasOwnProperty(a)){if(void 0===c||void 0!==m[a].fa&&void 0!==m[a].fa[c])throw new O(`Cannot register public name '${a}' twice`);hb(m,a,a);
if(m.hasOwnProperty(c))throw new O(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`);m[a].fa[c]=b;}else m[a]=b,void 0!==c&&(m[a].Ib=c);},jb=a=>{if(void 0===a)return "_unknown";a=a.replace(/[^a-zA-Z0-9_]/g,"$");var b=a.charCodeAt(0);return 48<=b&&57>=b?`_${a}`:a};function kb(a,b,c,d,e,f,h,l){this.name=a;this.constructor=b;this.ua=c;this.ka=d;this.ga=e;this.cb=f;this.xa=h;this.ab=l;this.nb=[];}
var lb=(a,b,c)=>{for(;b!==c;){if(!b.xa)throw new O(`Expected null or instance of ${c.name}, got an instance of ${b.name}`);a=b.xa(a);b=b.ga;}return a};function nb(a,b){if(null===b){if(this.Ia)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.R)throw new O(`Cannot pass "${ob(b)}" as a ${this.name}`);if(!b.R.$)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);return lb(b.R.$,b.R.ba.aa,this.aa)}
function pb(a,b){if(null===b){if(this.Ia)throw new O(`null is not a valid ${this.name}`);if(this.Ca){var c=this.Ka();null!==a&&a.push(this.ka,c);return c}return 0}if(!b||!b.R)throw new O(`Cannot pass "${ob(b)}" as a ${this.name}`);if(!b.R.$)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(!this.Ba&&b.R.ba.Ba)throw new O(`Cannot convert argument of type ${b.R.ha?b.R.ha.name:b.R.ba.name} to parameter type ${this.name}`);c=lb(b.R.$,b.R.ba.aa,this.aa);if(this.Ca){if(void 0===
b.R.ea)throw new O("Passing raw pointer to smart pointer is illegal");switch(this.sb){case 0:if(b.R.ha===this)c=b.R.ea;else throw new O(`Cannot convert argument of type ${b.R.ha?b.R.ha.name:b.R.ba.name} to parameter type ${this.name}`);break;case 1:c=b.R.ea;break;case 2:if(b.R.ha===this)c=b.R.ea;else {var d=b.clone();c=this.ob(c,P(()=>d["delete"]()));null!==a&&a.push(this.ka,c);}break;default:throw new O("Unsupporting sharing policy");}}return c}
function qb(a,b){if(null===b){if(this.Ia)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.R)throw new O(`Cannot pass "${ob(b)}" as a ${this.name}`);if(!b.R.$)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(b.R.ba.Ba)throw new O(`Cannot convert argument of type ${b.R.ba.name} to parameter type ${this.name}`);return lb(b.R.$,b.R.ba.aa,this.aa)}
function rb(a,b,c,d,e,f,h,l,n,k,p){this.name=a;this.aa=b;this.Ia=c;this.Ba=d;this.Ca=e;this.mb=f;this.sb=h;this.Ya=l;this.Ka=n;this.ob=k;this.ka=p;e||void 0!==b.ga?this.toWireType=pb:(this.toWireType=d?nb:qb,this.ia=null);}
var sb=(a,b,c)=>{if(!m.hasOwnProperty(a))throw new Qa("Replacing nonexistent public symbol");void 0!==m[a].fa&&void 0!==c?m[a].fa[c]=b:(m[a]=b,m[a].za=c);},tb=[],ub,vb=a=>{var b=tb[a];b||(a>=tb.length&&(tb.length=a+1),tb[a]=b=ub.get(a));return b},wb=(a,b,c=[])=>{a.includes("j")?(a=a.replace(/p/g,"i"),b=(0, m["dynCall_"+a])(b,...c)):b=vb(b)(...c);return b},xb=(a,b)=>(...c)=>wb(a,b,c),Q=(a,b)=>{a=N(a);var c=a.includes("j")?xb(a,b):vb(b);if("function"!=typeof c)throw new O(`unknown function pointer with signature ${a}: ${b}`);
return c},yb,Ab=a=>{a=zb(a);var b=N(a);R(a);return b},Bb=(a,b)=>{function c(f){e[f]||K[f]||(Pa[f]?Pa[f].forEach(c):(d.push(f),e[f]=!0));}var d=[],e={};b.forEach(c);throw new yb(`${a}: `+d.map(Ab).join([", "]));},Cb=(a,b)=>{for(var c=[],d=0;d<a;d++)c.push(F[b+4*d>>2]);return c};function Db(a){for(var b=1;b<a.length;++b)if(null!==a[b]&&void 0===a[b].ia)return !0;return !1}
function Eb(a){var b=Function;if(!(b instanceof Function))throw new TypeError(`new_ called with constructor type ${typeof b} which is not a function`);var c=gb(b.name||"unknownFunctionName",function(){});c.prototype=b.prototype;c=new c;a=b.apply(c,a);return a instanceof Object?a:c}
function Fb(a,b,c,d,e,f){var h=b.length;if(2>h)throw new O("argTypes array size mismatch! Must at least get return value and 'this' types!");var l=null!==b[1]&&null!==c,n=Db(b);c="void"!==b[0].name;d=[a,Sa,d,e,Na,b[0],b[1]];for(e=0;e<h-2;++e)d.push(b[e+2]);if(!n)for(e=l?1:2;e<b.length;++e)null!==b[e].ia&&d.push(b[e].ia);n=Db(b);e=b.length;var k="",p="";for(h=0;h<e-2;++h)k+=(0!==h?", ":"")+"arg"+h,p+=(0!==h?", ":"")+"arg"+h+"Wired";k=`\n        return function (${k}) {\n        if (arguments.length !== ${e-
2}) {\n          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ${e-2}');\n        }`;n&&(k+="var destructors = [];\n");var w=n?"destructors":"null",x="humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");l&&(k+="var thisWired = classParam['toWireType']("+w+", this);\n");for(h=0;h<e-2;++h)k+="var arg"+h+"Wired = argType"+h+"['toWireType']("+w+", arg"+h+");\n",x.push("argType"+h);l&&(p="thisWired"+(0<p.length?", ":
"")+p);k+=(c||f?"var rv = ":"")+"invoker(fn"+(0<p.length?", ":"")+p+");\n";if(n)k+="runDestructors(destructors);\n";else for(h=l?1:2;h<b.length;++h)f=1===h?"thisWired":"arg"+(h-2)+"Wired",null!==b[h].ia&&(k+=`${f}_dtor(${f});\n`,x.push(`${f}_dtor`));c&&(k+="var ret = retType['fromWireType'](rv);\nreturn ret;\n");let [g,r]=[x,k+"}\n"];g.push(r);b=Eb(g)(...d);return gb(a,b)}
var Gb=a=>{a=a.trim();const b=a.indexOf("(");return -1!==b?a.substr(0,b):a},Hb=[],S=[],Ib=a=>{9<a&&0===--S[a+1]&&(S[a]=void 0,Hb.push(a));},T=a=>{if(!a)throw new O("Cannot use deleted val. handle = "+a);return S[a]},P=a=>{switch(a){case void 0:return 2;case null:return 4;case !0:return 6;case !1:return 8;default:const b=Hb.pop()||S.length;S[b]=a;S[b+1]=1;return b}},Jb={name:"emscripten::val",fromWireType:a=>{var b=T(a);Ib(a);return b},toWireType:(a,b)=>P(b),argPackAdvance:8,readValueFromPointer:Oa,
ia:null},ob=a=>{if(null===a)return "null";var b=typeof a;return "object"===b||"array"===b||"function"===b?a.toString():""+a},Kb=(a,b)=>{switch(b){case 4:return function(c){return this.fromWireType(sa[c>>2])};case 8:return function(c){return this.fromWireType(ta[c>>3])};default:throw new TypeError(`invalid float width (${b}): ${a}`);}},Lb=(a,b,c)=>{switch(b){case 1:return c?d=>A[d]:d=>C[d];case 2:return c?d=>D[d>>1]:d=>ra[d>>1];case 4:return c?d=>E[d>>2]:d=>F[d>>2];default:throw new TypeError(`invalid integer width (${b}): ${a}`);
}},Mb=(a,b,c,d)=>{if(!(0<d))return 0;var e=c;d=c+d-1;for(var f=0;f<a.length;++f){var h=a.charCodeAt(f);if(55296<=h&&57343>=h){var l=a.charCodeAt(++f);h=65536+((h&1023)<<10)|l&1023;}if(127>=h){if(c>=d)break;b[c++]=h;}else {if(2047>=h){if(c+1>=d)break;b[c++]=192|h>>6;}else {if(65535>=h){if(c+2>=d)break;b[c++]=224|h>>12;}else {if(c+3>=d)break;b[c++]=240|h>>18;b[c++]=128|h>>12&63;}b[c++]=128|h>>6&63;}b[c++]=128|h&63;}}b[c]=0;return c-e},Nb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);127>=d?b++:2047>=
d?b+=2:55296<=d&&57343>=d?(b+=4,++c):b+=3;}return b},Ob="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0,U=(a,b,c)=>{var d=b+c;for(c=b;a[c]&&!(c>=d);)++c;if(16<c-b&&a.buffer&&Ob)return Ob.decode(a.subarray(b,c));for(d="";b<c;){var e=a[b++];if(e&128){var f=a[b++]&63;if(192==(e&224))d+=String.fromCharCode((e&31)<<6|f);else {var h=a[b++]&63;e=224==(e&240)?(e&15)<<12|f<<6|h:(e&7)<<18|f<<12|h<<6|a[b++]&63;65536>e?d+=String.fromCharCode(e):(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|
e&1023));}}else d+=String.fromCharCode(e);}return d},Pb="undefined"!=typeof TextDecoder?new TextDecoder("utf-16le"):void 0,Qb=(a,b)=>{var c=a>>1;for(var d=c+b/2;!(c>=d)&&ra[c];)++c;c<<=1;if(32<c-a&&Pb)return Pb.decode(C.subarray(a,c));c="";for(d=0;!(d>=b/2);++d){var e=D[a+2*d>>1];if(0==e)break;c+=String.fromCharCode(e);}return c},Rb=(a,b,c)=>{c??=2147483647;if(2>c)return 0;c-=2;var d=b;c=c<2*a.length?c/2:a.length;for(var e=0;e<c;++e)D[b>>1]=a.charCodeAt(e),b+=2;D[b>>1]=0;return b-d},Sb=a=>2*a.length,
Tb=(a,b)=>{for(var c=0,d="";!(c>=b/4);){var e=E[a+4*c>>2];if(0==e)break;++c;65536<=e?(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023)):d+=String.fromCharCode(e);}return d},Ub=(a,b,c)=>{c??=2147483647;if(4>c)return 0;var d=b;c=d+c-4;for(var e=0;e<a.length;++e){var f=a.charCodeAt(e);if(55296<=f&&57343>=f){var h=a.charCodeAt(++e);f=65536+((f&1023)<<10)|h&1023;}E[b>>2]=f;b+=4;if(b+4>c)break}E[b>>2]=0;return b-d},Vb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);55296<=d&&57343>=d&&
++c;b+=4;}return b},Wb=(a,b)=>{var c=K[a];if(void 0===c)throw a=`${b} has unknown type ${Ab(a)}`,new O(a);return c},Xb=(a,b,c)=>{var d=[];a=a.toWireType(d,c);d.length&&(F[b>>2]=P(d));return a},Yb={},Zb=a=>{var b=Yb[a];return void 0===b?N(a):b},$b=[],ac=a=>{var b=$b.length;$b.push(a);return b},bc=(a,b)=>{for(var c=Array(a),d=0;d<a;++d)c[d]=Wb(F[b+4*d>>2],"parameter "+d);return c},cc={},ec=()=>{if(!dc){var a={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:("object"==typeof navigator&&
navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8",_:ha||"./this.program"},b;for(b in cc)void 0===cc[b]?delete a[b]:a[b]=cc[b];var c=[];for(b in a)c.push(`${b}=${a[b]}`);dc=c;}return dc},dc,fc=(a,b)=>{for(var c=0,d=a.length-1;0<=d;d--){var e=a[d];"."===e?a.splice(d,1):".."===e?(a.splice(d,1),c++):c&&(a.splice(d,1),c--);}if(b)for(;c;c--)a.unshift("..");return a},gc=a=>{var b="/"===a.charAt(0),c="/"===a.substr(-1);(a=fc(a.split("/").filter(d=>!!d),!b).join("/"))||b||(a=".");a&&
c&&(a+="/");return (b?"/":"")+a},hc=a=>{var b=/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);a=b[0];b=b[1];if(!a&&!b)return ".";b&&=b.substr(0,b.length-1);return a+b},ic=a=>{if("/"===a)return "/";a=gc(a);a=a.replace(/\/$/,"");var b=a.lastIndexOf("/");return -1===b?a:a.substr(b+1)},jc=()=>{if("object"==typeof crypto&&"function"==typeof crypto.getRandomValues)return c=>crypto.getRandomValues(c);if(q)try{var a=require("crypto");if(a.randomFillSync)return c=>a.randomFillSync(c);
var b=a.randomBytes;return c=>(c.set(b(c.byteLength)),c)}catch(c){}Aa("initRandomDevice");},kc=a=>(kc=jc())(a),lc=(...a)=>{for(var b="",c=!1,d=a.length-1;-1<=d&&!c;d--){c=0<=d?a[d]:"/";if("string"!=typeof c)throw new TypeError("Arguments to path.resolve must be strings");if(!c)return "";b=c+"/"+b;c="/"===c.charAt(0);}b=fc(b.split("/").filter(e=>!!e),!c).join("/");return (c?"/":"")+b||"."},mc=[];function nc(a,b){var c=Array(Nb(a)+1);a=Mb(a,c,0,c.length);b&&(c.length=a);return c}var oc=[];
function pc(a,b){oc[a]={input:[],output:[],va:b};qc(a,rc);}
var rc={open(a){var b=oc[a.node.rdev];if(!b)throw new V(43);a.tty=b;a.seekable=!1;},close(a){a.tty.va.fsync(a.tty);},fsync(a){a.tty.va.fsync(a.tty);},read(a,b,c,d){if(!a.tty||!a.tty.va.Ua)throw new V(60);for(var e=0,f=0;f<d;f++){try{var h=a.tty.va.Ua(a.tty);}catch(l){throw new V(29);}if(void 0===h&&0===e)throw new V(6);if(null===h||void 0===h)break;e++;b[c+f]=h;}e&&(a.node.timestamp=Date.now());return e},write(a,b,c,d){if(!a.tty||!a.tty.va.Ja)throw new V(60);try{for(var e=0;e<d;e++)a.tty.va.Ja(a.tty,b[c+
e]);}catch(f){throw new V(29);}d&&(a.node.timestamp=Date.now());return e}},sc={Ua(){a:{if(!mc.length){var a=null;if(q){var b=Buffer.alloc(256),c=0,d=process.stdin.fd;try{c=fs.readSync(d,b,0,256);}catch(e){if(e.toString().includes("EOF"))c=0;else throw e;}0<c&&(a=b.slice(0,c).toString("utf-8"));}else "undefined"!=typeof window&&"function"==typeof window.prompt&&(a=window.prompt("Input: "),null!==a&&(a+="\n"));if(!a){a=null;break a}mc=nc(a,!0);}a=mc.shift();}return a},Ja(a,b){null===b||10===b?(oa(U(a.output,
0)),a.output=[]):0!=b&&a.output.push(b);},fsync(a){a.output&&0<a.output.length&&(oa(U(a.output,0)),a.output=[]);},Fb(){return {Bb:25856,Db:5,Ab:191,Cb:35387,zb:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},Gb(){return 0},Hb(){return [24,80]}},tc={Ja(a,b){null===b||10===b?(v(U(a.output,0)),a.output=[]):0!=b&&a.output.push(b);},fsync(a){a.output&&0<a.output.length&&(v(U(a.output,0)),a.output=[]);}};
function vc(a,b){var c=a.Y?a.Y.length:0;c>=b||(b=Math.max(b,c*(1048576>c?2:1.125)>>>0),0!=c&&(b=Math.max(b,256)),c=a.Y,a.Y=new Uint8Array(b),0<a.da&&a.Y.set(c.subarray(0,a.da),0));}
var W={ja:null,na(){return W.createNode(null,"/",16895,0)},createNode(a,b,c,d){if(24576===(c&61440)||4096===(c&61440))throw new V(63);W.ja||(W.ja={dir:{node:{oa:W.X.oa,la:W.X.la,lookup:W.X.lookup,Da:W.X.Da,rename:W.X.rename,unlink:W.X.unlink,rmdir:W.X.rmdir,readdir:W.X.readdir,symlink:W.X.symlink},stream:{qa:W.Z.qa}},file:{node:{oa:W.X.oa,la:W.X.la},stream:{qa:W.Z.qa,read:W.Z.read,write:W.Z.write,Oa:W.Z.Oa,Va:W.Z.Va,Xa:W.Z.Xa}},link:{node:{oa:W.X.oa,la:W.X.la,readlink:W.X.readlink},stream:{}},Pa:{node:{oa:W.X.oa,
la:W.X.la},stream:wc}});c=xc(a,b,c,d);16384===(c.mode&61440)?(c.X=W.ja.dir.node,c.Z=W.ja.dir.stream,c.Y={}):32768===(c.mode&61440)?(c.X=W.ja.file.node,c.Z=W.ja.file.stream,c.da=0,c.Y=null):40960===(c.mode&61440)?(c.X=W.ja.link.node,c.Z=W.ja.link.stream):8192===(c.mode&61440)&&(c.X=W.ja.Pa.node,c.Z=W.ja.Pa.stream);c.timestamp=Date.now();a&&(a.Y[b]=c,a.timestamp=c.timestamp);return c},Eb(a){return a.Y?a.Y.subarray?a.Y.subarray(0,a.da):new Uint8Array(a.Y):new Uint8Array(0)},X:{oa(a){var b={};b.dev=8192===
(a.mode&61440)?a.id:1;b.ino=a.id;b.mode=a.mode;b.nlink=1;b.uid=0;b.gid=0;b.rdev=a.rdev;16384===(a.mode&61440)?b.size=4096:32768===(a.mode&61440)?b.size=a.da:40960===(a.mode&61440)?b.size=a.link.length:b.size=0;b.atime=new Date(a.timestamp);b.mtime=new Date(a.timestamp);b.ctime=new Date(a.timestamp);b.Za=4096;b.blocks=Math.ceil(b.size/b.Za);return b},la(a,b){void 0!==b.mode&&(a.mode=b.mode);void 0!==b.timestamp&&(a.timestamp=b.timestamp);if(void 0!==b.size&&(b=b.size,a.da!=b))if(0==b)a.Y=null,a.da=
0;else {var c=a.Y;a.Y=new Uint8Array(b);c&&a.Y.set(c.subarray(0,Math.min(b,a.da)));a.da=b;}},lookup(){throw yc[44];},Da(a,b,c,d){return W.createNode(a,b,c,d)},rename(a,b,c){if(16384===(a.mode&61440)){try{var d=zc(b,c);}catch(f){}if(d)for(var e in d.Y)throw new V(55);}delete a.parent.Y[a.name];a.parent.timestamp=Date.now();a.name=c;b.Y[c]=a;b.timestamp=a.parent.timestamp;},unlink(a,b){delete a.Y[b];a.timestamp=Date.now();},rmdir(a,b){var c=zc(a,b),d;for(d in c.Y)throw new V(55);delete a.Y[b];a.timestamp=
Date.now();},readdir(a){var b=[".",".."],c;for(c of Object.keys(a.Y))b.push(c);return b},symlink(a,b,c){a=W.createNode(a,b,41471,0);a.link=c;return a},readlink(a){if(40960!==(a.mode&61440))throw new V(28);return a.link}},Z:{read(a,b,c,d,e){var f=a.node.Y;if(e>=a.node.da)return 0;a=Math.min(a.node.da-e,d);if(8<a&&f.subarray)b.set(f.subarray(e,e+a),c);else for(d=0;d<a;d++)b[c+d]=f[e+d];return a},write(a,b,c,d,e,f){if(!d)return 0;a=a.node;a.timestamp=Date.now();if(b.subarray&&(!a.Y||a.Y.subarray)){if(f)return a.Y=
b.subarray(c,c+d),a.da=d;if(0===a.da&&0===e)return a.Y=b.slice(c,c+d),a.da=d;if(e+d<=a.da)return a.Y.set(b.subarray(c,c+d),e),d}vc(a,e+d);if(a.Y.subarray&&b.subarray)a.Y.set(b.subarray(c,c+d),e);else for(f=0;f<d;f++)a.Y[e+f]=b[c+f];a.da=Math.max(a.da,e+d);return d},qa(a,b,c){1===c?b+=a.position:2===c&&32768===(a.node.mode&61440)&&(b+=a.node.da);if(0>b)throw new V(28);return b},Oa(a,b,c){vc(a.node,b+c);a.node.da=Math.max(a.node.da,b+c);},Va(a,b,c,d,e){if(32768!==(a.node.mode&61440))throw new V(43);
a=a.node.Y;if(e&2||a.buffer!==A.buffer){if(0<c||c+b<a.length)a.subarray?a=a.subarray(c,c+b):a=Array.prototype.slice.call(a,c,c+b);c=!0;Aa();b=void 0;if(!b)throw new V(48);A.set(a,b);}else c=!1,b=a.byteOffset;return {$:b,yb:c}},Xa(a,b,c,d){W.Z.write(a,b,0,d,c,!1);return 0}}},Ac=(a,b)=>{var c=0;a&&(c|=365);b&&(c|=146);return c},Bc=null,Cc={},Dc=[],Ec=1,Fc=null,Gc=!0,V=class{constructor(a){this.name="ErrnoError";this.Aa=a;}},yc={},Hc=class{constructor(){this.ya={};this.node=null;}get flags(){return this.ya.flags}set flags(a){this.ya.flags=
a;}get position(){return this.ya.position}set position(a){this.ya.position=a;}},Ic=class{constructor(a,b,c,d){a||=this;this.parent=a;this.na=a.na;this.Ea=null;this.id=Ec++;this.name=b;this.mode=c;this.X={};this.Z={};this.rdev=d;}get read(){return 365===(this.mode&365)}set read(a){a?this.mode|=365:this.mode&=-366;}get write(){return 146===(this.mode&146)}set write(a){a?this.mode|=146:this.mode&=-147;}};
function X(a,b={}){a=lc(a);if(!a)return {path:"",node:null};b=Object.assign({Ta:!0,La:0},b);if(8<b.La)throw new V(32);a=a.split("/").filter(h=>!!h);for(var c=Bc,d="/",e=0;e<a.length;e++){var f=e===a.length-1;if(f&&b.parent)break;c=zc(c,a[e]);d=gc(d+"/"+a[e]);c.Ea&&(!f||f&&b.Ta)&&(c=c.Ea.root);if(!f||b.Sa)for(f=0;40960===(c.mode&61440);)if(c=Jc(d),d=lc(hc(d),c),c=X(d,{La:b.La+1}).node,40<f++)throw new V(32);}return {path:d,node:c}}
function Kc(a){for(var b;;){if(a===a.parent)return a=a.na.Wa,b?"/"!==a[a.length-1]?`${a}/${b}`:a+b:a;b=b?`${a.name}/${b}`:a.name;a=a.parent;}}function Lc(a,b){for(var c=0,d=0;d<b.length;d++)c=(c<<5)-c+b.charCodeAt(d)|0;return (a+c>>>0)%Fc.length}function zc(a,b){var c=16384===(a.mode&61440)?(c=Mc(a,"x"))?c:a.X.lookup?0:2:54;if(c)throw new V(c);for(c=Fc[Lc(a.id,b)];c;c=c.lb){var d=c.name;if(c.parent.id===a.id&&d===b)return c}return a.X.lookup(a,b)}
function xc(a,b,c,d){a=new Ic(a,b,c,d);b=Lc(a.parent.id,a.name);a.lb=Fc[b];return Fc[b]=a}function Nc(a){var b=["r","w","rw"][a&3];a&512&&(b+="w");return b}function Mc(a,b){if(Gc)return 0;if(!b.includes("r")||a.mode&292){if(b.includes("w")&&!(a.mode&146)||b.includes("x")&&!(a.mode&73))return 2}else return 2;return 0}function Oc(a,b){try{return zc(a,b),20}catch(c){}return Mc(a,"wx")}function Pc(a){a=Dc[a];if(!a)throw new V(8);return a}
var wc={open(a){a.Z=Cc[a.node.rdev].Z;a.Z.open?.(a);},qa(){throw new V(70);}};function qc(a,b){Cc[a]={Z:b};}function Qc(a,b){var c="/"===b;if(c&&Bc)throw new V(10);if(!c&&b){var d=X(b,{Ta:!1});b=d.path;d=d.node;if(d.Ea)throw new V(10);if(16384!==(d.mode&61440))throw new V(54);}b={type:a,Jb:{},Wa:b,kb:[]};a=a.na(b);a.na=b;b.root=a;c?Bc=a:d&&(d.Ea=b,d.na&&d.na.kb.push(b));}
function Rc(a,b,c){var d=X(a,{parent:!0}).node;a=ic(a);if(!a||"."===a||".."===a)throw new V(28);var e=Oc(d,a);if(e)throw new V(e);if(!d.X.Da)throw new V(63);return d.X.Da(d,a,b,c)}function Y(a){return Rc(a,16895,0)}function Sc(a,b,c){"undefined"==typeof c&&(c=b,b=438);Rc(a,b|8192,c);}function Tc(a,b){if(!lc(a))throw new V(44);var c=X(b,{parent:!0}).node;if(!c)throw new V(44);b=ic(b);var d=Oc(c,b);if(d)throw new V(d);if(!c.X.symlink)throw new V(63);c.X.symlink(c,b,a);}
function Jc(a){a=X(a).node;if(!a)throw new V(44);if(!a.X.readlink)throw new V(28);return lc(Kc(a.parent),a.X.readlink(a))}
function Uc(a,b){if(""===a)throw new V(44);if("string"==typeof b){var c={r:0,"r+":2,w:577,"w+":578,a:1089,"a+":1090}[b];if("undefined"==typeof c)throw Error(`Unknown file open mode: ${b}`);b=c;}var d=b&64?("undefined"==typeof d?438:d)&4095|32768:0;if("object"==typeof a)var e=a;else {a=gc(a);try{e=X(a,{Sa:!(b&131072)}).node;}catch(f){}}c=!1;if(b&64)if(e){if(b&128)throw new V(20);}else e=Rc(a,d,0),c=!0;if(!e)throw new V(44);8192===(e.mode&61440)&&(b&=-513);if(b&65536&&16384!==(e.mode&61440))throw new V(54);
if(!c&&(d=e?40960===(e.mode&61440)?32:16384===(e.mode&61440)&&("r"!==Nc(b)||b&512)?31:Mc(e,Nc(b)):44))throw new V(d);if(b&512&&!c){d=e;d="string"==typeof d?X(d,{Sa:!0}).node:d;if(!d.X.la)throw new V(63);if(16384===(d.mode&61440))throw new V(31);if(32768!==(d.mode&61440))throw new V(28);if(c=Mc(d,"w"))throw new V(c);d.X.la(d,{size:0,timestamp:Date.now()});}b&=-131713;e={node:e,path:Kc(e),flags:b,seekable:!0,position:0,Z:e.Z,xb:[],error:!1};d=-1;e=Object.assign(new Hc,e);if(-1==d)a:{for(d=0;4096>=d;d++)if(!Dc[d])break a;
throw new V(33);}e.fd=d;Dc[d]=e;e.Z.open&&e.Z.open(e);!m.logReadFiles||b&1||(Vc||={},a in Vc||(Vc[a]=1));}function Wc(a,b,c){if(null===a.fd)throw new V(8);if(!a.seekable||!a.Z.qa)throw new V(70);if(0!=c&&1!=c&&2!=c)throw new V(28);a.position=a.Z.qa(a,b,c);a.xb=[];}var Xc;
function Yc(a,b,c){a=gc("/dev/"+a);var d=Ac(!!b,!!c);Zc||=64;var e=Zc++<<8|0;qc(e,{open(f){f.seekable=!1;},close(){c?.buffer?.length&&c(10);},read(f,h,l,n){for(var k=0,p=0;p<n;p++){try{var w=b();}catch(x){throw new V(29);}if(void 0===w&&0===k)throw new V(6);if(null===w||void 0===w)break;k++;h[l+p]=w;}k&&(f.node.timestamp=Date.now());return k},write(f,h,l,n){for(var k=0;k<n;k++)try{c(h[l+k]);}catch(p){throw new V(29);}n&&(f.node.timestamp=Date.now());return k}});Sc(a,d,e);}
var Zc,$c={},Vc,ad=a=>0===a%4&&(0!==a%100||0===a%400),bd=[31,29,31,30,31,30,31,31,30,31,30,31],cd=[31,28,31,30,31,30,31,31,30,31,30,31],dd=(a,b,c,d)=>{function e(g,r,t){for(g="number"==typeof g?g.toString():g||"";g.length<r;)g=t[0]+g;return g}function f(g,r){return e(g,r,"0")}function h(g,r){function t(H){return 0>H?-1:0<H?1:0}var z;0===(z=t(g.getFullYear()-r.getFullYear()))&&0===(z=t(g.getMonth()-r.getMonth()))&&(z=t(g.getDate()-r.getDate()));return z}function l(g){switch(g.getDay()){case 0:return new Date(g.getFullYear()-
1,11,29);case 1:return g;case 2:return new Date(g.getFullYear(),0,3);case 3:return new Date(g.getFullYear(),0,2);case 4:return new Date(g.getFullYear(),0,1);case 5:return new Date(g.getFullYear()-1,11,31);case 6:return new Date(g.getFullYear()-1,11,30)}}function n(g){var r=g.ra;for(g=new Date((new Date(g.sa+1900,0,1)).getTime());0<r;){var t=g.getMonth(),z=(ad(g.getFullYear())?bd:cd)[t];if(r>z-g.getDate())r-=z-g.getDate()+1,g.setDate(1),11>t?g.setMonth(t+1):(g.setMonth(0),g.setFullYear(g.getFullYear()+
1));else {g.setDate(g.getDate()+r);break}}t=new Date(g.getFullYear()+1,0,4);r=l(new Date(g.getFullYear(),0,4));t=l(t);return 0>=h(r,g)?0>=h(t,g)?g.getFullYear()+1:g.getFullYear():g.getFullYear()-1}var k=F[d+40>>2];d={vb:E[d>>2],ub:E[d+4>>2],Fa:E[d+8>>2],Ma:E[d+12>>2],Ga:E[d+16>>2],sa:E[d+20>>2],ma:E[d+24>>2],ra:E[d+28>>2],Kb:E[d+32>>2],tb:E[d+36>>2],wb:k?k?U(C,k):"":""};c=c?U(C,c):"";k={"%c":"%a %b %d %H:%M:%S %Y","%D":"%m/%d/%y","%F":"%Y-%m-%d","%h":"%b","%r":"%I:%M:%S %p","%R":"%H:%M","%T":"%H:%M:%S",
"%x":"%m/%d/%y","%X":"%H:%M:%S","%Ec":"%c","%EC":"%C","%Ex":"%m/%d/%y","%EX":"%H:%M:%S","%Ey":"%y","%EY":"%Y","%Od":"%d","%Oe":"%e","%OH":"%H","%OI":"%I","%Om":"%m","%OM":"%M","%OS":"%S","%Ou":"%u","%OU":"%U","%OV":"%V","%Ow":"%w","%OW":"%W","%Oy":"%y"};for(var p in k)c=c.replace(new RegExp(p,"g"),k[p]);var w="Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),x="January February March April May June July August September October November December".split(" ");k={"%a":g=>w[g.ma].substring(0,
3),"%A":g=>w[g.ma],"%b":g=>x[g.Ga].substring(0,3),"%B":g=>x[g.Ga],"%C":g=>f((g.sa+1900)/100|0,2),"%d":g=>f(g.Ma,2),"%e":g=>e(g.Ma,2," "),"%g":g=>n(g).toString().substring(2),"%G":n,"%H":g=>f(g.Fa,2),"%I":g=>{g=g.Fa;0==g?g=12:12<g&&(g-=12);return f(g,2)},"%j":g=>{for(var r=0,t=0;t<=g.Ga-1;r+=(ad(g.sa+1900)?bd:cd)[t++]);return f(g.Ma+r,3)},"%m":g=>f(g.Ga+1,2),"%M":g=>f(g.ub,2),"%n":()=>"\n","%p":g=>0<=g.Fa&&12>g.Fa?"AM":"PM","%S":g=>f(g.vb,2),"%t":()=>"\t","%u":g=>g.ma||7,"%U":g=>f(Math.floor((g.ra+
7-g.ma)/7),2),"%V":g=>{var r=Math.floor((g.ra+7-(g.ma+6)%7)/7);2>=(g.ma+371-g.ra-2)%7&&r++;if(r)53==r&&(t=(g.ma+371-g.ra)%7,4==t||3==t&&ad(g.sa)||(r=1));else {r=52;var t=(g.ma+7-g.ra-1)%7;(4==t||5==t&&ad(g.sa%400-1))&&r++;}return f(r,2)},"%w":g=>g.ma,"%W":g=>f(Math.floor((g.ra+7-(g.ma+6)%7)/7),2),"%y":g=>(g.sa+1900).toString().substring(2),"%Y":g=>g.sa+1900,"%z":g=>{g=g.tb;var r=0<=g;g=Math.abs(g)/60;return (r?"+":"-")+String("0000"+(g/60*100+g%60)).slice(-4)},"%Z":g=>g.wb,"%%":()=>"%"};c=c.replace(/%%/g,
"\x00\x00");for(p in k)c.includes(p)&&(c=c.replace(new RegExp(p,"g"),k[p](d)));c=c.replace(/\0\0/g,"%");p=nc(c,!1);if(p.length>b)return 0;A.set(p,a);return p.length-1};Qa=m.InternalError=class extends Error{constructor(a){super(a);this.name="InternalError";}};for(var ed=Array(256),fd=0;256>fd;++fd)ed[fd]=String.fromCharCode(fd);Ra=ed;O=m.BindingError=class extends Error{constructor(a){super(a);this.name="BindingError";}};
Object.assign(fb.prototype,{isAliasOf:function(a){if(!(this instanceof fb&&a instanceof fb))return !1;var b=this.R.ba.aa,c=this.R.$;a.R=a.R;var d=a.R.ba.aa;for(a=a.R.$;b.ga;)c=b.xa(c),b=b.ga;for(;d.ga;)a=d.xa(a),d=d.ga;return b===d&&c===a},clone:function(){this.R.$||Ua(this);if(this.R.wa)return this.R.count.value+=1,this;var a=db,b=Object,c=b.create,d=Object.getPrototypeOf(this),e=this.R;a=a(c.call(b,d,{R:{value:{count:e.count,ta:e.ta,wa:e.wa,$:e.$,ba:e.ba,ea:e.ea,ha:e.ha}}}));a.R.count.value+=1;a.R.ta=
!1;return a},["delete"](){this.R.$||Ua(this);if(this.R.ta&&!this.R.wa)throw new O("Object already scheduled for deletion");Wa(this);var a=this.R;--a.count.value;0===a.count.value&&(a.ea?a.ha.ka(a.ea):a.ba.aa.ka(a.$));this.R.wa||(this.R.ea=void 0,this.R.$=void 0);},isDeleted:function(){return !this.R.$},deleteLater:function(){this.R.$||Ua(this);if(this.R.ta&&!this.R.wa)throw new O("Object already scheduled for deletion");Za.push(this);1===Za.length&&ab&&ab($a);this.R.ta=!0;return this}});
m.getInheritedInstanceCount=()=>Object.keys(bb).length;m.getLiveInheritedInstances=()=>{var a=[],b;for(b in bb)bb.hasOwnProperty(b)&&a.push(bb[b]);return a};m.flushPendingDeletes=$a;m.setDelayFunction=a=>{ab=a;Za.length&&ab&&ab($a);};
Object.assign(rb.prototype,{eb(a){this.Ya&&(a=this.Ya(a));return a},Qa(a){this.ka?.(a);},argPackAdvance:8,readValueFromPointer:Oa,fromWireType:function(a){function b(){return this.Ca?eb(this.aa.ua,{ba:this.mb,$:c,ha:this,ea:a}):eb(this.aa.ua,{ba:this,$:a})}var c=this.eb(a);if(!c)return this.Qa(a),null;var d=cb(this.aa,c);if(void 0!==d){if(0===d.R.count.value)return d.R.$=c,d.R.ea=a,d.clone();d=d.clone();this.Qa(a);return d}d=this.aa.cb(c);d=Ya[d];if(!d)return b.call(this);d=this.Ba?d.$a:d.pointerType;
var e=Xa(c,this.aa,d.aa);return null===e?b.call(this):this.Ca?eb(d.aa.ua,{ba:d,$:e,ha:this,ea:a}):eb(d.aa.ua,{ba:d,$:e})}});yb=m.UnboundTypeError=((a,b)=>{var c=gb(b,function(d){this.name=b;this.message=d;d=Error(d).stack;void 0!==d&&(this.stack=this.toString()+"\n"+d.replace(/^Error(:[^\n]*)?\n/,""));});c.prototype=Object.create(a.prototype);c.prototype.constructor=c;c.prototype.toString=function(){return void 0===this.message?this.name:`${this.name}: ${this.message}`};return c})(Error,"UnboundTypeError");
S.push(0,1,void 0,1,null,1,!0,1,!1,1);m.count_emval_handles=()=>S.length/2-5-Hb.length;[44].forEach(a=>{yc[a]=new V(a);yc[a].stack="<generic error, no stack>";});Fc=Array(4096);Qc(W,"/");Y("/tmp");Y("/home");Y("/home/web_user");(function(){Y("/dev");qc(259,{read:()=>0,write:(d,e,f,h)=>h});Sc("/dev/null",259);pc(1280,sc);pc(1536,tc);Sc("/dev/tty",1280);Sc("/dev/tty1",1536);var a=new Uint8Array(1024),b=0,c=()=>{0===b&&(b=kc(a).byteLength);return a[--b]};Yc("random",c);Yc("urandom",c);Y("/dev/shm");Y("/dev/shm/tmp");})();
(function(){Y("/proc");var a=Y("/proc/self");Y("/proc/self/fd");Qc({na(){var b=xc(a,"fd",16895,73);b.X={lookup(c,d){var e=Pc(+d);c={parent:null,na:{Wa:"fake"},X:{readlink:()=>e.path}};return c.parent=c}};return b}},"/proc/self/fd");})();
var hd={k:(a,b,c)=>{var d=new Ja(a);F[d.$+16>>2]=0;F[d.$+4>>2]=b;F[d.$+8>>2]=c;Ka=a;throw Ka;},C:()=>{Aa("");},I:a=>{var b=Ma[a];delete Ma[a];var c=b.Ka,d=b.ka,e=b.Ra,f=e.map(h=>h.hb).concat(e.map(h=>h.qb));M([a],f,h=>{var l={};e.forEach((n,k)=>{var p=h[k],w=n.fb,x=n.gb,g=h[k+e.length],r=n.pb,t=n.rb;l[n.bb]={read:z=>p.fromWireType(w(x,z)),write:(z,H)=>{var B=[];r(t,z,g.toWireType(B,H));Na(B);}};});return [{name:b.name,fromWireType:n=>{var k={},p;for(p in l)k[p]=l[p].read(n);d(n);return k},toWireType:(n,
k)=>{for(var p in l)if(!(p in k))throw new TypeError(`Missing field: "${p}"`);var w=c();for(p in l)l[p].write(w,k[p]);null!==n&&n.push(d,w);return w},argPackAdvance:8,readValueFromPointer:Oa,ia:d}]});},t:()=>{},E:(a,b,c,d)=>{b=N(b);L(a,{name:b,fromWireType:function(e){return !!e},toWireType:function(e,f){return f?c:d},argPackAdvance:8,readValueFromPointer:function(e){return this.fromWireType(C[e])},ia:null});},H:(a,b,c,d,e,f,h,l,n,k,p,w,x)=>{p=N(p);f=Q(e,f);l&&=Q(h,l);k&&=Q(n,k);x=Q(w,x);var g=jb(p);
ib(g,function(){Bb(`Cannot construct ${p} due to unbound types`,[d]);});M([a,b,c],d?[d]:[],r=>{r=r[0];if(d){var t=r.aa;var z=t.ua;}else z=fb.prototype;r=gb(p,function(...mb){if(Object.getPrototypeOf(this)!==H)throw new O("Use 'new' to construct "+p);if(void 0===B.pa)throw new O(p+" has no accessible constructor");var uc=B.pa[mb.length];if(void 0===uc)throw new O(`Tried to invoke ctor of ${p} with invalid number of parameters (${mb.length}) - expected (${Object.keys(B.pa).toString()}) parameters instead!`);
return uc.apply(this,mb)});var H=Object.create(z,{constructor:{value:r}});r.prototype=H;var B=new kb(p,r,H,x,t,f,l,k);if(B.ga){var na;(na=B.ga).Na??(na.Na=[]);B.ga.Na.push(B);}t=new rb(p,B,!0,!1,!1);na=new rb(p+"*",B,!1,!1,!1);z=new rb(p+" const*",B,!1,!0,!1);Ya[a]={pointerType:na,$a:z};sb(g,r);return [t,na,z]});},G:(a,b,c,d,e,f)=>{var h=Cb(b,c);e=Q(d,e);M([],[a],l=>{l=l[0];var n=`constructor ${l.name}`;void 0===l.aa.pa&&(l.aa.pa=[]);if(void 0!==l.aa.pa[b-1])throw new O(`Cannot register multiple constructors with identical number of parameters (${b-
1}) for class '${l.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);l.aa.pa[b-1]=()=>{Bb(`Cannot construct ${l.name} due to unbound types`,h);};M([],h,k=>{k.splice(1,0,null);l.aa.pa[b-1]=Fb(n,k,null,e,f);return []});return []});},d:(a,b,c,d,e,f,h,l,n)=>{var k=Cb(c,d);b=N(b);b=Gb(b);f=Q(e,f);M([],[a],p=>{function w(){Bb(`Cannot call ${x} due to unbound types`,k);}p=p[0];var x=`${p.name}.${b}`;b.startsWith("@@")&&(b=Symbol[b.substring(2)]);l&&p.aa.nb.push(b);
var g=p.aa.ua,r=g[b];void 0===r||void 0===r.fa&&r.className!==p.name&&r.za===c-2?(w.za=c-2,w.className=p.name,g[b]=w):(hb(g,b,x),g[b].fa[c-2]=w);M([],k,t=>{t=Fb(x,t,p,f,h,n);void 0===g[b].fa?(t.za=c-2,g[b]=t):g[b].fa[c-2]=t;return []});return []});},D:a=>L(a,Jb),i:(a,b,c)=>{b=N(b);L(a,{name:b,fromWireType:d=>d,toWireType:(d,e)=>e,argPackAdvance:8,readValueFromPointer:Kb(b,c),ia:null});},l:(a,b,c,d,e,f,h)=>{var l=Cb(b,c);a=N(a);a=Gb(a);e=Q(d,e);ib(a,function(){Bb(`Cannot call ${a} due to unbound types`,
l);},b-1);M([],l,n=>{n=[n[0],null].concat(n.slice(1));sb(a,Fb(a,n,null,e,f,h),b-1);return []});},b:(a,b,c,d,e)=>{b=N(b);-1===e&&(e=4294967295);e=l=>l;if(0===d){var f=32-8*c;e=l=>l<<f>>>f;}var h=b.includes("unsigned")?function(l,n){return n>>>0}:function(l,n){return n};L(a,{name:b,fromWireType:e,toWireType:h,argPackAdvance:8,readValueFromPointer:Lb(b,c,0!==d),ia:null});},a:(a,b,c)=>{function d(f){return new e(A.buffer,F[f+4>>2],F[f>>2])}var e=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,
Float32Array,Float64Array][b];c=N(c);L(a,{name:c,fromWireType:d,argPackAdvance:8,readValueFromPointer:d},{ib:!0});},m:a=>{L(a,Jb);},j:(a,b)=>{b=N(b);var c="std::string"===b;L(a,{name:b,fromWireType:function(d){var e=F[d>>2],f=d+4;if(c)for(var h=f,l=0;l<=e;++l){var n=f+l;if(l==e||0==C[n]){h=h?U(C,h,n-h):"";if(void 0===k)var k=h;else k+=String.fromCharCode(0),k+=h;h=n+1;}}else {k=Array(e);for(l=0;l<e;++l)k[l]=String.fromCharCode(C[f+l]);k=k.join("");}R(d);return k},toWireType:function(d,e){e instanceof ArrayBuffer&&
(e=new Uint8Array(e));var f="string"==typeof e;if(!(f||e instanceof Uint8Array||e instanceof Uint8ClampedArray||e instanceof Int8Array))throw new O("Cannot pass non-string to std::string");var h=c&&f?Nb(e):e.length;var l=gd(4+h+1),n=l+4;F[l>>2]=h;if(c&&f)Mb(e,C,n,h+1);else if(f)for(f=0;f<h;++f){var k=e.charCodeAt(f);if(255<k)throw R(n),new O("String has UTF-16 code units that do not fit in 8 bits");C[n+f]=k;}else for(f=0;f<h;++f)C[n+f]=e[f];null!==d&&d.push(R,l);return l},argPackAdvance:8,readValueFromPointer:Oa,
ia(d){R(d);}});},g:(a,b,c)=>{c=N(c);if(2===b){var d=Qb;var e=Rb;var f=Sb;var h=l=>ra[l>>1];}else 4===b&&(d=Tb,e=Ub,f=Vb,h=l=>F[l>>2]);L(a,{name:c,fromWireType:l=>{for(var n=F[l>>2],k,p=l+4,w=0;w<=n;++w){var x=l+4+w*b;if(w==n||0==h(x))p=d(p,x-p),void 0===k?k=p:(k+=String.fromCharCode(0),k+=p),p=x+b;}R(l);return k},toWireType:(l,n)=>{if("string"!=typeof n)throw new O(`Cannot pass non-string to C++ string type ${c}`);var k=f(n),p=gd(4+k+b);F[p>>2]=k/b;e(n,p+4,k+b);null!==l&&l.push(R,p);return p},argPackAdvance:8,
readValueFromPointer:Oa,ia(l){R(l);}});},o:(a,b,c,d,e,f)=>{Ma[a]={name:N(b),Ka:Q(c,d),ka:Q(e,f),Ra:[]};},n:(a,b,c,d,e,f,h,l,n,k)=>{Ma[a].Ra.push({bb:N(b),hb:c,fb:Q(d,e),gb:f,qb:h,pb:Q(l,n),rb:k});},F:(a,b)=>{b=N(b);L(a,{jb:!0,name:b,argPackAdvance:0,fromWireType:()=>{},toWireType:()=>{}});},B:(a,b,c)=>C.copyWithin(a,b,b+c),h:(a,b,c)=>{a=T(a);b=Wb(b,"emval::as");return Xb(b,c,a)},p:(a,b,c,d,e)=>{a=$b[a];b=T(b);c=Zb(c);return a(b,b[c],d,e)},c:Ib,q:(a,b,c)=>{b=bc(a,b);var d=b.shift();a--;var e="return function (obj, func, destructorsRef, args) {\n",
f=0,h=[];0===c&&h.push("obj");for(var l=["retType"],n=[d],k=0;k<a;++k)h.push("arg"+k),l.push("argType"+k),n.push(b[k]),e+=`  var arg${k} = argType${k}.readValueFromPointer(args${f?"+"+f:""});\n`,f+=b[k].argPackAdvance;e+=`  var rv = ${1===c?"new func":"func.call"}(${h.join(", ")});\n`;d.jb||(l.push("emval_returnValue"),n.push(Xb),e+="  return emval_returnValue(retType, destructorsRef, rv);\n");l.push(e+"};\n");a=Eb(l)(...n);c=`methodCaller<(${b.map(p=>p.name).join(", ")}) => ${d.name}>`;return ac(gb(c,
a))},J:(a,b)=>{a=T(a);b=T(b);return P(a[b])},r:a=>{9<a&&(S[a+1]+=1);},K:a=>P(Zb(a)),f:a=>{var b=T(a);Na(b);Ib(a);},e:(a,b)=>{a=Wb(a,"_emval_take_value");a=a.readValueFromPointer(b);return P(a)},A:()=>{Aa("OOM");},v:(a,b)=>{var c=0;ec().forEach((d,e)=>{var f=b+c;e=F[a+4*e>>2]=f;for(f=0;f<d.length;++f)A[e++]=d.charCodeAt(f);A[e]=0;c+=d.length+1;});return 0},w:(a,b)=>{var c=ec();F[a>>2]=c.length;var d=0;c.forEach(e=>d+=e.length+1);F[b>>2]=d;return 0},x:function(a){try{var b=Pc(a);if(null===b.fd)throw new V(8);
b.Ha&&(b.Ha=null);try{b.Z.close&&b.Z.close(b);}catch(c){throw c;}finally{Dc[b.fd]=null;}b.fd=null;return 0}catch(c){if("undefined"==typeof $c||"ErrnoError"!==c.name)throw c;return c.Aa}},z:function(a,b,c,d){try{a:{var e=Pc(a);a=b;for(var f,h=b=0;h<c;h++){var l=F[a>>2],n=F[a+4>>2];a+=8;var k=e,p=f,w=A;if(0>n||0>p)throw new V(28);if(null===k.fd)throw new V(8);if(1===(k.flags&2097155))throw new V(8);if(16384===(k.node.mode&61440))throw new V(31);if(!k.Z.read)throw new V(28);var x="undefined"!=typeof p;
if(!x)p=k.position;else if(!k.seekable)throw new V(70);var g=k.Z.read(k,w,l,n,p);x||(k.position+=g);var r=g;if(0>r){var t=-1;break a}b+=r;if(r<n)break;"undefined"!=typeof f&&(f+=r);}t=b;}F[d>>2]=t;return 0}catch(z){if("undefined"==typeof $c||"ErrnoError"!==z.name)throw z;return z.Aa}},s:function(a,b,c,d,e){b=c+2097152>>>0<4194305-!!b?(b>>>0)+4294967296*c:NaN;try{if(isNaN(b))return 61;var f=Pc(a);Wc(f,b,d);Ha=[f.position>>>0,(I=f.position,1<=+Math.abs(I)?0<I?+Math.floor(I/4294967296)>>>0:~~+Math.ceil((I-
+(~~I>>>0))/4294967296)>>>0:0)];E[e>>2]=Ha[0];E[e+4>>2]=Ha[1];f.Ha&&0===b&&0===d&&(f.Ha=null);return 0}catch(h){if("undefined"==typeof $c||"ErrnoError"!==h.name)throw h;return h.Aa}},y:function(a,b,c,d){try{a:{var e=Pc(a);a=b;for(var f,h=b=0;h<c;h++){var l=F[a>>2],n=F[a+4>>2];a+=8;var k=e,p=l,w=n,x=f,g=A;if(0>w||0>x)throw new V(28);if(null===k.fd)throw new V(8);if(0===(k.flags&2097155))throw new V(8);if(16384===(k.node.mode&61440))throw new V(31);if(!k.Z.write)throw new V(28);k.seekable&&k.flags&
1024&&Wc(k,0,2);var r="undefined"!=typeof x;if(!r)x=k.position;else if(!k.seekable)throw new V(70);var t=k.Z.write(k,g,p,w,x,void 0);r||(k.position+=t);var z=t;if(0>z){var H=-1;break a}b+=z;"undefined"!=typeof f&&(f+=z);}H=b;}F[d>>2]=H;return 0}catch(B){if("undefined"==typeof $c||"ErrnoError"!==B.name)throw B;return B.Aa}},u:(a,b,c,d)=>dd(a,b,c,d)},Z=function(){function a(c){Z=c.exports;pa=Z.L;c=pa.buffer;m.HEAP8=A=new Int8Array(c);m.HEAP16=D=new Int16Array(c);m.HEAPU8=C=new Uint8Array(c);m.HEAPU16=
ra=new Uint16Array(c);m.HEAP32=E=new Int32Array(c);m.HEAPU32=F=new Uint32Array(c);m.HEAPF32=sa=new Float32Array(c);m.HEAPF64=ta=new Float64Array(c);ub=Z.O;va.unshift(Z.M);G--;m.monitorRunDependencies?.(G);0==G&&(za&&(c=za,za=null,c()));return Z}var b={a:hd};G++;m.monitorRunDependencies?.(G);if(m.instantiateWasm)try{return m.instantiateWasm(b,a)}catch(c){v(`Module.instantiateWasm callback failed with error: ${c}`),ba(c);}Ca||=m.locateFile?Ba("rsiscool.wasm")?"rsiscool.wasm":
m.locateFile?m.locateFile("rsiscool.wasm",u):u+"rsiscool.wasm":(new URL("rsiscool.wasm",import.meta.url)).href;Ga(b,function(c){a(c.instance);}).catch(ba);return {}}(),zb=a=>(zb=Z.N)(a),gd=a=>(gd=Z.P)(a),R=a=>(R=Z.Q)(a);m.dynCall_viijii=(a,b,c,d,e,f,h)=>(m.dynCall_viijii=Z.S)(a,b,c,d,e,f,h);m.dynCall_jiji=(a,b,c,d,e)=>(m.dynCall_jiji=Z.T)(a,b,c,d,e);m.dynCall_iiiiij=(a,b,c,d,e,f,h)=>(m.dynCall_iiiiij=Z.U)(a,b,c,d,e,f,h);
m.dynCall_iiiiijj=(a,b,c,d,e,f,h,l,n)=>(m.dynCall_iiiiijj=Z.V)(a,b,c,d,e,f,h,l,n);m.dynCall_iiiiiijj=(a,b,c,d,e,f,h,l,n,k)=>(m.dynCall_iiiiiijj=Z.W)(a,b,c,d,e,f,h,l,n,k);var jd;za=function kd(){jd||ld();jd||(za=kd);};
function ld(){function a(){if(!jd&&(jd=!0,m.calledRun=!0,!qa)){m.noFSInit||Xc||(Xc=!0,m.stdin=m.stdin,m.stdout=m.stdout,m.stderr=m.stderr,m.stdin?Yc("stdin",m.stdin):Tc("/dev/tty","/dev/stdin"),m.stdout?Yc("stdout",null,m.stdout):Tc("/dev/tty","/dev/stdout"),m.stderr?Yc("stderr",null,m.stderr):Tc("/dev/tty1","/dev/stderr"),Uc("/dev/stdin",0),Uc("/dev/stdout",1),Uc("/dev/stderr",1));Gc=!1;Ia(va);aa(m);if(m.onRuntimeInitialized)m.onRuntimeInitialized();if(m.postRun)for("function"==typeof m.postRun&&
(m.postRun=[m.postRun]);m.postRun.length;){var b=m.postRun.shift();wa.unshift(b);}Ia(wa);}}if(!(0<G)){if(m.preRun)for("function"==typeof m.preRun&&(m.preRun=[m.preRun]);m.preRun.length;)xa();Ia(ua);0<G||(m.setStatus?(m.setStatus("Running..."),setTimeout(function(){setTimeout(function(){m.setStatus("");},1);a();},1)):a());}}if(m.preInit)for("function"==typeof m.preInit&&(m.preInit=[m.preInit]);0<m.preInit.length;)m.preInit.pop()();ld();moduleRtn=ca;


  return moduleRtn;
}
);
})();

let wasmModule = null;
let moduleLoading = null;
async function initDecoder() {
    if (!getDecoderInitialized()) {
        if (moduleLoading) {
            await moduleLoading;
        }
        else {
            moduleLoading = new Promise((resolve, reject) => {
                rsiscool().then((module) => {
                    wasmModule = module;
                    resolve();
                }).catch(reject);
            });
            await moduleLoading;
        }
    }
}
function getDecoderInitialized() {
    return !!wasmModule;
}
function runEuclideanAlgorithm(field, a, b, R) {
    // Assume a's degree is >= b's
    if (a.degree() < b.degree()) {
        [a, b] = [b, a];
    }
    let rLast = a;
    let r = b;
    let tLast = field.zero;
    let t = field.one;
    // Run Euclidean algorithm until r's degree is less than R/2
    while (r.degree() >= R / 2) {
        const rLastLast = rLast;
        const tLastLast = tLast;
        rLast = r;
        tLast = t;
        // Divide rLastLast by rLast, with quotient in q and remainder in r
        if (rLast.isZero()) {
            // Euclidean algorithm already terminated?
            return null;
        }
        r = rLastLast;
        let q = field.zero;
        const denominatorLeadingTerm = rLast.getCoefficient(rLast.degree());
        const dltInverse = field.inverse(denominatorLeadingTerm);
        while (r.degree() >= rLast.degree() && !r.isZero()) {
            const degreeDiff = r.degree() - rLast.degree();
            const scale = field.multiply(r.getCoefficient(r.degree()), dltInverse);
            q = q.addOrSubtract(field.buildMonomial(degreeDiff, scale));
            r = r.addOrSubtract(rLast.multiplyByMonomial(degreeDiff, scale));
        }
        t = q.multiplyPoly(tLast).addOrSubtract(tLastLast);
        if (r.degree() >= rLast.degree()) {
            return null;
        }
    }
    const sigmaTildeAtZero = t.getCoefficient(0);
    if (sigmaTildeAtZero === 0) {
        return null;
    }
    const inverse = field.inverse(sigmaTildeAtZero);
    return [t.multiply(inverse), r.multiply(inverse)];
}
function findErrorLocations(field, errorLocator) {
    // This is a direct application of Chien's search
    const numErrors = errorLocator.degree();
    if (numErrors === 1) {
        return [errorLocator.getCoefficient(1)];
    }
    const result = new Array(numErrors);
    let errorCount = 0;
    for (let i = 1; i < field.size && errorCount < numErrors; i++) {
        if (errorLocator.evaluateAt(i) === 0) {
            result[errorCount] = field.inverse(i);
            errorCount++;
        }
    }
    if (errorCount !== numErrors) {
        return null;
    }
    return result;
}
function findErrorMagnitudes(field, errorEvaluator, errorLocations) {
    // This is directly applying Forney's Formula
    const s = errorLocations.length;
    const result = new Array(s);
    for (let i = 0; i < s; i++) {
        const xiInverse = field.inverse(errorLocations[i]);
        let denominator = 1;
        for (let j = 0; j < s; j++) {
            if (i !== j) {
                denominator = field.multiply(denominator, addOrSubtractGF(1, field.multiply(errorLocations[j], xiInverse)));
            }
        }
        result[i] = field.multiply(errorEvaluator.evaluateAt(xiInverse), field.inverse(denominator));
        if (field.generatorBase !== 0) {
            result[i] = field.multiply(result[i], xiInverse);
        }
    }
    return result;
}
function decodeJS(bytes, twoS) {
    const outputBytes = new Uint8ClampedArray(bytes.length);
    outputBytes.set(bytes);
    const field = new GenericGF(0x011d, 256, 0); // x^8 + x^4 + x^3 + x^2 + 1
    const poly = new GenericGFPoly(field, outputBytes);
    const syndromeCoefficients = new Uint8ClampedArray(twoS);
    let error = false;
    for (let s = 0; s < twoS; s++) {
        const evaluation = poly.evaluateAt(field.exp(s + field.generatorBase));
        syndromeCoefficients[syndromeCoefficients.length - 1 - s] = evaluation;
        if (evaluation !== 0) {
            error = true;
        }
    }
    if (!error) {
        return outputBytes;
    }
    const syndrome = new GenericGFPoly(field, syndromeCoefficients);
    const sigmaOmega = runEuclideanAlgorithm(field, field.buildMonomial(twoS, 1), syndrome, twoS);
    if (sigmaOmega === null) {
        return null;
    }
    const errorLocations = findErrorLocations(field, sigmaOmega[0]);
    if (errorLocations == null) {
        return null;
    }
    const errorMagnitudes = findErrorMagnitudes(field, sigmaOmega[1], errorLocations);
    for (let i = 0; i < errorLocations.length; i++) {
        const position = outputBytes.length - 1 - field.log(errorLocations[i]);
        if (position < 0) {
            return null;
        }
        outputBytes[position] = addOrSubtractGF(outputBytes[position], errorMagnitudes[i]);
    }
    return outputBytes;
}
function decodeWASM(bytes, twoS) {
    if (!wasmModule) {
        throw new Error("WASM module not yet initialized");
    }
    return wasmModule["decodeWASM"](bytes, twoS);
}
function validateWASM(bytes, twoS) {
    if (!wasmModule) {
        throw new Error("WASM module not yet initialized");
    }
    return wasmModule["validateWASM"](bytes, twoS);
}

export { decodeJS, decodeWASM, getDecoderInitialized, initDecoder, validateWASM };
//# sourceMappingURL=index.js.map
