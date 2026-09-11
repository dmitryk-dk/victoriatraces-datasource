const path = require('path');
const { grafanaESModules, nodeModulesToTransform } = require('./jest/utils');

module.exports = {
  moduleNameMapper: {
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    'react-inlinesvg': path.resolve(__dirname, 'jest', 'mocks', 'react-inlinesvg.tsx'),
    '@openfeature/web-sdk': path.resolve(__dirname, 'jest', 'mocks', 'openfeature.js'),
    '@openfeature/react-sdk': path.resolve(__dirname, 'jest', 'mocks', 'openfeature-react.js'),
  },
  modulePaths: ['<rootDir>/src'],
  // The Docker frontend build keeps its own node_modules in the repo. Without
  // this, jest sees two copies of every package and fails on duplicate module
  // names.
  modulePathIgnorePatterns: ['<rootDir>/.docker-node_modules'],
  setupFilesAfterEnv: ['<rootDir>/.config/jest-setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{spec,test,jest}.{js,jsx,ts,tsx}',
  ],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        sourceMaps: 'inline',
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: true,
            decorators: false,
            dynamicImport: true,
          },
        },
      },
    ],
  },
  transformIgnorePatterns: [],
};
