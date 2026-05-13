const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Stub Node.js built-ins that @xenova/transformers and protobufjs try to import.
// NOTE: 'buffer' is intentionally NOT stubbed — the 'buffer' npm package is a
// real JS polyfill that we need for Buffer.from() in AESEncryption and
// TransmissionService. It is polyfilled globally in index.js.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  fs: require.resolve('./metro-stubs/empty.js'),
  path: require.resolve('./metro-stubs/empty.js'),
  crypto: require.resolve('./metro-stubs/empty.js'),
  stream: require.resolve('./metro-stubs/empty.js'),
  os: require.resolve('./metro-stubs/empty.js'),
  zlib: require.resolve('./metro-stubs/empty.js'),
  http: require.resolve('./metro-stubs/empty.js'),
  https: require.resolve('./metro-stubs/empty.js'),
  net: require.resolve('./metro-stubs/empty.js'),
  tls: require.resolve('./metro-stubs/empty.js'),
  child_process: require.resolve('./metro-stubs/empty.js'),
  worker_threads: require.resolve('./metro-stubs/empty.js'),
};

module.exports = config;
