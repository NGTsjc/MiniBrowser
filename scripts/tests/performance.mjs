import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { CDP } from './cdp.mjs';

const source = path.resolve(process.argv[2] ?? 'src-tauri/target/debug/MiniBrowser.exe');
const label = process.argv[3] ?? 'current';
const runCount = Number(process.argv[4] ?? 3);
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 10) throw new Error('Run count must be 1..10');
const sourceSha256 = createHash('sha256').update(await readFile(source)).digest('hex');
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a simple profile label');
const root = path.resolve('.cache/maintenance-performance', `${label}-${Date.now()}`);
await mkdir(root, { recursive:true });
const execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn) {
  const start=Date.now();let error;
  while(Date.now()-start<30000){try{const value=await fn();if(value)return value}catch(e){error=e}await sleep(40)}
  throw error ?? new Error('Profile timed out');
}
const fixture=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fixed profile fixture</title><body id="fixture" style="height:3000px;background:#edf2f7"><h1>MiniBrowser performance fixture</h1><p>Fixed local document, no external requests.</p></body>')});
await new Promise(resolve=>fixture.listen(18766,'127.0.0.1',resolve));
const runs=[];
try {
  for(let run=0;run<runCount;run++) {
    const directory=path.join(root,String(run));await mkdir(path.join(directory,'MiniBrowser.data'),{recursive:true});
    const executable=path.join(directory,'MiniBrowser.exe');await copyFile(source,executable);
    await writeFile(path.join(directory,'MiniBrowser.data/settings.json'),JSON.stringify({version:1,startupUrl:'http://127.0.0.1:18766/',cornerRadius:128}));
    let child,controls,browser;
    try {
      const start=performance.now();
      child=spawn(executable,[],{cwd:directory,env:{...process.env,MINIBROWSER_TEST_CDP:'1'},windowsHide:true,stdio:'ignore'});
      controls=await until(()=>CDP.connect(9224));browser=await until(()=>CDP.connect(9223));
      await until(()=>controls.evaluate(`!!document.querySelector('#toolbar') && !!window.__TAURI_INTERNALS__?.invoke`));
      await until(()=>browser.evaluate(`!!document.querySelector('#fixture')`));
      const startupMs=performance.now()-start;
      const native=async action=>{
        const r=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/tests/profile-native.ps1'),'-AppProcessId',String(child.pid),'-Action',action],{windowsHide:true,encoding:'utf8'});
        return JSON.parse(r.stdout.replace(/^\uFEFF/,'').trim());
      };
      await sleep(1000);const before=await native('sample');
      const move=await native('move');const resize=await native('resize');
      await controls.invoke('open_settings');
      const previews=[];
      for(let i=0;i<20;i++) {
        for(const [command,args] of [['preview_corner_radius',{radius:64+i}],['preview_opacity',{opacity:.8+i/100}]]) {
          const start=performance.now();await controls.invoke(command,args);previews.push({command,ms:performance.now()-start});
        }
      }
      const previewStart=performance.now();
      await controls.evaluate(`(async()=>{for(let i=0;i<60;i++){for(const [id,value] of [['corner-radius',64+i%60],['opacity',80+i%20]]){const input=document.getElementById(id);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}))}await new Promise(requestAnimationFrame)}})()`);
      await sleep(200);
      const previewDurationMs=performance.now()-previewStart;
      await controls.invoke('cancel_settings');
      const after=await native('sample');
      const result={run:run+1,startupMs,before,after,move:move.samplesMs,resize:resize.samplesMs,previewDurationMs,previews};
      runs.push(result);console.log(`Profile ${label} ${run+1}/${runCount}: startup ${startupMs.toFixed(0)}ms, ${previews.length} preview calls, GDI ${before.hostGdi} -> ${after.hostGdi}`);
      await controls.evaluate(`setTimeout(()=>window.__TAURI_INTERNALS__.invoke('close_app'),100);true`);
      controls.close();browser.close();await until(()=>child.exitCode!==null);
    } finally { controls?.close();browser?.close();if(child?.exitCode===null)child.kill(); }
    await sleep(1000);
  }
  const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
  const summary={label,sourceSha256,system:os.release(),runs:runs.length,startupMedianMs:quantile(runs.map(r=>r.startupMs),.5),moveP95Ms:quantile(runs.flatMap(r=>r.move),.95),resizeP95Ms:quantile(runs.flatMap(r=>r.resize),.95),previewP95Ms:quantile(runs.flatMap(r=>r.previews.map(p=>p.ms)),.95),previewCalls:runs.map(r=>r.previews.length),hostGdiDelta:runs.map(r=>r.after.hostGdi-r.before.hostGdi),hostThreadsDelta:runs.map(r=>r.after.hostThreads-r.before.hostThreads),treeWorkingSet:runs.map(r=>r.after.treeWorkingSet)};
  await writeFile(path.join(root,'report.json'),JSON.stringify({summary,runs},null,2));
  console.log(JSON.stringify(summary,null,2));console.log(`Artifacts: ${root}`);
} finally {fixture.close()}
