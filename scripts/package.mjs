import { copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
if (process.platform !== 'win32') throw new Error('The current portable release target is Windows x64.');
const binary = await readFile('src-tauri/target/release/MiniBrowser.exe');
const pe = binary.readUInt32LE(0x3c);
assert.equal(binary.readUInt32LE(pe), 0x4550, 'Valid PE executable');
assert.equal(binary.readUInt16LE(pe + 4), 0x8664, 'Windows x64 target');
assert.equal(binary.readUInt16LE(pe + 24 + 68), 2, 'GUI subsystem, no console window');
assert.equal(binary.includes(Buffer.from('MINIBROWSER_TEST_CDP')), false, 'No test CDP flag in release');
const icon = await readFile('src-tauri/icons/icon.ico');
assert.equal(icon.readUInt16LE(2), 1, 'Valid application ICO');
for (let i = 0; i < icon.readUInt16LE(4); i++) {
  const entry = 6 + i * 16;
  const start = icon.readUInt32LE(entry + 12);
  const size = icon.readUInt32LE(entry + 8);
  assert.ok(binary.includes(icon.subarray(start, start + size)), 'Current application icon embedded in EXE; rebuild native resources if stale');
}
const optional = pe + 24;
const sectionCount = binary.readUInt16LE(pe + 6);
const sectionTable = optional + binary.readUInt16LE(pe + 20);
function offset(rva) {
  for (let i = 0; i < sectionCount; i++) {
    const section = sectionTable + 40 * i;
    const address = binary.readUInt32LE(section + 12);
    const length = Math.max(binary.readUInt32LE(section + 8), binary.readUInt32LE(section + 16));
    if (rva >= address && rva < address + length) return binary.readUInt32LE(section + 20) + rva - address;
  }
  throw new Error('Invalid PE RVA');
}
const imports = [];
let descriptor = offset(binary.readUInt32LE(optional + 112 + 8));
while (binary.readUInt32LE(descriptor + 12)) {
  const name = offset(binary.readUInt32LE(descriptor + 12));
  imports.push(binary.toString('ascii', name, binary.indexOf(0, name)));
  descriptor += 20;
}
assert.ok(!imports.some(name => /^(WebView2Loader|VCRUNTIME\d+|MSVCP\d+)\.dll$/i.test(name)), 'No sidecar loader or VC++ runtime DLL required');
await mkdir('release', { recursive: true });
const destination = 'release/MiniBrowser.exe';
const staged = 'release/MiniBrowser.next.exe';
await copyFile('src-tauri/target/release/MiniBrowser.exe', staged);
try {
  await rename(staged, destination);
} catch (error) {
  if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(error.code)) throw error;
  // A running Windows image may prevent replacement, but can be renamed.
  // Keep it in the same directory so the live session's portable data is intact.
  const previous = `release/MiniBrowser.previous-${Date.now()}.exe`;
  await rename(destination, previous);
  try { await rename(staged, destination); }
  catch (replacementError) { await rename(previous, destination); throw replacementError; }
  console.log(`Running previous executable retained at: ${previous}`);
}
const hash = createHash('sha256').update(binary).digest('hex');
await writeFile('release/MiniBrowser.exe.sha256', `${hash}  MiniBrowser.exe\n`);
console.log('Portable executable: release/MiniBrowser.exe');
console.log(`Windows x64 GUI · ${(binary.length / 1024 / 1024).toFixed(2)} MiB · system DLLs: ${imports.join(', ')}`);
