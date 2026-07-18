'use client';

import React, { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

const noopSubscribe = () => () => {};

/** Server can't know a returning visitor's saved theme preference, so it
 *  always renders as light. useSyncExternalStore (not a setState-in-effect)
 *  is the React-sanctioned way to defer client-only values past hydration. */
function useIsMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const mounted = useIsMounted();
  const isDark = mounted && theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className={`p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-muted)] transition-colors focus-ring ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
