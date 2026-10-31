// Runs before the page paints, so a saved light or dark choice never flashes the other theme.
// It is a separate file because the Content-Security-Policy does not allow inline scripts.
// With no saved choice the page opens dark, the look it is designed around.
try {
  const saved = localStorage.getItem('manifestlens-theme');
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
} catch {
  document.documentElement.setAttribute('data-theme', 'dark');
}
