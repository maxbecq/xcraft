/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

// GitHub Pages serves the site under /xcraft/
export default defineConfig({
  base: '/xcraft/',
  // Shown on the title screen: version, commit and when this build was made.
  define: {
    __VERSION__: JSON.stringify(version),
    __COMMIT__: JSON.stringify(commit),
    __BUILT__: JSON.stringify(new Date().toISOString()),
  },
  // Many tests play whole minutes of game: CI machines are slower than a desktop.
  // .claude/worktrees: other sessions' checkouts, with their own tests.
  // The map editor: a second page at /xcraft/editeur/, reached by its address only (no link from the game).
  build: { rollupOptions: { input: { main: 'index.html', editeur: 'editeur/index.html' } } },
  test: { testTimeout: 30_000, exclude: ['**/node_modules/**', '.claude/**'] },
});
