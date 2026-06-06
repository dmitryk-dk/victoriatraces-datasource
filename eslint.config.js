const grafanaConfig = require('@grafana/eslint-config/flat');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'plugins/**',
      'release/**',
      'dist/**',
      'coverage/**',
      '.config/**',
      '.cache/**',
      '.npm/**',
      'bin/**',
      '**/*.d.ts',
    ],
  },
  ...grafanaConfig,
  {
    // eslint-plugin-react@7 auto-detects the React version via an old
    // context API that ESLint 10 removed. Pin the version so detection
    // never runs.
    settings: {
      react: { version: '19.2' },
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      // React Compiler / React 19 strict lints. Flagged for projects that
      // have adopted the React Compiler; without it the suggested fixes are
      // either no-ops or small regressions. Re-enable once the compiler is in.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
];
