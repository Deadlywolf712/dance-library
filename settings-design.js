(() => {
  function initializeSettingsDesign() {
    const select = document.getElementById('theme-select');
    const picks = [...document.querySelectorAll('[data-settings-theme]')];
    const current = document.getElementById('settings-current-theme');
    if (!select || !current) return;

    function reflectTheme() {
      const theme = document.body.getAttribute('data-theme') || select.value;
      const option = [...select.options].find(item => item.value === theme);
      current.textContent = option?.textContent || '';
      for (const pick of picks) {
        pick.setAttribute('aria-pressed', String(pick.dataset.settingsTheme === theme));
      }
    }

    for (const pick of picks) {
      pick.addEventListener('click', () => {
        select.value = pick.dataset.settingsTheme;
        // Keep theme persistence, contrast adjustment, and favorites in the
        // existing controller; these buttons are shortcuts to that same field.
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    const count = document.getElementById('settings-theme-count');
    if (count) count.textContent = String(select.options.length);
    new MutationObserver(reflectTheme).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    reflectTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSettingsDesign, { once: true });
  } else {
    initializeSettingsDesign();
  }
})();
