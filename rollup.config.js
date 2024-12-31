import typescript from 'rollup-plugin-typescript2';

export default {
    input: {
        'index': 'src/index.ts',
        'BitMatrix': 'src/BitMatrix.ts',
        'locator/index': 'src/locator/index.ts',
        'decoder/index': 'src/decoder/index.ts',
        'decoder/version': 'src/decoder/version.ts',
        'decoder/decodeData/index': 'src/decoder/decodeData/index.ts',
        'decoder/decodeData/BitStream': 'src/decoder/decodeData/BitStream.ts',
        'decoder/reedsolomon/index': 'src/decoder/reedsolomon/index.ts',
    },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].js',
        sourcemap: true,
    },
    plugins: [
        typescript(),
    ]
};

