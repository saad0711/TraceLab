import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await cp('public', 'dist', { recursive: true });
await copyFile('src/styles.css', 'dist/assets/styles.css');
console.log('Built TraceLab into dist/');
