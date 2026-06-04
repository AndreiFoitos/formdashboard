module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    // babel-preset-expo auto-adds react-native-worklets/plugin (Reanimated 4)
    // when the package is installed, so no manual plugin entry is needed.
  };
};