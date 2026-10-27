// Runs in every document/frame. No application IPC is exposed to the page.
(() => {
  let pauseOnHide = __PAUSE_ON_HIDE__;
  const pause = () => {
    if (!pauseOnHide || !document.hidden) return;
    for (const element of document.querySelectorAll('video, audio')) element.pause();
  };
  document.addEventListener('visibilitychange', pause, true);
  document.addEventListener('play', (event) => {
    if (pauseOnHide && document.hidden && event.target instanceof HTMLMediaElement) {
      event.target.pause();
    }
  }, true);
  // Propagate only the media preference to child frames; this grants no native access.
  const update = (value) => {
    pauseOnHide = value;
    pause();
    for (const frame of document.querySelectorAll('iframe')) {
      try { frame.contentWindow.postMessage({ __miniBrowserPause: value }, '*'); } catch {}
    }
  };
  window.addEventListener('message', (event) => {
    if (event.data?.__miniBrowserPauseRequest === true && event.source) {
      event.source.postMessage({ __miniBrowserPause: pauseOnHide }, { targetOrigin: '*' });
    }
    if (event.source === window.parent && typeof event.data?.__miniBrowserPause === 'boolean') {
      update(event.data.__miniBrowserPause);
    }
  });
  if (window.parent !== window) window.parent.postMessage({ __miniBrowserPauseRequest: true }, '*');
  window.addEventListener('load', () => update(pauseOnHide));
  Object.defineProperty(window, '__miniBrowserSetPause', { value: update });
})();
