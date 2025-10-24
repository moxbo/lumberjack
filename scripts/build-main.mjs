#!/usr/bin/env node
// Simple script to transpile TypeScript files for main process
import { build } from 'esbuild';
import { glob } from 'glob';

const files = await glob('src/**/*.ts');

await build({
  entryPoints: files,
  outdir: 'src',
  outExtension: { '.js': '.js' },
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: false,
  logLevel: 'info',
});

console.log('TypeScript files transpiled successfully');
