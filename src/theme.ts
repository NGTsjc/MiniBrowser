import type { Settings } from './types';
import { parameters } from './parameters';

export const DEFAULT_ACCENT = parameters.defaults.accentColor;
export const validAccent = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function luminance(rgb: number[]) {
  const channels = rgb.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

export function applyTheme(color: string, target: HTMLElement = document.documentElement) {
  const accent = validAccent(color) ? color.toUpperCase() : DEFAULT_ACCENT;
  const rgb = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
  const light = luminance(rgb);
  const foreground = light > .179 ? '#000000' : '#FFFFFF';
  // Darken colored text/focus indicators until they remain readable on white.
  let ink = [...rgb];
  while (luminance(ink) > .16) ink = ink.map(c => Math.floor(c * .88));
  const inkColor = `rgb(${ink.join(',')})`;
  const variables = { '--accent': accent, '--accent-contrast': foreground, '--accent-ink': inkColor,
    '--accent-border': light > .183 ? inkColor : accent,
    '--accent-soft': `rgb(${rgb.map(c => Math.round(c * .10 + 255 * .90)).join(',')})`,
    '--accent-hover': `rgb(${rgb.map(c => Math.round(c * .16 + 255 * .84)).join(',')})` };
  for (const [key, value] of Object.entries(variables)) target.style.setProperty(key, value);
}

export function initializeTheme() {
  const current = () => (window as unknown as { __MINIBROWSER_ACCENT__?: string }).__MINIBROWSER_ACCENT__ ?? DEFAULT_ACCENT;
  applyTheme(current());
  window.addEventListener('minibrowser-theme', () => applyTheme(current()));
}

export function bindThemeEditor(panel: HTMLElement) {
  const picker = panel.querySelector<HTMLInputElement>('#accent-picker')!;
  const hex = panel.querySelector<HTMLInputElement>('#accent-hex')!;
  const swatches = [...panel.querySelectorAll<HTMLButtonElement>('[data-color]')];
  const preview = (value: string) => {
    hex.setCustomValidity(validAccent(value) ? '' : '请输入 #RRGGBB 格式的颜色');
    hex.setAttribute('aria-invalid', String(!validAccent(value)));
    if (!validAccent(value)) return;
    picker.value = value;
    applyTheme(value, panel);
    swatches.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === value.toUpperCase())));
  };
  const set = (value: string) => { hex.value = value.toUpperCase(); preview(hex.value); };
  picker.addEventListener('input', () => set(picker.value));
  hex.addEventListener('input', () => preview(hex.value));
  hex.addEventListener('blur', () => { if (validAccent(hex.value)) set(hex.value); });
  swatches.forEach(button => {
    button.style.setProperty('--swatch', button.dataset.color!);
    button.addEventListener('click', () => set(button.dataset.color!));
  });
  panel.querySelector('#accent-reset')!.addEventListener('click', () => set(DEFAULT_ACCENT));
  return { open: (settings: Settings) => set(settings.accentColor), value: () => hex.value.toUpperCase(),
    close: () => { panel.removeAttribute('style'); } };
}
