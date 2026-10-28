export class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer); this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')); }
      this.pending.clear();
    });
  }
  static async connect(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(t => t.type === 'page');
    if (!target) throw new Error('No page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    return new CDP(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  invoke(command, args = {}) {
    return this.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
  }
  close() { this.socket.close(); }
}

