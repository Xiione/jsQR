import typescript from 'rollup-plugin-typescript2';

export default {
    input: {
        'jsQR': 'src/index.ts',
        'decoder/decoder': 'src/decoder/decoder.ts',
        'decoder/reedsolomon': 'src/decoder/reedsolomon/index.ts',
        'decoder/version': 'src/decoder/version.ts',
        'locator': 'src/locator/index.ts'
    },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].js',
        sourcemap: true,
    },
    plugins: [
        typescript()
    ]
};

