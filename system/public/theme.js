// Theme: dark is home, light is optional. Runs in <head> before paint so there is no flash.
(function () {
  var KEY = 'pad-theme', root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f6f1' : '#121416');
    var button = document.getElementById('themeToggle');
    if (button) {
      var label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      button.setAttribute('aria-label', label); button.title = label;
      button.setAttribute('aria-pressed', String(theme === 'light'));
    }
  }
  apply(saved() === 'light' ? 'light' : 'dark');
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('themeToggle');
    apply(root.getAttribute('data-theme'));
    if (!button) return;
    button.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  });
  // Keep other open windows of the app in step.
  window.addEventListener('storage', function (event) { if (event.key === KEY) apply(event.newValue === 'light' ? 'light' : 'dark'); });
})();
