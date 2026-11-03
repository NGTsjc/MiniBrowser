import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,copyFile,writeFile,readFile,rmdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {CDP} from './cdp.mjs';

const root=path.resolve('.cache/localization-checks',String(Date.now()));
const chinese=JSON.parse(await readFile('assets/locales/locale.example.json','utf8'));
const english=JSON.parse(await readFile('assets/locales/en.json','utf8'));
const execute=promisify(execFile);const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const passed=[];let child,controls,browser,current;
async function until(fn){let last;const start=Date.now();while(Date.now()-start<30000){try{const r=await fn();if(r)return r}catch(e){last=e}await sleep(80)}throw last??Error('Localization check timed out')}
async function native(action='inspect'){
  const r=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/native-probe.ps1'),'-AppProcessId',String(child.pid),'-Action',action],{windowsHide:true,encoding:'utf8'});
  return JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
async function connect(port=9223){browser=await until(()=>CDP.connect(port));controls=await until(()=>CDP.connect(port+1));await until(()=>controls.evaluate(`!!document.getElementById('toolbar') && !!window.__TAURI_INTERNALS__`))}
async function start(name,{file='locale.json',content,settings={}}={}){
  current=path.join(root,name);await mkdir(path.join(current,'MiniBrowser.data'),{recursive:true});
  const exe=path.join(current,'MiniBrowser.exe');await copyFile('src-tauri/target/debug/MiniBrowser.exe',exe);
  await writeFile(path.join(current,'MiniBrowser.data/settings.json'),JSON.stringify({version:1,languageFile:file,...settings}));
  if(content!==undefined)await writeFile(path.join(current,'MiniBrowser.data/locale.json'),typeof content==='string'?content:JSON.stringify(content));
  await launch(exe);
}
async function launch(exe){child=spawn(exe,[],{cwd:current,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',d=>process.stderr.write(d));await connect();}
async function stop(){try{await controls?.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('close_app'),100);true`);controls?.close();browser?.close();await until(()=>child.exitCode!==null)}finally{controls?.close();browser?.close();if(child?.exitCode===null)child.kill();}controls=null;browser=null;await sleep(200);}
async function open(){await controls.invoke('open_settings');await until(()=>controls.evaluate(`!document.getElementById('panel').hidden`));}
const set=(id,value)=>controls.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
async function screenshot(name){const s=await controls.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(current,name),Buffer.from(s.data,'base64'));}
function pass(message){passed.push(message);console.log('PASS',message);}
try{
  if(!process.argv.includes('--picker-only')) {
  await start('chinese',{content:'\uFEFF'+JSON.stringify(chinese)});await open();
  assert.equal(await controls.evaluate(`document.documentElement.lang`),'zh-CN');
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'窗口设置');
  assert.equal(await browser.evaluate(`document.querySelector('.welcome h1').textContent`),chinese['guide.title']);
  await controls.invoke('show_context_menu');await until(()=>controls.evaluate(`!document.getElementById('context-menu').hidden`));
  assert.deepEqual(await controls.evaluate(`[...document.querySelectorAll('.menu-label')].map(e=>e.textContent)`),['设置','刷新','隐藏','关闭','恢复窗口','重启','开发者工具']);
  await controls.invoke('dismiss_context_menu');
  await native('openTrayMenu');assert.deepEqual((await native()).menuItems,['隐藏窗口','重置窗口','关闭','重启']);await native('dismissMenu');
  const saved=(await controls.invoke('get_settings')).settings;
  await assert.rejects(controls.invoke('apply_settings',{settings:{...saved,accentColor:'invalid'},urlEdited:false}),/主题色必须/);
  await set('url','https://draft.example/');
  const temp=path.join(current,'MiniBrowser.data/settings.json.tmp');await mkdir(temp);
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('设置保存失败')`));
  assert.equal(await controls.evaluate(`document.getElementById('url').value`),'https://draft.example/');await rmdir(temp);
  await writeFile(path.join(current,'test-faults.json'),JSON.stringify({navigation:true}));
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('设置已保存')`));
  assert.match(await controls.evaluate(`document.getElementById('notice').textContent`),/无法打开新地址/);
  await writeFile(path.join(current,'test-faults.json'),'{}');await controls.invoke('cancel_settings');
  const confirmed=(await controls.invoke('get_settings')).settings;
  assert.equal(confirmed.languageFile,'locale.json');assert.equal(confirmed.startupUrl,'https://draft.example/');
  await controls.invoke('apply_settings',{settings:{...confirmed,startupUrl:''},urlEdited:true});
  await native('resize');await sleep(600);
  assert.equal(JSON.parse(await readFile(path.join(current,'MiniBrowser.data/settings.json'),'utf8')).languageFile,'locale.json');
  await open();await screenshot('chinese.png');pass('Chinese covers settings, guide, context/tray menus, validation, save failures and saved warnings; languageFile survives size/settings writes');
  await writeFile(path.join(current,'MiniBrowser.data/locale.json'),JSON.stringify({'settings.title':'Reloaded title'}));
  await open();assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'窗口设置');
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`document.querySelector('#panel h1').textContent==='Reloaded title'`));
  await until(()=>browser.evaluate(`document.querySelector('.welcome h1').textContent===${JSON.stringify(english['guide.title'])}`));
  assert.equal(await controls.evaluate(`document.documentElement.lang`),'en');
  await open();
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'locale.json');
  await writeFile(path.join(current,'MiniBrowser.data/locale.json'),JSON.stringify({'settings.title':'Restarted title'}));
  console.log('Checking locale after session rebuild');
  await controls.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('clear_session'),100);true`);controls.close();browser.close();await connect(9225);await open();
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'Reloaded title');
  console.log('Checking locale after process restart');
  await stop();await launch(path.join(current,'MiniBrowser.exe'));await open();
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'Restarted title');
  assert.equal(await controls.evaluate(`document.getElementById('confirm').textContent`),'Confirm');
  assert.equal(await controls.evaluate(`document.documentElement.lang`),'en');
  pass('confirmation reloads the same path immediately; session rebuilding retains active text and restart reads updated file');await stop();

  }
  await start('live-settings',{file:null});await open();
  const data=path.join(current,'MiniBrowser.data');
  await writeFile(path.join(data,'chinese.json'),JSON.stringify(chinese));
  const original=(await controls.invoke('get_settings')).settings;
  async function picker(selectedPath, cancel=false) {
    await controls.evaluate(`document.getElementById('browse-language').click();true`);
    await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/language-picker.ps1'),'-AppProcessId',String(child.pid),...(cancel?['-Cancel']:['-SelectedPath',selectedPath])],{windowsHide:true,encoding:'utf8'});
    await until(()=>controls.evaluate(`!document.getElementById('browse-language').disabled`));
  }
  await picker(path.join(data,'chinese.json'));
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'chinese.json');
  assert.equal(await controls.evaluate(`document.documentElement.lang`),'en');
  await picker('',true);
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'chinese.json');
  const outsideFile=path.join(current,'outside.json');await writeFile(outsideFile,'{}');
  await picker(outsideFile);
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'chinese.json');
  assert.match(await controls.evaluate(`document.getElementById('notice').textContent`),/outside MiniBrowser.data/);
  pass('native file picker selects relative paths, cancellation keeps draft and outside files are rejected');

  for(const bad of ['missing.json','../outside.json',path.join(data,'chinese.json')]) {
    await set('language-file',bad);await set('url','https://retained.example/');
    await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
    await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && !document.getElementById('notice').hidden`));
    assert.equal(await controls.evaluate(`document.documentElement.lang`),'en');
    assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),bad);
    assert.equal((await controls.invoke('get_settings')).settings.languageFile,null);
  }
  await writeFile(path.join(data,'broken.json'),'[]');
  await assert.rejects(controls.invoke('apply_settings',{settings:{...original,languageFile:'broken.json'},urlEdited:false}));
  await set('language-file','chinese.json');await set('url','');
  await mkdir(path.join(data,'settings.json.tmp'));
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('save')`));
  assert.equal(await controls.evaluate(`document.documentElement.lang`),'en');
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'chinese.json');
  await rmdir(path.join(data,'settings.json.tmp'));
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`document.documentElement.lang==='zh-CN'`));
  await until(()=>browser.evaluate(`document.documentElement.lang==='zh-CN'`));
  await browser.send('Page.reload');await until(()=>browser.evaluate(`!!document.querySelector('.welcome h1') && document.documentElement.lang==='zh-CN'`));
  await open();assert.equal(await controls.evaluate(`document.getElementById('browse-language').textContent`),chinese['settings.languageBrowse']);
  await controls.invoke('show_context_menu');
  assert.equal(await controls.evaluate(`document.querySelector('[data-action=refresh] .menu-label').textContent`),chinese['menu.refresh']);
  await controls.invoke('dismiss_context_menu');
  await native('openTrayMenu');assert.deepEqual((await native()).menuItems,['隐藏窗口','重置窗口','关闭','重启']);await native('dismissMenu');
  await set('language-file','');await controls.invoke('cancel_settings');await open();
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'chinese.json');
  await set('language-file','');await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`document.documentElement.lang==='en'`));
  assert.equal((await controls.invoke('get_settings')).settings.languageFile,null);
  await browser.send('Page.reload');await until(()=>browser.evaluate(`!!document.querySelector('.welcome h1') && document.documentElement.lang==='en'`));
  await assert.rejects(browser.invoke('choose_language_file'),/not allowed|permission|control/i);
  await open();await writeFile(path.join(data,'partial.json'),JSON.stringify({'settings.title':'Partial <text>','guide.title':'Live guide <text>','menu.refresh':13}));
  await set('language-file','partial.json');
  await controls.evaluate(`document.getElementById('settings-form').requestSubmit()`);
  await until(()=>controls.evaluate(`!document.getElementById('confirm').disabled && document.getElementById('notice').textContent.includes('Settings saved')`));
  assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`),false);
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'Partial <text>');
  assert.match(await controls.evaluate(`document.getElementById('notice').textContent`),/menu.refresh/);
  await controls.invoke('cancel_settings');await open();
  assert.equal(await controls.evaluate(`document.getElementById('language-file').value`),'partial.json');
  await sleep(120);await controls.evaluate(`document.getElementById('language-file').scrollIntoView({block:'center'});true`);await sleep(100);
  await screenshot('language-settings.png');
  const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><body>remote locale permission probe</body>')});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18768,'127.0.0.1',resolve)});
  try {
    await browser.send('Page.navigate',{url:'http://127.0.0.1:18768/'});
    await until(()=>browser.evaluate(`document.body.textContent.includes('remote locale permission probe')`));
    for(const command of ['get_locale','choose_language_file']) {
      assert.equal(await browser.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}).then(()=>false,()=>true)`),true);
    }
    assert.equal(await browser.evaluate(`typeof window.__MINIBROWSER_LOCALE__`),'undefined');
    await browser.send('Page.navigate',{url:'http://tauri.localhost/index.html?view=guide'});
    await until(()=>browser.evaluate(`!!document.querySelector('.welcome h1')`));
    assert.equal(await browser.evaluate(`document.documentElement.lang`),'en');
    assert.equal(await browser.evaluate(`document.querySelector('.welcome h1').textContent`),'Live guide <text>');
  } finally { await new Promise(resolve=>server.close(resolve)); }


  pass('settings path validation, failed save, cancellation, immediate Chinese/English, guide reload and menus preserve transaction semantics');await stop();
  if(process.argv.includes('--picker-only')) { await writeFile(path.join(root,'report.json'),JSON.stringify({passed},null,2));process.exit(0); }

  const injected='<img src=x onerror="window.__localeXss=1"> & \'text\'';
  const hint='" onpointerdown="window.__localeXss=1';
  await start('plain-text',{content:{'settings.title':injected,'toolbar.hint':hint,'menu.refresh':injected,'menu.close':'Close & literal','settings.clearBody':'Line one\nLine two','settings.confirm':'Confirm '+ 'verylongword'.repeat(8)}});await open();
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),injected);
  assert.equal(await controls.evaluate(`document.getElementById('toolbar').title`),hint);
  assert.equal(await controls.evaluate(`document.getElementById('toolbar').hasAttribute('onpointerdown')`),false);
  assert.equal(await controls.evaluate(`!!document.querySelector('#panel img') || !!window.__localeXss`),false);
  await controls.invoke('show_context_menu');await until(()=>controls.evaluate(`!document.getElementById('context-menu').hidden`));
  assert.equal(await controls.evaluate(`document.querySelector('[data-action=refresh] .menu-label').textContent`),injected);
  assert.equal(await controls.evaluate(`document.querySelector('[data-action=refresh] img')`),null);
  await controls.invoke('dismiss_context_menu');await native('compactResize');
  assert.equal(await controls.evaluate(`(()=>{const p=document.getElementById('panel');p.scrollTop=p.scrollHeight;const b=document.getElementById('confirm'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&!!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#confirm')})()`),true);
  await native('openTrayMenu');assert.equal((await native()).menuItems[2],'Close && literal');await native('dismissMenu');
  await native('resize');await screenshot('plain-text.png');pass('quotes, markup, newlines and long labels remain literal, and compact controls stay reachable');await stop();

  for(const [name,content] of [['missing',undefined],['broken','{'],['invalid-fields',{'menu.refresh':12,'menu.close':'A\nB','errors.save':'No placeholder','settings.title':'Custom title'}]]){
    await start(name,{content});await open();
    const snapshot=await controls.invoke('get_settings');assert.ok(snapshot.warning);
    assert.equal(await controls.evaluate(`document.getElementById('confirm').textContent`),'Confirm');
    if(name==='invalid-fields'){
      assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'Custom title');
      assert.equal(await controls.evaluate(`window.__MINIBROWSER_LOCALE__['errors.save']`),english['errors.save']);
    }
    await set('url','https://retained.example/');await open();assert.equal(await controls.evaluate(`document.getElementById('url').value`),'https://retained.example/');
    pass(`${name} falls back without blocking startup or replacing a draft`);await stop();
  }
  const outside=path.join(root,'outside');await mkdir(outside,{recursive:true});await writeFile(path.join(outside,'custom.json'),JSON.stringify({'settings.title':'Must not load'}));
  await start('junction',{file:'redirect/custom.json'});await stop();
  await symlink(outside,path.join(current,'MiniBrowser.data/redirect'),'junction');await launch(path.join(current,'MiniBrowser.exe'));await open();
  assert.equal(await controls.evaluate(`document.querySelector('#panel h1').textContent`),'Window Settings');
  assert.match((await controls.invoke('get_settings')).warning,/outside MiniBrowser.data/);pass('canonical path checking rejects a junction escaping the portable data tree');await stop();
  await writeFile(path.join(root,'report.json'),JSON.stringify({passed},null,2));console.log('Artifacts:',root);
}catch(error){console.error('Original failure:',error);try{await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/language-picker.ps1'),'-AppProcessId',String(child.pid),'-Cancel'],{windowsHide:true,encoding:'utf8'});}catch{}try{console.error('Browser body:',await browser.evaluate('document.body.textContent'));await screenshot('failure.png')}catch{}console.error('Failure artifacts:',current);throw error}
finally{if(child?.exitCode===null)await stop()}
