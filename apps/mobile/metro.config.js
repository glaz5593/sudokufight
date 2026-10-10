// Expo 57 sets Metro up for the monorepo by itself (watchFolders, nodeModulesPaths): never override those.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Avatars are SVG files (assets/avatars), drawn by expo-image as plain assets.
if (!config.resolver.assetExts.includes('svg')) config.resolver.assetExts.push('svg');

// @colyseus/sdk imports 'ws' only as a Node fallback; on the phone the platform's WebSocket is used.
// Without this the native bundle fails on Node's 'stream'.
const wsShim = path.resolve(__dirname, 'src/net/ws-shim.js');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') return { type: 'sourceFile', filePath: wsShim };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
