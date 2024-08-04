import typescript from 'rollup-plugin-typescript2';
import copy from 'rollup-plugin-copy'

export default {
    input: {
        'jsQR': 'src/index.ts',
        'decoder/decoder': 'src/decoder/decoder.ts',
        'decoder/decodeData/index': 'src/decoder/decodeData/index.ts',
        'decoder/decodeData/BitStream': 'src/decoder/decodeData/BitStream.ts',
        'decoder/reedsolomon/index': 'src/decoder/reedsolomon/index.ts',
        'decoder/version': 'src/decoder/version.ts',
        'locator': 'src/locator/index.ts',
        'BitMatrix': 'src/BitMatrix.ts'
    },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].js',
        sourcemap: true,
    },
    plugins: [
        typescript(),
        copy({
          targets: [
            { src: './src/decoder/reedsolomon/wasm/rsiscool.wasm', dest: './dist/decoder/reedsolomon/' },
          ]
        }),
    ]
};

