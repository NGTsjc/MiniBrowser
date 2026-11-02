import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {CDP} from './cdp.mjs';

const baseline=process.argv.includes('--baseline');
const source=path.resolve(process.argv[2]??'src-tauri/target/debug/MiniBrowser.exe');
const root=path.resolve('.cache/appearance-checks',(baseline?'baseline-':'fixed-')+Date.now());
await mkdir(path.join(root,'MiniBrowser.data'),{recursive:true});const executable=path.join(root,'MiniBrowser.exe');
await copyFile(source,executable);
await writeFile(path.join(root,'MiniBrowser.data/settings.json'),JSON.stringify({version:1,opacity:.7,cornerRadius:32,dragPosition:'bottomRight'}));
const child=spawn(executable,[],{cwd:root,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:['ignore','ignore','pipe']});
child.stderr.on('data',d=>process.stderr.write(d));
const execute=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));const passed=[];
let controls,browser,watcher;const stopSignal=path.join(root,'monitor.stop'),readySignal=path.join(root,'monitor.ready');
async function until(fn){let last;const start=Date.now();while(Date.now()-start<30000){try{const r=await fn();if(r)return r}catch(e){last=e}await sleep(60)}throw last??Error('Appearance check timed out')}
const probeArgs=action=>['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/native-probe.ps1'),'-AppProcessId',String(child.pid),'-Action',action];
async function native(action='inspect'){const r=await execute('powershell.exe',probeArgs(action),{windowsHide:true,encoding:'utf8'});return r.stdout.trim()?JSON.parse(r.stdout.replace(/^\uFEFF/,'')):null}
const overlay=result=>Object.entries(result).find(([key])=>key.startsWith('MiniBrowser '))[1];
const pass=message=>{passed.push(message);console.log('PASS',message)};
async function key(key,code,vk){await controls.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk});await controls.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk})}
async function click(selector){if(!selector.startsWith('#drag-position-option-'))await controls.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await sleep(80);const point=await controls.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await controls.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await controls.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})}
async function open(){await controls.invoke('open_settings');await until(()=>controls.evaluate(`!document.getElementById('panel').hidden`));await sleep(120)}
async function popup(){await click('#drag-position-trigger');await until(()=>controls.evaluate(`!document.getElementById('drag-position-popup').hidden`))}
async function screenshot(name){const s=await controls.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,name),Buffer.from(s.data,'base64'))}
function assertStyles(result){for(const window of [result.MiniBrowser,overlay(result)]){assert.equal(window.style&0x00c30000,0);assert.equal(window.extendedStyle&0x00060201,0);assert.equal(window.nonclientRendering,false);assert.ok(window.style&0x40000);assert.ok(window.extendedStyle&0x80000)}}
try{
  browser=await until(()=>CDP.connect(9223));controls=await until(()=>CDP.connect(9224));
  await until(()=>controls.evaluate(`!!document.getElementById('drag-position')&&!!window.__TAURI_INTERNALS__`));
  await writeFile(path.join(root,'initial-native.json'),JSON.stringify(await native(),null,2));
  if(!baseline){
    assertStyles(await native());
    await open();assert.equal(await controls.evaluate(`document.getElementById('drag-position').hidden`),true);
    await popup();
    assert.equal(await controls.evaluate(`document.getElementById('drag-position-trigger').getAttribute('role')`),'combobox');
    assert.deepEqual(await controls.evaluate(`[...document.querySelectorAll('#drag-position-popup [role=option]')].map(e=>e.getAttribute('aria-selected'))`),['false','false','false','true']);
    await screenshot('dropdown-open.png');
    await click('#drag-position-option-0');
    await until(()=>controls.evaluate(`document.getElementById('toolbar').dataset.position==='topLeft'`));
    assert.equal(await controls.evaluate(`document.getElementById('drag-position-popup').hidden`),true);
    await controls.evaluate(`document.getElementById('drag-position-trigger').focus()`);await key('ArrowDown','ArrowDown',40);await key('End','End',35);await key('Enter','Enter',13);
    await until(()=>controls.evaluate(`document.getElementById('toolbar').dataset.position==='bottomRight'`));
    await key('ArrowUp','ArrowUp',38);await key('Home','Home',36);await key('Escape','Escape',27);
    assert.equal(await controls.evaluate(`document.getElementById('drag-position-popup').hidden`),true);assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`),false);
    assert.equal(await controls.evaluate(`document.getElementById('drag-position').value`),'bottomRight');
    await popup();await controls.evaluate(`document.querySelector('#panel h1').click()`);await controls.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:100,y:100});await controls.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:100,y:100});
    assert.equal(await controls.evaluate(`document.getElementById('drag-position-popup').hidden`),true);
    await popup();await key('Tab','Tab',9);assert.equal(await controls.evaluate(`document.getElementById('drag-position-popup').hidden`),true);
    await controls.evaluate(`(()=>{const h=document.getElementById('accent-hex');h.value='#7C3AED';h.dispatchEvent(new Event('input',{bubbles:true}))})()`);await popup();
    assert.equal(await controls.evaluate(`getComputedStyle(document.getElementById('drag-position-popup')).getPropertyValue('--accent').trim()`),'#7C3AED');
    await controls.invoke('hide_window');await controls.invoke('show_window');assert.equal(await controls.evaluate(`document.getElementById('drag-position-popup').hidden`),true);
    await native('compactResize');await popup();
    assert.equal(await controls.evaluate(`(()=>{const r=document.getElementById('drag-position-popup').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`),true);
    await key('Home','Home',36);await key('Enter','Enter',13);await until(()=>controls.evaluate(`document.getElementById('toolbar').dataset.position==='topLeft'`));
    await controls.invoke('context_menu_action',{action:'restore'});await controls.invoke('cancel_settings');
    pass('themed listbox supports selected state, mouse/keyboard, Esc without draft cancellation, outside/Tab/hide dismissal, theme preview and compact bounds');
    const stable=await native();const rewritten=await native('resetWindowStyles');assertStyles(rewritten);assert.equal(rewritten.MiniBrowser.alpha,stable.MiniBrowser.alpha);
    const resized=(await native('edgeResize')).MiniBrowser;assert.ok(resized.width>stable.MiniBrowser.width+20);await controls.invoke('context_menu_action',{action:'restore'});
    pass('native style rewrites cannot add caption/edges or remove opacity, while edge resize remains available');
  }
  watcher=execute('powershell.exe',[...probeArgs('monitorStyles'),'-ReadySignal',readySignal,'-StopSignal',stopSignal],{windowsHide:true,encoding:'utf8'});
  await until(()=>readFile(readySignal,'utf8'));
  for(let i=0;i<12;i++){
    await controls.invoke('hide_window');await sleep(35);await controls.invoke('show_window');await sleep(35);
    if(i===5&&!baseline){await open();const settings=(await controls.invoke('get_settings')).settings;await controls.invoke('apply_settings',{settings:{...settings,alwaysOnTop:true},urlEdited:false});}
  }
  await writeFile(stopSignal,'stop');const watchResult=await watcher;watcher=null;
  const samples=JSON.parse(watchResult.stdout.replace(/^\uFEFF/,''));await writeFile(path.join(root,'visibility-style-samples.json'),JSON.stringify(samples,null,2));
  if(!baseline){assert.ok(samples.samples>100);assert.ok(samples.visibilityChanges>=20);assert.equal(samples.captionSamples,0);assert.equal(samples.edgeSamples,0);assert.equal(samples.resizeMissing,0);assert.equal(samples.layeredMissing,0);assertStyles(await native());pass('high-rate samples across hide/show and topmost changes contain no native caption or decoration edges');
    await controls.invoke('context_menu_action',{action:'restore'});await native('altF4');await until(()=>child.exitCode!==null);assert.equal(child.exitCode,0);pass('Alt+F4 still closes the frameless browser normally');
  }else{assert.ok(samples.captionSamples>0);console.log('BASELINE',JSON.stringify(samples));}
  await writeFile(path.join(root,'report.json'),JSON.stringify({passed,samples,baseline},null,2));console.log('Artifacts:',root);
}catch(error){try{await screenshot('failure.png');await writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.stack,native:await native(),ui:await controls.evaluate(`({active:document.activeElement?.id,trigger:document.getElementById('drag-position-trigger')?.getBoundingClientRect().toJSON(),popup:document.getElementById('drag-position-popup')?.hidden})`)},null,2))}catch{}console.error('Failure artifacts:',root);throw error}
finally{await writeFile(stopSignal,'stop');if(watcher){try{await watcher}catch{}}try{if(child.exitCode===null){await controls?.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('close_app'),100);true`);await until(()=>child.exitCode!==null)}}catch{}controls?.close();browser?.close();if(child.exitCode===null)child.kill()}
