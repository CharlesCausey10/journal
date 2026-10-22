const { createRequire } = require('node:module');
const toolingRequire = createRequire(
  require.resolve('./.erb/tooling/package.json'),
);

module.exports = {
  modulePathIgnorePatterns: ['<rootDir>/release/app/package.json'],
  moduleDirectories: ['node_modules', 'release/app/node_modules', 'src'],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json'],
  moduleNameMapper: {
    '\\.svg\\?react$': '<rootDir>/.erb/mocks/svgComponentMock.js',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/.erb/mocks/fileMock.js',
    '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
  },
  setupFiles: ['./.erb/scripts/check-build-exists.ts'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost/',
  },
  testPathIgnorePatterns: ['release/app/dist', '.erb/dll'],
  // Exercise the real editor and its ESM dependencies in renderer tests.
  transformIgnorePatterns: ['node_modules/(?!(@lexical|lexical|@preact)/)'],
  transform: {
    '\\.(ts|tsx|js|jsx)$': [
      toolingRequire.resolve('ts-jest'),
      {
        compiler: toolingRequire.resolve('typescript'),
        tsconfig: {
          isolatedModules: true,
          module: 'commonjs',
        },
      },
    ],
  },
};
