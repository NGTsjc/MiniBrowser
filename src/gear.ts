import { invoke } from '@tauri-apps/api/core';
import type { DragShape } from './types';

export function renderDragShape(toolbar: HTMLElement, shape: DragShape) {
  const scale = window.devicePixelRatio;
  const root = document.documentElement.style;
  root.setProperty('--drag-left', `${shape.x / scale}px`);
  root.setProperty('--drag-top', `${shape.y / scale}px`);
  root.setProperty('--drag-width', `${shape.width / scale}px`);
  root.setProperty('--drag-height', `${shape.height / scale}px`);
  root.setProperty('--drag-bottom', `${(shape.y + shape.height) / scale}px`);
  root.setProperty('--panel-safe', `${shape.panelInset / scale}px`);
  toolbar.style.clipPath = shape.arc
    ? `polygon(${shape.points.map(([x, y]) => `${x / shape.width * 100}% ${y / shape.height * 100}%`).join(',')})`
    : '';
  toolbar.classList.toggle('arc', shape.arc);
  toolbar.dataset.arc = String(shape.arc);
  if (!shape.arc) {
    toolbar.style.setProperty('--grip-x', `${shape.grip[0] / scale}px`);
    toolbar.style.setProperty('--grip-y', `${shape.grip[1] / scale}px`);
    toolbar.style.setProperty('--grip-room', `${2 * Math.min(shape.width - shape.grip[0], shape.height - shape.grip[1]) / scale}px`);
    toolbar.innerHTML = '<span class="drag-grip" aria-hidden="true">⠿</span>';
    return;
  }
  const dots = [-1, 0, 1].flatMap(y => [-1, 1].map(x =>
    `<circle cx="${x * 2.5}" cy="${y * 5}" r="1.3"/>`)).join('');
  toolbar.innerHTML = `<svg viewBox="0 0 ${shape.width} ${shape.height}" aria-hidden="true">
    <polygon class="drag-surface" points="${shape.points.map(p => p.join(',')).join(' ')}"/>
    <g class="drag-texture" transform="translate(${shape.grip.join(' ')}) scale(${window.devicePixelRatio}) rotate(-45)">${dots}</g>
  </svg>`;
}

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
