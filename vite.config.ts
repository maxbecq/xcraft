/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site under /xcraft/
export default defineConfig({
  base: '/xcraft/',
  // Many tests play whole minutes of game: CI machines are slower than a desktop.
  test: { testTimeout: 30_000 },
});
