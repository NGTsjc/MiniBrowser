import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,copyFile,writeFile,readFile,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {CDP} from './cdp.mjs';

const root=path.resolve('.cache/drag-position-checks',String(Date.now()));
await mkdir(root,{recursive:true});const executable=path.join(root,'MiniBrowser.exe');
await copyFile('src-tauri/target/debug/MiniBrowser.exe',executable);
const child=spawn(executable,[],{cwd:root,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:['ignore','ignore','pipe']});
child.stderr.on('data',d=>process.stderr.write(d));
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let controls,browser,processId=child.pid;const passed=[];
async function until(fn){let last;const start=Date.now();while(Date.now()-start<30000){try{const r=await fn();if(r)return r}catch(e){last=e}await sleep(70)}throw last??Error('Drag position check timed out')}
async function native(action='inspect',point){const r=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/native-probe.ps1'),'-AppProcessId',String(processId),'-ExecutablePath',executable,'-Action',action,...(point?['-ClickX',String(Math.round(point.x)),'-ClickY',String(Math.round(point.y))]:[])],{windowsHide:true,encoding:'utf8'});return JSON.parse(r.stdout.replace(/^\uFEFF/,''))}
const overlay = result => Object.entries(result).find(([key])=>key.startsWith('MiniBrowser '))[1];
async function connect(port=9223){browser=await until(()=>CDP.connect(port));controls=await until(()=>CDP.connect(port+1));await until(()=>controls.evaluate(`!!document.getElementById('drag-position') && !!window.__TAURI_INTERNALS__`))}
async function open(){await controls.invoke('open_settings');await until(()=>controls.evaluate(`!document.getElementById('panel').hidden`))}
async function select(position){await controls.evaluate(`(()=>{const e=document.getElementById('drag-position');e.value=${JSON.stringify(position)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(()=>controls.evaluate(`document.getElementById('toolbar').dataset.position===${JSON.stringify(position)}`))}
async function closed(){await until(()=>controls.evaluate(`document.getElementById('panel').hidden`))}
const snapshot=()=>controls.invoke('get_settings');
const saved=async()=>JSON.parse(await readFile(path.join(root,'MiniBrowser.data/settings.json'),'utf8'));
const faults=value=>writeFile(path.join(root,'test-faults.json'),JSON.stringify(value));
async function screenshot(name){const s=await controls.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,name),Buffer.from(s.data,'base64'))}
const pass=message=>{passed.push(message);console.log('PASS',message)};
try{
  await connect();const original=(await snapshot()).settings;
  assert.equal(original.dragPosition,'topLeft');
  await open();assert.deepEqual(await controls.evaluate(`[...document.querySelector('#drag-position').options].map(e=>e.textContent)`),['Top left','Top right','Bottom left','Bottom right']);
  await controls.invoke('cancel_settings');
  for(const radius of [0,32,128,256]){
    for(const position of ['topLeft','topRight','bottomLeft','bottomRight']){
      await controls.invoke('context_menu_action',{action:'restore'});
      await controls.invoke('preview_corner_radius',{radius});
      await controls.invoke('preview_drag_position',{position});
      const state=await snapshot(),shape=state.dragShape;const result=await native();
      const bar=overlay(result),main=result.MiniBrowser;
      assert.equal(shape.position,position);
      assert.deepEqual([bar.x,bar.y,bar.width,bar.height],[main.x+shape.x,main.y+shape.y,shape.width,shape.height]);
      const point={x:shape.grip[0]/main.scale,y:shape.grip[1]/main.scale};
      const hit=overlay(await native('inspect',point));assert.equal(hit.sampleInside,true);assert.equal(hit.sampleHitsControl,true);
      if(shape.arc){
        const right=position.endsWith('Right'),bottom=position.startsWith('bottom');
        const empty={x:(right?1:shape.width-2)/main.scale,y:(bottom?1:shape.height-2)/main.scale};
        const hole=overlay(await native('inspect',empty));assert.equal(hole.sampleInside,false);assert.equal(hole.sampleHitsControl,false);
      }
      if(radius===0 || radius===128){
        const moved=(await native('dragToolbar',point)).MiniBrowser;
        assert.ok(Math.abs(moved.x-main.x-65)<=5&&Math.abs(moved.y-main.y-45)<=5,`${position} compact drag`);
      }
      await open();await select(position);
      await controls.invoke('preview_corner_radius',{radius});
      await controls.evaluate(`(()=>{const e=document.getElementById('url');e.value='https://retained.example/';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      const full=await snapshot();const current=await native();const corner=full.dragShape;
      const panelPoint={x:(corner.x+corner.grip[0])/current.MiniBrowser.scale,y:(corner.y+corner.grip[1])/current.MiniBrowser.scale};
      assert.equal(await controls.evaluate(`!!document.elementFromPoint(${panelPoint.x},${panelPoint.y})?.closest('#toolbar')`),true);
      assert.equal(await controls.evaluate(`(()=>{const b=document.getElementById('confirm'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&!!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#confirm')})()`),true);
      if(radius===0 || radius===128){
        const moved=(await native('dragToolbar',panelPoint)).MiniBrowser;
        assert.ok(Math.abs(moved.x-current.MiniBrowser.x-65)<=5&&Math.abs(moved.y-current.MiniBrowser.y-45)<=5,`${position} settings drag`);
      }
      await native('rightClickControl',panelPoint);await until(()=>controls.evaluate(`!document.getElementById('context-menu').hidden`));await controls.invoke('dismiss_context_menu');
      assert.equal(await controls.evaluate(`document.getElementById('url').value`),'https://retained.example/');
      if(radius===128)await screenshot(`settings-${position}.png`);
      await controls.invoke('cancel_settings');await closed();
      assert.equal((await snapshot()).dragShape.position,'topLeft');
    }
  }
  pass('all four corners mirror square/arc native regions, preserve click-through, drag in browser/settings modes and keep drafts through menus');
  await open();await select('bottomRight');
  const oldEpoch=(await snapshot()).previewEpoch;
  await controls.evaluate(`(()=>{const p=document.getElementById('drag-position');for(const value of ['topRight','bottomLeft','topLeft','bottomRight','topRight']){p.value=value;p.dispatchEvent(new Event('change',{bubbles:true}))}document.getElementById('settings-form').requestSubmit()})()`);await closed();
  assert.equal((await saved()).dragPosition,'topRight');assert.equal((await snapshot()).dragShape.position,'topRight');
  await assert.rejects(controls.invoke('preview_drag_position',{position:'bottomRight',epoch:oldEpoch}),/expired/);
  await assert.rejects(controls.invoke('preview_drag_position',{position:'middle'}));
  await assert.rejects(browser.invoke('preview_drag_position',{position:'bottomRight'}));
  await open();await select('bottomLeft');
  const temp=path.join(root,'MiniBrowser.data/settings.json.tmp');await mkdir(temp);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('Could not save settings')`));
  assert.equal((await snapshot()).dragShape.position,'topRight');assert.equal(await controls.evaluate(`document.getElementById('drag-position').value`),'bottomLeft');
  await rmdir(temp);await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);await closed();
  assert.equal((await saved()).dragPosition,'bottomLeft');
  await open();await controls.evaluate(`(()=>{const p=document.getElementById('drag-position');for(let i=0;i<50;i++){p.value=i%2?'topRight':'bottomRight';p.dispatchEvent(new Event('change',{bubbles:true}))}document.getElementById('cancel').click()})()`);await closed();
  assert.equal((await snapshot()).dragShape.position,'bottomLeft');
  await faults({control_region:true});await assert.rejects(controls.invoke('preview_drag_position',{position:'topRight'}));await faults({});
  assert.equal((await snapshot()).dragShape.position,'bottomLeft');
  pass('confirmation flushes the final corner, stale/invalid/remote requests are denied, cancel and failed saves preserve the committed corner and draft');
  await open();await select('bottomRight');await controls.invoke('hide_window');await controls.invoke('show_window');
  await controls.invoke('context_menu_action',{action:'restore'});
  assert.equal((await snapshot()).dragShape.position,'bottomRight');assert.equal((await saved()).dragPosition,'bottomLeft');
  assert.equal(await controls.evaluate(`document.getElementById('drag-position').value`),'bottomRight');
  await controls.invoke('cancel_settings');await closed();
  for(const position of ['topLeft','topRight','bottomLeft','bottomRight']){
    await open();await select(position);await controls.invoke('preview_corner_radius',{radius:128});await native('compactResize');
    assert.equal(await controls.evaluate(`(()=>{const p=document.getElementById('panel');p.scrollTop=p.scrollHeight;const b=document.getElementById('confirm'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&!!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#confirm')})()`),true,`${position} compact footer`);
    await controls.invoke('context_menu_action',{action:'restore'});await controls.invoke('cancel_settings');await closed();
  }
  pass('hide/show and restore retain corner previews, and all four positions leave compact-window confirmation accessible');
  await controls.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('clear_session'),100);true`);controls.close();browser.close();await connect(9225);
  assert.equal((await snapshot()).dragShape.position,'bottomLeft');
  const custom=JSON.parse(await readFile('assets/locales/locale.example.json','utf8'));await writeFile(path.join(root,'MiniBrowser.data/locale.json'),JSON.stringify(custom));
  const currentSettings=(await snapshot()).settings;await controls.invoke('apply_settings',{settings:{...currentSettings,languageFile:'locale.json'},urlEdited:false});
  await controls.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('restart_app'),100);true`);controls.close();browser.close();await until(()=>child.exitCode!==null);processId=0;await connect();processId=(await native()).processId;
  assert.equal((await snapshot()).dragShape.position,'bottomLeft');await open();
  assert.deepEqual(await controls.evaluate(`[...document.querySelector('#drag-position').options].map(e=>e.textContent)`),['左上角','右上角','左下角','右下角']);
  pass('session rebuilding and process restart restore the saved corner and Chinese position labels');
  await writeFile(path.join(root,'report.json'),JSON.stringify({passed},null,2));console.log('Artifacts:',root);
}catch(error){try{await screenshot('failure.png');await writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.stack,snapshot:await snapshot(),ui:await controls.evaluate(`({selected:document.getElementById('drag-position').value,notice:document.getElementById('notice').textContent})`)},null,2))}catch{}console.error('Failure artifacts:',root);throw error}
finally{try{await controls?.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('close_app'),100);true`);controls?.close();browser?.close();await until(()=>{try{process.kill(processId,0);return false}catch{return true}})}catch{}if(child.exitCode===null)child.kill();if(processId>0&&processId!==child.pid){try{process.kill(processId)}catch{}}}
