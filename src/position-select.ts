/** A themed select-only combobox. The native select remains the form/model
 * source, so programmatic changes and the settings preview queue keep working. */
export function bindPositionSelect(select: HTMLSelectElement, panel: HTMLElement) {
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = `${select.id}-trigger`; trigger.className = 'position-select-trigger';
  trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const value = document.createElement('span'); value.className = 'position-select-value';
  const arrow = document.createElement('span'); arrow.className = 'position-select-arrow'; arrow.setAttribute('aria-hidden', 'true');
  trigger.append(value, arrow);
  const popup = document.createElement('div'); popup.id = `${select.id}-popup`; popup.className = 'position-select-popup';
  popup.hidden = true; popup.setAttribute('role', 'listbox'); trigger.setAttribute('aria-controls', popup.id);
  const label = select.labels?.[0];
  if (label) {
    label.id ||= `${select.id}-label`; label.htmlFor = trigger.id;
    trigger.setAttribute('aria-labelledby', label.id); popup.setAttribute('aria-labelledby', label.id);
  }
  select.hidden = true; select.after(trigger); panel.append(popup);
  let active = 0; let typed = ''; let lastTyped = 0;
  const options = [...select.options].map((option, index) => {
    const row = document.createElement('div'); row.id = `${select.id}-option-${index}`;
    row.className = 'position-select-option'; row.setAttribute('role', 'option');
    const text = document.createElement('span'); text.textContent = option.textContent; row.title = option.textContent ?? '';
    const check = document.createElement('span'); check.className = 'position-select-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    row.append(text, check); popup.append(row);
    row.addEventListener('pointerdown', event => event.preventDefault());
    row.addEventListener('pointermove', () => activate(index));
    row.addEventListener('click', () => choose(index));
    return row;
  });
  function activate(index: number) {
    active = (index + options.length) % options.length;
    options.forEach((row, i) => row.classList.toggle('active', i === active));
    trigger.setAttribute('aria-activedescendant', options[active].id);
    const row = options[active];
    if (row.offsetTop < popup.scrollTop) popup.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > popup.scrollTop + popup.clientHeight) popup.scrollTop = row.offsetTop + row.offsetHeight - popup.clientHeight;
  }
  function close(focus = false) {
    popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
    typed = ''; if (focus && !select.disabled) trigger.focus({preventScroll: true});
  }
  function sync() {
    value.textContent = select.selectedOptions[0]?.textContent ?? ''; trigger.title = value.textContent;
    trigger.disabled = select.disabled;
    options.forEach((row, i) => row.setAttribute('aria-selected', String(i === select.selectedIndex)));
    if (select.disabled) close();
  }
  function open() {
    if (select.disabled || panel.hidden) return;
    sync(); popup.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const inset = Math.max(4, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-safe')) || 8);
    const width = Math.min(rect.width, Math.max(1, innerWidth - 2 * inset));
    popup.style.width = `${width}px`; popup.style.left = `${Math.max(inset, Math.min(rect.left, innerWidth - inset - width))}px`;
    popup.style.maxHeight = 'none';
    const wanted = Math.min(180, popup.scrollHeight);
    const below = Math.max(0, innerHeight - inset - rect.bottom - 5);
    const above = Math.max(0, rect.top - inset - 5);
    const down = below >= wanted || below >= above;
    const viewportHeight = Math.max(1, innerHeight - 2 * inset);
    const room = Math.max(below, above);
    const available = room < Math.min(32, viewportHeight) ? viewportHeight : room;
    const height = Math.max(1, Math.min(wanted, available, viewportHeight));
    popup.style.maxHeight = `${height}px`;
    const top = down ? rect.bottom + 5 : rect.top - height - 5;
    popup.style.top = `${Math.max(inset, Math.min(top, innerHeight - inset - height))}px`;
    activate(Math.max(0, select.selectedIndex));
  }
  function choose(index: number) {
    if (select.disabled) return;
    select.selectedIndex = index; select.dispatchEvent(new Event('change', {bubbles: true})); close(true);
  }
  trigger.addEventListener('click', () => popup.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); close(true); return;
    }
    if (event.key === 'Tab') { close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const wasOpen = !popup.hidden;
      if (!wasOpen) open();
      else if (event.key === 'Enter' || event.key === ' ') { choose(active); return; }
      if (event.key === 'Home') activate(0);
      else if (event.key === 'End') activate(options.length - 1);
      else if (wasOpen && event.key.startsWith('Arrow')) activate(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); const now = Date.now(); typed = now - lastTyped > 700 ? event.key : typed + event.key; lastTyped = now;
      if (popup.hidden) open();
      const match = [...select.options].findIndex(option => option.text.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()));
      if (match >= 0) activate(match);
    }
  });
  select.addEventListener('change', sync);
  document.addEventListener('pointerdown', event => {
    if (!popup.hidden && !trigger.contains(event.target as Node) && !popup.contains(event.target as Node)) close();
  }, true);
  document.addEventListener('scroll', event => { if (!popup.contains(event.target as Node)) close(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  window.addEventListener('resize', () => close()); window.addEventListener('blur', () => close());
  const observer = new MutationObserver(() => {
    sync(); if (panel.hidden || document.body.classList.contains('context-menu-open')) close();
  });
  observer.observe(select, {attributes: true, attributeFilter: ['disabled']});
  observer.observe(document.body, {attributes: true, attributeFilter: ['class']});
  sync();
  return {sync, close};
}
