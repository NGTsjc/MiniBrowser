import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVersion, synchronizeVersion } from '../sync-version.mjs';

test('valid versions, prereleases and malformed or overflowing tags', () => {
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3');
  assert.equal(normalizeVersion('v1.2.3-rc.1+build.7'), '1.2.3-rc.1+build.7');
  for (const value of ['v01.2.3', 'v1.2', 'v1.2.3-01', 'v65536.0.0', 'v1.2.3\n', 'v1.2.3;echo injected']) {
    assert.throws(() => normalizeVersion(value), undefined, value);
  }
});

test('synchronizes all four versions without touching registry packages; check is read-only', async t => {
  const parent = path.resolve('.cache/version-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri'));
  const files = ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  for (const file of files) await writeFile(path.join(root, file), await readFile(file));
  const originalLock = await readFile(path.join(root, files[3]), 'utf8');
  await synchronizeVersion({ root, version: '0.0.0' });
  const dependencyBlocks = text => text.split(/(?=^\[\[package\]\])/m).filter(block => !/^name = "minibrowser"$/m.test(block)).join('');
  const result = await synchronizeVersion({ root, version: 'v2.3.4-rc.1' });
  assert.equal(result.version, '2.3.4-rc.1');
  assert.equal(result.changed.length, 4);
  assert.equal(dependencyBlocks(await readFile(path.join(root, files[3]), 'utf8')), dependencyBlocks(originalLock));
  await synchronizeVersion({ root, version: '2.3.4-rc.1', check: true });
  const before = await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')));
  await assert.rejects(synchronizeVersion({ root, version: '9.0.0', check: true }), /Version mismatch/);
  await assert.rejects(synchronizeVersion({ root, version: 'not-a-version' }));
  assert.deepEqual(await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8'))), before);
  assert.deepEqual((await synchronizeVersion({ root, version: '2.3.4-rc.1' })).changed, []);
  await synchronizeVersion({ root, version: '2.3.4' });
  await synchronizeVersion({ root, check: true });
});

test('ambiguous root lockfile packages fail before modifying any manifest', async t => {
  const parent = path.resolve('.cache/version-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'broken-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src-tauri'));
  for (const file of ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    await writeFile(path.join(root, file), await readFile(file));
  }
  const before = await readFile(path.join(root, 'package.json'), 'utf8');
  const lockPath = path.join(root, 'src-tauri/Cargo.lock');
  await writeFile(lockPath, `${await readFile(lockPath, 'utf8')}\n[[package]]\nname = "minibrowser"\nversion = "9.0.0"\n`);
  await assert.rejects(synchronizeVersion({ root, version: '1.2.3' }), /Expected one minibrowser package/);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), before);
});
