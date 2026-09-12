// Local-only theme toggle so the draft can be reviewed in both themes.
  // The real site's toggle lives in the application bundle.
  document.getElementById('themeToggle').addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') === 'dark';
    if (dark) { root.removeAttribute('data-theme'); }
    else { root.setAttribute('data-theme', 'dark'); }
  });
