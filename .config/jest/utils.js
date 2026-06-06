const nodeModulesToTransform = (moduleNames) => `node_modules\/(?!.*(${moduleNames.join('|')})\/.*)`;

const grafanaESModules = [
  '.+',
];

module.exports = {
  nodeModulesToTransform,
  grafanaESModules,
};
