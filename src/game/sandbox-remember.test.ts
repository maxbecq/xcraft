import { describe, expect, it, vi } from 'vitest';
import { rememberSandbox, sandboxRemembered } from './settings';

describe('Bac à sable options', () => {
  it('are kept for the next match, unknown ones dropped', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect([...sandboxRemembered()]).toEqual([]);
    rememberSandbox('unlimited', true);
    rememberSandbox('reveal', true);
    rememberSandbox('unlimited', false);
    store.set('xcraft.sandbox', `${store.get('xcraft.sandbox')},bogus`);
    expect([...sandboxRemembered()]).toEqual(['reveal']);
    vi.unstubAllGlobals();
  });
});
