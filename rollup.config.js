import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: 'dist/nats-echo.js',
            format: 'umd',
            name: 'NatsEcho',
            globals: {
                'nats.ws': 'nats',
                'laravel-echo': 'Echo'
            }
        },
        {
            file: 'dist/nats-echo.esm.js',
            format: 'esm'
        }
    ],
    plugins: [
        resolve(),
        commonjs(),
        typescript({ tsconfig: './tsconfig.json' }),
        terser()
    ],
    external: ['nats.ws', 'laravel-echo']
};