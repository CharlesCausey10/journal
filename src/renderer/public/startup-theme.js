// Runs synchronously before the application module and its styles load.
(function () {
  const root = document.documentElement;
  root.dataset.startupState = 'loading';
  let background = '#e6e7e3';
  try {
    const cached = JSON.parse(localStorage.getItem('journal-startup-appearance'));
    const themes = ['paper', 'stone', 'sage', 'lavender', 'midnight', 'charcoal'];
    if (cached && themes.includes(cached.theme) &&
        /^rgb\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\)$/.test(cached.background)) {
      background = cached.background;
    }
  } catch {
    // A missing or unavailable cache uses a neutral background until settings load.
  }
  root.style.setProperty('--startup-background', background);
  root.style.backgroundColor = background;
}());
