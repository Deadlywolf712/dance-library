(() => {
  'use strict';

  window.addEventListener('load', () => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Offline mode could not start:', error);
      const status = document.getElementById('app-status');
      if (status) status.textContent = 'Offline mode is unavailable in this browser session.';
    });
  });
})();
