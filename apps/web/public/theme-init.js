// Runs before the page paints, so a saved light or dark choice never flashes the other theme.
// It is a separate file because the Content-Security-Policy does not allow inline scripts.
try {
  const saved = localStorage.getItem('manifestlens-theme');
  if (saved === 'light' || saved === 'dark')
    document.documentElement.setAttribute('data-theme', saved);
} catch {
  // Storage can be unavailable (private windows); the page then follows the system theme.
}
