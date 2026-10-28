// Integration tests against the real debug Windows application / WebView2.
// Build first: pnpm build:ui && cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol
// This script only touches .cache/smoke-portable; release builds ignore the CDP flag.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, writeFile, readdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { checkNewPages } from './new-page-checks.mjs';
import { checkCornerPrototype, checkCornerSettings } from './corner-checks.mjs';
import { checkControlLayout } from './control-layout-checks.mjs';
import { CDP } from './cdp.mjs';
import { checkPageZoom } from './zoom-checks.mjs';

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


const wav = Buffer.alloc(44 + 44100 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 44100; i++) wav.writeInt16LE(Math.round(Math.sin(i / 44100 * 440 * Math.PI * 2) * 10), 44 + i * 2);
const fixture = createServer((req, res) => {
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  if (requestPath === '/zoom-frame') { res.setHeader('Content-Type','text/html');res.end('<!doctype html><body style="height:3000px">Zoom frame</body>');return; }
  if (requestPath === '/popup-frame') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><button style="position:fixed;inset:0" onclick="window.open('http://127.0.0.1:18765/popup-iframe','_blank')">Open in new tab</button>`);
    return;
  }
  if (req.url === '/tone.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>MiniBrowser fixture</title><h1>Private session test</h1><audio id="audio" loop src="/tone.wav"></audio>${requestPath === '/frame' ? '<script>document.addEventListener("contextmenu",e=>{e.preventDefault();parent.postMessage("fixture-context","*")})</script>' : '<iframe src="http://localhost:18765/frame"></iframe>'}`);
});
await new Promise(resolve => fixture.listen(18765, resolve));
let child;
let controls;
let browser;
let testProcessId = 0;
const execute = promisify(execFile);
async function native(action = 'inspect', point = null) {
  const result = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/tests/native-probe.ps1'), '-AppProcessId', String(testProcessId), '-ExecutablePath', executable, '-Action', action, ...(point ? ['-ClickX', String(Math.round(point.x)), '-ClickY', String(Math.round(point.y)), ...(point.ticks ? ['-WheelTicks',String(point.ticks)] : [])] : [])], { windowsHide: true, encoding: 'utf8' });
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
  assert.deepEqual(labels, ['设置','刷新','隐藏','关闭','恢复窗口','重启','开发者工具']);
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
  await until(() => controls.evaluate(`!!document.getElementById('toolbar')`));
  await controls.invoke('open_settings');
  let snapshot = await controls.invoke('get_settings');
  assert.equal(snapshot.settings.opacity, 1);
  assert.equal(snapshot.settings.pauseMediaOnHide, true);
  assert.equal(snapshot.settings.width, 960);
  assert.equal(snapshot.settings.height, 600);
  assert.equal(snapshot.settings.accentColor, '#2563EB');
  assert.equal(await controls.evaluate(`getComputedStyle(document.documentElement).colorScheme`), 'light');
  assert.equal(await controls.evaluate(`getComputedStyle(document.getElementById('panel')).backgroundColor`), 'rgb(255, 255, 255)');
  assert.deepEqual(await controls.evaluate(`[...document.querySelectorAll('[data-color]')].map(e=>getComputedStyle(e).backgroundColor)`), ['rgb(37, 99, 235)', 'rgb(124, 58, 237)', 'rgb(219, 39, 119)', 'rgb(220, 38, 38)', 'rgb(180, 83, 9)', 'rgb(4, 120, 87)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
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
  // Theme preview is restricted to the draft panel; menu/toolbar/guide retain
  // the committed color until the form successfully saves.
  for (const color of ['#FFFFFF', '#000000', '#FF00FF']) {
    await controls.evaluate(`(()=>{const h=document.getElementById('accent-hex');h.value='${color}';h.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const contrast = await controls.evaluate(`(()=>{const s=getComputedStyle(document.getElementById('confirm'));const l=c=>{const v=c.match(/\\d+/g).slice(0,3).map(x=>{x=Number(x)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};const a=l(s.color),b=l(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`);
    assert.ok(contrast >= 4.5, `${color} contrast: ${contrast}`);
    assert.equal(await controls.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#2563EB');
    assert.equal(await browser.evaluate(`window.__MINIBROWSER_ACCENT__`), '#2563EB');
  }
  await controls.evaluate(`(()=>{const h=document.getElementById('accent-hex');h.value='#ZZZZZZ';h.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await controls.evaluate(`document.getElementById('accent-hex').checkValidity()`), false);
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => controls.evaluate(`document.getElementById('panel').hidden`));
  assert.equal(await controls.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#2563EB');
  passed('light theme, extreme-color contrast, invalid HEX and cancelled preview');

  await controls.invoke('open_settings');
  await controls.evaluate(`document.querySelector('[data-color="#7C3AED"]').click()`);
  const blockedTemp = path.join(root, 'MiniBrowser.data/settings.json.tmp');
  await mkdir(blockedTemp);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(() => controls.evaluate(`!document.getElementById('confirm').disabled && !document.getElementById('notice').hidden`));
  assert.equal((await controls.invoke('get_settings')).settings.accentColor, '#2563EB');
  assert.equal(await controls.evaluate(`document.getElementById('accent-hex').value`), '#7C3AED');
  assert.equal(await browser.evaluate(`window.__MINIBROWSER_ACCENT__`), '#2563EB');
  await rmdir(blockedTemp);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(() => controls.evaluate(`document.getElementById('panel').hidden`));
  await until(() => browser.evaluate(`window.__MINIBROWSER_ACCENT__ === '#7C3AED'`));
  assert.equal(JSON.parse(await readFile(path.join(root, 'MiniBrowser.data/settings.json'), 'utf8')).accentColor, '#7C3AED');
  await controls.invoke('open_settings');
  assert.equal(await controls.evaluate(`document.getElementById('accent-picker').value`), '#7c3aed');
  await controls.evaluate(`document.getElementById('accent-reset').click()`);
  assert.equal(await controls.evaluate(`document.getElementById('accent-hex').value`), '#2563EB');
  passed('theme save failure retains draft, retry commits guide and controls, reset previews');
  await controls.invoke('cancel_settings');
  const docked = await native();
  const dockedToolbar = Object.entries(docked).find(([title]) => title.startsWith('MiniBrowser '))[1];
  assert.ok(Math.abs(dockedToolbar.x - docked.MiniBrowser.x) <= 2);
  assert.ok(Math.abs(dockedToolbar.y - docked.MiniBrowser.y) <= 2);
  assert.equal(await controls.evaluate(`document.getElementById('gear')`), null);
  await openMenu(browser, true);
  await chooseMenu('settings');
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
  await checkCornerPrototype({ browser, controls, native, passed, root });
  await checkCornerSettings({ controls, native, until, passed, root });
  await checkControlLayout({ browser, controls, native, until, passed, root });

  const fixtureUrl = 'http://127.0.0.1:18765/';
  await controls.invoke('open_settings');
  const settings = { ...snapshot.settings, cornerRadius: 12, accentColor: '#7C3AED', startupUrl: fixtureUrl, opacity: 0.85, shortcut: 'Ctrl+Alt+M' };
  await controls.invoke('apply_settings', { settings, urlEdited: true });
  await until(() => browser.evaluate(`location.href === ${JSON.stringify(fixtureUrl)}`));
  assert.equal(await browser.evaluate(`window.__MINIBROWSER_ACCENT__`), undefined, 'Remote webpages receive no theme');
  assert.equal(await browser.evaluate(`window.__MINIBROWSER_PARAMETERS__`), undefined, 'Remote webpages receive no application parameters');
  await browser.evaluate(`(()=>{
    const input=document.createElement('input');input.id='context-input';input.value='Copy this text';
    Object.assign(input.style,{position:'fixed',left:'20px',top:'20px',width:'200px',height:'30px',zIndex:'100'});
    document.body.append(input); input.focus(); input.select();
    window.__contextCount=0;document.addEventListener('contextmenu',event=>{window.__contextCount++;queueMicrotask(()=>window.__contextPrevented=event.defaultPrevented)});
  })()`);
  async function pageRightClick(x, y) {
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  }
  await pageRightClick(100, 35);
  await until(() => browser.evaluate(`window.__contextCount === 1`));
  assert.equal(await browser.evaluate(`window.__contextPrevented`), false);
  assert.equal(await controls.evaluate(`document.getElementById('context-menu').hidden`), true);
  await native('dismissMenu');
  passed('webpage context event is not cancelled and application menu stays closed');

  await browser.evaluate(`(()=>{
    window.__customContext = event => {
      event.preventDefault();
      let menu=document.getElementById('website-menu');
      if(!menu){menu=document.createElement('div');menu.id='website-menu';menu.textContent='Website action';document.body.append(menu)}
      menu.hidden=false;
    };
    document.addEventListener('contextmenu',window.__customContext);
  })()`);
  await pageRightClick(100, 35);
  await until(() => browser.evaluate(`!!document.getElementById('website-menu') && window.__contextCount === 2`));
  assert.equal(await controls.evaluate(`document.getElementById('context-menu').hidden`), true);
  await browser.evaluate(`document.removeEventListener('contextmenu',window.__customContext);document.getElementById('website-menu').remove();document.getElementById('context-input').remove()`);
  await browser.evaluate(`(()=>{
    window.__frameContext=0;window.addEventListener('message',e=>{if(e.data==='fixture-context')window.__frameContext++});
    const frame=document.querySelector('iframe');Object.assign(frame.style,{position:'fixed',left:'20px',top:'20px',width:'300px',height:'150px'});
  })()`);
  const framePoint = await browser.evaluate(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.equal(await browser.evaluate(`document.elementFromPoint(${framePoint.x},${framePoint.y}).tagName`), 'IFRAME');
  await native('rightClickPage', framePoint);
  await until(() => browser.evaluate(`window.__frameContext === 1`));
  assert.equal(await controls.evaluate(`document.getElementById('context-menu').hidden`), true);
  await browser.evaluate(`document.querySelector('iframe').removeAttribute('style')`);
  passed('website custom context handlers and cross-origin iframe menus remain independent');
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
  assert.equal(await controls.evaluate(`getComputedStyle(document.getElementById('context-menu')).getPropertyValue('--accent').trim()`), '#7C3AED');
  const menuScreenshot = await controls.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(root, 'context-menu.png'), Buffer.from(menuScreenshot.data, 'base64'));
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => controls.evaluate(`document.getElementById('context-menu').hidden`));
  await openMenu(controls);
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await controls.evaluate(`document.activeElement.dataset.action`), 'hide');
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(async () => !(await native()).MiniBrowser.visible);
  assert.equal((await native()).MiniBrowser.visible, false);
  await controls.invoke('show_window');
  assert.equal(toolbarWindow(await native()).alpha, 217);
  passed('toolbar native menu actions and synchronized opacity after show');

  await browser.evaluate('window.__refreshProbe = true');
  await openMenu(controls);
  await chooseMenu('refresh');
  await until(() => browser.evaluate('window.__refreshProbe === undefined'));
  await openMenu(controls);
  await chooseMenu('restore');
  await until(async () => { const s = await controls.invoke('get_settings'); return s.settings.width === 960 && s.settings.height === 600; });
  assert.equal(await browser.evaluate('location.href'), fixtureUrl);
  assert.equal((await controls.invoke('get_settings')).settings.opacity, 0.85);
  passed('application menu refresh and restore size without clearing session');

  await openMenu(controls);
  await chooseMenu('devtools');
  const tools = await until(async () => {
    const result = await native('inspectDevtools');
    return result.devtools.some(tool => tool.title.includes('18765')) && result;
  });
  assert.equal(tools.devtools.length, 1, 'DevTools opens for the browser, not local controls');
  await openMenu(controls);
  await chooseMenu('devtools');
  assert.equal((await native('inspectDevtools')).devtools.length, 1, 'Repeated open reuses DevTools');
  await native('closeDevtools');
  await until(async () => (await native('inspectDevtools')).devtools.length === 0);
  assert.equal(await browser.evaluate('location.href'), fixtureUrl);
  passed('menu opens a separate webpage DevTools window and closing it keeps browsing');

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
  await openMenu(controls);
  await native('clickOutsideMenu');
  await until(() => controls.evaluate(`document.getElementById('context-menu').hidden`));
  assert.equal(await controls.evaluate(`document.getElementById('url').value`), 'https://draft.example/');
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), false);
  assert.notEqual((await controls.invoke('get_settings')).settings.startupUrl, 'https://draft.example/');
  await openMenu(controls);
  await chooseMenu('settings');
  assert.equal(await controls.evaluate(`document.getElementById('url').value`), 'https://draft.example/');
  await controls.invoke('cancel_settings');
  passed('styled menu closes on outside click and preserves unconfirmed settings');

  await browser.evaluate(`document.cookie='session=private; path=/'; localStorage.setItem('secret','value')`);
  snapshot = await controls.invoke('get_settings');
  await controls.invoke('apply_settings', { settings: { ...snapshot.settings, startupUrl: fixtureUrl + 'next' }, urlEdited: true });
  await until(() => browser.evaluate(`location.pathname === '/next'`));
  assert.match(await browser.evaluate('document.cookie'), /session=private/);
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), 'value');
  passed('URL navigation keeps current login/storage');
  await checkNewPages({ browser, controls, native, until, sleep, passed, fixtureUrl });
  await checkPageZoom({ browser, controls, native, until, passed, fixtureUrl });

  await browser.evaluate(`window.__trayResetPageToken='same-document'`);
  const beforeReset = (await controls.invoke('get_settings')).settings;
  await controls.invoke('open_settings');
  await controls.evaluate(`(()=>{
    const url=document.getElementById('url');url.value='https://unconfirmed.example/';url.dispatchEvent(new Event('input',{bubbles:true}));
    const opacity=document.getElementById('opacity');opacity.value='65';opacity.dispatchEvent(new Event('input',{bubbles:true}));
    const corner=document.getElementById('corner-radius');corner.value='32';corner.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await until(async () => (await native()).MiniBrowser.alpha === 166);
  const previewInset = (await native()).MiniBrowser.cornerTopInset;
  await controls.invoke('hide_window');
  await native('resize');
  await native('moveBeyond');
  const hiddenTray = await native('openTrayMenu');
  assert.deepEqual(hiddenTray.menuItems, ['显示窗口','重置窗口','关闭','重启']);
  await native('trayReset');
  const resetWindow = await until(async () => { const result=await native();return result.MiniBrowser.visible && result; });
  const restoredSettings = (await controls.invoke('get_settings')).settings;
  assert.equal(restoredSettings.width, 960);
  assert.equal(restoredSettings.height, 600);
  assert.ok(Math.abs(resetWindow.MiniBrowser.x + resetWindow.MiniBrowser.width/2 - resetWindow.workArea.x - resetWindow.workArea.width/2) <= 2);
  assert.ok(Math.abs(resetWindow.MiniBrowser.y + resetWindow.MiniBrowser.height/2 - resetWindow.workArea.y - resetWindow.workArea.height/2) <= 2);
  assert.equal(resetWindow.MiniBrowser.alpha, 166, 'Unconfirmed opacity preview survives reset');
  assert.equal(resetWindow.MiniBrowser.cornerTopInset, previewInset, 'Unconfirmed corner preview survives reset');
  assert.equal(toolbarWindow(resetWindow).alpha, 255);
  assert.equal(await controls.evaluate(`document.getElementById('url').value`), 'https://unconfirmed.example/');
  assert.equal(await controls.evaluate(`document.getElementById('opacity').value`), '65');
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), false);
  for (const key of ['startupUrl','opacity','accentColor','cornerRadius','alwaysOnTop','pauseMediaOnHide','shortcut']) assert.equal(restoredSettings[key], beforeReset[key]);
  assert.equal(await browser.evaluate(`window.__trayResetPageToken`), 'same-document');
  assert.match(await browser.evaluate('document.cookie'), /session=private/);
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), 'value');
  const resetSaved = JSON.parse(await readFile(path.join(root,'MiniBrowser.data/settings.json'),'utf8'));
  assert.equal(resetSaved.width, 960);
  assert.equal(resetSaved.height, 600);
  await controls.invoke('cancel_settings');
  assert.equal((await native()).MiniBrowser.alpha, 217);
  passed('tray reset restores hidden offscreen resized window and preserves draft, session and saved preferences');

  await openMenu(controls);
  const visibleTray = await native('openTrayMenu');
  assert.deepEqual(visibleTray.menuItems, ['隐藏窗口','重置窗口','关闭','重启']);
  await native('trayReset');
  assert.equal(await controls.evaluate(`document.getElementById('context-menu').hidden`), true);
  assert.equal((await native()).MiniBrowser.visible, true);
  assert.equal(await browser.evaluate(`window.__trayResetPageToken`), 'same-document');
  passed('tray reset also works while visible and closes the application popup');

  const denied = await browser.evaluate(`window.__TAURI_INTERNALS__.invoke('get_settings').then(()=>false,()=>true)`);
  assert.equal(denied, true);
  assert.equal(await browser.evaluate(`window.__TAURI_INTERNALS__.invoke('preview_corner_radius',{radius:32}).then(()=>false,()=>true)`), true);
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
  await native('zoomIn');
  assert.ok(await browser.evaluate('devicePixelRatio') > (await native()).MiniBrowser.scale);

  // Release debugger connections before destroying the environments. A live CDP
  // connection can keep the old runtime/debug port alive after its host closes.
  await controls.evaluate(`setTimeout(() => window.__TAURI_INTERNALS__.invoke('clear_session'), 100); true`);
  controls.close(); browser.close();
  await sleep(700);
  controls = await until(() => CDP.connect(9226));
  browser = await until(() => CDP.connect(9225));
  await until(() => browser.evaluate(`location.pathname === '/next' && !!document.getElementById('audio')`));
  await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('toolbar')`));
  assert.equal(await browser.evaluate('document.cookie'), '');
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), null);
  assert.equal((await controls.invoke('get_settings')).settings.opacity, 0.85);
  passed('clear cache rebuilds private session and keeps preferences');
  assert.ok(Math.abs(await browser.evaluate('devicePixelRatio') - (await native()).MiniBrowser.scale) < .01);
  assert.equal((await controls.invoke('get_settings')).settings.accentColor, '#7C3AED');
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius, 12);
  assert.deepEqual((await native()).MiniBrowser.cornersInside, Array(4).fill(false));
  assert.equal(await controls.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#7C3AED');

  await browser.evaluate(`document.cookie='restart=private; path=/'; location.href='/unsaved-navigation'`);
  await until(() => browser.evaluate(`location.pathname === '/unsaved-navigation'`));
  await native('zoomIn');
  assert.ok(await browser.evaluate('devicePixelRatio') > (await native()).MiniBrowser.scale);
  await openMenu(controls);
  await controls.evaluate(`setTimeout(()=>document.querySelector('#context-menu [data-action=restart]').click(),100);true`);
  controls.close(); browser.close();
  await until(() => child.exitCode !== null);
  await sleep(700);
  controls = await until(() => CDP.connect(9224));
  browser = await until(() => CDP.connect(9223));
  await until(() => browser.evaluate(`location.pathname === '/next' && !!document.getElementById('audio')`));
  await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('toolbar')`));
  assert.equal(await browser.evaluate('document.cookie'), '');
  testProcessId = 0;
  testProcessId = (await native()).processId;
  assert.notEqual(testProcessId, child.pid);
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius, 12);
  assert.deepEqual((await native()).MiniBrowser.cornersInside, Array(4).fill(false));
  passed('restart launches one fresh process with confirmed URL and no cookies');
  assert.ok(Math.abs(await browser.evaluate('devicePixelRatio') - (await native()).MiniBrowser.scale) < .01);
  assert.equal((await controls.invoke('get_settings')).settings.accentColor, '#7C3AED');
  assert.equal(await controls.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#7C3AED');

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
    await until(() => controls.evaluate(`!!window.__TAURI_INTERNALS__?.invoke && !!document.getElementById('toolbar')`));
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
