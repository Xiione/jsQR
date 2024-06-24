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
            while (firstNonZero < coefficientsLength && coefficients[firstNonZero] === 0) {
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
            [smallerCoefficients, largerCoefficients] = [largerCoefficients, smallerCoefficients];
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

var n=moduleArg,ca,da,ea=new Promise((a,b)=>{ca=a;da=b;}),fa=Object.assign({},n),ha="./this.program",p="",ia,ja;p=self.location.href;_scriptName&&(p=_scriptName);p.startsWith("blob:")?p="":p=p.substr(0,p.replace(/[?#].*/,"").lastIndexOf("/")+1);ja=a=>{var b=new XMLHttpRequest;b.open("GET",a,!1);b.responseType="arraybuffer";b.send(null);return new Uint8Array(b.response)};
ia=(a,b,c)=>{fetch(a,{credentials:"same-origin"}).then(d=>d.ok?d.arrayBuffer():Promise.reject(Error(d.status+" : "+d.url))).then(b,c);};var v=n.printErr||console.error.bind(console);Object.assign(n,fa);fa=null;n.thisProgram&&(ha=n.thisProgram);var x;n.wasmBinary&&(x=n.wasmBinary);var ka,la=!1,y,A,B,ma,C,D,na,oa,pa=[],qa=[],ra=[];function sa(){var a=n.preRun.shift();pa.unshift(a);}var E=0,F=null;
function ua(a){n.onAbort?.(a);a="Aborted("+a+")";v(a);la=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");da(a);throw a;}var va=a=>a.startsWith("data:application/octet-stream;base64,"),wa;function xa(a){if(a==wa&&x)return new Uint8Array(x);if(ja)return ja(a);throw "both async and sync fetching of the wasm failed";}function ya(a){return x?Promise.resolve().then(()=>xa(a)):new Promise((b,c)=>{ia(a,d=>b(new Uint8Array(d)),()=>{try{b(xa(a));}catch(d){c(d);}});})}
function za(a,b,c){return ya(a).then(d=>WebAssembly.instantiate(d,b)).then(c,d=>{v(`failed to asynchronously prepare wasm: ${d}`);ua(d);})}function Aa(a,b){var c=wa;return x||"function"!=typeof WebAssembly.instantiateStreaming||va(c)||"function"!=typeof fetch?za(c,a,b):fetch(c,{credentials:"same-origin"}).then(d=>WebAssembly.instantiateStreaming(d,a).then(b,function(e){v(`wasm streaming compile failed: ${e}`);v("falling back to ArrayBuffer instantiation");return za(c,a,b)}))}var Ba=a=>{for(;0<a.length;)a.shift()(n);};
class Ca{constructor(a){this.S=a-24;}}var Da=0,Fa={},Ga=a=>{for(;a.length;){var b=a.pop();a.pop()(b);}};function H(a){return this.fromWireType(D[a>>2])}
var I={},J={},Ha={},K,M=(a,b,c)=>{function d(f){f=c(f);if(f.length!==a.length)throw new K("Mismatched type converter count");for(var m=0;m<a.length;++m)L(a[m],f[m]);}a.forEach(function(f){Ha[f]=b;});var e=Array(b.length),h=[],g=0;b.forEach((f,m)=>{J.hasOwnProperty(f)?e[m]=J[f]:(h.push(f),I.hasOwnProperty(f)||(I[f]=[]),I[f].push(()=>{e[m]=J[f];++g;g===h.length&&d(e);}));});0===h.length&&d(e);},Ja,N=a=>{for(var b="";A[a];)b+=Ja[A[a++]];return b},O,Ka=a=>{throw new O(a);};
function La(a,b,c={}){var d=b.name;if(!a)throw new O(`type "${d}" must have a positive integer typeid pointer`);if(J.hasOwnProperty(a)){if(c.va)return;throw new O(`Cannot register type '${d}' twice`);}J[a]=b;delete Ha[a];I.hasOwnProperty(a)&&(b=I[a],delete I[a],b.forEach(e=>e()));}function L(a,b,c={}){if(!("argPackAdvance"in b))throw new TypeError("registerType registeredInstance requires argPackAdvance");return La(a,b,c)}
var Ma=a=>{throw new O(a.P.T.R.name+" instance already deleted");},Na=!1,Oa=()=>{},Pa=(a,b,c)=>{if(b===c)return a;if(void 0===c.W)return null;a=Pa(a,b,c.W);return null===a?null:c.oa(a)},Qa={},P=[],Ra=()=>{for(;P.length;){var a=P.pop();a.P.aa=!1;a["delete"]();}},Q,R={},Sa=(a,b)=>{if(void 0===b)throw new O("ptr should not be undefined");for(;a.W;)b=a.da(b),a=a.W;return R[b]},Ta=(a,b)=>{if(!b.T||!b.S)throw new K("makeClassHandle requires ptr and ptrType");if(!!b.X!==!!b.U)throw new K("Both smartPtrType and smartPtr must be specified");
b.count={value:1};return S(Object.create(a,{P:{value:b,writable:!0}}))},S=a=>{if("undefined"===typeof FinalizationRegistry)return S=b=>b,a;Na=new FinalizationRegistry(b=>{b=b.P;--b.count.value;0===b.count.value&&(b.U?b.X.Z(b.U):b.T.R.Z(b.S));});S=b=>{var c=b.P;c.U&&Na.register(b,{P:c},b);return b};Oa=b=>{Na.unregister(b);};return S(a)};function Ua(){}
var T=(a,b)=>Object.defineProperty(b,"name",{value:a}),Va=(a,b,c)=>{if(void 0===a[b].V){var d=a[b];a[b]=function(...e){if(!a[b].V.hasOwnProperty(e.length))throw new O(`Function '${c}' called with an invalid number of arguments (${e.length}) - expects one of (${a[b].V})!`);return a[b].V[e.length].apply(this,e)};a[b].V=[];a[b].V[d.ea]=d;}},Wa=(a,b,c)=>{if(n.hasOwnProperty(a)){if(void 0===c||void 0!==n[a].V&&void 0!==n[a].V[c])throw new O(`Cannot register public name '${a}' twice`);Va(n,a,a);if(n.hasOwnProperty(c))throw new O(`Cannot register multiple overloads of a function with the same number of arguments (${c})!`);
n[a].V[c]=b;}else n[a]=b,void 0!==c&&(n[a].Ea=c);},Xa=a=>{if(void 0===a)return "_unknown";a=a.replace(/[^a-zA-Z0-9_]/g,"$");var b=a.charCodeAt(0);return 48<=b&&57>=b?`_${a}`:a};function Ya(a,b,c,d,e,h,g,f){this.name=a;this.constructor=b;this.ba=c;this.Z=d;this.W=e;this.qa=h;this.da=g;this.oa=f;this.ya=[];}var Za=(a,b,c)=>{for(;b!==c;){if(!b.da)throw new O(`Expected null or instance of ${c.name}, got an instance of ${b.name}`);a=b.da(a);b=b.W;}return a};
function $a(a,b){if(null===b){if(this.ha)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.P)throw new O(`Cannot pass "${ab(b)}" as a ${this.name}`);if(!b.P.S)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);return Za(b.P.S,b.P.T.R,this.R)}
function bb(a,b){if(null===b){if(this.ha)throw new O(`null is not a valid ${this.name}`);if(this.ga){var c=this.ia();null!==a&&a.push(this.Z,c);return c}return 0}if(!b||!b.P)throw new O(`Cannot pass "${ab(b)}" as a ${this.name}`);if(!b.P.S)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(!this.fa&&b.P.T.fa)throw new O(`Cannot convert argument of type ${b.P.X?b.P.X.name:b.P.T.name} to parameter type ${this.name}`);c=Za(b.P.S,b.P.T.R,this.R);if(this.ga){if(void 0===b.P.U)throw new O("Passing raw pointer to smart pointer is illegal");
switch(this.Da){case 0:if(b.P.X===this)c=b.P.U;else throw new O(`Cannot convert argument of type ${b.P.X?b.P.X.name:b.P.T.name} to parameter type ${this.name}`);break;case 1:c=b.P.U;break;case 2:if(b.P.X===this)c=b.P.U;else {var d=b.clone();c=this.za(c,U(()=>d["delete"]()));null!==a&&a.push(this.Z,c);}break;default:throw new O("Unsupporting sharing policy");}}return c}
function cb(a,b){if(null===b){if(this.ha)throw new O(`null is not a valid ${this.name}`);return 0}if(!b.P)throw new O(`Cannot pass "${ab(b)}" as a ${this.name}`);if(!b.P.S)throw new O(`Cannot pass deleted object as a pointer of type ${this.name}`);if(b.P.T.fa)throw new O(`Cannot convert argument of type ${b.P.T.name} to parameter type ${this.name}`);return Za(b.P.S,b.P.T.R,this.R)}
function db(a,b,c,d,e,h,g,f,m,l,k){this.name=a;this.R=b;this.ha=c;this.fa=d;this.ga=e;this.xa=h;this.Da=g;this.ma=f;this.ia=m;this.za=l;this.Z=k;e||void 0!==b.W?this.toWireType=bb:(this.toWireType=d?$a:cb,this.Y=null);}
var eb=(a,b,c)=>{if(!n.hasOwnProperty(a))throw new K("Replacing nonexistent public symbol");void 0!==n[a].V&&void 0!==c?n[a].V[c]=b:(n[a]=b,n[a].ea=c);},fb=[],gb,hb=a=>{var b=fb[a];b||(a>=fb.length&&(fb.length=a+1),fb[a]=b=gb.get(a));return b},ib=(a,b,c=[])=>{a.includes("j")?(a=a.replace(/p/g,"i"),b=(0, n["dynCall_"+a])(b,...c)):b=hb(b)(...c);return b},jb=(a,b)=>(...c)=>ib(a,b,c),V=(a,b)=>{a=N(a);var c=a.includes("j")?jb(a,b):hb(b);if("function"!=typeof c)throw new O(`unknown function pointer with signature ${a}: ${b}`);
return c},kb,mb=a=>{a=lb(a);var b=N(a);W(a);return b},nb=(a,b)=>{function c(h){e[h]||J[h]||(Ha[h]?Ha[h].forEach(c):(d.push(h),e[h]=!0));}var d=[],e={};b.forEach(c);throw new kb(`${a}: `+d.map(mb).join([", "]));},ob=(a,b)=>{for(var c=[],d=0;d<a;d++)c.push(D[b+4*d>>2]);return c};function pb(a){for(var b=1;b<a.length;++b)if(null!==a[b]&&void 0===a[b].Y)return !0;return !1}
function qb(a){var b=Function;if(!(b instanceof Function))throw new TypeError(`new_ called with constructor type ${typeof b} which is not a function`);var c=T(b.name||"unknownFunctionName",function(){});c.prototype=b.prototype;c=new c;a=b.apply(c,a);return a instanceof Object?a:c}
function rb(a,b,c,d,e,h){var g=b.length;if(2>g)throw new O("argTypes array size mismatch! Must at least get return value and 'this' types!");var f=null!==b[1]&&null!==c,m=pb(b);c="void"!==b[0].name;d=[a,Ka,d,e,Ga,b[0],b[1]];for(e=0;e<g-2;++e)d.push(b[e+2]);if(!m)for(e=f?1:2;e<b.length;++e)null!==b[e].Y&&d.push(b[e].Y);m=pb(b);e=b.length;var l="",k="";for(g=0;g<e-2;++g)l+=(0!==g?", ":"")+"arg"+g,k+=(0!==g?", ":"")+"arg"+g+"Wired";l=`\n        return function (${l}) {\n        if (arguments.length !== ${e-
2}) {\n          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ${e-2}');\n        }`;m&&(l+="var destructors = [];\n");var r=m?"destructors":"null",q="humanName throwBindingError invoker fn runDestructors retType classParam".split(" ");f&&(l+="var thisWired = classParam['toWireType']("+r+", this);\n");for(g=0;g<e-2;++g)l+="var arg"+g+"Wired = argType"+g+"['toWireType']("+r+", arg"+g+");\n",q.push("argType"+g);f&&(k="thisWired"+(0<k.length?", ":
"")+k);l+=(c||h?"var rv = ":"")+"invoker(fn"+(0<k.length?", ":"")+k+");\n";if(m)l+="runDestructors(destructors);\n";else for(g=f?1:2;g<b.length;++g)h=1===g?"thisWired":"arg"+(g-2)+"Wired",null!==b[g].Y&&(l+=`${h}_dtor(${h});\n`,q.push(`${h}_dtor`));c&&(l+="var ret = retType['fromWireType'](rv);\nreturn ret;\n");let [w,u]=[q,l+"}\n"];w.push(u);b=qb(w)(...d);return T(a,b)}
var sb=a=>{a=a.trim();const b=a.indexOf("(");return -1!==b?a.substr(0,b):a},tb=[],X=[],vb=a=>{9<a&&0===--X[a+1]&&(X[a]=void 0,tb.push(a));},Y=a=>{if(!a)throw new O("Cannot use deleted val. handle = "+a);return X[a]},U=a=>{switch(a){case void 0:return 2;case null:return 4;case !0:return 6;case !1:return 8;default:const b=tb.pop()||X.length;X[b]=a;X[b+1]=1;return b}},wb={name:"emscripten::val",fromWireType:a=>{var b=Y(a);vb(a);return b},toWireType:(a,b)=>U(b),argPackAdvance:8,readValueFromPointer:H,Y:null},
ab=a=>{if(null===a)return "null";var b=typeof a;return "object"===b||"array"===b||"function"===b?a.toString():""+a},xb=(a,b)=>{switch(b){case 4:return function(c){return this.fromWireType(na[c>>2])};case 8:return function(c){return this.fromWireType(oa[c>>3])};default:throw new TypeError(`invalid float width (${b}): ${a}`);}},yb=(a,b,c)=>{switch(b){case 1:return c?d=>y[d]:d=>A[d];case 2:return c?d=>B[d>>1]:d=>ma[d>>1];case 4:return c?d=>C[d>>2]:d=>D[d>>2];default:throw new TypeError(`invalid integer width (${b}): ${a}`);
}},zb="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0,Ab="undefined"!=typeof TextDecoder?new TextDecoder("utf-16le"):void 0,Bb=(a,b)=>{var c=a>>1;for(var d=c+b/2;!(c>=d)&&ma[c];)++c;c<<=1;if(32<c-a&&Ab)return Ab.decode(A.subarray(a,c));c="";for(d=0;!(d>=b/2);++d){var e=B[a+2*d>>1];if(0==e)break;c+=String.fromCharCode(e);}return c},Cb=(a,b,c)=>{c??=2147483647;if(2>c)return 0;c-=2;var d=b;c=c<2*a.length?c/2:a.length;for(var e=0;e<c;++e)B[b>>1]=a.charCodeAt(e),b+=2;B[b>>1]=0;return b-d},
Db=a=>2*a.length,Eb=(a,b)=>{for(var c=0,d="";!(c>=b/4);){var e=C[a+4*c>>2];if(0==e)break;++c;65536<=e?(e-=65536,d+=String.fromCharCode(55296|e>>10,56320|e&1023)):d+=String.fromCharCode(e);}return d},Fb=(a,b,c)=>{c??=2147483647;if(4>c)return 0;var d=b;c=d+c-4;for(var e=0;e<a.length;++e){var h=a.charCodeAt(e);if(55296<=h&&57343>=h){var g=a.charCodeAt(++e);h=65536+((h&1023)<<10)|g&1023;}C[b>>2]=h;b+=4;if(b+4>c)break}C[b>>2]=0;return b-d},Gb=a=>{for(var b=0,c=0;c<a.length;++c){var d=a.charCodeAt(c);55296<=
d&&57343>=d&&++c;b+=4;}return b},Hb=(a,b)=>{var c=J[a];if(void 0===c)throw a=`${b} has unknown type ${mb(a)}`,new O(a);return c},Ib=(a,b,c)=>{var d=[];a=a.toWireType(d,c);d.length&&(D[b>>2]=U(d));return a},Jb=[],Kb={},Lb=a=>{var b=Kb[a];return void 0===b?N(a):b},Mb=()=>"object"==typeof globalThis?globalThis:Function("return this")(),Nb=a=>{var b=Jb.length;Jb.push(a);return b},Ob=(a,b)=>{for(var c=Array(a),d=0;d<a;++d)c[d]=Hb(D[b+4*d>>2],"parameter "+d);return c},Pb={},Rb=()=>{if(!Qb){var a={USER:"web_user",
LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:("object"==typeof navigator&&navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8",_:ha||"./this.program"},b;for(b in Pb)void 0===Pb[b]?delete a[b]:a[b]=Pb[b];var c=[];for(b in a)c.push(`${b}=${a[b]}`);Qb=c;}return Qb},Qb;K=n.InternalError=class extends Error{constructor(a){super(a);this.name="InternalError";}};for(var Sb=Array(256),Tb=0;256>Tb;++Tb)Sb[Tb]=String.fromCharCode(Tb);Ja=Sb;
O=n.BindingError=class extends Error{constructor(a){super(a);this.name="BindingError";}};
Object.assign(Ua.prototype,{isAliasOf:function(a){if(!(this instanceof Ua&&a instanceof Ua))return !1;var b=this.P.T.R,c=this.P.S;a.P=a.P;var d=a.P.T.R;for(a=a.P.S;b.W;)c=b.da(c),b=b.W;for(;d.W;)a=d.da(a),d=d.W;return b===d&&c===a},clone:function(){this.P.S||Ma(this);if(this.P.ca)return this.P.count.value+=1,this;var a=S,b=Object,c=b.create,d=Object.getPrototypeOf(this),e=this.P;a=a(c.call(b,d,{P:{value:{count:e.count,aa:e.aa,ca:e.ca,S:e.S,T:e.T,U:e.U,X:e.X}}}));a.P.count.value+=1;a.P.aa=!1;return a},
["delete"](){this.P.S||Ma(this);if(this.P.aa&&!this.P.ca)throw new O("Object already scheduled for deletion");Oa(this);var a=this.P;--a.count.value;0===a.count.value&&(a.U?a.X.Z(a.U):a.T.R.Z(a.S));this.P.ca||(this.P.U=void 0,this.P.S=void 0);},isDeleted:function(){return !this.P.S},deleteLater:function(){this.P.S||Ma(this);if(this.P.aa&&!this.P.ca)throw new O("Object already scheduled for deletion");P.push(this);1===P.length&&Q&&Q(Ra);this.P.aa=!0;return this}});n.getInheritedInstanceCount=()=>Object.keys(R).length;
n.getLiveInheritedInstances=()=>{var a=[],b;for(b in R)R.hasOwnProperty(b)&&a.push(R[b]);return a};n.flushPendingDeletes=Ra;n.setDelayFunction=a=>{Q=a;P.length&&Q&&Q(Ra);};
Object.assign(db.prototype,{ra(a){this.ma&&(a=this.ma(a));return a},ka(a){this.Z?.(a);},argPackAdvance:8,readValueFromPointer:H,fromWireType:function(a){function b(){return this.ga?Ta(this.R.ba,{T:this.xa,S:c,X:this,U:a}):Ta(this.R.ba,{T:this,S:a})}var c=this.ra(a);if(!c)return this.ka(a),null;var d=Sa(this.R,c);if(void 0!==d){if(0===d.P.count.value)return d.P.S=c,d.P.U=a,d.clone();d=d.clone();this.ka(a);return d}d=this.R.qa(c);d=Qa[d];if(!d)return b.call(this);d=this.fa?d.na:d.pointerType;var e=Pa(c,
this.R,d.R);return null===e?b.call(this):this.ga?Ta(d.R.ba,{T:d,S:e,X:this,U:a}):Ta(d.R.ba,{T:d,S:e})}});kb=n.UnboundTypeError=((a,b)=>{var c=T(b,function(d){this.name=b;this.message=d;d=Error(d).stack;void 0!==d&&(this.stack=this.toString()+"\n"+d.replace(/^Error(:[^\n]*)?\n/,""));});c.prototype=Object.create(a.prototype);c.prototype.constructor=c;c.prototype.toString=function(){return void 0===this.message?this.name:`${this.name}: ${this.message}`};return c})(Error,"UnboundTypeError");
X.push(0,1,void 0,1,null,1,!0,1,!1,1);n.count_emval_handles=()=>X.length/2-5-tb.length;
var Vb={l:(a,b,c)=>{var d=new Ca(a);D[d.S+16>>2]=0;D[d.S+4>>2]=b;D[d.S+8>>2]=c;Da=a;throw Da;},y:()=>{ua("");},F:a=>{var b=Fa[a];delete Fa[a];var c=b.ia,d=b.Z,e=b.la,h=e.map(g=>g.ua).concat(e.map(g=>g.Ba));M([a],h,g=>{var f={};e.forEach((m,l)=>{var k=g[l],r=m.sa,q=m.ta,w=g[l+e.length],u=m.Aa,t=m.Ca;f[m.pa]={read:G=>k.fromWireType(r(q,G)),write:(G,aa)=>{var z=[];u(t,G,w.toWireType(z,aa));Ga(z);}};});return [{name:b.name,fromWireType:m=>{var l={},k;for(k in f)l[k]=f[k].read(m);d(m);return l},toWireType:(m,
l)=>{for(var k in f)if(!(k in l))throw new TypeError(`Missing field: "${k}"`);var r=c();for(k in f)f[k].write(r,l[k]);null!==m&&m.push(d,r);return r},argPackAdvance:8,readValueFromPointer:H,Y:d}]});},t:()=>{},A:(a,b,c,d)=>{b=N(b);L(a,{name:b,fromWireType:function(e){return !!e},toWireType:function(e,h){return h?c:d},argPackAdvance:8,readValueFromPointer:function(e){return this.fromWireType(A[e])},Y:null});},D:(a,b,c,d,e,h,g,f,m,l,k,r,q)=>{k=N(k);h=V(e,h);f&&=V(g,f);l&&=V(m,l);q=V(r,q);var w=Xa(k);Wa(w,
function(){nb(`Cannot construct ${k} due to unbound types`,[d]);});M([a,b,c],d?[d]:[],u=>{u=u[0];if(d){var t=u.R;var G=t.ba;}else G=Ua.prototype;u=T(k,function(...Ia){if(Object.getPrototypeOf(this)!==aa)throw new O("Use 'new' to construct "+k);if(void 0===z.$)throw new O(k+" has no accessible constructor");var ub=z.$[Ia.length];if(void 0===ub)throw new O(`Tried to invoke ctor of ${k} with invalid number of parameters (${Ia.length}) - expected (${Object.keys(z.$).toString()}) parameters instead!`);return ub.apply(this,
Ia)});var aa=Object.create(G,{constructor:{value:u}});u.prototype=aa;var z=new Ya(k,u,aa,q,t,h,f,l);if(z.W){var ba;(ba=z.W).ja??(ba.ja=[]);z.W.ja.push(z);}t=new db(k,z,!0,!1,!1);ba=new db(k+"*",z,!1,!1,!1);G=new db(k+" const*",z,!1,!0,!1);Qa[a]={pointerType:ba,na:G};eb(w,u);return [t,ba,G]});},C:(a,b,c,d,e,h)=>{var g=ob(b,c);e=V(d,e);M([],[a],f=>{f=f[0];var m=`constructor ${f.name}`;void 0===f.R.$&&(f.R.$=[]);if(void 0!==f.R.$[b-1])throw new O(`Cannot register multiple constructors with identical number of parameters (${b-
1}) for class '${f.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);f.R.$[b-1]=()=>{nb(`Cannot construct ${f.name} due to unbound types`,g);};M([],g,l=>{l.splice(1,0,null);f.R.$[b-1]=rb(m,l,null,e,h);return []});return []});},d:(a,b,c,d,e,h,g,f,m)=>{var l=ob(c,d);b=N(b);b=sb(b);h=V(e,h);M([],[a],k=>{function r(){nb(`Cannot call ${q} due to unbound types`,l);}k=k[0];var q=`${k.name}.${b}`;b.startsWith("@@")&&(b=Symbol[b.substring(2)]);f&&k.R.ya.push(b);
var w=k.R.ba,u=w[b];void 0===u||void 0===u.V&&u.className!==k.name&&u.ea===c-2?(r.ea=c-2,r.className=k.name,w[b]=r):(Va(w,b,q),w[b].V[c-2]=r);M([],l,t=>{t=rb(q,t,k,h,g,m);void 0===w[b].V?(t.ea=c-2,w[b]=t):w[b].V[c-2]=t;return []});return []});},z:a=>L(a,wb),j:(a,b,c)=>{b=N(b);L(a,{name:b,fromWireType:d=>d,toWireType:(d,e)=>e,argPackAdvance:8,readValueFromPointer:xb(b,c),Y:null});},E:(a,b,c,d,e,h,g)=>{var f=ob(b,c);a=N(a);a=sb(a);e=V(d,e);Wa(a,function(){nb(`Cannot call ${a} due to unbound types`,f);},
b-1);M([],f,m=>{eb(a,rb(a,[m[0],null].concat(m.slice(1)),null,e,h,g),b-1);return []});},c:(a,b,c,d,e)=>{b=N(b);-1===e&&(e=4294967295);e=f=>f;if(0===d){var h=32-8*c;e=f=>f<<h>>>h;}var g=b.includes("unsigned")?function(f,m){return m>>>0}:function(f,m){return m};L(a,{name:b,fromWireType:e,toWireType:g,argPackAdvance:8,readValueFromPointer:yb(b,c,0!==d),Y:null});},a:(a,b,c)=>{function d(h){return new e(y.buffer,D[h+4>>2],D[h>>2])}var e=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,
Float64Array][b];c=N(c);L(a,{name:c,fromWireType:d,argPackAdvance:8,readValueFromPointer:d},{va:!0});},o:a=>{L(a,wb);},k:(a,b)=>{b=N(b);var c="std::string"===b;L(a,{name:b,fromWireType:function(d){var e=D[d>>2],h=d+4;if(c)for(var g=h,f=0;f<=e;++f){var m=h+f;if(f==e||0==A[m]){if(g){var l=g;var k=A,r=l+(m-g);for(g=l;k[g]&&!(g>=r);)++g;if(16<g-l&&k.buffer&&zb)l=zb.decode(k.subarray(l,g));else {for(r="";l<g;){var q=k[l++];if(q&128){var w=k[l++]&63;if(192==(q&224))r+=String.fromCharCode((q&31)<<6|w);else {var u=
k[l++]&63;q=224==(q&240)?(q&15)<<12|w<<6|u:(q&7)<<18|w<<12|u<<6|k[l++]&63;65536>q?r+=String.fromCharCode(q):(q-=65536,r+=String.fromCharCode(55296|q>>10,56320|q&1023));}}else r+=String.fromCharCode(q);}l=r;}}else l="";if(void 0===t)var t=l;else t+=String.fromCharCode(0),t+=l;g=m+1;}}else {t=Array(e);for(f=0;f<e;++f)t[f]=String.fromCharCode(A[h+f]);t=t.join("");}W(d);return t},toWireType:function(d,e){e instanceof ArrayBuffer&&(e=new Uint8Array(e));var h,g="string"==typeof e;if(!(g||e instanceof Uint8Array||
e instanceof Uint8ClampedArray||e instanceof Int8Array))throw new O("Cannot pass non-string to std::string");var f;if(c&&g)for(h=f=0;h<e.length;++h){var m=e.charCodeAt(h);127>=m?f++:2047>=m?f+=2:55296<=m&&57343>=m?(f+=4,++h):f+=3;}else f=e.length;h=f;f=Ub(4+h+1);m=f+4;D[f>>2]=h;if(c&&g){if(g=m,m=h+1,h=A,0<m){m=g+m-1;for(var l=0;l<e.length;++l){var k=e.charCodeAt(l);if(55296<=k&&57343>=k){var r=e.charCodeAt(++l);k=65536+((k&1023)<<10)|r&1023;}if(127>=k){if(g>=m)break;h[g++]=k;}else {if(2047>=k){if(g+1>=
m)break;h[g++]=192|k>>6;}else {if(65535>=k){if(g+2>=m)break;h[g++]=224|k>>12;}else {if(g+3>=m)break;h[g++]=240|k>>18;h[g++]=128|k>>12&63;}h[g++]=128|k>>6&63;}h[g++]=128|k&63;}}h[g]=0;}}else if(g)for(g=0;g<h;++g){l=e.charCodeAt(g);if(255<l)throw W(m),new O("String has UTF-16 code units that do not fit in 8 bits");A[m+g]=l;}else for(g=0;g<h;++g)A[m+g]=e[g];null!==d&&d.push(W,f);return f},argPackAdvance:8,readValueFromPointer:H,Y(d){W(d);}});},f:(a,b,c)=>{c=N(c);if(2===b){var d=Bb;var e=Cb;var h=Db;var g=f=>ma[f>>
1];}else 4===b&&(d=Eb,e=Fb,h=Gb,g=f=>D[f>>2]);L(a,{name:c,fromWireType:f=>{for(var m=D[f>>2],l,k=f+4,r=0;r<=m;++r){var q=f+4+r*b;if(r==m||0==g(q))k=d(k,q-k),void 0===l?l=k:(l+=String.fromCharCode(0),l+=k),k=q+b;}W(f);return l},toWireType:(f,m)=>{if("string"!=typeof m)throw new O(`Cannot pass non-string to C++ string type ${c}`);var l=h(m),k=Ub(4+l+b);D[k>>2]=l/b;e(m,k+4,l+b);null!==f&&f.push(W,k);return k},argPackAdvance:8,readValueFromPointer:H,Y(f){W(f);}});},G:(a,b,c,d,e,h)=>{Fa[a]={name:N(b),ia:V(c,
d),Z:V(e,h),la:[]};},p:(a,b,c,d,e,h,g,f,m,l)=>{Fa[a].la.push({pa:N(b),ua:c,sa:V(d,e),ta:h,Ba:g,Aa:V(f,m),Ca:l});},B:(a,b)=>{b=N(b);L(a,{wa:!0,name:b,argPackAdvance:0,fromWireType:()=>{},toWireType:()=>{}});},x:(a,b,c)=>A.copyWithin(a,b,b+c),i:(a,b,c)=>{a=Y(a);b=Hb(b,"emval::as");return Ib(b,c,a)},r:(a,b,c,d)=>{a=Jb[a];b=Y(b);return a(null,b,c,d)},H:(a,b,c,d,e)=>{a=Jb[a];b=Y(b);c=Lb(c);return a(b,b[c],d,e)},b:vb,s:a=>{if(0===a)return U(Mb());a=Lb(a);return U(Mb()[a])},g:(a,b,c)=>{b=Ob(a,b);var d=b.shift();
a--;var e="return function (obj, func, destructorsRef, args) {\n",h=0,g=[];0===c&&g.push("obj");for(var f=["retType"],m=[d],l=0;l<a;++l)g.push("arg"+l),f.push("argType"+l),m.push(b[l]),e+=`  var arg${l} = argType${l}.readValueFromPointer(args${h?"+"+h:""});\n`,h+=b[l].argPackAdvance;e+=`  var rv = ${1===c?"new func":"func.call"}(${g.join(", ")});\n`;d.wa||(f.push("emval_returnValue"),m.push(Ib),e+="  return emval_returnValue(retType, destructorsRef, rv);\n");f.push(e+"};\n");a=qb(f)(...m);c=`methodCaller<(${b.map(k=>
k.name).join(", ")}) => ${d.name}>`;return Nb(T(c,a))},I:a=>{a=Lb(a);return U(n[a])},m:(a,b)=>{a=Y(a);b=Y(b);return U(a[b])},h:a=>{9<a&&(X[a+1]+=1);},q:a=>U(Lb(a)),e:a=>{var b=Y(a);Ga(b);vb(a);},n:(a,b)=>{a=Hb(a,"_emval_take_value");a=a.readValueFromPointer(b);return U(a)},w:()=>{ua("OOM");},u:(a,b)=>{var c=0;Rb().forEach((d,e)=>{var h=b+c;e=D[a+4*e>>2]=h;for(h=0;h<d.length;++h)y[e++]=d.charCodeAt(h);y[e]=0;c+=d.length+1;});return 0},v:(a,b)=>{var c=Rb();D[a>>2]=c.length;var d=0;c.forEach(e=>d+=e.length+
1);D[b>>2]=d;return 0}},Z=function(){function a(c){Z=c.exports;ka=Z.J;c=ka.buffer;n.HEAP8=y=new Int8Array(c);n.HEAP16=B=new Int16Array(c);n.HEAPU8=A=new Uint8Array(c);n.HEAPU16=ma=new Uint16Array(c);n.HEAP32=C=new Int32Array(c);n.HEAPU32=D=new Uint32Array(c);n.HEAPF32=na=new Float32Array(c);n.HEAPF64=oa=new Float64Array(c);gb=Z.M;qa.unshift(Z.K);E--;n.monitorRunDependencies?.(E);0==E&&(F&&(c=F,F=null,c()));return Z}var b={a:Vb};E++;n.monitorRunDependencies?.(E);
if(n.instantiateWasm)try{return n.instantiateWasm(b,a)}catch(c){v(`Module.instantiateWasm callback failed with error: ${c}`),da(c);}wa||=n.locateFile?va("rsiscool.wasm")?"rsiscool.wasm":n.locateFile?n.locateFile("rsiscool.wasm",p):p+"rsiscool.wasm":(new URL("rsiscool.wasm",import.meta.url)).href;Aa(b,function(c){a(c.instance);}).catch(da);return {}}(),lb=a=>(lb=Z.L)(a),Ub=a=>(Ub=Z.N)(a),W=a=>(W=Z.O)(a),Wb;F=function Xb(){Wb||Yb();Wb||(F=Xb);};
function Yb(){function a(){if(!Wb&&(Wb=!0,n.calledRun=!0,!la)){Ba(qa);ca(n);if(n.onRuntimeInitialized)n.onRuntimeInitialized();if(n.postRun)for("function"==typeof n.postRun&&(n.postRun=[n.postRun]);n.postRun.length;){var b=n.postRun.shift();ra.unshift(b);}Ba(ra);}}if(!(0<E)){if(n.preRun)for("function"==typeof n.preRun&&(n.preRun=[n.preRun]);n.preRun.length;)sa();Ba(pa);0<E||(n.setStatus?(n.setStatus("Running..."),setTimeout(function(){setTimeout(function(){n.setStatus("");},1);a();},1)):a());}}
if(n.preInit)for("function"==typeof n.preInit&&(n.preInit=[n.preInit]);0<n.preInit.length;)n.preInit.pop()();Yb();moduleRtn=ea;


  return moduleRtn;
}
);
})();

let wasmModule;
async function initDecoder() {
    wasmModule = await rsiscool();
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
    const field = new GenericGF(0x011D, 256, 0); // x^8 + x^4 + x^3 + x^2 + 1
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
