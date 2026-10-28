// Legacy placeholder generator, not used by the current build.
// Running this overwrites the current personal-logo ICO; see scripts/README.md.
// Generate the small native window/tray mark without an image build dependency.
import { mkdirSync, writeFileSync } from 'node:fs';
const size = 32;
const bitmap = Buffer.alloc(40 + size * size * 4 + size * 4);
bitmap.writeUInt32LE(40, 0);
bitmap.writeInt32LE(size, 4);
bitmap.writeInt32LE(size * 2, 8);
bitmap.writeUInt16LE(1, 12);
bitmap.writeUInt16LE(32, 14);
bitmap.writeUInt32LE(size * size * 4, 20);
for (let y = 3; y < 29; y++) for (let x = 3; x < 29; x++) {
  const border = x < 6 || x > 25 || y < 6 || y > 25 || y === 11;
  const rgba = border ? [160, 239, 208, 255] : [24, 36, 42, 255];
  const offset = 40 + ((size - 1 - y) * size + x) * 4;
  bitmap.set([rgba[2], rgba[1], rgba[0], rgba[3]], offset);
}
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = size;
header[7] = size;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(bitmap.length, 14);
header.writeUInt32LE(22, 18);
mkdirSync('src-tauri/icons', { recursive: true });
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, bitmap]));
