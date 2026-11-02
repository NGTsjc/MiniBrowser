export const renderText = (template: string, params: Record<string, string | number> = {}) =>
  template.replace(/\{([A-Za-z0-9_]+)\}/g, (token, key: string) => Object.hasOwn(params, key) ? String(params[key]) : token);

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
