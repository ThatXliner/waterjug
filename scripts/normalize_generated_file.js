import { readFile, writeFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/normalize_generated_file.js <path>');

const contents = await readFile(path, 'utf8');
await writeFile(path, `${contents.trimEnd()}\n`);
