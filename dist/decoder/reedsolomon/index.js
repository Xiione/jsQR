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
function(moduleArg = {}) {
  var moduleRtn;

var m=moduleArg,aa,ba,ca=new Promise((a,b)=>{aa=a;ba=b;}),da=Object.assign({},m),ea="./this.program",q="",fa,ha;q=self.location.href;_scriptName&&(q=_scriptName);q.startsWith("blob:")?q="":q=q.substr(0,q.replace(/[?#].*/,"").lastIndexOf("/")+1);ha=a=>{var b=new XMLHttpRequest;b.open("GET",a,!1);b.responseType="arraybuffer";b.send(null);return new Uint8Array(b.response)};
fa=(a,b,c)=>{fetch(a,{credentials:"same-origin"}).then(d=>d.ok?d.arrayBuffer():Promise.reject(Error(d.status+" : "+d.url))).then(b,c);};var ia=m.print||console.log.bind(console),u=m.printErr||console.error.bind(console);Object.assign(m,da);da=null;m.thisProgram&&(ea=m.thisProgram);var v;m.wasmBinary&&(v=m.wasmBinary);var ja,ka=!1,y,A,C,la,D,E,na,oa,pa=[],qa=[],ra=[];function sa(){var a=m.preRun.shift();pa.unshift(a);}var F=0,H=null;
function ua(a){m.onAbort?.(a);a="Aborted("+a+")";u(a);ka=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");ba(a);throw a;}var va=a=>a.startsWith("data:application/octet-stream;base64,"),wa;function xa(a){if(a==wa&&v)return new Uint8Array(v);if(ha)return ha(a);throw "both async and sync fetching of the wasm failed";}function ya(a){return v?Promise.resolve().then(()=>xa(a)):new Promise((b,c)=>{fa(a,d=>b(new Uint8Array(d)),()=>{try{b(xa(a));}catch(d){c(d);}});})}
function za(a,b,c){return ya(a).then(d=>WebAssembly.instantiate(d,b)).then(c,d=>{u(`failed to asynchronously prepare wasm: ${d}`);ua(d);})}function Aa(a,b){var c=wa;return v||"function"!=typeof WebAssembly.instantiateStreaming||va(c)||"function"!=typeof fetch?za(c,a,b):fetch(c,{credentials:"same-origin"}).then(d=>WebAssembly.instantiateStreaming(d,a).then(b,function(e){u(`wasm streaming compile failed: ${e}`);u("falling back to ArrayBuffer instantiation");return za(c,a,b)}))}
var I,Ba,Ca=a=>{for(;0<a.length;)a.shift()(m);};class Da{constructor(a){this.aa=a-24;}}var Ea=0,Ga={},Ha=a=>{for(;a.length;){var b=a.pop();a.pop()(b);}};function Ia(a){return this.fromWireType(E[a>>2])}
var J={},K={},Ja={},Ka,M=(a,b,c)=>{function d(l){l=c(l);if(l.length!==a.length)throw new Ka("Mismatched type converter count");for(var n=0;n<a.length;++n)L(a[n],l[n]);}a.forEach(function(l){Ja[l]=b;});var e=Array(b.length),f=[],k=0;b.forEach((l,n)=>{K.hasOwnProperty(l)?e[n]=K[l]:(f.push(l),J.hasOwnProperty(l)||(J[l]=[]),J[l].push(()=>{e[n]=K[l];++k;k===f.length&&d(e);}));});0===f.length&&d(e);},La,N=a=>{for(var b="";A[a];)b+=La[A[a++]];return b},O,Ma=a=>{throw new O(a);};
function Na(a,b,c={}){var d=b.name;if(!a)throw new O(`type "${d}" must have a positive integer typeid pointer`);if(K.hasOwnProperty(a)){if(c.ub)return;throw new O(`Cannot register type '${d}' twice`);}K[a]=b;delete Ja[a];J.hasOwnProperty(a)&&(b=J[a],delete J[a],b.forEach(e=>e()));}function L(a,b,c={}){if(!("argPackAdvance"in b))throw new TypeError("registerType registeredInstance requires argPackAdvance");return Na(a,b,c)}
var Oa=a=>{throw new O(a.S.ca.ba.name+" instance already deleted");},Pa=!1,Qa=()=>{},Ra=(a,b,c)=>{if(b===c)return a;if(void 0===c.ha)return null;a=Ra(a,b,c.ha);return null===a?null:c.nb(a)},Sa={},Ta=[],Ua=()=>{for(;Ta.length;){var a=Ta.pop();a.S.va=!1;a["delete"]();}},Va,Wa={},Xa=(a,b)=>{if(void 0===b)throw new O("ptr should not be undefined");for(;a.ha;)b=a.Ca(b),a=a.ha;return Wa[b]},Za=(a,b)=>{if(!b.ca||!b.aa)throw new Ka("makeClassHandle requires ptr and ptrType");if(!!b.ia!==!!b.ea)throw new Ka("Both smartPtrType and smartPtr must be specified");
b.count={value:1};return Ya(Object.create(a,{S:{value:b,writable:!0}}))},Ya=a=>{if("undefined"===typeof FinalizationRegistry)return Ya=b=>b,a;Pa=new FinalizationRegistry(b=>{b=b.S;--b.count.value;0===b.count.value&&(b.ea?b.ia.ma(b.ea):b.ca.ba.ma(b.aa));});Ya=b=>{var c=b.S;c.ea&&Pa.register(b,{S:c},b);return b};Qa=b=>{Pa.unregister(b);};return Ya(a)};function $a(){}
var ab=(a,b)=>Object.defineProperty(b,"name",{value:a}),bb=(a,b,c)=>{if(void 0===a[b].ga){var d=a[b];a[b]=function(...e){if(!a[b].ga.hasOwnProperty(e.length))throw new O(`Function '${c}' called with an invalid number of arguments (${e.length}) - expects one of (${a[b].ga})!`);return a[b].ga[e.length].apply(this,e)};a[b].ga=[];a[b].ga[d.Ea]=d;}},cb=(a,b,c)=>{if(m.hasOwnProperty(a)){if(void 0===c||void 0!==m[a].ga&&void 0!==m[a].ga[c])throw new O(`Cannot register public name '${a}' twice`);bb(m,a,a);
if(m.hasOwnProperty(c))throw new O(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`);m[a].ga[c]=b;}else m[a]=b,void 0!==c&&(m[a].bc=c);},db=a=>{if(void 0===a)return "_unknown";a=a.replace(/[^a-zA-Z0-9_]/g,"$");var b=a.charCodeAt(0);return 48<=b&&57>=b?`_${a}`:a};function eb(a,b,c,d,e,f,k,l){this.name=a;this.constructor=b;this.xa=c;this.ma=d;this.ha=e;this.pb=f;this.Ca=k;this.nb=l;this.zb=[];}
var fb=(a,b,c)=>{for(;b!==c;){if(!b.Ca)throw new O(`Expected null or instance of ${c.name}, got an instance of ${b.name}`);a=b.Ca(a);b=b.ha;}return a};function hb(a,b){if(null===b){if(this.Qa)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.S)throw new O(`Cannot pass "${ib(b)}" as a ${this.name}`);if(!b.S.aa)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);return fb(b.S.aa,b.S.ca.ba,this.ba)}
function jb(a,b){if(null===b){if(this.Qa)throw new O(`null is not a valid ${this.name}`);if(this.Ia){var c=this.Sa();null!==a&&a.push(this.ma,c);return c}return 0}if(!b||!b.S)throw new O(`Cannot pass "${ib(b)}" as a ${this.name}`);if(!b.S.aa)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(!this.Ha&&b.S.ca.Ha)throw new O(`Cannot convert argument of type ${b.S.ia?b.S.ia.name:b.S.ca.name} to parameter type ${this.name}`);c=fb(b.S.aa,b.S.ca.ba,this.ba);if(this.Ia){if(void 0===
b.S.ea)throw new O("Passing raw pointer to smart pointer is illegal");switch(this.Eb){case 0:if(b.S.ia===this)c=b.S.ea;else throw new O(`Cannot convert argument of type ${b.S.ia?b.S.ia.name:b.S.ca.name} to parameter type ${this.name}`);break;case 1:c=b.S.ea;break;case 2:if(b.S.ia===this)c=b.S.ea;else {var d=b.clone();c=this.Ab(c,P(()=>d["delete"]()));null!==a&&a.push(this.ma,c);}break;default:throw new O("Unsupporting sharing policy");}}return c}
function kb(a,b){if(null===b){if(this.Qa)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.S)throw new O(`Cannot pass "${ib(b)}" as a ${this.name}`);if(!b.S.aa)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(b.S.ca.Ha)throw new O(`Cannot convert argument of type ${b.S.ca.name} to parameter type ${this.name}`);return fb(b.S.aa,b.S.ca.ba,this.ba)}
function lb(a,b,c,d,e,f,k,l,n,h,p){this.name=a;this.ba=b;this.Qa=c;this.Ha=d;this.Ia=e;this.yb=f;this.Eb=k;this.gb=l;this.Sa=n;this.Ab=h;this.ma=p;e||void 0!==b.ha?this.toWireType=jb:(this.toWireType=d?hb:kb,this.ka=null);}
var mb=(a,b,c)=>{if(!m.hasOwnProperty(a))throw new Ka("Replacing nonexistent public symbol");void 0!==m[a].ga&&void 0!==c?m[a].ga[c]=b:(m[a]=b,m[a].Ea=c);},nb=[],ob,pb=a=>{var b=nb[a];b||(a>=nb.length&&(nb.length=a+1),nb[a]=b=ob.get(a));return b},qb=(a,b,c=[])=>{a.includes("j")?(a=a.replace(/p/g,"i"),b=(0, m["dynCall_"+a])(b,...c)):b=pb(b)(...c);return b},rb=(a,b)=>(...c)=>qb(a,b,c),Q=(a,b)=>{a=N(a);var c=a.includes("j")?rb(a,b):pb(b);if("function"!=typeof c)throw new O(`unknown function pointer with signature ${a}: ${b}`);
return c},sb,ub=a=>{a=tb(a);var b=N(a);R(a);return b},vb=(a,b)=>{function c(f){e[f]||K[f]||(Ja[f]?Ja[f].forEach(c):(d.push(f),e[f]=!0));}var d=[],e={};b.forEach(c);throw new sb(`${a}: `+d.map(ub).join([", "]));},wb=(a,b)=>{for(var c=[],d=0;d<a;d++)c.push(E[b+4*d>>2]);return c};function xb(a){for(var b=1;b<a.length;++b)if(null!==a[b]&&void 0===a[b].ka)return !0;return !1}
function yb(a){var b=Function;if(!(b instanceof Function))throw new TypeError(`new_ called with constructor type ${typeof b} which is not a function`);var c=ab(b.name||"unknownFunctionName",function(){});c.prototype=b.prototype;c=new c;a=b.apply(c,a);return a instanceof Object?a:c}
function zb(a,b,c,d,e,f){var k=b.length;if(2>k)throw new O("argTypes array size mismatch! Must at least get return value and 'this' types!");var l=null!==b[1]&&null!==c,n=xb(b);c="void"!==b[0].name;d=[a,Ma,d,e,Ha,b[0],b[1]];for(e=0;e<k-2;++e)d.push(b[e+2]);if(!n)for(e=l?1:2;e<b.length;++e)null!==b[e].ka&&d.push(b[e].ka);n=xb(b);e=b.length;var h="",p="";for(k=0;k<e-2;++k)h+=(0!==k?", ":"")+"arg"+k,p+=(0!==k?", ":"")+"arg"+k+"Wired";h=`\n        return function (${h}) {\n        if (arguments.length !== ${e-
2}) {\n          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ${e-2}');\n        }`;n&&(h+="var destructors = [];\n");var w=n?"destructors":"null",x="humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");l&&(h+="var thisWired = classParam['toWireType']("+w+", this);\n");for(k=0;k<e-2;++k)h+="var arg"+k+"Wired = argType"+k+"['toWireType']("+w+", arg"+k+");\n",x.push("argType"+k);l&&(p="thisWired"+(0<p.length?", ":
"")+p);h+=(c||f?"var rv = ":"")+"invoker(fn"+(0<p.length?", ":"")+p+");\n";if(n)h+="runDestructors(destructors);\n";else for(k=l?1:2;k<b.length;++k)f=1===k?"thisWired":"arg"+(k-2)+"Wired",null!==b[k].ka&&(h+=`${f}_dtor(${f});\n`,x.push(`${f}_dtor`));c&&(h+="var ret = retType['fromWireType'](rv);\nreturn ret;\n");let [g,r]=[x,h+"}\n"];g.push(r);b=yb(g)(...d);return ab(a,b)}
var Ab=a=>{a=a.trim();const b=a.indexOf("(");return -1!==b?a.substr(0,b):a},Bb=[],S=[],Cb=a=>{9<a&&0===--S[a+1]&&(S[a]=void 0,Bb.push(a));},T=a=>{if(!a)throw new O("Cannot use deleted val. handle = "+a);return S[a]},P=a=>{switch(a){case void 0:return 2;case null:return 4;case !0:return 6;case !1:return 8;default:const b=Bb.pop()||S.length;S[b]=a;S[b+1]=1;return b}},Db={name:"emscripten::val",fromWireType:a=>{var b=T(a);Cb(a);return b},toWireType:(a,b)=>P(b),argPackAdvance:8,readValueFromPointer:Ia,
ka:null},ib=a=>{if(null===a)return "null";var b=typeof a;return "object"===b||"array"===b||"function"===b?a.toString():""+a},Eb=(a,b)=>{switch(b){case 4:return function(c){return this.fromWireType(na[c>>2])};case 8:return function(c){return this.fromWireType(oa[c>>3])};default:throw new TypeError(`invalid float width (${b}): ${a}`);}},Fb=(a,b,c)=>{switch(b){case 1:return c?d=>y[d]:d=>A[d];case 2:return c?d=>C[d>>1]:d=>la[d>>1];case 4:return c?d=>D[d>>2]:d=>E[d>>2];default:throw new TypeError(`invalid integer width (${b}): ${a}`);
}},Gb=(a,b,c,d)=>{if(0<d){d=c+d-1;for(var e=0;e<a.length;++e){var f=a.charCodeAt(e);if(55296<=f&&57343>=f){var k=a.charCodeAt(++e);f=65536+((f&1023)<<10)|k&1023;}if(127>=f){if(c>=d)break;b[c++]=f;}else {if(2047>=f){if(c+1>=d)break;b[c++]=192|f>>6;}else {if(65535>=f){if(c+2>=d)break;b[c++]=224|f>>12;}else {if(c+3>=d)break;b[c++]=240|f>>18;b[c++]=128|f>>12&63;}b[c++]=128|f>>6&63;}b[c++]=128|f&63;}}b[c]=0;}},Hb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);127>=d?b++:2047>=d?b+=2:55296<=d&&57343>=d?
(b+=4,++c):b+=3;}return b},Ib="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0,U=(a,b,c)=>{var d=b+c;for(c=b;a[c]&&!(c>=d);)++c;if(16<c-b&&a.buffer&&Ib)return Ib.decode(a.subarray(b,c));for(d="";b<c;){var e=a[b++];if(e&128){var f=a[b++]&63;if(192==(e&224))d+=String.fromCharCode((e&31)<<6|f);else {var k=a[b++]&63;e=224==(e&240)?(e&15)<<12|f<<6|k:(e&7)<<18|f<<12|k<<6|a[b++]&63;65536>e?d+=String.fromCharCode(e):(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023));}}else d+=String.fromCharCode(e);}return d},
Jb="undefined"!=typeof TextDecoder?new TextDecoder("utf-16le"):void 0,Kb=(a,b)=>{var c=a>>1;for(var d=c+b/2;!(c>=d)&&la[c];)++c;c<<=1;if(32<c-a&&Jb)return Jb.decode(A.subarray(a,c));c="";for(d=0;!(d>=b/2);++d){var e=C[a+2*d>>1];if(0==e)break;c+=String.fromCharCode(e);}return c},Lb=(a,b,c)=>{c??=2147483647;if(2>c)return 0;c-=2;var d=b;c=c<2*a.length?c/2:a.length;for(var e=0;e<c;++e)C[b>>1]=a.charCodeAt(e),b+=2;C[b>>1]=0;return b-d},Mb=a=>2*a.length,Nb=(a,b)=>{for(var c=0,d="";!(c>=b/4);){var e=D[a+
4*c>>2];if(0==e)break;++c;65536<=e?(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023)):d+=String.fromCharCode(e);}return d},Ob=(a,b,c)=>{c??=2147483647;if(4>c)return 0;var d=b;c=d+c-4;for(var e=0;e<a.length;++e){var f=a.charCodeAt(e);if(55296<=f&&57343>=f){var k=a.charCodeAt(++e);f=65536+((f&1023)<<10)|k&1023;}D[b>>2]=f;b+=4;if(b+4>c)break}D[b>>2]=0;return b-d},Pb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);55296<=d&&57343>=d&&++c;b+=4;}return b},Qb=(a,b)=>{var c=K[a];if(void 0===
c)throw a=`${b} has unknown type ${ub(a)}`,new O(a);return c},Rb=(a,b,c)=>{var d=[];a=a.toWireType(d,c);d.length&&(E[b>>2]=P(d));return a},Sb={},Tb=a=>{var b=Sb[a];return void 0===b?N(a):b},Ub=[],Vb=a=>{var b=Ub.length;Ub.push(a);return b},Wb=(a,b)=>{for(var c=Array(a),d=0;d<a;++d)c[d]=Qb(E[b+4*d>>2],"parameter "+d);return c},Xb={},Zb=()=>{if(!Yb){var a={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:("object"==typeof navigator&&navigator.languages&&navigator.languages[0]||
"C").replace("-","_")+".UTF-8",_:ea||"./this.program"},b;for(b in Xb)void 0===Xb[b]?delete a[b]:a[b]=Xb[b];var c=[];for(b in a)c.push(`${b}=${a[b]}`);Yb=c;}return Yb},Yb,$b=(a,b)=>{for(var c=0,d=a.length-1;0<=d;d--){var e=a[d];"."===e?a.splice(d,1):".."===e?(a.splice(d,1),c++):c&&(a.splice(d,1),c--);}if(b)for(;c;c--)a.unshift("..");return a},ac=a=>{var b="/"===a.charAt(0),c="/"===a.substr(-1);(a=$b(a.split("/").filter(d=>!!d),!b).join("/"))||b||(a=".");a&&c&&(a+="/");return (b?"/":"")+a},bc=a=>{var b=
/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);a=b[0];b=b[1];if(!a&&!b)return ".";b&&=b.substr(0,b.length-1);return a+b},cc=a=>{if("/"===a)return "/";a=ac(a);a=a.replace(/\/$/,"");var b=a.lastIndexOf("/");return -1===b?a:a.substr(b+1)},dc=()=>{if("object"==typeof crypto&&"function"==typeof crypto.getRandomValues)return a=>crypto.getRandomValues(a);ua("initRandomDevice");},ec=a=>(ec=dc())(a),fc=(...a)=>{for(var b="",c=!1,d=a.length-1;-1<=d&&!c;d--){c=0<=d?a[d]:"/";if("string"!=
typeof c)throw new TypeError("Arguments to path.resolve must be strings");if(!c)return "";b=c+"/"+b;c="/"===c.charAt(0);}b=$b(b.split("/").filter(e=>!!e),!c).join("/");return (c?"/":"")+b||"."},gc=[];function hc(a){var b=Array(Hb(a)+1);Gb(a,b,0,b.length);return b}var ic=[];function jc(a,b){ic[a]={input:[],fa:[],ya:b};kc(a,lc);}
var lc={open(a){var b=ic[a.node.La];if(!b)throw new V(43);a.ja=b;a.seekable=!1;},close(a){a.ja.ya.Ga(a.ja);},Ga(a){a.ja.ya.Ga(a.ja);},read(a,b,c,d){if(!a.ja||!a.ja.ya.bb)throw new V(60);for(var e=0,f=0;f<d;f++){try{var k=a.ja.ya.bb(a.ja);}catch(l){throw new V(29);}if(void 0===k&&0===e)throw new V(6);if(null===k||void 0===k)break;e++;b[c+f]=k;}e&&(a.node.timestamp=Date.now());return e},write(a,b,c,d){if(!a.ja||!a.ja.ya.Ra)throw new V(60);try{for(var e=0;e<d;e++)a.ja.ya.Ra(a.ja,b[c+e]);}catch(f){throw new V(29);
}d&&(a.node.timestamp=Date.now());return e}},mc={bb(){return gc.length?gc.shift():null},Ra(a,b){null===b||10===b?(ia(U(a.fa,0)),a.fa=[]):0!=b&&a.fa.push(b);},Ga(a){a.fa&&0<a.fa.length&&(ia(U(a.fa,0)),a.fa=[]);},Xb(){return {Pb:25856,Rb:5,Ob:191,Qb:35387,Nb:[3,28,127,21,4,0,1,0,17,19,26,0,18,15,23,22,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},Yb(){return 0},Zb(){return [24,80]}},nc={Ra(a,b){null===b||10===b?(u(U(a.fa,0)),a.fa=[]):0!=b&&a.fa.push(b);},Ga(a){a.fa&&0<a.fa.length&&(u(U(a.fa,0)),a.fa=[]);}};
function pc(a,b){var c=a.Z?a.Z.length:0;c>=b||(b=Math.max(b,c*(1048576>c?2:1.125)>>>0),0!=c&&(b=Math.max(b,256)),c=a.Z,a.Z=new Uint8Array(b),0<a.da&&a.Z.set(c.subarray(0,a.da),0));}
var W={la:null,pa(){return W.createNode(null,"/",16895,0)},createNode(a,b,c,d){if(24576===(c&61440)||4096===(c&61440))throw new V(63);W.la||(W.la={dir:{node:{qa:W.Y.qa,na:W.Y.na,za:W.Y.za,Ja:W.Y.Ja,ib:W.Y.ib,kb:W.Y.kb,jb:W.Y.jb,hb:W.Y.hb,Ma:W.Y.Ma},stream:{sa:W.$.sa}},file:{node:{qa:W.Y.qa,na:W.Y.na},stream:{sa:W.$.sa,read:W.$.read,write:W.$.write,Wa:W.$.Wa,cb:W.$.cb,fb:W.$.fb}},link:{node:{qa:W.Y.qa,na:W.Y.na,Ba:W.Y.Ba},stream:{}},Xa:{node:{qa:W.Y.qa,na:W.Y.na},stream:qc}});c=rc(a,b,c,d);16384===
(c.mode&61440)?(c.Y=W.la.dir.node,c.$=W.la.dir.stream,c.Z={}):32768===(c.mode&61440)?(c.Y=W.la.file.node,c.$=W.la.file.stream,c.da=0,c.Z=null):40960===(c.mode&61440)?(c.Y=W.la.link.node,c.$=W.la.link.stream):8192===(c.mode&61440)&&(c.Y=W.la.Xa.node,c.$=W.la.Xa.stream);c.timestamp=Date.now();a&&(a.Z[b]=c,a.timestamp=c.timestamp);return c},Ub(a){return a.Z?a.Z.subarray?a.Z.subarray(0,a.da):new Uint8Array(a.Z):new Uint8Array(0)},Y:{qa(a){var b={};b.Tb=8192===(a.mode&61440)?a.id:1;b.Wb=a.id;b.mode=a.mode;
b.ac=1;b.uid=0;b.Vb=0;b.La=a.La;16384===(a.mode&61440)?b.size=4096:32768===(a.mode&61440)?b.size=a.da:40960===(a.mode&61440)?b.size=a.link.length:b.size=0;b.Lb=new Date(a.timestamp);b.$b=new Date(a.timestamp);b.Sb=new Date(a.timestamp);b.lb=4096;b.Mb=Math.ceil(b.size/b.lb);return b},na(a,b){void 0!==b.mode&&(a.mode=b.mode);void 0!==b.timestamp&&(a.timestamp=b.timestamp);if(void 0!==b.size&&(b=b.size,a.da!=b))if(0==b)a.Z=null,a.da=0;else {var c=a.Z;a.Z=new Uint8Array(b);c&&a.Z.set(c.subarray(0,Math.min(b,
a.da)));a.da=b;}},za(){throw sc[44];},Ja(a,b,c,d){return W.createNode(a,b,c,d)},ib(a,b,c){if(16384===(a.mode&61440)){try{var d=tc(b,c);}catch(f){}if(d)for(var e in d.Z)throw new V(55);}delete a.parent.Z[a.name];a.parent.timestamp=Date.now();a.name=c;b.Z[c]=a;b.timestamp=a.parent.timestamp;},kb(a,b){delete a.Z[b];a.timestamp=Date.now();},jb(a,b){var c=tc(a,b),d;for(d in c.Z)throw new V(55);delete a.Z[b];a.timestamp=Date.now();},hb(a){var b=[".",".."],c;for(c of Object.keys(a.Z))b.push(c);return b},Ma(a,
b,c){a=W.createNode(a,b,41471,0);a.link=c;return a},Ba(a){if(40960!==(a.mode&61440))throw new V(28);return a.link}},$:{read(a,b,c,d,e){var f=a.node.Z;if(e>=a.node.da)return 0;a=Math.min(a.node.da-e,d);if(8<a&&f.subarray)b.set(f.subarray(e,e+a),c);else for(d=0;d<a;d++)b[c+d]=f[e+d];return a},write(a,b,c,d,e,f){if(!d)return 0;a=a.node;a.timestamp=Date.now();if(b.subarray&&(!a.Z||a.Z.subarray)){if(f)return a.Z=b.subarray(c,c+d),a.da=d;if(0===a.da&&0===e)return a.Z=b.slice(c,c+d),a.da=d;if(e+d<=a.da)return a.Z.set(b.subarray(c,
c+d),e),d}pc(a,e+d);if(a.Z.subarray&&b.subarray)a.Z.set(b.subarray(c,c+d),e);else for(f=0;f<d;f++)a.Z[e+f]=b[c+f];a.da=Math.max(a.da,e+d);return d},sa(a,b,c){1===c?b+=a.position:2===c&&32768===(a.node.mode&61440)&&(b+=a.node.da);if(0>b)throw new V(28);return b},Wa(a,b,c){pc(a.node,b+c);a.node.da=Math.max(a.node.da,b+c);},cb(a,b,c,d,e){if(32768!==(a.node.mode&61440))throw new V(43);a=a.node.Z;if(e&2||a.buffer!==y.buffer){if(0<c||c+b<a.length)a.subarray?a=a.subarray(c,c+b):a=Array.prototype.slice.call(a,
c,c+b);c=!0;ua();b=void 0;if(!b)throw new V(48);y.set(a,b);}else c=!1,b=a.byteOffset;return {aa:b,Kb:c}},fb(a,b,c,d){W.$.write(a,b,0,d,c,!1);return 0}}},uc=(a,b)=>{var c=0;a&&(c|=365);b&&(c|=146);return c},vc=null,wc={},xc=[],yc=1,zc=null,Ac=!0,V=class{constructor(a){this.name="ErrnoError";this.Fa=a;}},sc={},Bc=class{constructor(){this.Da={};this.node=null;}get flags(){return this.Da.flags}set flags(a){this.Da.flags=a;}get position(){return this.Da.position}set position(a){this.Da.position=a;}},Cc=class{constructor(a,
b,c,d){a||=this;this.parent=a;this.pa=a.pa;this.Ka=null;this.id=yc++;this.name=b;this.mode=c;this.Y={};this.$={};this.La=d;}get read(){return 365===(this.mode&365)}set read(a){a?this.mode|=365:this.mode&=-366;}get write(){return 146===(this.mode&146)}set write(a){a?this.mode|=146:this.mode&=-147;}};
function X(a,b={}){a=fc(a);if(!a)return {path:"",node:null};b=Object.assign({ab:!0,Ta:0},b);if(8<b.Ta)throw new V(32);a=a.split("/").filter(k=>!!k);for(var c=vc,d="/",e=0;e<a.length;e++){var f=e===a.length-1;if(f&&b.parent)break;c=tc(c,a[e]);d=ac(d+"/"+a[e]);c.Ka&&(!f||f&&b.ab)&&(c=c.Ka.root);if(!f||b.$a)for(f=0;40960===(c.mode&61440);)if(c=Dc(d),d=fc(bc(d),c),c=X(d,{Ta:b.Ta+1}).node,40<f++)throw new V(32);}return {path:d,node:c}}
function Ec(a){for(var b;;){if(a===a.parent)return a=a.pa.eb,b?"/"!==a[a.length-1]?`${a}/${b}`:a+b:a;b=b?`${a.name}/${b}`:a.name;a=a.parent;}}function Fc(a,b){for(var c=0,d=0;d<b.length;d++)c=(c<<5)-c+b.charCodeAt(d)|0;return (a+c>>>0)%zc.length}function tc(a,b){var c=16384===(a.mode&61440)?(c=Gc(a,"x"))?c:a.Y.za?0:2:54;if(c)throw new V(c);for(c=zc[Fc(a.id,b)];c;c=c.xb){var d=c.name;if(c.parent.id===a.id&&d===b)return c}return a.Y.za(a,b)}
function rc(a,b,c,d){a=new Cc(a,b,c,d);b=Fc(a.parent.id,a.name);a.xb=zc[b];return zc[b]=a}function Hc(a){var b=["r","w","rw"][a&3];a&512&&(b+="w");return b}function Gc(a,b){if(Ac)return 0;if(!b.includes("r")||a.mode&292){if(b.includes("w")&&!(a.mode&146)||b.includes("x")&&!(a.mode&73))return 2}else return 2;return 0}function Ic(a,b){try{return tc(a,b),20}catch(c){}return Gc(a,"wx")}function Jc(a){a=xc[a];if(!a)throw new V(8);return a}
var qc={open(a){a.$=wc[a.node.La].$;a.$.open?.(a);},sa(){throw new V(70);}};function kc(a,b){wc[a]={$:b};}function Kc(a,b){var c="/"===b;if(c&&vc)throw new V(10);if(!c&&b){var d=X(b,{ab:!1});b=d.path;d=d.node;if(d.Ka)throw new V(10);if(16384!==(d.mode&61440))throw new V(54);}b={type:a,cc:{},eb:b,wb:[]};a=a.pa(b);a.pa=b;b.root=a;c?vc=a:d&&(d.Ka=b,d.pa&&d.pa.wb.push(b));}
function Lc(a,b,c){var d=X(a,{parent:!0}).node;a=cc(a);if(!a||"."===a||".."===a)throw new V(28);var e=Ic(d,a);if(e)throw new V(e);if(!d.Y.Ja)throw new V(63);return d.Y.Ja(d,a,b,c)}function Y(a){return Lc(a,16895,0)}function Mc(a,b,c){"undefined"==typeof c&&(c=b,b=438);Lc(a,b|8192,c);}function Nc(a,b){if(!fc(a))throw new V(44);var c=X(b,{parent:!0}).node;if(!c)throw new V(44);b=cc(b);var d=Ic(c,b);if(d)throw new V(d);if(!c.Y.Ma)throw new V(63);c.Y.Ma(c,b,a);}
function Dc(a){a=X(a).node;if(!a)throw new V(44);if(!a.Y.Ba)throw new V(28);return fc(Ec(a.parent),a.Y.Ba(a))}
function Oc(a,b){if(""===a)throw new V(44);if("string"==typeof b){var c={r:0,"r+":2,w:577,"w+":578,a:1089,"a+":1090}[b];if("undefined"==typeof c)throw Error(`Unknown file open mode: ${b}`);b=c;}var d=b&64?("undefined"==typeof d?438:d)&4095|32768:0;if("object"==typeof a)var e=a;else {a=ac(a);try{e=X(a,{$a:!(b&131072)}).node;}catch(f){}}c=!1;if(b&64)if(e){if(b&128)throw new V(20);}else e=Lc(a,d,0),c=!0;if(!e)throw new V(44);8192===(e.mode&61440)&&(b&=-513);if(b&65536&&16384!==(e.mode&61440))throw new V(54);
if(!c&&(d=e?40960===(e.mode&61440)?32:16384===(e.mode&61440)&&("r"!==Hc(b)||b&512)?31:Gc(e,Hc(b)):44))throw new V(d);if(b&512&&!c){d=e;d="string"==typeof d?X(d,{$a:!0}).node:d;if(!d.Y.na)throw new V(63);if(16384===(d.mode&61440))throw new V(31);if(32768!==(d.mode&61440))throw new V(28);if(c=Gc(d,"w"))throw new V(c);d.Y.na(d,{size:0,timestamp:Date.now()});}b&=-131713;e={node:e,path:Ec(e),flags:b,seekable:!0,position:0,$:e.$,Jb:[],error:!1};d=-1;e=Object.assign(new Bc,e);if(-1==d)a:{for(d=0;4096>=d;d++)if(!xc[d])break a;
throw new V(33);}e.wa=d;xc[d]=e;e.$.open&&e.$.open(e);!m.logReadFiles||b&1||(Pc||={},a in Pc||(Pc[a]=1));}function Qc(a,b,c){if(null===a.wa)throw new V(8);if(!a.seekable||!a.$.sa)throw new V(70);if(0!=c&&1!=c&&2!=c)throw new V(28);a.position=a.$.sa(a,b,c);a.Jb=[];}var Rc;
function Sc(a,b,c){a=ac("/dev/"+a);var d=uc(!!b,!!c);Tc||=64;var e=Tc++<<8|0;kc(e,{open(f){f.seekable=!1;},close(){c?.buffer?.length&&c(10);},read(f,k,l,n){for(var h=0,p=0;p<n;p++){try{var w=b();}catch(x){throw new V(29);}if(void 0===w&&0===h)throw new V(6);if(null===w||void 0===w)break;h++;k[l+p]=w;}h&&(f.node.timestamp=Date.now());return h},write(f,k,l,n){for(var h=0;h<n;h++)try{c(k[l+h]);}catch(p){throw new V(29);}n&&(f.node.timestamp=Date.now());return h}});Mc(a,d,e);}
var Tc,Uc={},Pc,Vc=a=>0===a%4&&(0!==a%100||0===a%400),Wc=[31,29,31,30,31,30,31,31,30,31,30,31],Xc=[31,28,31,30,31,30,31,31,30,31,30,31],Yc=(a,b,c,d)=>{function e(g,r,t){for(g="number"==typeof g?g.toString():g||"";g.length<r;)g=t[0]+g;return g}function f(g,r){return e(g,r,"0")}function k(g,r){function t(G){return 0>G?-1:0<G?1:0}var z;0===(z=t(g.getFullYear()-r.getFullYear()))&&0===(z=t(g.getMonth()-r.getMonth()))&&(z=t(g.getDate()-r.getDate()));return z}function l(g){switch(g.getDay()){case 0:return new Date(g.getFullYear()-
1,11,29);case 1:return g;case 2:return new Date(g.getFullYear(),0,3);case 3:return new Date(g.getFullYear(),0,2);case 4:return new Date(g.getFullYear(),0,1);case 5:return new Date(g.getFullYear()-1,11,31);case 6:return new Date(g.getFullYear()-1,11,30)}}function n(g){var r=g.ta;for(g=new Date((new Date(g.ua+1900,0,1)).getTime());0<r;){var t=g.getMonth(),z=(Vc(g.getFullYear())?Wc:Xc)[t];if(r>z-g.getDate())r-=z-g.getDate()+1,g.setDate(1),11>t?g.setMonth(t+1):(g.setMonth(0),g.setFullYear(g.getFullYear()+
1));else {g.setDate(g.getDate()+r);break}}t=new Date(g.getFullYear()+1,0,4);r=l(new Date(g.getFullYear(),0,4));t=l(t);return 0>=k(r,g)?0>=k(t,g)?g.getFullYear()+1:g.getFullYear():g.getFullYear()-1}var h=E[d+40>>2];d={Hb:D[d>>2],Gb:D[d+4>>2],Na:D[d+8>>2],Ua:D[d+12>>2],Oa:D[d+16>>2],ua:D[d+20>>2],oa:D[d+24>>2],ta:D[d+28>>2],dc:D[d+32>>2],Fb:D[d+36>>2],Ib:h?h?U(A,h):"":""};c=c?U(A,c):"";h={"%c":"%a %b %d %H:%M:%S %Y","%D":"%m/%d/%y","%F":"%Y-%m-%d","%h":"%b","%r":"%I:%M:%S %p","%R":"%H:%M","%T":"%H:%M:%S",
"%x":"%m/%d/%y","%X":"%H:%M:%S","%Ec":"%c","%EC":"%C","%Ex":"%m/%d/%y","%EX":"%H:%M:%S","%Ey":"%y","%EY":"%Y","%Od":"%d","%Oe":"%e","%OH":"%H","%OI":"%I","%Om":"%m","%OM":"%M","%OS":"%S","%Ou":"%u","%OU":"%U","%OV":"%V","%Ow":"%w","%OW":"%W","%Oy":"%y"};for(var p in h)c=c.replace(new RegExp(p,"g"),h[p]);var w="Sunday Monday Tuesday Wednesday Thursday Friday Saturday".split(" "),x="January February March April May June July August September October November December".split(" ");h={"%a":g=>w[g.oa].substring(0,
3),"%A":g=>w[g.oa],"%b":g=>x[g.Oa].substring(0,3),"%B":g=>x[g.Oa],"%C":g=>f((g.ua+1900)/100|0,2),"%d":g=>f(g.Ua,2),"%e":g=>e(g.Ua,2," "),"%g":g=>n(g).toString().substring(2),"%G":n,"%H":g=>f(g.Na,2),"%I":g=>{g=g.Na;0==g?g=12:12<g&&(g-=12);return f(g,2)},"%j":g=>{for(var r=0,t=0;t<=g.Oa-1;r+=(Vc(g.ua+1900)?Wc:Xc)[t++]);return f(g.Ua+r,3)},"%m":g=>f(g.Oa+1,2),"%M":g=>f(g.Gb,2),"%n":()=>"\n","%p":g=>0<=g.Na&&12>g.Na?"AM":"PM","%S":g=>f(g.Hb,2),"%t":()=>"\t","%u":g=>g.oa||7,"%U":g=>f(Math.floor((g.ta+
7-g.oa)/7),2),"%V":g=>{var r=Math.floor((g.ta+7-(g.oa+6)%7)/7);2>=(g.oa+371-g.ta-2)%7&&r++;if(r)53==r&&(t=(g.oa+371-g.ta)%7,4==t||3==t&&Vc(g.ua)||(r=1));else {r=52;var t=(g.oa+7-g.ta-1)%7;(4==t||5==t&&Vc(g.ua%400-1))&&r++;}return f(r,2)},"%w":g=>g.oa,"%W":g=>f(Math.floor((g.ta+7-(g.oa+6)%7)/7),2),"%y":g=>(g.ua+1900).toString().substring(2),"%Y":g=>g.ua+1900,"%z":g=>{g=g.Fb;var r=0<=g;g=Math.abs(g)/60;return (r?"+":"-")+String("0000"+(g/60*100+g%60)).slice(-4)},"%Z":g=>g.Ib,"%%":()=>"%"};c=c.replace(/%%/g,
"\x00\x00");for(p in h)c.includes(p)&&(c=c.replace(new RegExp(p,"g"),h[p](d)));c=c.replace(/\0\0/g,"%");p=hc(c);if(p.length>b)return 0;y.set(p,a);return p.length-1};Ka=m.InternalError=class extends Error{constructor(a){super(a);this.name="InternalError";}};for(var Zc=Array(256),$c=0;256>$c;++$c)Zc[$c]=String.fromCharCode($c);La=Zc;O=m.BindingError=class extends Error{constructor(a){super(a);this.name="BindingError";}};
Object.assign($a.prototype,{isAliasOf:function(a){if(!(this instanceof $a&&a instanceof $a))return !1;var b=this.S.ca.ba,c=this.S.aa;a.S=a.S;var d=a.S.ca.ba;for(a=a.S.aa;b.ha;)c=b.Ca(c),b=b.ha;for(;d.ha;)a=d.Ca(a),d=d.ha;return b===d&&c===a},clone:function(){this.S.aa||Oa(this);if(this.S.Aa)return this.S.count.value+=1,this;var a=Ya,b=Object,c=b.create,d=Object.getPrototypeOf(this),e=this.S;a=a(c.call(b,d,{S:{value:{count:e.count,va:e.va,Aa:e.Aa,aa:e.aa,ca:e.ca,ea:e.ea,ia:e.ia}}}));a.S.count.value+=
1;a.S.va=!1;return a},["delete"](){this.S.aa||Oa(this);if(this.S.va&&!this.S.Aa)throw new O("Object already scheduled for deletion");Qa(this);var a=this.S;--a.count.value;0===a.count.value&&(a.ea?a.ia.ma(a.ea):a.ca.ba.ma(a.aa));this.S.Aa||(this.S.ea=void 0,this.S.aa=void 0);},isDeleted:function(){return !this.S.aa},deleteLater:function(){this.S.aa||Oa(this);if(this.S.va&&!this.S.Aa)throw new O("Object already scheduled for deletion");Ta.push(this);1===Ta.length&&Va&&Va(Ua);this.S.va=!0;return this}});
m.getInheritedInstanceCount=()=>Object.keys(Wa).length;m.getLiveInheritedInstances=()=>{var a=[],b;for(b in Wa)Wa.hasOwnProperty(b)&&a.push(Wa[b]);return a};m.flushPendingDeletes=Ua;m.setDelayFunction=a=>{Va=a;Ta.length&&Va&&Va(Ua);};
Object.assign(lb.prototype,{qb(a){this.gb&&(a=this.gb(a));return a},Ya(a){this.ma?.(a);},argPackAdvance:8,readValueFromPointer:Ia,fromWireType:function(a){function b(){return this.Ia?Za(this.ba.xa,{ca:this.yb,aa:c,ia:this,ea:a}):Za(this.ba.xa,{ca:this,aa:a})}var c=this.qb(a);if(!c)return this.Ya(a),null;var d=Xa(this.ba,c);if(void 0!==d){if(0===d.S.count.value)return d.S.aa=c,d.S.ea=a,d.clone();d=d.clone();this.Ya(a);return d}d=this.ba.pb(c);d=Sa[d];if(!d)return b.call(this);d=this.Ha?d.mb:d.pointerType;
var e=Ra(c,this.ba,d.ba);return null===e?b.call(this):this.Ia?Za(d.ba.xa,{ca:d,aa:e,ia:this,ea:a}):Za(d.ba.xa,{ca:d,aa:e})}});sb=m.UnboundTypeError=((a,b)=>{var c=ab(b,function(d){this.name=b;this.message=d;d=Error(d).stack;void 0!==d&&(this.stack=this.toString()+"\n"+d.replace(/^Error(:[^\n]*)?\n/,""));});c.prototype=Object.create(a.prototype);c.prototype.constructor=c;c.prototype.toString=function(){return void 0===this.message?this.name:`${this.name}: ${this.message}`};return c})(Error,"UnboundTypeError");
S.push(0,1,void 0,1,null,1,!0,1,!1,1);m.count_emval_handles=()=>S.length/2-5-Bb.length;[44].forEach(a=>{sc[a]=new V(a);sc[a].stack="<generic error, no stack>";});zc=Array(4096);Kc(W,"/");Y("/tmp");Y("/home");Y("/home/web_user");(function(){Y("/dev");kc(259,{read:()=>0,write:(d,e,f,k)=>k});Mc("/dev/null",259);jc(1280,mc);jc(1536,nc);Mc("/dev/tty",1280);Mc("/dev/tty1",1536);var a=new Uint8Array(1024),b=0,c=()=>{0===b&&(b=ec(a).byteLength);return a[--b]};Sc("random",c);Sc("urandom",c);Y("/dev/shm");Y("/dev/shm/tmp");})();
(function(){Y("/proc");var a=Y("/proc/self");Y("/proc/self/fd");Kc({pa(){var b=rc(a,"fd",16895,73);b.Y={za(c,d){var e=Jc(+d);c={parent:null,pa:{eb:"fake"},Y:{Ba:()=>e.path}};return c.parent=c}};return b}},"/proc/self/fd");})();
var bd={l:(a,b,c)=>{var d=new Da(a);E[d.aa+16>>2]=0;E[d.aa+4>>2]=b;E[d.aa+8>>2]=c;Ea=a;throw Ea;},C:()=>{ua("");},J:a=>{var b=Ga[a];delete Ga[a];var c=b.Sa,d=b.ma,e=b.Za,f=e.map(k=>k.tb).concat(e.map(k=>k.Cb));M([a],f,k=>{var l={};e.forEach((n,h)=>{var p=k[h],w=n.rb,x=n.sb,g=k[h+e.length],r=n.Bb,t=n.Db;l[n.ob]={read:z=>p.fromWireType(w(x,z)),write:(z,G)=>{var B=[];r(t,z,g.toWireType(B,G));Ha(B);}};});return [{name:b.name,fromWireType:n=>{var h={},p;for(p in l)h[p]=l[p].read(n);d(n);return h},toWireType:(n,
h)=>{for(var p in l)if(!(p in h))throw new TypeError(`Missing field: "${p}"`);var w=c();for(p in l)l[p].write(w,h[p]);null!==n&&n.push(d,w);return w},argPackAdvance:8,readValueFromPointer:Ia,ka:d}]});},t:()=>{},E:(a,b,c,d)=>{b=N(b);L(a,{name:b,fromWireType:function(e){return !!e},toWireType:function(e,f){return f?c:d},argPackAdvance:8,readValueFromPointer:function(e){return this.fromWireType(A[e])},ka:null});},H:(a,b,c,d,e,f,k,l,n,h,p,w,x)=>{p=N(p);f=Q(e,f);l&&=Q(k,l);h&&=Q(n,h);x=Q(w,x);var g=db(p);
cb(g,function(){vb(`Cannot construct ${p} due to unbound types`,[d]);});M([a,b,c],d?[d]:[],r=>{r=r[0];if(d){var t=r.ba;var z=t.xa;}else z=$a.prototype;r=ab(p,function(...gb){if(Object.getPrototypeOf(this)!==G)throw new O("Use 'new' to construct "+p);if(void 0===B.ra)throw new O(p+" has no accessible constructor");var oc=B.ra[gb.length];if(void 0===oc)throw new O(`Tried to invoke ctor of ${p} with invalid number of parameters (${gb.length}) - expected (${Object.keys(B.ra).toString()}) parameters instead!`);
return oc.apply(this,gb)});var G=Object.create(z,{constructor:{value:r}});r.prototype=G;var B=new eb(p,r,G,x,t,f,l,h);if(B.ha){var ma;(ma=B.ha).Va??(ma.Va=[]);B.ha.Va.push(B);}t=new lb(p,B,!0,!1,!1);ma=new lb(p+"*",B,!1,!1,!1);z=new lb(p+" const*",B,!1,!0,!1);Sa[a]={pointerType:ma,mb:z};mb(g,r);return [t,ma,z]});},G:(a,b,c,d,e,f)=>{var k=wb(b,c);e=Q(d,e);M([],[a],l=>{l=l[0];var n=`constructor ${l.name}`;void 0===l.ba.ra&&(l.ba.ra=[]);if(void 0!==l.ba.ra[b-1])throw new O(`Cannot register multiple constructors with identical number of parameters (${b-
1}) for class '${l.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);l.ba.ra[b-1]=()=>{vb(`Cannot construct ${l.name} due to unbound types`,k);};M([],k,h=>{h.splice(1,0,null);l.ba.ra[b-1]=zb(n,h,null,e,f);return []});return []});},d:(a,b,c,d,e,f,k,l,n)=>{var h=wb(c,d);b=N(b);b=Ab(b);f=Q(e,f);M([],[a],p=>{function w(){vb(`Cannot call ${x} due to unbound types`,h);}p=p[0];var x=`${p.name}.${b}`;b.startsWith("@@")&&(b=Symbol[b.substring(2)]);l&&p.ba.zb.push(b);
var g=p.ba.xa,r=g[b];void 0===r||void 0===r.ga&&r.className!==p.name&&r.Ea===c-2?(w.Ea=c-2,w.className=p.name,g[b]=w):(bb(g,b,x),g[b].ga[c-2]=w);M([],h,t=>{t=zb(x,t,p,f,k,n);void 0===g[b].ga?(t.Ea=c-2,g[b]=t):g[b].ga[c-2]=t;return []});return []});},D:a=>L(a,Db),i:(a,b,c)=>{b=N(b);L(a,{name:b,fromWireType:d=>d,toWireType:(d,e)=>e,argPackAdvance:8,readValueFromPointer:Eb(b,c),ka:null});},I:(a,b,c,d,e,f,k)=>{var l=wb(b,c);a=N(a);a=Ab(a);e=Q(d,e);cb(a,function(){vb(`Cannot call ${a} due to unbound types`,
l);},b-1);M([],l,n=>{mb(a,zb(a,[n[0],null].concat(n.slice(1)),null,e,f,k),b-1);return []});},b:(a,b,c,d,e)=>{b=N(b);-1===e&&(e=4294967295);e=l=>l;if(0===d){var f=32-8*c;e=l=>l<<f>>>f;}var k=b.includes("unsigned")?function(l,n){return n>>>0}:function(l,n){return n};L(a,{name:b,fromWireType:e,toWireType:k,argPackAdvance:8,readValueFromPointer:Fb(b,c,0!==d),ka:null});},a:(a,b,c)=>{function d(f){return new e(y.buffer,E[f+4>>2],E[f>>2])}var e=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,
Float32Array,Float64Array][b];c=N(c);L(a,{name:c,fromWireType:d,argPackAdvance:8,readValueFromPointer:d},{ub:!0});},m:a=>{L(a,Db);},j:(a,b)=>{b=N(b);var c="std::string"===b;L(a,{name:b,fromWireType:function(d){var e=E[d>>2],f=d+4;if(c)for(var k=f,l=0;l<=e;++l){var n=f+l;if(l==e||0==A[n]){k=k?U(A,k,n-k):"";if(void 0===h)var h=k;else h+=String.fromCharCode(0),h+=k;k=n+1;}}else {h=Array(e);for(l=0;l<e;++l)h[l]=String.fromCharCode(A[f+l]);h=h.join("");}R(d);return h},toWireType:function(d,e){e instanceof ArrayBuffer&&
(e=new Uint8Array(e));var f="string"==typeof e;if(!(f||e instanceof Uint8Array||e instanceof Uint8ClampedArray||e instanceof Int8Array))throw new O("Cannot pass non-string to std::string");var k=c&&f?Hb(e):e.length;var l=ad(4+k+1),n=l+4;E[l>>2]=k;if(c&&f)Gb(e,A,n,k+1);else if(f)for(f=0;f<k;++f){var h=e.charCodeAt(f);if(255<h)throw R(n),new O("String has UTF-16 code units that do not fit in 8 bits");A[n+f]=h;}else for(f=0;f<k;++f)A[n+f]=e[f];null!==d&&d.push(R,l);return l},argPackAdvance:8,readValueFromPointer:Ia,
ka(d){R(d);}});},g:(a,b,c)=>{c=N(c);if(2===b){var d=Kb;var e=Lb;var f=Mb;var k=l=>la[l>>1];}else 4===b&&(d=Nb,e=Ob,f=Pb,k=l=>E[l>>2]);L(a,{name:c,fromWireType:l=>{for(var n=E[l>>2],h,p=l+4,w=0;w<=n;++w){var x=l+4+w*b;if(w==n||0==k(x))p=d(p,x-p),void 0===h?h=p:(h+=String.fromCharCode(0),h+=p),p=x+b;}R(l);return h},toWireType:(l,n)=>{if("string"!=typeof n)throw new O(`Cannot pass non-string to C++ string type ${c}`);var h=f(n),p=ad(4+h+b);E[p>>2]=h/b;e(n,p+4,h+b);null!==l&&l.push(R,p);return p},argPackAdvance:8,
readValueFromPointer:Ia,ka(l){R(l);}});},K:(a,b,c,d,e,f)=>{Ga[a]={name:N(b),Sa:Q(c,d),ma:Q(e,f),Za:[]};},n:(a,b,c,d,e,f,k,l,n,h)=>{Ga[a].Za.push({ob:N(b),tb:c,rb:Q(d,e),sb:f,Cb:k,Bb:Q(l,n),Db:h});},F:(a,b)=>{b=N(b);L(a,{vb:!0,name:b,argPackAdvance:0,fromWireType:()=>{},toWireType:()=>{}});},B:(a,b,c)=>A.copyWithin(a,b,b+c),h:(a,b,c)=>{a=T(a);b=Qb(b,"emval::as");return Rb(b,c,a)},p:(a,b,c,d,e)=>{a=Ub[a];b=T(b);c=Tb(c);return a(b,b[c],d,e)},c:Cb,q:(a,b,c)=>{b=Wb(a,b);var d=b.shift();a--;var e="return function (obj, func, destructorsRef, args) {\n",
f=0,k=[];0===c&&k.push("obj");for(var l=["retType"],n=[d],h=0;h<a;++h)k.push("arg"+h),l.push("argType"+h),n.push(b[h]),e+=`  var arg${h} = argType${h}.readValueFromPointer(args${f?"+"+f:""});\n`,f+=b[h].argPackAdvance;e+=`  var rv = ${1===c?"new func":"func.call"}(${k.join(", ")});\n`;d.vb||(l.push("emval_returnValue"),n.push(Rb),e+="  return emval_returnValue(retType, destructorsRef, rv);\n");l.push(e+"};\n");a=yb(l)(...n);c=`methodCaller<(${b.map(p=>p.name).join(", ")}) => ${d.name}>`;return Vb(ab(c,
a))},L:a=>{a=Tb(a);return P(m[a])},k:(a,b)=>{a=T(a);b=T(b);return P(a[b])},r:a=>{9<a&&(S[a+1]+=1);},o:a=>P(Tb(a)),f:a=>{var b=T(a);Ha(b);Cb(a);},e:(a,b)=>{a=Qb(a,"_emval_take_value");a=a.readValueFromPointer(b);return P(a)},A:()=>{ua("OOM");},v:(a,b)=>{var c=0;Zb().forEach((d,e)=>{var f=b+c;e=E[a+4*e>>2]=f;for(f=0;f<d.length;++f)y[e++]=d.charCodeAt(f);y[e]=0;c+=d.length+1;});return 0},w:(a,b)=>{var c=Zb();E[a>>2]=c.length;var d=0;c.forEach(e=>d+=e.length+1);E[b>>2]=d;return 0},x:function(a){try{var b=
Jc(a);if(null===b.wa)throw new V(8);b.Pa&&(b.Pa=null);try{b.$.close&&b.$.close(b);}catch(c){throw c;}finally{xc[b.wa]=null;}b.wa=null;return 0}catch(c){if("undefined"==typeof Uc||"ErrnoError"!==c.name)throw c;return c.Fa}},z:function(a,b,c,d){try{a:{var e=Jc(a);a=b;for(var f,k=b=0;k<c;k++){var l=E[a>>2],n=E[a+4>>2];a+=8;var h=e,p=f,w=y;if(0>n||0>p)throw new V(28);if(null===h.wa)throw new V(8);if(1===(h.flags&2097155))throw new V(8);if(16384===(h.node.mode&61440))throw new V(31);if(!h.$.read)throw new V(28);
var x="undefined"!=typeof p;if(!x)p=h.position;else if(!h.seekable)throw new V(70);var g=h.$.read(h,w,l,n,p);x||(h.position+=g);var r=g;if(0>r){var t=-1;break a}b+=r;if(r<n)break;"undefined"!=typeof f&&(f+=r);}t=b;}E[d>>2]=t;return 0}catch(z){if("undefined"==typeof Uc||"ErrnoError"!==z.name)throw z;return z.Fa}},s:function(a,b,c,d,e){b=c+2097152>>>0<4194305-!!b?(b>>>0)+4294967296*c:NaN;try{if(isNaN(b))return 61;var f=Jc(a);Qc(f,b,d);Ba=[f.position>>>0,(I=f.position,1<=+Math.abs(I)?0<I?+Math.floor(I/
4294967296)>>>0:~~+Math.ceil((I-+(~~I>>>0))/4294967296)>>>0:0)];D[e>>2]=Ba[0];D[e+4>>2]=Ba[1];f.Pa&&0===b&&0===d&&(f.Pa=null);return 0}catch(k){if("undefined"==typeof Uc||"ErrnoError"!==k.name)throw k;return k.Fa}},y:function(a,b,c,d){try{a:{var e=Jc(a);a=b;for(var f,k=b=0;k<c;k++){var l=E[a>>2],n=E[a+4>>2];a+=8;var h=e,p=l,w=n,x=f,g=y;if(0>w||0>x)throw new V(28);if(null===h.wa)throw new V(8);if(0===(h.flags&2097155))throw new V(8);if(16384===(h.node.mode&61440))throw new V(31);if(!h.$.write)throw new V(28);
h.seekable&&h.flags&1024&&Qc(h,0,2);var r="undefined"!=typeof x;if(!r)x=h.position;else if(!h.seekable)throw new V(70);var t=h.$.write(h,g,p,w,x,void 0);r||(h.position+=t);var z=t;if(0>z){var G=-1;break a}b+=z;"undefined"!=typeof f&&(f+=z);}G=b;}E[d>>2]=G;return 0}catch(B){if("undefined"==typeof Uc||"ErrnoError"!==B.name)throw B;return B.Fa}},u:(a,b,c,d)=>Yc(a,b,c,d)},Z=function(){function a(c){Z=c.exports;ja=Z.M;c=ja.buffer;m.HEAP8=y=new Int8Array(c);m.HEAP16=C=new Int16Array(c);m.HEAPU8=A=new Uint8Array(c);
m.HEAPU16=la=new Uint16Array(c);m.HEAP32=D=new Int32Array(c);m.HEAPU32=E=new Uint32Array(c);m.HEAPF32=na=new Float32Array(c);m.HEAPF64=oa=new Float64Array(c);ob=Z.P;qa.unshift(Z.N);F--;m.monitorRunDependencies?.(F);0==F&&(H&&(c=H,H=null,c()));return Z}var b={a:bd};F++;m.monitorRunDependencies?.(F);if(m.instantiateWasm)try{return m.instantiateWasm(b,a)}catch(c){u(`Module.instantiateWasm callback failed with error: ${c}`),ba(c);}wa||=m.locateFile?va("rsiscool.wasm")?
"rsiscool.wasm":m.locateFile?m.locateFile("rsiscool.wasm",q):q+"rsiscool.wasm":(new URL("rsiscool.wasm",import.meta.url)).href;Aa(b,function(c){a(c.instance);}).catch(ba);return {}}(),tb=a=>(tb=Z.O)(a),ad=a=>(ad=Z.Q)(a),R=a=>(R=Z.R)(a);m.dynCall_viijii=(a,b,c,d,e,f,k)=>(m.dynCall_viijii=Z.T)(a,b,c,d,e,f,k);m.dynCall_jiji=(a,b,c,d,e)=>(m.dynCall_jiji=Z.U)(a,b,c,d,e);m.dynCall_iiiiij=(a,b,c,d,e,f,k)=>(m.dynCall_iiiiij=Z.V)(a,b,c,d,e,f,k);
m.dynCall_iiiiijj=(a,b,c,d,e,f,k,l,n)=>(m.dynCall_iiiiijj=Z.W)(a,b,c,d,e,f,k,l,n);m.dynCall_iiiiiijj=(a,b,c,d,e,f,k,l,n,h)=>(m.dynCall_iiiiiijj=Z.X)(a,b,c,d,e,f,k,l,n,h);var cd;H=function dd(){cd||ed();cd||(H=dd);};
function ed(){function a(){if(!cd&&(cd=!0,m.calledRun=!0,!ka)){m.noFSInit||Rc||(Rc=!0,m.stdin=m.stdin,m.stdout=m.stdout,m.stderr=m.stderr,m.stdin?Sc("stdin",m.stdin):Nc("/dev/tty","/dev/stdin"),m.stdout?Sc("stdout",null,m.stdout):Nc("/dev/tty","/dev/stdout"),m.stderr?Sc("stderr",null,m.stderr):Nc("/dev/tty1","/dev/stderr"),Oc("/dev/stdin",0),Oc("/dev/stdout",1),Oc("/dev/stderr",1));Ac=!1;Ca(qa);aa(m);if(m.onRuntimeInitialized)m.onRuntimeInitialized();if(m.postRun)for("function"==typeof m.postRun&&
(m.postRun=[m.postRun]);m.postRun.length;){var b=m.postRun.shift();ra.unshift(b);}Ca(ra);}}if(!(0<F)){if(m.preRun)for("function"==typeof m.preRun&&(m.preRun=[m.preRun]);m.preRun.length;)sa();Ca(pa);0<F||(m.setStatus?(m.setStatus("Running..."),setTimeout(function(){setTimeout(function(){m.setStatus("");},1);a();},1)):a());}}if(m.preInit)for("function"==typeof m.preInit&&(m.preInit=[m.preInit]);0<m.preInit.length;)m.preInit.pop()();ed();moduleRtn=ca;


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
        throw new Error("decodeWASM not yet initialized");
    }
    return wasmModule["decodeWASM"](bytes, twoS);
}

export { decodeJS, decodeWASM, getDecoderInitialized, initDecoder };
//# sourceMappingURL=index.js.map
