module.exports = {
  OpenFeature: {
    setProvider: () => {},
    getClient: () => ({
      getBooleanValue: () => false,
      getStringValue: () => '',
      getNumberValue: () => 0,
      getObjectValue: () => ({}),
    }),
  },
};