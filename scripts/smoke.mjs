// Integration tests against the real debug Windows application / WebView2.
// Build first: pnpm build:ui && cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol
// This script only touches .cache/smoke-portable; release builds ignore the CDP flag.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.cache/smoke-portable', String(Date.now()));
const executable = path.join(root, 'MiniBrowser.exe');
await mkdir(root, { recursive: true });
await copyFile(path.resolve('src-tauri/target/debug/MiniBrowser.exe'), executable);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const start = Date.now(); let error;
  while (Date.now() - start < timeout) {
    try { const result = await fn(); if (result) return result; } catch (e) { error = e; }
    await sleep(150);
  }
  throw error ?? new Error('Timed out');
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer); this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); }
      this.pending.clear();
    });
  }
  static async connect(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(t => t.type === 'page');
    if (!target) throw new Error('No page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    return new CDP(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  invoke(command, args = {}) {
    return this.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
  }
  close() { this.socket.close(); }
}

const wav = Buffer.alloc(44 + 44100 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 44100; i++) wav.writeInt16LE(Math.round(Math.sin(i / 44100 * 440 * Math.PI * 2) * 10), 44 + i * 2);
const fixture = createServer((req, res) => {
  if (req.url === '/tone.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>MiniBrowser fixture</title><h1>Private session test</h1><audio id="audio" loop src="/tone.wav"></audio>${req.url === '/frame' ? '' : '<iframe src="http://localhost:18765/frame"></iframe>'}`);
});
await new Promise(resolve => fixture.listen(18765, resolve));
let child;
let controls;
let browser;
let testProcessId = 0;
const execute = promisify(execFile);
async function native(action = 'inspect') {
  const result = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/native-probe.ps1'), '-AppProcessId', String(testProcessId), '-ExecutablePath', executable, '-Action', action], { windowsHide: true, encoding: 'utf8' });
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}
const results = [];
const passed = name => { results.push(name); console.log(`PASS ${name}`); };
const toolbarWindow = result => Object.entries(result).find(([title]) => title.startsWith('MiniBrowser '))[1];
async function openMenu(client, webpage = false) {
  if (webpage) {
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 180, y: 100, button: 'right', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 180, y: 100, button: 'right', clickCount: 1 });
  } else {
    await client.evaluate(`document.getElementById('toolbar').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));true`);
  }
  await until(() => controls.evaluate(`!document.getElementById('context-menu').hidden`));
  const labels = await controls.evaluate(`[...document.querySelectorAll('#context-menu .menu-label')].map(e=>e.textContent)`);
  assert.deepEqual(labels, ['刷新','隐藏','关闭','恢复窗口','重启']);
  const shown = await native(); const popup = toolbarWindow(shown); const area = shown.controlWorkArea;
  assert.ok(popup.x >= area.x && popup.y >= area.y && popup.x + popup.width <= area.x + area.width && popup.y + popup.height <= area.y + area.height);
}
async function chooseMenu(action) {
  const point = await controls.evaluate(`(()=>{const r=document.querySelector('#context-menu [data-action=${action}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await controls.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await controls.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await until(() => controls.evaluate(`document.getElementById('context-menu').hidden`));
}
try {
  child = spawn(executable, [], { cwd: root, env: { ...process.env, MINIBROWSER_TEST_CDP: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', data => process.stderr.write(data));
  child.on('exit', (code, signal) => console.log(`Application exit: ${code} ${signal ?? ''}`));
  testProcessId = child.pid;
  controls = await until(() => CDP.connect(9224));
  browser = await until(() => CDP.connect(9223));
  await until(() => controls.evaluate(`!!document.getElementById('gear')`));
  await controls.invoke('open_settings');
  let snapshot = await controls.invoke('get_settings');
  assert.equal(snapshot.settings.opacity, 1);
  assert.equal(snapshot.settings.pauseMediaOnHide, true);
  assert.equal(snapshot.settings.width, 960);
  assert.equal(snapshot.settings.height, 600);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.welcome')).scrollbarWidth`), 'none');
  const centered = await native();
  const centeredPanel = Object.entries(centered).find(([title]) => title.startsWith('MiniBrowser '))[1];
  assert.ok(Math.abs(centeredPanel.x + centeredPanel.width / 2 - centered.MiniBrowser.x - centered.MiniBrowser.width / 2) <= 2);
  assert.ok(Math.abs(centeredPanel.y + centeredPanel.height / 2 - centered.MiniBrowser.y - centered.MiniBrowser.height / 2) <= 2);
  passed('first launch defaults and local controls');
  await controls.send('Page.enable');
  const screenshot = await controls.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'settings.png'), Buffer.from(screenshot.data, 'base64'));
  const guide = await browser.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'guide.png'), Buffer.from(guide.data, 'base64'));
  await controls.invoke('cancel_settings');
  const docked = await native();
  const dockedToolbar = Object.entries(docked).find(([title]) => title.startsWith('MiniBrowser '))[1];
  assert.ok(Math.abs(dockedToolbar.x - docked.MiniBrowser.x) <= 2);
  assert.ok(Math.abs(dockedToolbar.y - docked.MiniBrowser.y) <= 2);
  await controls.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1 });
  await sleep(70);
  await controls.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 });
  await until(() => controls.evaluate(`!document.getElementById('panel').hidden`));
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), false);
  await controls.invoke('cancel_settings');
  let dragged = false;
  for (let attempt = 0; attempt < 3 && !dragged; attempt++) {
    await controls.invoke('cancel_settings');
    const beforeDrag = (await native()).MiniBrowser;
    const afterDrag = (await native('dragToolbar')).MiniBrowser;
    dragged = Math.abs(afterDrag.x - beforeDrag.x - 65) <= 5 && Math.abs(afterDrag.y - beforeDrag.y - 45) <= 5;
  }
  assert.ok(dragged, 'Background drag must follow the cursor without a long-press offset');
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), true);
  passed('flush toolbar, centered settings and immediate background drag tracking');

  await controls.invoke('preview_opacity', { opacity: 0.5 });
  const preview = await native();
  assert.equal(preview.MiniBrowser.alpha, 128);
  assert.equal(toolbarWindow(preview).alpha, 128);
  await controls.invoke('open_settings');
  assert.equal(toolbarWindow(await native()).alpha, 255, 'Settings stay readable while toolbar follows alpha');
  await controls.invoke('cancel_settings');
  assert.equal(toolbarWindow(await native()).alpha, 255);
  assert.equal((await controls.invoke('get_settings')).settings.opacity, 1);
  passed('opacity preview does not commit preferences');

  const fixtureUrl = 'http://127.0.0.1:18765/';
  await controls.invoke('open_settings');
  const settings = { ...snapshot.settings, startupUrl: fixtureUrl, opacity: 0.85, shortcut: 'Ctrl+Alt+M' };
  await controls.invoke('apply_settings', { settings, urlEdited: true });
  await until(() => browser.evaluate(`location.href === ${JSON.stringify(fixtureUrl)}`));
  const saved = JSON.parse(await readFile(path.join(root, 'MiniBrowser.data/settings.json'), 'utf8'));
  assert.equal(saved.startupUrl, fixtureUrl);
  assert.equal(saved.opacity, 0.85);
  assert.equal('x' in saved, false);
  const nativeWindow = (await native()).MiniBrowser;
  assert.equal(nativeWindow.alpha, 217);
  assert.equal(toolbarWindow(await native()).alpha, 217);
  assert.ok((nativeWindow.extendedStyle & 0x80) !== 0, 'Hidden from taskbar as tool window');
  passed('native opacity and taskbar style');
  const resized = (await native('edgeResize')).MiniBrowser;
  assert.ok(resized.width > nativeWindow.width + 10, 'Dragging native window edge resizes browser');
  await sleep(600);
  const resizedSettings = JSON.parse(await readFile(path.join(root, 'MiniBrowser.data/settings.json'), 'utf8'));
  assert.ok(resizedSettings.width > saved.width);
  passed('native edge resize persists dimensions');
  passed('settings persist beside EXE with no window position');

  await openMenu(controls);
  const menuScreenshot = await controls.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'context-menu.png'), Buffer.from(menuScreenshot.data, 'base64'));
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => controls.evaluate(`document.getElementById('context-menu').hidden`));
  await openMenu(controls);
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await controls.evaluate(`document.activeElement.dataset.action`), 'hide');
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(async () => !(await native()).MiniBrowser.visible);
  assert.equal((await native()).MiniBrowser.visible, false);
  await controls.invoke('show_window');
  assert.equal(toolbarWindow(await native()).alpha, 217);
  passed('toolbar native menu actions and synchronized opacity after show');

  await browser.evaluate('window.__refreshProbe = true');
  await openMenu(browser, true);
  await chooseMenu('refresh');
  await until(() => browser.evaluate('window.__refreshProbe === undefined'));
  await openMenu(controls);
  await chooseMenu('restore');
  await until(async () => { const s = await controls.invoke('get_settings'); return s.settings.width === 960 && s.settings.height === 600; });
  assert.equal(await browser.evaluate('location.href'), fixtureUrl);
  assert.equal((await controls.invoke('get_settings')).settings.opacity, 0.85);
  passed('webpage context menu refresh and restore size without clearing session');

  const outside = await native('moveBeyond');
  assert.ok(outside.MiniBrowser.x + outside.MiniBrowser.width > outside.workArea.x + outside.workArea.width);
  await native('releaseBounds');
  await until(async () => {
    const r = await native(); const w = r.MiniBrowser; const a = r.workArea;
    return w.x >= a.x && w.y >= a.y && w.x + w.width <= a.x + a.width && w.y + w.height <= a.y + a.height;
  });
  passed('native move leaves position free until release then rebounds into work area');

  await controls.invoke('open_settings');
  await controls.evaluate(`(()=>{const field=document.getElementById('url');field.value='https://draft.example/';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await openMenu(browser, true);
  await native('clickOutsideMenu');
  await until(() => controls.evaluate(`document.getElementById('context-menu').hidden`));
  assert.equal(await controls.evaluate(`document.getElementById('url').value`), 'https://draft.example/');
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), false);
  assert.notEqual((await controls.invoke('get_settings')).settings.startupUrl, 'https://draft.example/');
  await controls.invoke('cancel_settings');
  passed('styled menu closes on outside click and preserves unconfirmed settings');

  await browser.evaluate(`document.cookie='session=private; path=/'; localStorage.setItem('secret','value')`);
  snapshot = await controls.invoke('get_settings');
  await controls.invoke('apply_settings', { settings: { ...snapshot.settings, startupUrl: fixtureUrl + 'next' }, urlEdited: true });
  await until(() => browser.evaluate(`location.pathname === '/next'`));
  assert.match(await browser.evaluate('document.cookie'), /session=private/);
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), 'value');
  passed('URL navigation keeps current login/storage');

  const denied = await browser.evaluate(`window.__TAURI_INTERNALS__.invoke('get_settings').then(()=>false,()=>true)`);
  assert.equal(denied, true);
  passed('remote webpage denied application IPC');

  await browser.evaluate(`(async()=>{
    const canvas=document.createElement('canvas'); canvas.width=160; canvas.height=90;
    const context=canvas.getContext('2d'); context.fillStyle='#acd9ad'; context.fillRect(0,0,160,90);
    const video=document.createElement('video'); video.id='video'; video.muted=true; video.srcObject=canvas.captureStream(10); document.body.append(video);
    await video.play(); await document.getElementById('audio').play();
  })()`);
  await controls.invoke('hide_window');
  await sleep(400);
  assert.equal(await browser.evaluate(`document.getElementById('audio').paused`), true);
  assert.equal(await browser.evaluate(`document.getElementById('video').paused`), true);
  await controls.invoke('show_window');
  assert.equal(await browser.evaluate(`document.getElementById('audio').paused`), true);
  passed('hide pauses audio/video and showing does not resume');

  snapshot = await controls.invoke('get_settings');
  await controls.invoke('apply_settings', { settings: { ...snapshot.settings, pauseMediaOnHide: false }, urlEdited: false });
  await browser.evaluate(`document.getElementById('audio').play()`);
  await controls.invoke('hide_window');
  assert.equal(await browser.evaluate(`document.getElementById('audio').paused`), false);
  await controls.invoke('show_window');
  await browser.evaluate(`document.getElementById('audio').pause()`);
  passed('pause-on-hide switch allows background playback');

  await native('hotkey');
  assert.equal((await native()).MiniBrowser.visible, false);
  await native('hotkey');
  assert.equal((await native()).MiniBrowser.visible, true);
  passed('registered global shortcut hides and restores native window');

  const extra = spawn(executable, [], { cwd: root, env: { ...process.env, MINIBROWSER_TEST_CDP: '1' }, windowsHide: true, stdio: 'ignore' });
  await until(() => extra.exitCode === 0);
  assert.equal(await browser.evaluate('location.pathname'), '/next');
  passed('second launch activates existing instance without navigation');

  // Release debugger connections before destroying the environments. A live CDP
  // connection can keep the old runtime/debug port alive after its host closes.
  await controls.evaluate(`setTimeout(() => window.__TAURI_INTERNALS__.invoke('clear_session'), 100); true`);
  controls.close(); browser.close();
  await sleep(700);
  controls = await until(() => CDP.connect(9226));
  browser = await until(() => CDP.connect(9225));
  await until(() => browser.evaluate(`location.pathname === '/next' && !!document.getElementById('audio')`));
  await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('gear')`));
  assert.equal(await browser.evaluate('document.cookie'), '');
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), null);
  assert.equal((await controls.invoke('get_settings')).settings.opacity, 0.85);
  passed('clear cache rebuilds private session and keeps preferences');

  await browser.evaluate(`document.cookie='restart=private; path=/'; location.href='/unsaved-navigation'`);
  await until(() => browser.evaluate(`location.pathname === '/unsaved-navigation'`));
  await openMenu(controls);
  await controls.evaluate(`setTimeout(()=>document.querySelector('#context-menu [data-action=restart]').click(),100);true`);
  controls.close(); browser.close();
  await until(() => child.exitCode !== null);
  await sleep(700);
  controls = await until(() => CDP.connect(9224));
  browser = await until(() => CDP.connect(9223));
  await until(() => browser.evaluate(`location.pathname === '/next' && !!document.getElementById('audio')`));
  await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('gear')`));
  assert.equal(await browser.evaluate('document.cookie'), '');
  testProcessId = 0;
  testProcessId = (await native()).processId;
  assert.notEqual(testProcessId, child.pid);
  passed('restart launches one fresh process with confirmed URL and no cookies');

  await openMenu(controls);
  await controls.evaluate(`setTimeout(()=>document.querySelector('#context-menu [data-action=close]').click(),100);true`);
  controls.close(); browser.close();
  await until(() => { try { process.kill(testProcessId, 0); return false; } catch { return true; } });
  const remaining = await readdir(path.join(root, 'MiniBrowser.data/sessions'));
  if (remaining.length) {
    child = spawn(executable, [], { cwd: root, env: { ...process.env, MINIBROWSER_TEST_CDP: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => process.stderr.write(data));
    testProcessId = child.pid;
    controls = await until(() => CDP.connect(9224));
    browser = await until(() => CDP.connect(9223));
    await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('gear')`));
    await until(async () => {
      const entries = await readdir(path.join(root, 'MiniBrowser.data/sessions'));
      return !entries.some(entry => remaining.includes(entry));
    });
    assert.equal((await controls.invoke('get_settings')).settings.opacity, 0.85);
    assert.equal(await browser.evaluate('document.cookie'), '');
    passed('deferred runtime cleanup recovers on next startup without restoring cookies');
    await controls.evaluate(`setTimeout(() => window.__TAURI_INTERNALS__.invoke('close_app'), 100); true`);
    controls.close(); browser.close();
    await until(() => child.exitCode !== null);
  }
  passed('graceful exit and session cleanup/recovery');
  await writeFile(path.join(root, 'report.json'), JSON.stringify({ passed: results }, null, 2));
  console.log(`Artifacts: ${root}`);
} finally {
  controls?.close(); browser?.close();
  if (child?.exitCode === null) child.kill();
  if (testProcessId > 0 && testProcessId !== child?.pid) { try { process.kill(testProcessId); } catch {} }
  fixture.close();
}
