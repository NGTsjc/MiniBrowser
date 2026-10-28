import type { Parameters } from './types';

declare global {
  interface Window { __MINIBROWSER_PARAMETERS__?: Parameters }
}

const injected = window.__MINIBROWSER_PARAMETERS__;
if (!injected) throw new Error('应用参数未加载，请重新启动应用');
export const parameters: Parameters = injected;

export function initializeParameters() {
  const root = document.documentElement;
  root.style.setProperty('--default-accent', parameters.defaults.accentColor);
  root.style.setProperty('--panel-radius', `${parameters.layout.panelRadius}px`);
  root.style.setProperty('--menu-radius', `${parameters.layout.menuRadius}px`);
}
