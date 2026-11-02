import { invoke } from '@tauri-apps/api/core';
import type { DragShape } from './types';

export function renderDragShape(toolbar: HTMLElement, shape: DragShape) {
  const scale = window.devicePixelRatio;
  const root = document.documentElement.style;
  const right = shape.position === 'topRight' || shape.position === 'bottomRight';
  const bottom = shape.position === 'bottomLeft' || shape.position === 'bottomRight';
  const horizontalSpace = (shape.edgeOffset[0] + shape.width) / scale + 8;
  const verticalSpace = (shape.edgeOffset[1] + shape.height) / scale;
  root.setProperty('--drag-header-space', `${bottom ? 0 : verticalSpace + 12}px`);
  root.setProperty('--footer-left-reserve', `${bottom && !right ? horizontalSpace : 0}px`);
  root.setProperty('--footer-right-reserve', `${bottom && right ? horizontalSpace : 0}px`);
  root.setProperty('--compact-footer-left', right ? 'max(8px, var(--panel-safe))' : `${horizontalSpace}px`);
  root.setProperty('--compact-footer-right', right ? `${horizontalSpace}px` : 'max(8px, var(--panel-safe))');
  toolbar.dataset.position = shape.position;
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
    toolbar.style.setProperty('--grip-room', `${2 * Math.min(shape.grip[0], shape.grip[1], shape.width - 1 - shape.grip[0], shape.height - 1 - shape.grip[1]) / scale}px`);
    toolbar.innerHTML = '<span class="drag-grip" aria-hidden="true">⠿</span>';
    return;
  }
  const dots = [-1, 0, 1].flatMap(y => [-1, 1].map(x =>
    `<circle cx="${x * 2.5}" cy="${y * 5}" r="1.3"/>`)).join('');
  toolbar.innerHTML = `<svg viewBox="0 0 ${shape.width} ${shape.height}" aria-hidden="true">
    <polygon class="drag-surface" points="${shape.points.map(p => p.join(',')).join(' ')}"/>
    <g class="drag-texture" transform="translate(${shape.grip.join(' ')}) scale(${window.devicePixelRatio}) rotate(${right !== bottom ? 45 : -45})">${dots}</g>
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
