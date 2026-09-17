const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// lucide-react-native ships its barrel + per-icon files as ESM (.mjs).
// Metro's default sourceExts don't include `mjs`, so the import chain
// `lucide-react-native -> ./icons/<name>.mjs` fails to resolve. Adding
// the extension here is the one-line fix the library docs recommend.
config.resolver.sourceExts.push('mjs')

// 3D avatar models (assets/avatar/*.glb) are bundled as binary assets.
config.resolver.assetExts.push('glb')

// three's CommonJS entry (used by @react-three/fiber's `require('three')`)
// calls Node's `process.emitWarning`, which doesn't exist in React Native and
// crashes on load. Always resolve bare `three` to the ES module build instead.
const threeModule = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js')
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: threeModule }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: './global.css' })