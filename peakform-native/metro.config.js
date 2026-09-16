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

module.exports = withNativeWind(config, { input: './global.css' })