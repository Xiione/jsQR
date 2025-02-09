# jsQR
This fork is a heavily modified version of danimoh's fork for integration with [qris.cool](https://qris.cool). My modifications are not documented in this README. Use at your own risk!!

## Installation
The below assumes you're running MacOS on Apple Silicon.
```
brew install emscripten
```
```
brew install doctest
```
In somewhere you're okay adding directories to your shell PATH from:
```
git clone https://github.com/emscripten-core/emsdk.git && cd /emsdk && ./emsdk install latest-arm64-linux && ./emsdk activate latest-arm64-linux
```
Add the emsdk binaries directories to your PATH. For example, I run fish shell and I installed emsdk at `~`, so I did
```
fish_add_path ~/emsdk
fish_add_path ~/emsdk/upstream/emscripten
```

Finally,
```
git clone --recurse-submodules https://github.com/Xiione/jsQR.git
```

Inside the newly cloned repository run
```
yarn install
```
npm, pnpm, etc likely work as well.

## Testing
```
yarn test
```
The vitest HTML reporter is enabled by default.

<br>

## Begin original README
This project is a fork of [cozmo/jsQR](https://github.com/cozmo/jsQR) that provides an es6 build and contains several of the open pull requests of the original project which lately doesn't seem to be maintained much anymore.

A pure javascript QR code reading library.
This library takes in raw images and will locate, extract and parse any QR code found within.

[Demo](https://danimoh.github.io/jsQR)


## Installation



### NPM
Available [on npm](https://www.npmjs.com/package/jsqr-es6). Can be used in a Node.js program or with a module bundler such as Webpack or Browserify.

```
npm install jsqr-es6 --save
```

```javascript
// ES6 import
import jsQR from "jsqr-es6";

// CommonJS require
const jsQR = require("jsqr-es6");

jsQR(...);
```

### Browser
Alternatively for frontend use [`jsQR.js`](./dist/jsQR.js) can be included with a script tag

```html
<script type="module">
import jsQR from 'path/to/jsQR.js';

jsQR(...);
</script>
```

### A note on webcams
jsQR is designed to be a completely standalone library for scanning QR codes. By design it does not include any platform specific code. This allows it to just as easily scan a frontend webcam stream, a user uploaded image, or be used as part of a backend Node.js process.

If you want to have webcam support out of the box, this qr scanner based on this library is recommended: https://github.com/nimiq/qr-scanner/

## Usage

jsQR exports a method that takes in 3 arguments representing the image data you wish to decode. Additionally can take an options object to further configure scanning behavior.

```javascript
const code = jsQR(imageData, width, height, options?);

if (code) {
  console.log("Found QR code", code);
}
```

### Arguments
- `imageData` - An `Uint8ClampedArray` of RGBA pixel values in the form `[r0, g0, b0, a0, r1, g1, b1, a1, ...]`.
As such the length of this array should be `4 * width * height`.
This data is in the same form as the [`ImageData`](https://developer.mozilla.org/en-US/docs/Web/API/ImageData) interface, and it's also [commonly](https://www.npmjs.com/package/jpeg-js#decoding-jpegs) [returned](https://github.com/lukeapage/pngjs/blob/master/README.md#property-data) by node modules for reading images.
- `width` - The width of the image you wish to decode.
- `height` - The height of the image you wish to decode.
- `options` (optional) - Additional options.
  - `inversionAttempts` - (`attemptBoth` (default), `dontInvert`, `onlyInvert`, or `invertFirst`) - Should jsQR attempt to invert the image to find QR codes with white modules on black backgrounds instead of the black modules on white background. This option defaults to `attemptBoth` for backwards compatibility but causes a ~50% performance hit, and will probably be default to `dontInvert` in future versions.
  - `canOverwriteImage` - (`true` (default) or `false`) - Specifies whether the image data can be overwritten for performance improvements or whether it should be kept untouched. If `true` the image buffer will be used internally to reduce additional memory allocation.

### Return value
If a QR is able to be decoded the library will return an object with the following keys.

- `binaryData` - `Uint8ClampedArray` - The raw bytes of the QR code.
- `data` - The string version of the QR code data.
- `chunks` - The QR chunks.
- `version` - The QR version.
- `location` - An object with keys describing key points of the QR code. Each key is a point of the form `{x: number, y: number}`.
Has points for the following locations.
  - Corners - `topRightCorner`/`topLeftCorner`/`bottomRightCorner`/`bottomLeftCorner`;
  - Finder patterns - `topRightFinderPattern`/`topLeftFinderPattern`/`bottomLeftFinderPattern`
  - May also have a point for the `bottomRightAlignmentPattern` assuming one exists and can be located.

Because the library is written in [typescript](http://www.typescriptlang.org/) you can also view the [type definitions](./dist/index.d.ts) to understand the API.

## Contributing

jsQR is written using [typescript](http://www.typescriptlang.org/).
You can view the development source in the [`src`](./src) directory.

Tests can be run with

```
npm test
```

Besides unit tests the test suite contains several hundred images that can be found in the [/tests/end-to-end/](./tests/end-to-end/) folder.

Not all the images can be read. In general changes should hope to increase the number of images that read. However due to the nature of computer vision some changes may cause images that pass to start to fail and visa versa. To update the expected outcomes run `npm run-script generate-test-data`. These outcomes can be evaluated in the context of a PR to determine if a change improves or harms the overall ability of the library to read QR codes. A summary of which are passing
and failing can be found at [/tests/end-to-end/report.json](./tests/end-to-end/report.json)

After testing any changes, you can compile the production version by running
```
npm run-script build
```

- Source hosted at [GitHub](https://github.com/danimoh/jsQR)
- Report issues, questions, feature requests on [GitHub Issues](https://github.com/danimoh/jsQR/issues)

Pull requests are welcome! Please create seperate branches for seperate features/patches.
