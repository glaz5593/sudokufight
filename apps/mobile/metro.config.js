// Expo 57 sets Metro up for the monorepo by itself (watchFolders, nodeModulesPaths): never override those.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @colyseus/sdk imports 'ws' only as a Node fallback; on the phone the platform's WebSocket is used.
// Without this the native bundle fails on Node's 'stream'.
const wsShim = path.resolve(__dirname, 'src/net/ws-shim.js');
// expo-router's native tabs draw Material icons on Android with a 948 KB font (through expo-symbols); the app
// uses neither native tabs nor SymbolView, so the font is left out (docs/PERF.md). Using either needs this
// line gone.
const MATERIAL_SYMBOLS = '@expo-google-fonts/material-symbols/400Regular';
const noMaterialSymbols = path.resolve(__dirname, 'src/theme/no-material-symbols.js');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') return { type: 'sourceFile', filePath: wsShim };
  if (moduleName === MATERIAL_SYMBOLS) return { type: 'sourceFile', filePath: noMaterialSymbols };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
