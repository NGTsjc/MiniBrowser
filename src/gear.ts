import { invoke } from '@tauri-apps/api/core';

export function bindToolbar(toolbar: HTMLElement, report: (error: unknown) => void) {
  // Start the native move loop on mouse-down, before the cursor moves.
  toolbar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    event.preventDefault();
    void invoke('drag_window').catch(report);
  });
  toolbar.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    void invoke('show_context_menu').catch(report);
  });
}
