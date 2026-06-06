const React = require('react');

module.exports = {
  OpenFeatureProvider: ({ children }) => children,
  OpenFeatureTestProvider: ({ children }) => children,
  useFlag: () => ({ value: false }),
  useBooleanFlagValue: () => false,
  useBooleanFlagDetails: () => ({ value: false }),
  useStringFlagValue: () => '',
  useStringFlagDetails: () => ({ value: '' }),
  useNumberFlagValue: () => 0,
  useNumberFlagDetails: () => ({ value: 0 }),
  useObjectFlagValue: () => ({}),
  useObjectFlagDetails: () => ({ value: {} }),
};