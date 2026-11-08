/**
 * Light / dark / system. The stamp on <html> must beat the OS media query in
 * both directions, which the CSS scopes in theme.css handle.
 */

import { useEffect, useState } from 'react';
import { readStored, writeStored } from '../lib/storage';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'bvg-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];
const ICON: Record<Theme, string> = { system: '◑', light: '☀', dark: '☾' };
const LABEL: Record<Theme, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function read(): Theme {
  const stored = readStored(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      writeStored(KEY, null);
    } else {
      root.setAttribute('data-theme', theme);
      writeStored(KEY, theme);
    }
  }, [theme]);

  const next = () => setTheme((prev) => ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]!);

  return (
    <button type="button" className="theme-toggle" onClick={next} aria-label={`${LABEL[theme]}. Click to change.`} title={LABEL[theme]}>
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
