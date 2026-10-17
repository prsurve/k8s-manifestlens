export const THEME_KEY = 'manifestlens-theme';

export type Theme = 'light' | 'dark';

/** The theme in effect: the saved choice if there is one, otherwise the system's. */
export function effectiveTheme(root: HTMLElement, systemDark: boolean): Theme {
  const chosen = root.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return systemDark ? 'dark' : 'light';
}

/**
 * Wire up the light/dark button. The saved choice is applied before first paint by
 * public/theme-init.js; this handles clicks, the button's label, and saving.
 */
export function initTheme(
  button: HTMLElement,
  root: HTMLElement = document.documentElement,
  media: MediaQueryList = window.matchMedia('(prefers-color-scheme: dark)'),
  storage: () => Storage = () => localStorage,
): void {
  const current = (): Theme => effectiveTheme(root, media.matches);
  const label = (): void => {
    const next = current() === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
  };

  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      storage().setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private windows); the choice then lasts until the page closes.
    }
    label();
  });
  media.addEventListener('change', label);
  label();
}
