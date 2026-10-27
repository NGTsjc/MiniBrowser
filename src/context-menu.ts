import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './context-menu.css';

const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const items = [
  { action: 'settings', label: '设置', icon: icon('<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/>'), hint: '' },
  { action: 'refresh', label: '刷新', icon: icon('<path d="M20 7v5h-5M19.4 12a7.5 7.5 0 1 1-2.1-5.3L20 9"/>'), hint: '' },
  { action: 'hide', label: '隐藏', icon: icon('<path d="M3 3l18 18M10.6 5.2 12 5c5.5 0 9 7 9 7a18 18 0 0 1-3.1 3.9M6.2 6.3A20 20 0 0 0 3 12s3.5 7 9 7a10 10 0 0 0 4-.9M10 10a3 3 0 0 0 4 4"/>'), hint: '' },
  { action: 'close', label: '关闭', icon: icon('<path d="m7 7 10 10M17 7 7 17"/>'), hint: '' },
  { action: 'restore', label: '恢复窗口', icon: icon('<rect x="5" y="6" width="14" height="12" rx="2"/><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>'), hint: '位置与尺寸' },
  { action: 'restart', label: '重启', icon: icon('<path d="M4 9a8 8 0 1 1-.2 5M4 4v5h5M12 8v4l3 2"/>'), hint: '' },
  { action: 'devtools', label: '开发者工具', icon: icon('<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>'), hint: '' },
];

export function createContextMenu(host: HTMLElement, report: (error: unknown) => void) {
  const menu = document.createElement('section');
  menu.id = 'context-menu';
  menu.className = 'context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '窗口操作');
  menu.innerHTML = `<div class="menu-heading"><span>窗口操作</span><kbd>Esc</kbd></div>${items.map(item => `
    ${['close', 'restore', 'devtools'].includes(item.action) ? '<div class="menu-separator" role="separator"></div>' : ''}
    <button type="button" role="menuitem" tabindex="-1" data-action="${item.action}" class="menu-item${item.action === 'close' ? ' menu-danger' : ''}">
      <span class="menu-icon">${item.icon}</span><span class="menu-label">${item.label}</span><span class="menu-hint" data-hint="${item.action}">${item.hint}</span>
    </button>`).join('')}`;
  host.append(menu);
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
  let active = false;
  let selected = 0;
  let running = false;

  function select(index: number, focus = false) {
    selected = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => {
      button.classList.toggle('selected', selected === i);
      button.tabIndex = selected === i ? 0 : -1;
    });
    if (focus) buttons[selected].focus({ preventScroll: true });
  }
  async function perform(action: string) {
    if (!active || running) return;
    running = true;
    buttons.forEach(button => { button.disabled = true; });
    try { await invoke('context_menu_action', { action }); }
    catch (error) { report(error); }
    finally { running = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  buttons.forEach((button, i) => {
    button.addEventListener('pointerenter', () => select(i));
    button.addEventListener('click', () => void perform(items[i].action));
  });
  menu.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    switch (event.key) {
      case 'ArrowDown': select(selected + 1, true); break;
      case 'ArrowUp': select(selected - 1, true); break;
      case 'Home': select(0, true); break;
      case 'End': select(buttons.length - 1, true); break;
      case 'Enter': case ' ': void perform(items[selected].action); break;
      case 'Tab': case 'Escape': void invoke('dismiss_context_menu').catch(report); break;
    }
  }, true);
  return {
    async initialize() {
      await listen<string | null>('context-menu-open', (event) => {
        active = true;
        running = false;
        buttons.forEach(button => { button.disabled = false; });
        menu.querySelector<HTMLElement>('[data-hint=hide]')!.textContent = event.payload ?? '';
        menu.hidden = false;
        document.body.classList.add('context-menu-open');
        select(0);
        // Keep keyboard navigation ready without drawing a focus ring on open.
        menu.tabIndex = -1;
        menu.focus({ preventScroll: true });
      });
      await listen('context-menu-close', () => {
        active = false;
        menu.hidden = true;
        document.body.classList.remove('context-menu-open');
      });
    },
  };
}
