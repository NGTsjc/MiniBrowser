import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.cache/release-smoke', String(Date.now()));
await mkdir(root, { recursive: true });
const executable = path.join(root, 'MiniBrowser.exe');
await copyFile('release/MiniBrowser.exe', executable);
await mkdir(path.join(root, 'MiniBrowser.data'), { recursive: true });
await writeFile(path.join(root, 'MiniBrowser.data/settings.json'), JSON.stringify({ version: 1, opacity: 0.7, shortcut: 'Ctrl+Alt+M' }));
const app = spawn(executable, [], { cwd: path.resolve('.'), windowsHide: true, stdio: 'ignore' });
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let inspected;
  for (let i = 0; i < 30; i++) {
    try {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/tests/native-probe.ps1'), '-AppProcessId', String(app.pid)], { windowsHide: true, encoding: 'utf8' });
      inspected = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      if (inspected.MiniBrowser.visible) break;
    } catch {}
    await sleep(200);
  }
  assert.equal(inspected?.MiniBrowser.visible, true, 'Release GUI appears');
  assert.equal(inspected.MiniBrowser.alpha, 179, 'Saved opacity survives first native show');
  assert.ok((inspected.MiniBrowser.extendedStyle & 0x80) !== 0);
  const sessions = await readdir(path.join(root, 'MiniBrowser.data/sessions'));
  assert.equal(sessions.length, 1, 'Data is beside actual EXE, not the working directory');
  const probe = async action => {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/tests/native-probe.ps1'), '-AppProcessId', String(app.pid), '-Action', action], { windowsHide: true, encoding: 'utf8' });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  };
  assert.equal((await probe('hotkey')).MiniBrowser.visible, false);
  const restored = (await probe('hotkey')).MiniBrowser;
  assert.equal(restored.visible, true);
  assert.equal(restored.alpha, 179, 'Saved opacity survives hide/show');
  assert.ok((restored.extendedStyle & 0x80) !== 0);
  await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/tests/native-probe.ps1'), '-AppProcessId', String(app.pid), '-Action', 'close'], { windowsHide: true, encoding: 'utf8' });
  for (let i = 0; i < 100 && app.exitCode === null; i++) await sleep(100);
  assert.equal(app.exitCode, 0, 'Native close exits normally');
  console.log('PASS release GUI launch, native styles, EXE-relative storage, native close');
} finally {
  if (app.exitCode === null) app.kill();
}
