import { t } from './i18n';
import type { Parameters } from './types';

declare global {
  interface Window { __MINIBROWSER_PARAMETERS__?: Parameters }
}

const injected = window.__MINIBROWSER_PARAMETERS__;
if (!injected) throw new Error(t('errors.parameters'));
export const parameters: Parameters = injected;

export function initializeParameters() {
  const root = document.documentElement;
  root.style.setProperty('--default-accent', parameters.defaults.accentColor);
  root.style.setProperty('--menu-radius', `${parameters.layout.menuRadius}px`);
}
