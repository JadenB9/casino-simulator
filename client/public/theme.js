// Runs in <head> before the first paint, from its own file: the page's CSP has no room for an
// inline script. The choice is the site's (the same on every page of j4den.com): localStorage.theme
// is "light" or "dark", light mode is data-theme="light" on <html>, and dark, the default, carries
// no attribute. With nothing saved the page follows the device. app/theme.ts keeps it current.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (err) {
    /* private windows refuse localStorage; dark is still right */
  }
})();
