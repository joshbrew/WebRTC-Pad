(() => {
  const root = document.documentElement;
  const appearanceKey = 'pad-appearance-v1', lastDarkKey = 'pad-dark-skin';
  const defaults = [
    { id: 'classic', name: 'Classic', colorScheme: 'dark' },
    { id: 'light', name: 'Light', colorScheme: 'light' },
  ];
  const saved = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const preference = () => saved(appearanceKey) || (saved('pad-theme') === 'light' ? 'light' : saved(lastDarkKey) || 'classic');
  let themes = defaults, active = defaults[0], stylesheet, loading, revision = 0;
  let lastDark = saved(lastDarkKey) || 'classic';
  let gallery, galleryOpener, galleryThemes;

  function syncControls() {
    const light = active.colorScheme === 'light';
    const button = document.getElementById('themeToggle');
    if (button) {
      const label = light ? 'Switch to dark theme' : 'Switch to light theme';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(light));
      button.title = label;
    }
    for (const name of document.querySelectorAll('[data-appearance-name]')) name.textContent = active.name;
    if (gallery?.open) {
      if (galleryThemes !== themes) renderGallery();
      for (const card of gallery.querySelectorAll('[data-appearance-choice]')) {
        card.setAttribute('aria-pressed', String(card.dataset.appearanceChoice === active.id));
      }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--surface-page').trim() || meta.content;
  }

  function renderGallery() {
    const cards = themes.map(theme => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'appearance-card';
      card.dataset.appearanceChoice = theme.id;
      card.setAttribute('aria-label', theme.name);
      if (typeof theme.preview === 'string' && theme.preview.startsWith(`/themes/${theme.id}/`)) {
        const image = new Image();
        image.alt = '';
        image.width = 512;
        image.height = 304;
        image.decoding = 'async';
        image.src = theme.preview;
        image.addEventListener('error', () => image.remove(), { once: true });
        card.append(image);
      }
      const heading = document.createElement('span');
      heading.className = 'appearance-card-heading';
      const name = document.createElement('strong');
      name.textContent = theme.name;
      const current = document.createElement('span');
      current.className = 'appearance-current';
      current.textContent = 'Current';
      current.setAttribute('aria-hidden', 'true');
      heading.append(name, current);
      card.append(heading);
      if (theme.description) {
        const description = document.createElement('small');
        description.id = `appearance-description-${theme.id}`;
        description.textContent = theme.description;
        card.setAttribute('aria-describedby', description.id);
        card.append(description);
      }
      return card;
    });
    gallery.querySelector('.appearance-grid').replaceChildren(...cards);
    galleryThemes = themes;
  }

  function openGallery(opener) {
    if (!gallery) {
      gallery = document.createElement('dialog');
      gallery.className = 'appearance-gallery';
      gallery.setAttribute('aria-labelledby', 'appearance-title');
      gallery.innerHTML = `<div class="dialog-heading appearance-heading">
        <h3 id="appearance-title">Appearance</h3>
        <form method="dialog"><button class="button secondary appearance-close" aria-label="Close appearance" autofocus>×</button></form>
      </div><div class="appearance-grid"></div><p class="appearance-status" role="status"></p>`;
      gallery.addEventListener('click', event => {
        const card = event.target.closest('[data-appearance-choice]');
        if (!card) return;
        gallery.querySelector('.appearance-status').textContent = '';
        choose(card.dataset.appearanceChoice, true);
      });
      gallery.addEventListener('close', () => {
        if (!gallery.open) galleryOpener?.focus({ preventScroll: true });
      });
    }
    galleryOpener = opener;
    (document.fullscreenElement || document.body).append(gallery);
    gallery.querySelector('.appearance-status').textContent = '';
    gallery.showModal();
    syncControls();
  }

  function activate(theme, link, persist) {
    stylesheet?.remove();
    stylesheet = link;
    active = theme;
    root.dataset.theme = theme.colorScheme;
    root.dataset.skin = theme.id;
    if (link) link.media = 'all';
    if (theme.colorScheme === 'dark') lastDark = theme.id;
    if (persist) try {
      localStorage.setItem(appearanceKey, theme.id);
      localStorage.setItem(lastDarkKey, lastDark);
    } catch { /* The appearance still applies in this window. */ }
    syncControls();
    document.dispatchEvent(new Event('appearance-change'));
  }

  function choose(id, persist = false) {
    const theme = themes.find(item => item.id === id) || themes.find(item => item.id === 'classic');
    const request = ++revision;
    loading?.remove();
    loading = null;
    if (theme === active) { syncControls(); return; }
    if (!theme.stylesheet) { activate(theme, null, persist); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = theme.stylesheet;
    link.media = 'not all';
    loading = link;
    link.onload = () => {
      if (revision !== request) return;
      loading = null;
      activate(theme, link, persist);
    };
    link.onerror = () => {
      if (revision !== request) return;
      loading = null;
      link.remove();
      syncControls();
      if (gallery?.open) gallery.querySelector('.appearance-status').textContent = `Could not load ${theme.name}.`;
    };
    document.head.append(link);
  }

  active = defaults.find(theme => theme.id === preference()) || defaults[0];
  root.dataset.theme = active.colorScheme;
  root.dataset.skin = active.id;
  document.addEventListener('DOMContentLoaded', () => {
    syncControls();
    document.getElementById('themeToggle')?.addEventListener('click', () => choose(active.colorScheme === 'light' ? lastDark : 'light', true));
  });
  document.addEventListener('appearance-controls', syncControls);
  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-appearance-browse]');
    if (opener) openGallery(opener);
  });
  document.addEventListener('fullscreenchange', () => {
    if (gallery?.open && gallery.parentElement !== (document.fullscreenElement || document.body)) gallery.close();
  });
  window.addEventListener('storage', event => {
    if (event.key === lastDarkKey || event.key === null) lastDark = saved(lastDarkKey) || 'classic';
    if (event.key === appearanceKey || event.key === null) choose(preference());
  });
  fetch('/themes.json').then(response => response.ok ? response.json() : []).then(packs => {
    if (!Array.isArray(packs)) return;
    const valid = packs.filter(pack => pack && typeof pack.id === 'string' && typeof pack.name === 'string' && ['dark', 'light'].includes(pack.colorScheme) && typeof pack.stylesheet === 'string' && pack.stylesheet.startsWith(`/themes/${pack.id}/`));
    themes = [...valid, ...defaults.filter(theme => !valid.some(pack => pack.id === theme.id))];
    choose(preference());
  }).catch(() => {});
})();
