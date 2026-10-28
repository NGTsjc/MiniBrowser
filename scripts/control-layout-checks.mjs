import assert from 'node:assert/strict';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkControlLayout({ browser, controls, native, until, passed, root }) {
  const overlay = result => Object.entries(result).find(([key]) => key.startsWith('MiniBrowser '))[1];
  const snapshot = await controls.invoke('get_settings');
  assert.equal(snapshot.parameters.limits.maxCornerRadius, 128);
  assert.equal(snapshot.parameters.defaults.cornerRadius, 0);
  assert.equal(await controls.evaluate(`document.getElementById('corner-radius').max`), '128');
  await controls.invoke('cancel_settings');
  for (const radius of [0, 32, 63, 64, 128]) {
    await controls.invoke('preview_corner_radius', { radius });
    const shape = (await controls.invoke('get_settings')).dragShape;
    await until(() => controls.evaluate(`document.getElementById('toolbar').dataset.arc === '${radius >= 64}'`));
    const result = await native();
    const bar = overlay(result);
    assert.equal(shape.arc, radius >= 64);
    assert.ok(Math.abs(bar.x - result.MiniBrowser.x - shape.x) <= 1);
    assert.ok(Math.abs(bar.y - result.MiniBrowser.y - shape.y) <= 1);
    assert.equal(bar.width, shape.width);
    assert.equal(bar.height, shape.height);
    if (!shape.arc) {
      assert.equal(bar.width, bar.height);
      assert.equal(shape.y, 0);
      assert.equal(shape.x, 0);
      assert.equal(bar.cornersInside[0], radius === 0);
      const hit = overlay(await native('inspect', {x:shape.grip[0]/result.MiniBrowser.scale,y:shape.grip[1]/result.MiniBrowser.scale}));
      assert.equal(hit.sampleInside, true);
      assert.equal(hit.sampleHitsControl, true);
    }
    else {
      const scale = result.MiniBrowser.scale;
      const center = { x:shape.grip[0]/scale, y:shape.grip[1]/scale };
      const hit = overlay(await native('inspect', center));
      assert.equal(hit.sampleInside, true);
      assert.equal(hit.sampleHitsControl, true);
      const outside = overlay(await native('inspect', {x:(bar.width-2)/scale,y:(bar.height-2)/scale}));
      assert.equal(outside.sampleInside, false);
      assert.equal(outside.sampleHitsControl, false, 'Empty concave area must pass input to the page');
    }
    await native('captureWindow');
    await copyFile(path.join(root,'rounded-window.png'),path.join(root,`adaptive-drag-${radius}.png`));
  }
  passed('shared parameters and 0/32/63/64/128 adaptive drag geometry match native visible and click-through regions');

  let current = await native();
  let shape = (await controls.invoke('get_settings')).dragShape;
  const scale = current.MiniBrowser.scale;
  const grip = {x:shape.grip[0]/scale,y:shape.grip[1]/scale};
  const moved = await native('dragToolbar',grip);
  assert.ok(Math.abs(moved.MiniBrowser.x-current.MiniBrowser.x-65)<=5);
  assert.ok(Math.abs(moved.MiniBrowser.y-current.MiniBrowser.y-45)<=5);
  await native('rightClickControl',grip);
  await until(() => controls.evaluate(`!document.getElementById('context-menu').hidden`));
  await controls.invoke('dismiss_context_menu');
  for (const corner of ['TL','TR','BL','BR']) {
    const before = (await native()).MiniBrowser;
    const inset = Math.ceil(128 - (128-3)/Math.sqrt(2));
    const after = (await native(`cornerResize${corner}`,{x:inset,y:inset})).MiniBrowser;
    assert.ok(after.width>before.width+20 && after.height>before.height+20,`${corner} large-radius resize`);
  }
  await controls.invoke('open_settings');
  await controls.evaluate(`(()=>{const input=document.getElementById('corner-radius');input.value='128';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('settings-form').requestSubmit()})()`);
  await until(() => controls.evaluate(`document.getElementById('panel').hidden`));
  assert.equal(JSON.parse(await readFile(path.join(root,'MiniBrowser.data/settings.json'),'utf8')).cornerRadius,128);
  await controls.invoke('preview_corner_radius',{radius:64});
  await controls.invoke('cancel_settings');
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius,128);
  await controls.invoke('hide_window');
  await controls.invoke('show_window');
  assert.equal((await controls.invoke('get_settings')).dragShape.arc,true);
  await native('openTrayMenu');
  await native('trayReset');
  assert.equal((await controls.invoke('get_settings')).dragShape.arc,true);
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius,128);
  passed('large curved handle drags immediately, opens menu, saves 128, cancels preview, survives hide/reset and leaves four resize arcs operable');

  await browser.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#49AE91';ctx.fillRect(0,0,640,400);
    const video=document.createElement('video');video.id='large-corner-video';video.muted=true;video.srcObject=canvas.captureStream(10);
    Object.assign(video.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',objectFit:'cover',zIndex:'10'});
    document.body.append(video);await video.play();
  })()`);
  for (const opacity of [1,.2]) {
    await controls.invoke('preview_opacity',{opacity});
    current = await native('captureWindow');
    assert.equal(overlay(current).alpha,Math.round(opacity*255));
    assert.equal(current.MiniBrowser.alpha,Math.round(opacity*255));
    assert.equal(await browser.evaluate(`document.getElementById('large-corner-video').paused`),false);
    await copyFile(path.join(root,'rounded-window.png'),path.join(root,`large-corner-video-${opacity}.png`));
  }
  await controls.invoke('open_settings');
  await native('minimumResize');
  current = await native();
  const panel = overlay(current);
  const main = current.MiniBrowser;
  assert.ok(Math.abs(panel.x+panel.width/2-main.x-main.width/2)<=2);
  assert.ok(Math.abs(panel.y+panel.height/2-main.y-main.height/2)<=2);
  assert.deepEqual(panel.cornersInside,[false,false,false,false]);
  const footer = await controls.evaluate(`(()=>{const r=document.querySelector('.form-footer').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})()`);
  assert.ok(footer.top>=0 && footer.bottom<=footer.height+1);
  await native('captureWindow');
  await copyFile(path.join(root,'rounded-window.png'),path.join(root,'large-corner-minimum-panel.png'));
  shape = (await controls.invoke('get_settings')).dragShape;
  assert.equal(shape.arc,true);
  await native('openTrayMenu');
  await native('trayReset');
  await controls.invoke('cancel_settings');
  await browser.evaluate(`(()=>{const v=document.getElementById('large-corner-video');v.srcObject.getTracks().forEach(t=>t.stop());v.remove()})()`);
  assert.equal((await controls.invoke('get_settings')).settings.cornerRadius,128);
  await controls.invoke('open_settings');
  await controls.invoke('apply_settings',{settings:snapshot.settings,urlEdited:false});
  passed('128-radius video/alpha, clamped minimum-window panel and cancelled preview preserve saved settings');
}
