import assert from 'node:assert/strict';

export async function checkNewPages({ browser, controls, native, until, sleep, passed, fixtureUrl }) {
  const originalUrl = await browser.evaluate('location.href');
  const original = await controls.invoke('get_settings');
  assert.equal(original.warning, null);
  const assertSingleBrowser = async () => {
    const windows = await native();
    assert.equal(Object.keys(windows).filter(title => title.startsWith('MiniBrowser')).length, 2);
    const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    assert.equal(targets.filter(target => target.type === 'page').length, 1);
  };
  const assertNavigated = async (url) => {
    await until(() => browser.evaluate(`location.href === ${JSON.stringify(url)} && !!document.getElementById('audio')`));
    assert.equal((await controls.invoke('get_settings')).settings.startupUrl, original.settings.startupUrl);
    assert.equal((await controls.invoke('get_settings')).warning, null);
    assert.equal(await controls.evaluate(`document.getElementById('panel').hidden`), true);
    assert.match(await browser.evaluate('document.cookie'), /session=private/);
    assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), 'value');
  };
  for (const kind of ['blank-link', 'ctrl-link', 'middle-link', 'script', 'named-first', 'named-second']) {
    console.log(`Checking new-page ${kind}`);
    const url = `${fixtureUrl}popup-${kind}`;
    if (['blank-link', 'ctrl-link', 'middle-link'].includes(kind)) {
      await browser.evaluate(`(()=>{
        const link=document.createElement('a');link.id='popup-link';link.href=${JSON.stringify(url)};
        link.textContent='Open destination';link.target=${kind === 'blank-link' ? "'_blank'" : "'_self'"};
        Object.assign(link.style,{position:'fixed',left:'120px',top:'100px',width:'180px',height:'40px',zIndex:'100'});
        document.body.append(link);
      })()`);
      const point = await browser.evaluate(`(()=>{const r=document.getElementById('popup-link').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      const modifiers = kind === 'ctrl-link' ? 2 : 0;
      const button = kind === 'middle-link' ? 'middle' : 'left';
      if (kind === 'ctrl-link' || kind === 'middle-link') {
        await native(kind === 'ctrl-link' ? 'ctrlClickPage' : 'middleClickPage', point);
      } else {
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, modifiers, clickCount: 1 });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, modifiers, clickCount: 1 });
      }
    } else {
      await browser.evaluate(`window.open(${JSON.stringify(url)}, ${kind.startsWith('named') ? "'reused-destination'" : "'_blank'"});true`);
    }
    await assertNavigated(url);
    await assertSingleBrowser();
  }
  passed('new-tab links, Ctrl/middle clicks, scripts and named windows navigate the single browser without notices');

  const frameDestination = `${fixtureUrl}popup-iframe`;
  await browser.evaluate(`(async()=>{
    const frame=document.querySelector('iframe');
    Object.assign(frame.style,{position:'fixed',left:'80px',top:'80px',width:'300px',height:'150px',zIndex:'100'});
    await new Promise(resolve=>{frame.onload=resolve;frame.src='http://localhost:18765/popup-frame'});
  })()`);
  const point = await browser.evaluate(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await native('clickPage', point);
  await assertNavigated(frameDestination);
  await assertSingleBrowser();
  const currentUrl = await browser.evaluate('location.href');
  await browser.evaluate(`(async()=>{
    const frame=document.querySelector('iframe');
    await new Promise(resolve=>{frame.onload=resolve;frame.src='http://localhost:18765/frame?internal-navigation=1'});
    const button=document.createElement('button');button.id='site-tab';button.onclick=()=>button.dataset.active='true';document.body.append(button);
    button.click(); window.focus();
  })()`);
  assert.equal(await browser.evaluate('location.href'), currentUrl);
  assert.equal(await browser.evaluate(`document.getElementById('site-tab').dataset.active`), 'true');
  passed('cross-origin iframe popups use the main browser while frame navigation and in-page tabs stay local');

  await controls.invoke('open_settings');
  const urlOne = `${fixtureUrl}popup-settings-current`;
  await browser.evaluate(`window.open(${JSON.stringify(urlOne)},'_blank');true`);
  await until(() => controls.evaluate(`document.getElementById('url').value === ${JSON.stringify(urlOne)}`));
  await controls.evaluate(`(()=>{const field=document.getElementById('url');field.value='https://draft-popup.example/';field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const urlTwo = `${fixtureUrl}popup-settings-draft`;
  await browser.evaluate(`window.open(${JSON.stringify(urlTwo)},'_blank');true`);
  await until(() => browser.evaluate(`location.href === ${JSON.stringify(urlTwo)}`));
  assert.equal(await controls.evaluate(`document.getElementById('url').value`), 'https://draft-popup.example/');
  assert.equal((await controls.invoke('get_settings')).settings.startupUrl, original.settings.startupUrl);
  assert.equal((await controls.invoke('get_settings')).warning, null);
  await controls.invoke('cancel_settings');
  passed('popup navigation updates actual URL without replacing the startup address or edited settings draft');

  for (const url of ['about:blank', 'mailto:fixture@example.com', 'file:///C:/MiniBrowser-test', 'data:text/html,blocked']) {
    await browser.evaluate(`window.open(${JSON.stringify(url)},'_blank');true`);
    await sleep(200);
    assert.equal(await browser.evaluate('location.href'), urlTwo);
    await assertSingleBrowser();
  }
  await browser.evaluate(`window.__popupBlob=URL.createObjectURL(new Blob(['<h1>Blocked blob</h1>'],{type:'text/html'}));window.open(window.__popupBlob,'_blank');true`);
  await sleep(200);
  assert.equal(await browser.evaluate('location.href'), urlTwo);
  await assertSingleBrowser();
  await browser.evaluate(`URL.revokeObjectURL(window.__popupBlob)`);
  // Clear rejection notices through the existing trusted settings flow.
  await controls.invoke('apply_settings', { settings: original.settings, urlEdited: false });
  await browser.send('Page.navigate', { url: originalUrl });
  await until(() => browser.evaluate(`location.href === ${JSON.stringify(originalUrl)} && !!document.getElementById('audio')`));
  assert.match(await browser.evaluate('document.cookie'), /session=private/);
  assert.equal(await browser.evaluate(`localStorage.getItem('secret')`), 'value');
  passed('unsupported and blank popups create no additional page and never navigate away');
}
