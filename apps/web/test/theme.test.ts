// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, effectiveTheme, initTheme } from '../src/theme.js';

function setup(systemDark: boolean, saved?: string) {
  document.documentElement.removeAttribute('data-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const button = document.createElement('button');
  let listener: (() => void) | undefined;
  const media = {
    matches: systemDark,
    addEventListener: (_: string, l: () => void) => (listener = l),
  } as unknown as MediaQueryList;
  const store = new Map<string, string>();
  const storage = { setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
  initTheme(button, document.documentElement, media, () => storage);
  return {
    button,
    store,
    systemChanges: (dark: boolean) => {
      (media as { matches: boolean }).matches = dark;
      listener?.();
    },
  };
}
const theme = () => document.documentElement.getAttribute('data-theme');

describe('effectiveTheme', () => {
  it('prefers a saved choice, then the system', () => {
    const root = document.createElement('div');
    expect(effectiveTheme(root, true)).toBe('dark');
    expect(effectiveTheme(root, false)).toBe('light');
    root.setAttribute('data-theme', 'light');
    expect(effectiveTheme(root, true)).toBe('light');
    root.setAttribute('data-theme', 'nonsense');
    expect(effectiveTheme(root, true)).toBe('dark');
  });
});

describe('initTheme', () => {
  beforeEach(() => document.documentElement.removeAttribute('data-theme'));

  it('offers the opposite of the system theme and leaves the page alone until clicked', () => {
    expect(setup(false).button.getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(theme()).toBeNull();
    expect(setup(true).button.getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('switches, saves the choice and updates the label', () => {
    const { button, store } = setup(false);
    button.click();
    expect(theme()).toBe('dark');
    expect(store.get(THEME_KEY)).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme');
    expect(button.title).toBe('Switch to light theme');
    button.click();
    expect(theme()).toBe('light');
    expect(store.get(THEME_KEY)).toBe('light');
  });

  it('can override a dark system with light', () => {
    const { button } = setup(true);
    button.click();
    expect(theme()).toBe('light');
    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  it('starts from a saved choice', () => {
    const { button } = setup(false, 'dark');
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('updates the label when the system theme changes and nothing is saved', () => {
    const s = setup(false);
    s.systemChanges(true);
    expect(s.button.getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('still switches when storage is unavailable', () => {
    document.documentElement.removeAttribute('data-theme');
    const button = document.createElement('button');
    const media = { matches: false, addEventListener: vi.fn() } as unknown as MediaQueryList;
    const blocked = () => {
      throw new Error('blocked');
    };
    initTheme(button, document.documentElement, media, blocked as unknown as () => Storage);
    expect(() => button.click()).not.toThrow();
    expect(theme()).toBe('dark');
  });
});
