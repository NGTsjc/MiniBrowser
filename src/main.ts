import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { bindToolbar, renderDragShape } from './gear';
import { createContextMenu } from './context-menu';
import type { Settings, Snapshot, DragShape } from './types';
import { bindThemeEditor, initializeTheme } from './theme';
import './style.css';
import { parameters, initializeParameters } from './parameters';

initializeParameters();

initializeTheme();

const app = document.querySelector<HTMLDivElement>('#app')!;
const view = new URLSearchParams(location.search).get('view');

if (view !== 'controls') {
  document.body.classList.add('guide');
  app.innerHTML = `<main class="welcome"><div class="brand-mark">m<span>↗</span></div><div class="eyebrow">MINIBROWSER</div><h1>给网页，一个小空间。</h1><p>右键此引导页或左上角拖动区，选择设置并输入网址。</p><div class="guide-card"><span>01</span><p>右键左上角拖动区打开菜单<br><small>网页内右键保留网站原有操作</small></p></div><div class="guide-card"><span>02</span><p>拖动窗口边缘调整尺寸<br><small>使用托盘或快捷键找回隐藏窗口</small></p></div><footer>临时浏览会话 · 关闭后清理</footer></main>`;
} else {
  app.innerHTML = `
    <div id="toolbar" class="toolbar" title="按住移动窗口，右键打开菜单" aria-label="窗口拖动区">
      <span class="drag-grip" aria-hidden="true">⠿</span>
    </div>
    <section id="panel" class="panel" hidden aria-label="窗口设置">
      <header><div><div class="eyebrow">MINIBROWSER</div><h1>窗口设置</h1></div><span class="session-badge"><i></i> 临时会话</span></header>
      <form id="settings-form">
        <div class="scroll-area">
          <div id="notice" class="notice" role="status" hidden></div>
          <label class="field-label" for="url">网页地址</label>
          <input id="url" type="text" inputmode="url" spellcheck="false" placeholder="输入网址，如 example.com" autocomplete="off" />
          <p class="hint">确认后保存为下次启动地址</p>
          <div class="divider"></div>
          <label class="setting-row" for="topmost"><span><strong>窗口置顶</strong><small>保持在其他窗口上方</small></span><input id="topmost" type="checkbox" class="switch" /></label>
          <label class="setting-row" for="pause-media"><span><strong>隐藏时暂停媒体</strong><small>再次显示后，手动继续播放</small></span><input id="pause-media" type="checkbox" class="switch" /></label>
          <div class="slider-heading"><label class="field-label" for="opacity">不透明度</label><output id="opacity-value">100%</output></div>
          <input id="opacity" type="range" min="${parameters.limits.minOpacity * 100}" max="${parameters.limits.maxOpacity * 100}" step="1" value="${parameters.defaults.opacity * 100}" />
          <div class="range-labels"><span>更通透</span><span>完全不透明</span></div>
          <div class="slider-heading"><label class="field-label" for="corner-radius">窗口圆角</label><output id="corner-radius-value">0 px</output></div>
          <input id="corner-radius" type="range" min="${parameters.limits.minCornerRadius}" max="${parameters.limits.maxCornerRadius}" step="${parameters.limits.cornerRadiusStep}" value="${parameters.defaults.cornerRadius}" />
          <div class="range-labels"><span>直角</span><span>更圆润</span></div>
          <p class="hint">实时预览 · 确认保存，取消恢复</p>
          <div class="theme-field"><label class="field-label" for="accent-hex">主题色</label>
            <div class="theme-editor"><input id="accent-picker" type="color" aria-label="选择主题色" value="${parameters.defaults.accentColor}" /><input id="accent-hex" type="text" aria-label="主题色 HEX" pattern="#[0-9A-Fa-f]{6}" required maxlength="7" spellcheck="false" autocomplete="off" value="${parameters.defaults.accentColor}" /><button id="accent-reset" type="button" class="text-button">恢复默认</button></div>
            <div class="theme-swatches" role="group" aria-label="预设主题色">${[parameters.defaults.accentColor, '#7C3AED', '#DB2777', '#DC2626', '#B45309', '#047857', '#000000', '#FFFFFF'].map(color => `<button type="button" class="theme-swatch" data-color="${color}" aria-label="主题色 ${color}" aria-pressed="false"></button>`).join('')}</div>
            <p class="hint">浅色界面 · 仅在面板中预览，确认后应用</p>
          </div>
          <label class="field-label shortcut-label" for="shortcut">显示 / 隐藏快捷键</label>
          <div class="shortcut-row"><input id="shortcut" readonly placeholder="点击后按下组合键" autocomplete="off" /><button id="clear-shortcut" type="button" class="text-button">清除</button></div>
          <p class="hint">全局生效 · 冲突时可通过托盘恢复窗口</p>
          <div class="divider"></div>
          <div class="actions"><button id="refresh" type="button">↻ 刷新网页</button><button id="clear-cache" type="button">清空缓存</button><button id="close" type="button" class="danger">关闭</button></div>
          <div id="clear-confirm" class="confirm-box" hidden><strong>清空整个浏览会话？</strong><p>缓存、Cookie 和网站存储将被清除，你会退出登录。此操作无法撤销。</p><div><button id="clear-no" type="button">返回</button><button id="clear-yes" type="button" class="danger">清空并重新加载</button></div></div>
          <p class="footnote">应用设置保存在程序旁，网页数据在退出后清理。</p>
        </div>
        <footer class="form-footer"><span id="saving" aria-live="polite"></span><button id="cancel" type="button">取消</button><button id="confirm" type="submit" class="primary">确认</button></footer>
      </form>
    </section>`;

  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = element<HTMLElement>('panel');
  const toolbar = element<HTMLElement>('toolbar');
  const url = element<HTMLInputElement>('url');
  const topmost = element<HTMLInputElement>('topmost');
  const pause = element<HTMLInputElement>('pause-media');
  const opacity = element<HTMLInputElement>('opacity');
  const cornerRadius = element<HTMLInputElement>('corner-radius');
  const shortcut = element<HTMLInputElement>('shortcut');
  const notice = element<HTMLElement>('notice');
  const confirmation = element<HTMLElement>('clear-confirm');
  const themeEditor = bindThemeEditor(panel);
  let settings: Settings | null = null;
  let editedUrl = false;
  let busy = false;
  let pendingOpacity: Promise<unknown> = Promise.resolve();
  let opacityScheduled = false;
  let pendingCorners: Promise<unknown> = Promise.resolve();
  let cornersScheduled = false;

  function report(error: unknown) {
    notice.textContent = String(error);
    notice.hidden = false;
    if (panel.hidden) void invoke('open_settings').catch(() => {});
  }
  function setBusy(value: boolean, message = '') {
    busy = value;
    panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(control => { control.disabled = value; });
    element<HTMLElement>('saving').textContent = message;
  }
  const contextMenu = createContextMenu(app, report);
  async function action(command: string) {
    try { await invoke(command); } catch (error) { report(error); }
  }
  function open(snapshot: Snapshot) {
    settings = structuredClone(snapshot.settings);
    themeEditor.open(settings);
    editedUrl = false;
    url.value = snapshot.currentUrl;
    topmost.checked = settings.alwaysOnTop;
    pause.checked = settings.pauseMediaOnHide;
    cornerRadius.value = String(settings.cornerRadius);
    element<HTMLOutputElement>('corner-radius-value').value = `${cornerRadius.value} px`;
    opacity.value = String(Math.round(settings.opacity * 100));
    element<HTMLOutputElement>('opacity-value').value = `${opacity.value}%`;
    shortcut.value = settings.shortcut ?? '';
    notice.hidden = !snapshot.warning;
    notice.textContent = snapshot.warning ?? '';
    confirmation.hidden = true;
    panel.hidden = false;
    toolbar.hidden = true;
    document.body.classList.add('panel-open');
    setBusy(false);
    setTimeout(() => url.focus(), 60);
  }
  function close() {
    themeEditor.close();
    panel.hidden = true;
    toolbar.hidden = false;
    document.body.classList.remove('panel-open');
    settings = null;
  }
  async function cancel() {
    if (busy) return;
    setBusy(true);
    await Promise.all([pendingOpacity, pendingCorners]);
    try { await invoke('cancel_settings'); } catch (error) { setBusy(false); report(error); }
  }
  bindToolbar(toolbar, report);
  url.addEventListener('input', () => { editedUrl = true; });
  opacity.addEventListener('input', () => {
    element<HTMLOutputElement>('opacity-value').value = `${opacity.value}%`;
    if (opacityScheduled) return;
    opacityScheduled = true;
    pendingOpacity = pendingOpacity.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => {
      opacityScheduled = false;
      invoke('preview_opacity', { opacity: Number(opacity.value) / 100 }).catch(report).finally(resolve);
    })));
  });
  cornerRadius.addEventListener('input', () => {
    element<HTMLOutputElement>('corner-radius-value').value = `${cornerRadius.value} px`;
    if (cornersScheduled) return;
    cornersScheduled = true;
    pendingCorners = pendingCorners.then(() => new Promise<void>(resolve => requestAnimationFrame(() => {
      cornersScheduled = false;
      invoke('preview_corner_radius', { radius: Number(cornerRadius.value) }).catch(report).finally(resolve);
    })));
  });
  shortcut.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' || event.key === 'Escape') return;
    event.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(event.key)) {
      report('请使用 Ctrl、Alt 或 Win 加其他按键，或使用功能键。');
      return;
    }
    const keys = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
    let key = event.code;
    if (key.startsWith('Key')) key = key.slice(3);
    if (key.startsWith('Digit')) key = key.slice(5);
    keys.push(key);
    shortcut.value = keys.join('+');
  });
  element('clear-shortcut').addEventListener('click', () => { shortcut.value = ''; });
  element('refresh').addEventListener('click', () => void action('refresh_page'));
  element('close').addEventListener('click', () => void action('close_app'));
  element('clear-cache').addEventListener('click', () => { confirmation.hidden = false; });
  element('clear-no').addEventListener('click', () => { confirmation.hidden = true; });
  element('clear-yes').addEventListener('click', async () => {
    await Promise.all([pendingOpacity, pendingCorners]);
    setBusy(true, '正在清理…');
    try { await invoke('clear_session'); } catch (error) { setBusy(false); report(error); }
  });
  element('cancel').addEventListener('click', () => void cancel());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); void cancel(); }
  });
  element<HTMLFormElement>('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true, '正在保存…');
    await Promise.all([pendingOpacity, pendingCorners]);
    const draft: Settings = { ...settings, startupUrl: url.value, alwaysOnTop: topmost.checked,
      opacity: Number(opacity.value) / 100, shortcut: shortcut.value || null, pauseMediaOnHide: pause.checked,
      accentColor: themeEditor.value(), cornerRadius: Number(cornerRadius.value) };
    try { await invoke('apply_settings', { settings: draft, urlEdited: editedUrl }); }
    catch (error) { setBusy(false); report(error); }
  });

  async function initialize() {
    await contextMenu.initialize();
    await listen<DragShape>('drag-shape-changed', event => renderDragShape(toolbar, event.payload));
    const snapshot = await invoke<Snapshot>('get_settings');
    renderDragShape(toolbar, snapshot.dragShape);
    await listen<Snapshot>('settings-open', (event) => open(event.payload));
    await listen('settings-close', close);
    await listen<string>('notice', (event) => report(event.payload));
    await listen<string>('url-changed', (event) => {
      if (!panel.hidden && !editedUrl) {
        const value = event.payload;
        const target = new URL(value);
        url.value = target.protocol === 'tauri:' || target.origin === location.origin ? '' : value;
      }
    });
    await invoke('frontend_ready');
  }
  void initialize().catch(report);
}
