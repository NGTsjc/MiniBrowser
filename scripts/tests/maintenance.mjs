import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, copyFile, writeFile, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { CDP } from './cdp.mjs';

const root=path.resolve('.cache/maintenance-checks',String(Date.now()));
await mkdir(path.join(root,'MiniBrowser.data'),{recursive:true});
const executable=path.join(root,'MiniBrowser.exe');
await copyFile('src-tauri/target/debug/MiniBrowser.exe',executable);
const fixtureUrl='http://127.0.0.1:18767/';
await writeFile(path.join(root,'MiniBrowser.data/settings.json'),JSON.stringify({version:1,startupUrl:fixtureUrl}));
const fixture=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Maintenance fixture</title><body id="fixture">Maintenance session</body>')});
await new Promise(r=>fixture.listen(18767,'127.0.0.1',r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, timeout=30000) {
  const start=Date.now();let error;
  while(Date.now()-start<timeout){try{const value=await fn();if(value)return value}catch(e){error=e}await sleep(80)}
  throw error??new Error('Maintenance check timed out');
}
const execute=promisify(execFile);
let child,controls,browser,processId=0;
const passed=[];
const pass=name=>{passed.push(name);console.log(`PASS ${name}`)};
const faults=value=>writeFile(path.join(root,'test-faults.json'),JSON.stringify(value));
const saved=async()=>JSON.parse(await readFile(path.join(root,'MiniBrowser.data/settings.json'),'utf8'));
const native=async(action='inspect')=>{
  const {stdout}=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/native-probe.ps1'),'-AppProcessId',String(processId),'-ExecutablePath',executable,'-Action',action],{windowsHide:true,encoding:'utf8'});
  return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
};
const set=async(id,value)=>controls.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const submit=()=>controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
const closed=()=>until(()=>controls.evaluate(`document.getElementById('panel').hidden`));
const open=async()=>{await controls.invoke('open_settings');await until(()=>controls.evaluate(`!document.getElementById('panel').hidden`))};
const ready=async()=>{
  controls=await until(()=>CDP.connect(9224));browser=await until(()=>CDP.connect(9223));
  await until(()=>controls.evaluate(`!!document.getElementById('toolbar') && !!window.__TAURI_INTERNALS__?.invoke`));
  await until(()=>browser.evaluate(`!!document.getElementById('fixture')`));
};
try {
  child=spawn(executable,[],{cwd:root,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>process.stderr.write(data));processId=child.pid;
  await ready();
  const original=(await controls.invoke('get_settings')).settings;
  await open();
  await set('url','https://retained-draft.example/');
  await open();
  assert.equal(await controls.evaluate(`document.getElementById('url').value`),'https://retained-draft.example/');
  await faults({corner_preview:true});await set('corner-radius',32);
  await until(()=>controls.evaluate(`document.getElementById('notice').textContent.includes('corner_preview')`));
  assert.equal(await controls.evaluate(`document.getElementById('url').value`),'https://retained-draft.example/');
  await faults({});await controls.evaluate(`document.getElementById('cancel').click()`);await closed();
  pass('repeated open and preview errors retain the edited draft');

  await open();
  const oldEpoch=(await controls.invoke('get_settings')).previewEpoch;
  await controls.evaluate(`(()=>{for(let i=0;i<120;i++){for(const[id,value]of [['opacity',20+i%80],['corner-radius',i%129]]){const input=document.getElementById(id);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}))}}document.getElementById('opacity').value='95';document.getElementById('opacity').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('corner-radius').value='128';document.getElementById('corner-radius').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('settings-form').requestSubmit()})()`);
  await closed();assert.equal((await saved()).opacity,.95);assert.equal((await saved()).cornerRadius,128);
  await assert.rejects(controls.invoke('preview_corner_radius',{radius:0,epoch:oldEpoch}),/失效/);
  await open();
  await controls.evaluate(`(()=>{for(let i=0;i<100;i++){const input=document.getElementById('corner-radius');input.value=String(i);input.dispatchEvent(new Event('input',{bubbles:true}))}document.getElementById('cancel').click()})()`);
  await closed();assert.equal((await saved()).cornerRadius,128);
  await controls.invoke('apply_settings',{settings:original,urlEdited:false});
  pass('bursts flush final settings; cancel and old preview epochs cannot overwrite committed appearance');

  await open();await set('url',fixtureUrl+'draft');await set('opacity',60);
  const temp=path.join(root,'MiniBrowser.data/settings.json.tmp');await mkdir(temp);
  await submit();await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('保存失败')`));
  assert.equal((await saved()).opacity,original.opacity);
  assert.equal(await controls.evaluate(`document.getElementById('url').value`),fixtureUrl+'draft');
  await rmdir(temp);await set('opacity',70);await submit();await closed();assert.equal((await saved()).opacity,.7);
  pass('failed file replacement rolls back, retains draft and refreshes epoch for a successful retry');

  await open();await faults({navigation:true});await set('url',fixtureUrl+'saved-but-not-loaded');await set('opacity',75);await submit();
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('设置已保存')`));
  assert.equal((await saved()).startupUrl,fixtureUrl+'saved-but-not-loaded');
  assert.equal((await saved()).opacity,.75);
  assert.equal(await browser.evaluate('location.href'),fixtureUrl+'draft');
  await faults({});await controls.evaluate(`document.getElementById('cancel').click()`);await closed();
  assert.equal((await controls.invoke('get_settings')).settings.opacity,.75);
  assert.equal((await native()).MiniBrowser.alpha,191);
  pass('post-commit navigation failure is a saved warning; cancel retains newly committed settings');

  for(const name of ['media_sync','panel_close']) {
    await open();await faults({[name]:true});await set('opacity',80);await submit();
    await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('设置已保存')`));
    assert.equal((await saved()).opacity,.8);
    await faults({});await controls.evaluate(`document.getElementById('cancel').click()`);await closed();
  }
  pass('media and panel-close failures after commit never roll back saved settings');

  const before=(await native()).MiniBrowser;
  await faults({controls_opacity:true});await assert.rejects(controls.invoke('preview_opacity',{opacity:.4}));
  assert.equal((await native()).MiniBrowser.alpha,before.alpha);
  await faults({control_region:true});await assert.rejects(controls.invoke('preview_corner_radius',{radius:128}));
  assert.equal((await native()).MiniBrowser.cornerTopInset,before.cornerTopInset);
  await faults({});await controls.invoke('cancel_settings');
  pass('partial native opacity and clipping failures restore the previous main-window appearance');
  const stable = (await native()).MiniBrowser;
  const protectedStyles = (await native('resetExtendedStyles')).MiniBrowser;
  assert.equal(protectedStyles.alpha, stable.alpha);
  assert.ok((protectedStyles.extendedStyle & 0x80) !== 0);
  assert.equal(protectedStyles.extendedStyle & 0x40000,0);
  pass('native style rewrites retain layered alpha and taskbar exclusion');

  await faults({control_region:true});await assert.rejects(controls.invoke('show_context_menu'));
  await faults({});await controls.invoke('show_context_menu');
  await until(()=>controls.evaluate(`!document.getElementById('context-menu').hidden`));
  await faults({control_region:true});await assert.rejects(controls.invoke('dismiss_context_menu'));
  assert.equal(await controls.evaluate(`document.getElementById('context-menu').hidden`),false);
  await faults({});await controls.invoke('dismiss_context_menu');
  await until(()=>controls.evaluate(`document.getElementById('context-menu').hidden`));
  pass('failed popup mode changes restore menu state and can be retried');


  const settings={...(await controls.invoke('get_settings')).settings,accentColor:'#047857',opacity:.85};
  await Promise.all([controls.invoke('apply_settings',{settings,urlEdited:false}),native('edgeResize')]);
  await until(async()=>{const file=await saved();const current=(await controls.invoke('get_settings')).settings;return file.width===current.width&&file.height===current.height&&file.accentColor==='#047857'&&file.opacity===.85});
  pass('resize persistence and settings confirmation preserve the latest dimensions and preferences');

  await controls.invoke('apply_settings',{settings:{...original,startupUrl:fixtureUrl},urlEdited:false});
  await browser.evaluate(`document.cookie='maintenance=private';window.__maintenanceToken=true`);
  await faults({session_reset_delay_ms:300});
  await controls.invoke('clear_session');
  await controls.invoke('close_app');await controls.invoke('restart_app');
  controls.close();browser.close();await until(()=>child.exitCode!==null);
  await ready();processId=0;processId=(await native()).processId;
  assert.notEqual(processId,child.pid);
  assert.equal(await browser.evaluate('document.cookie'),'');
  assert.equal(await browser.evaluate('window.__maintenanceToken'),undefined);
  const fresh=(await controls.invoke('get_settings')).previewEpoch;
  await assert.rejects(controls.invoke('preview_opacity',{opacity:.3,epoch:fresh+1}));
  pass('close then restart during session rebuilding executes the latest request with a fresh session');

  await controls.invoke('clear_session');await controls.invoke('restart_app');await controls.invoke('close_app');
  const finalPid=processId;controls.close();browser.close();
  await until(()=>{try{process.kill(finalPid,0);return false}catch{return true}});
  await sleep(500);
  await assert.rejects(()=>CDP.connect(9223));
  pass('restart then close during rebuilding exits without creating a replacement window');
  await faults({session_build:true,session_reset_delay_ms:100});
  child=spawn(executable,[],{cwd:root,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>process.stderr.write(data));processId=child.pid;
  await ready();await controls.invoke('clear_session');controls.close();browser.close();
  await until(()=>child.exitCode!==null);
  assert.equal(child.exitCode,1);
  pass('unrecoverable session rebuild failure exits with an error instead of leaving a headless process');

  await writeFile(path.join(root,'report.json'),JSON.stringify({passed},null,2));
  console.log(`Artifacts: ${root}`);
} catch(error) {
  try { await writeFile(path.join(root,'failure.json'),JSON.stringify({error:error.stack,snapshot:await controls.invoke('get_settings'),ui:await controls.evaluate(`({hidden:document.getElementById('panel').hidden,notice:document.getElementById('notice').textContent,url:document.getElementById('url').value,disabled:document.getElementById('confirm').disabled})`)},null,2)); } catch {}
  console.error('Failure artifacts:',root); throw error;
} finally {
  controls?.close();browser?.close();
  if(child?.exitCode===null)child.kill();
  if(processId>0&&processId!==child?.pid){try{process.kill(processId)}catch{}}
  fixture.close();
}
