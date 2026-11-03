import { invoke } from '@tauri-apps/api/core';
import english from '../assets/locales/en.json';
import { escapeHtml, renderText } from './i18n-format';

type Key = keyof typeof english;
declare global { interface Window { __MINIBROWSER_LOCALE__?: Record<string, string> } }
let messages = { ...english, ...window.__MINIBROWSER_LOCALE__ };
export const t = (key: Key, params: Record<string, string | number> = {}) => renderText(messages[key], params);
export const h = (key: Key, params: Record<string, string | number> = {}) => escapeHtml(t(key, params));
export { escapeHtml };
document.documentElement.lang = t('meta.languageTag');

export function refreshTranslations(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n as Key); });
  for (const attr of ['title', 'placeholder', 'aria-label']) {
    root.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`).forEach(node => node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`) as Key)));
  }
}
function update() {
  messages = { ...english, ...window.__MINIBROWSER_LOCALE__ };
  document.documentElement.lang = t('meta.languageTag');
  refreshTranslations();
  window.dispatchEvent(new Event('minibrowser-translated'));
}
export async function initializeLocale() {
  let receivedUpdate = false;
  window.addEventListener('minibrowser-locale', () => { receivedUpdate = true; update(); });
  const initial = await invoke<Record<string,string>>('get_locale');
  if (!receivedUpdate) { window.__MINIBROWSER_LOCALE__ = initial; update(); }
}
