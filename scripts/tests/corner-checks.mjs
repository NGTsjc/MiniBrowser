import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';

export async function checkCornerPrototype({ browser, controls, native, passed, root }) {
  const overlay = result => Object.entries(result).find(([key]) => key.startsWith('MiniBrowser '))[1];
  await controls.invoke('cancel_settings');
  for (const radius of [0, 12, 32]) {
    await controls.invoke('preview_corner_radius', { radius });
    const result = await native();
    assert.deepEqual(result.MiniBrowser.cornersInside, Array(4).fill(radius === 0));
    assert.equal(result.MiniBrowser.centerInside, true);
    assert.equal(overlay(result).cornersInside[0], radius === 0);
    assert.equal(result.MiniBrowser.cornerHitsApp, radius === 0);
  }
  await browser.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
    const context=canvas.getContext('2d');context.fillStyle='#49AE91';context.fillRect(0,0,640,400);
    const video=document.createElement('video');video.id='corner-video';video.muted=true;video.srcObject=canvas.captureStream(10);
    Object.assign(video.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',objectFit:'cover',zIndex:'10'});
    document.body.append(video);await video.play();
  })()`);
  for (const opacity of [1, .2]) {
    await controls.invoke('preview_opacity', { opacity });
    const result = await native('captureWindow');
    assert.equal(result.MiniBrowser.alpha, Math.round(opacity * 255));
    assert.deepEqual(result.MiniBrowser.cornersInside, Array(4).fill(false));
    assert.equal(overlay(result).cornersInside[0], false);
    assert.equal(await browser.evaluate(`document.getElementById('corner-video').paused`), false);
    await copyFile(path.join(root, 'rounded-window.png'), path.join(root, `rounded-video-${Math.round(opacity * 100)}.png`));
  }
  await controls.invoke('preview_opacity', { opacity: 1 });
  for (const corner of ['TL', 'TR', 'BL', 'BR']) {
    const before = (await native()).MiniBrowser;
    const after = (await native(`cornerResize${corner}`)).MiniBrowser;
    assert.ok(after.width > before.width + 20 && after.height > before.height + 20, `${corner} native rounded resize: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
    assert.deepEqual(after.cornersInside, Array(4).fill(false));
  }
  assert.equal(await browser.evaluate(`document.getElementById('corner-video').paused`), false);
  await native('captureWindow');
  await copyFile(path.join(root, 'rounded-window.png'), path.join(root, 'rounded-resized-video.png'));
  await browser.evaluate(`(()=>{const video=document.getElementById('corner-video');video.srcObject.getTracks().forEach(track=>track.stop());video.remove()})()`);
  await controls.invoke('open_settings');
  await native('minimumResize');
  assert.deepEqual((await native()).MiniBrowser.cornersInside, Array(4).fill(false));
  assert.deepEqual(overlay(await native()).cornersInside, Array(4).fill(false));
  await native('captureWindow');
  await copyFile(path.join(root, 'rounded-window.png'), path.join(root, 'rounded-minimum.png'));
  // Reset the size without committing the preview or replacing the panel.
  await native('openTrayMenu');
  await native('trayReset');
  assert.deepEqual((await native()).MiniBrowser.cornersInside, Array(4).fill(false));
  await controls.invoke('cancel_settings');
  await controls.invoke('preview_corner_radius', { radius: 32 });
  await controls.invoke('hide_window');
  await controls.invoke('show_window');
  assert.deepEqual((await native()).MiniBrowser.cornersInside, Array(4).fill(false));
  await controls.invoke('open_settings');
  assert.deepEqual(overlay(await native()).cornersInside, Array(4).fill(false));
  await controls.invoke('cancel_settings');
  await controls.invoke('show_context_menu');
  assert.deepEqual(overlay(await native()).cornersInside, Array(4).fill(false));
  await controls.invoke('dismiss_context_menu');
  await controls.invoke('preview_corner_radius', { radius: 0 });
  await assert.rejects(() => controls.invoke('preview_corner_radius', { radius: 129 }));
  passed('native corner prototype clips browser, drag grip and popups with media, alpha and click-through corners');
}

export async function checkCornerSettings({ controls, native, until, passed, root }) {
  const set = value => controls.evaluate(`(()=>{const input=document.getElementById('corner-radius');input.value='${value}';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await controls.invoke('open_settings');
  assert.equal(await controls.evaluate(`document.getElementById('corner-radius').value`), '0');
  await set(32);
  await until(async () => (await native()).MiniBrowser.cornerTopInset > 20);
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius, 0);
  await controls.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(async () => (await native()).MiniBrowser.cornerTopInset === 0);
  await controls.invoke('open_settings');
  await set(12);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(() => controls.evaluate(`document.getElementById('panel').hidden`));
  const saved = JSON.parse(await readFile(path.join(root, 'MiniBrowser.data/settings.json'), 'utf8'));
  assert.equal(saved.cornerRadius, 12);
  const confirmedInset = (await native()).MiniBrowser.cornerTopInset;
  assert.ok(confirmedInset > 0);
  await controls.invoke('open_settings');
  await set(32);
  await until(async () => (await native()).MiniBrowser.cornerTopInset > confirmedInset);
  const temp = path.join(root, 'MiniBrowser.data/settings.json.tmp');
  await mkdir(temp);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(() => controls.evaluate(`!document.getElementById('confirm').disabled && !document.getElementById('notice').hidden`));
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius, 12);
  assert.equal((await native()).MiniBrowser.cornerTopInset, confirmedInset);
  assert.equal(await controls.evaluate(`document.getElementById('corner-radius').value`), '32');
  await rmdir(temp);
  await controls.invoke('cancel_settings');
  passed('corner slider previews, Esc restores, confirmation persists and save failure rolls back without losing draft');
}
