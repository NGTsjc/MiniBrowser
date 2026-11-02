import { t, h } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { bindToolbar, renderDragShape } from './gear';
import { bindPositionSelect } from './position-select';
import './position-select.css';
import { createContextMenu } from './context-menu';
import type { Settings, Snapshot, DragShape, ApplyOutcome, DragPosition } from './types';
import { bindThemeEditor, initializeTheme } from './theme';
import './style.css';
import { LatestPreview } from './preview';
import { parameters, initializeParameters } from './parameters';

initializeParameters();

initializeTheme();

const app = document.querySelector<HTMLDivElement>('#app')!;
const view = new URLSearchParams(location.search).get('view');

if (view !== 'controls') {
  document.body.classList.add('guide');
  app.innerHTML = `<main class="welcome"><div class="brand-mark">m<span>↗</span></div><div class="eyebrow">MINIBROWSER</div><h1>${h('guide.title')}</h1><p>${h('guide.intro')}</p><div class="guide-card"><span>01</span><p>${h('guide.menu')}<br><small>${h('guide.context')}</small></p></div><div class="guide-card"><span>02</span><p>${h('guide.resize')}<br><small>${h('guide.recover')}</small></p></div><footer>${h('guide.footer')}</footer></main>`;
} else {
  app.innerHTML = `
    <div id="toolbar" class="toolbar" title="${h('toolbar.hint')}" aria-label="${h('toolbar.label')}">
      <span class="drag-grip" aria-hidden="true">⠿</span>
    </div>
    <section id="panel" class="panel" hidden aria-label="${h('settings.title')}">
      <header><div><div class="eyebrow">MINIBROWSER</div><h1>${h('settings.title')}</h1></div><span class="session-badge"><i></i> ${h('settings.session')}</span></header>
      <form id="settings-form">
        <div class="scroll-area">
          <div id="notice" class="notice" role="status" hidden></div>
          <label class="field-label" for="url">${h('settings.url')}</label>
          <input id="url" type="text" inputmode="url" spellcheck="false" placeholder="${h('settings.urlPlaceholder')}" autocomplete="off" />
          <p class="hint">${h('settings.urlHint')}</p>
          <div class="divider"></div>
          <label class="setting-row" for="topmost"><span><strong>${h('settings.topmost')}</strong><small>${h('settings.topmostHint')}</small></span><input id="topmost" type="checkbox" class="switch" /></label>
          <label class="setting-row" for="pause-media"><span><strong>${h('settings.pause')}</strong><small>${h('settings.pauseHint')}</small></span><input id="pause-media" type="checkbox" class="switch" /></label>
          <div class="slider-heading"><label class="field-label" for="opacity">${h('settings.opacity')}</label><output id="opacity-value">100%</output></div>
          <input id="opacity" type="range" min="${parameters.limits.minOpacity * 100}" max="${parameters.limits.maxOpacity * 100}" step="1" value="${parameters.defaults.opacity * 100}" />
          <div class="range-labels"><span>${h('settings.transparent')}</span><span>${h('settings.opaque')}</span></div>
          <div class="slider-heading"><label class="field-label" for="corner-radius">${h('settings.radius')}</label><output id="corner-radius-value">0 px</output></div>
          <input id="corner-radius" type="range" min="${parameters.limits.minCornerRadius}" max="${parameters.limits.maxCornerRadius}" step="${parameters.limits.cornerRadiusStep}" value="${parameters.defaults.cornerRadius}" />
          <div class="range-labels"><span>${h('settings.square')}</span><span>${h('settings.round')}</span></div>
          <p class="hint">${h('settings.previewHint')}</p>
          <label class="field-label position-label" for="drag-position">${h('settings.dragPosition')}</label>
          <select id="drag-position">${parameters.limits.dragPositions.map(position => `<option value="${position}">${h(`positions.${position}`)}</option>`).join('')}</select>
          <div class="theme-field"><label class="field-label" for="accent-hex">${h('settings.accent')}</label>
            <div class="theme-editor"><input id="accent-picker" type="color" aria-label="${h('settings.pickColor')}" value="${parameters.defaults.accentColor}" /><input id="accent-hex" type="text" aria-label="${h('settings.colorHex')}" pattern="#[0-9A-Fa-f]{6}" required maxlength="7" spellcheck="false" autocomplete="off" value="${parameters.defaults.accentColor}" /><button id="accent-reset" type="button" class="text-button">${h('settings.reset')}</button></div>
            <div class="theme-swatches" role="group" aria-label="${h('settings.presets')}">${[parameters.defaults.accentColor, '#7C3AED', '#DB2777', '#DC2626', '#B45309', '#047857', '#000000', '#FFFFFF'].map(color => `<button type="button" class="theme-swatch" data-color="${color}" aria-label="${h('settings.accent')} ${color}" aria-pressed="false"></button>`).join('')}</div>
            <p class="hint">${h('settings.themeHint')}</p>
          </div>
          <label class="field-label shortcut-label" for="shortcut">${h('settings.shortcut')}</label>
          <div class="shortcut-row"><input id="shortcut" readonly placeholder="${h('settings.recordShortcut')}" autocomplete="off" /><button id="clear-shortcut" type="button" class="text-button">${h('settings.clear')}</button></div>
          <p class="hint">${h('settings.shortcutHint')}</p>
          <div class="divider"></div>
          <div class="actions"><button id="refresh" type="button">↻ ${h('settings.refresh')}</button><button id="clear-cache" type="button">${h('settings.clearCache')}</button><button id="close" type="button" class="danger">${h('menu.close')}</button></div>
          <div id="clear-confirm" class="confirm-box" hidden><strong>${h('settings.clearTitle')}</strong><p>${h('settings.clearBody')}</p><div><button id="clear-no" type="button">${h('settings.back')}</button><button id="clear-yes" type="button" class="danger">${h('settings.clearReload')}</button></div></div>
          <p class="footnote">${h('settings.footnote')}</p>
        </div>
        <footer class="form-footer"><span id="saving" aria-live="polite"></span><button id="cancel" title="${h('settings.cancel')}" type="button">${h('settings.cancel')}</button><button id="confirm" title="${h('settings.confirm')}" type="submit" class="primary">${h('settings.confirm')}</button></footer>
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
  const dragPosition = element<HTMLSelectElement>('drag-position');
  const positionSelect = bindPositionSelect(dragPosition, panel);
  const shortcut = element<HTMLInputElement>('shortcut');
  const notice = element<HTMLElement>('notice');
  const confirmation = element<HTMLElement>('clear-confirm');
  const themeEditor = bindThemeEditor(panel);
  let settings: Settings | null = null;
  let editedUrl = false;
  let busy = false;
  let previewEpoch = 0;
  let focusVersion = 0;
  panel.addEventListener('pointerdown', () => { focusVersion++; }, true);
  panel.addEventListener('keydown', () => { focusVersion++; }, true);
  const opacityPreview = new LatestPreview<{value:number;epoch:number}>(
    ({value,epoch}) => invoke('preview_opacity',{opacity:value,epoch}), report);
  const cornerPreview = new LatestPreview<{value:number;epoch:number}>(
    ({value,epoch}) => invoke('preview_corner_radius',{radius:value,epoch}), report);
  const positionPreview = new LatestPreview<{value:DragPosition;epoch:number}>(
    ({value,epoch}) => invoke('preview_drag_position',{position:value,epoch}), report);
  const resumePreviews = () => { opacityPreview.resume(); cornerPreview.resume(); positionPreview.resume(); };
  const flushPreviews = () => Promise.all([opacityPreview.flush(), cornerPreview.flush(), positionPreview.flush()]);
  const stopPreviews = () => Promise.all([opacityPreview.cancel(), cornerPreview.cancel(), positionPreview.cancel()]);
  async function refreshEpoch() {
    try { previewEpoch = (await invoke<Snapshot>('get_settings')).previewEpoch; } catch { /* host may be closing */ }
  }

  function report(error: unknown) {
    notice.textContent = String(error);
    notice.hidden = false;
    if (panel.hidden) void invoke('open_settings').then(() => { if (!panel.hidden) { notice.textContent = String(error); notice.hidden = false; } }).catch(() => {});
  }
  function setBusy(value: boolean, message = '') {
    busy = value;
    panel.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach(control => { control.disabled = value; });
    element<HTMLElement>('saving').textContent = message;
  }
  const contextMenu = createContextMenu(app, report);
  async function action(command: string) {
    try { await invoke(command); } catch (error) { report(error); }
  }
  function open(snapshot: Snapshot) {
    if (settings && !panel.hidden) {
      if (snapshot.warning) { notice.textContent = snapshot.warning; notice.hidden = false; }
      return;
    }
    previewEpoch = snapshot.previewEpoch;
    resumePreviews();
    settings = structuredClone(snapshot.settings);
    themeEditor.open(settings);
    editedUrl = false;
    url.value = snapshot.currentUrl;
    topmost.checked = settings.alwaysOnTop;
    pause.checked = settings.pauseMediaOnHide;
    cornerRadius.value = String(settings.cornerRadius);
    dragPosition.value = settings.dragPosition;
    positionSelect.sync();
    element<HTMLOutputElement>('corner-radius-value').value = `${cornerRadius.value} px`;
    opacity.value = String(Math.round(settings.opacity * 100));
    element<HTMLOutputElement>('opacity-value').value = `${opacity.value}%`;
    shortcut.value = settings.shortcut ?? '';
    notice.hidden = !snapshot.warning;
    notice.textContent = snapshot.warning ?? '';
    confirmation.hidden = true;
    panel.hidden = false;
    document.body.classList.add('panel-open');
    setBusy(false);
    const scheduledFocus = ++focusVersion;
    setTimeout(() => { if (!panel.hidden && focusVersion === scheduledFocus) url.focus(); }, 60);
  }
  function close() {
    positionSelect.close();
    void stopPreviews();
    themeEditor.close();
    panel.hidden = true;
    toolbar.hidden = false;
    document.body.classList.remove('panel-open');
    settings = null;
  }
  async function cancel() {
    if (busy) return;
    setBusy(true);
    await stopPreviews();
    try { await invoke('cancel_settings', {epoch:previewEpoch}); }
    catch (error) { await refreshEpoch(); resumePreviews(); setBusy(false); report(error); }
  }
  bindToolbar(toolbar, report);
  url.addEventListener('input', () => { editedUrl = true; });
  opacity.addEventListener('input', () => {
    element<HTMLOutputElement>('opacity-value').value = `${opacity.value}%`;
    if (busy || panel.hidden) return;
    opacityPreview.enqueue({value:Number(opacity.value)/100, epoch:previewEpoch});
  });
  cornerRadius.addEventListener('input', () => {
    element<HTMLOutputElement>('corner-radius-value').value = Number(cornerRadius.value) + ' px';
    if (busy || panel.hidden) return;
    cornerPreview.enqueue({value:Number(cornerRadius.value), epoch:previewEpoch});
  });
  dragPosition.addEventListener('change', () => {
    if (busy || panel.hidden) return;
    positionPreview.enqueue({value:dragPosition.value as DragPosition,epoch:previewEpoch});
  });
  shortcut.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' || event.key === 'Escape') return;
    event.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
    if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(event.key)) {
      report(t('errors.shortcutCombination'));
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
    if (busy) return;
    setBusy(true, t('settings.clearing'));
    await stopPreviews();
    try { await invoke('clear_session'); } catch (error) { await refreshEpoch(); resumePreviews(); setBusy(false); report(error); }
  });
  element('cancel').addEventListener('click', () => void cancel());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); void cancel(); }
  });
  element<HTMLFormElement>('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true, t('settings.saving'));
    await flushPreviews();
    const draft: Settings = { ...settings, startupUrl: url.value, alwaysOnTop: topmost.checked,
      opacity: Number(opacity.value) / 100, shortcut: shortcut.value || null, pauseMediaOnHide: pause.checked,
      accentColor: themeEditor.value(), cornerRadius: Number(cornerRadius.value), dragPosition: dragPosition.value as DragPosition };
    try {
      const result = await invoke<ApplyOutcome>('apply_settings', {settings:draft, urlEdited:editedUrl, epoch:previewEpoch});
      if (result.warnings.length) {
        settings = structuredClone(result.settings);
        previewEpoch = result.previewEpoch;
        editedUrl = result.navigationFailed;
        setBusy(false);
        notice.textContent = t('settings.savedWarnings', {warnings: result.warnings.join(t('common.separator'))}); notice.hidden = false;
      }
    } catch (error) { await refreshEpoch(); setBusy(false); report(error); }
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
