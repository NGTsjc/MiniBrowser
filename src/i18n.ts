import english from '../assets/locales/en.json';
import { escapeHtml, renderText } from './i18n-format';

type Key = keyof typeof english;
declare global { interface Window { __MINIBROWSER_LOCALE__?: Record<string, string> } }
const messages = { ...english, ...window.__MINIBROWSER_LOCALE__ };
export const t = (key: Key, params: Record<string, string | number> = {}) => renderText(messages[key], params);
export const h = (key: Key, params: Record<string, string | number> = {}) => escapeHtml(t(key, params));
export { escapeHtml };
document.documentElement.lang = t('meta.languageTag');
