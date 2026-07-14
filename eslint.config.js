'use strict';

const js = require('@eslint/js');

/** Extension code and build scripts run in different worlds; lint them as such. */
module.exports = [
  { ignores: ['dist/**', '.cache/**', 'node_modules/**', 'data/**'] },

  // The extension itself: browser globals + the WebExtension API.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        chrome: 'readonly',
        browser: 'readonly',
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        MutationObserver: 'readonly',
        NodeFilter: 'readonly',
        Node: 'readonly',
        requestIdleCallback: 'readonly',
        requestAnimationFrame: 'readonly',
        module: 'writable',
        globalThis: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules },
  },

  // Build scripts and tests: Node.
  {
    files: ['scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: { ...js.configs.recommended.rules },
  },
];
