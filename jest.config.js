const path = require('path');
const deps = process.env.ACTIVEHTML_TEST_DEPENDENCIES || path.join(__dirname, 'node_modules');
module.exports = {
  rootDir: __dirname,
  testEnvironment: path.join(deps, 'jest-environment-jsdom'),
  testRegex: '/__tests__/.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/lib/', '/node_modules/'],
  setupFiles: [path.join(__dirname, 'src/__tests__/setup.js')],
  moduleNameMapper: {
    '\\.(css|less|sass|scss)$': path.join(deps, 'identity-obj-proxy'),
    '^@jupyter-widgets/base$': path.join(deps, '@jupyter-widgets/base/lib/index.js'),
    '^@jupyter-widgets/base-manager$': path.join(deps, '@jupyter-widgets/base-manager/lib/index.js'),
    '^@lumino/(.*)$': path.join(deps, '@lumino/$1'),
    '^@jupyterlab/services$': path.join(deps, '@jupyterlab/services/lib/index.js')
  },
  transform: {
    '^.+\\.tsx?$': [path.join(deps, 'ts-jest'), {tsconfig: {
      rootDir: process.env.ACTIVEHTML_COMPILER_ROOT || __dirname,
      target: 'es2018', module: 'commonjs', esModuleInterop: true,
      skipLibCheck: true, isolatedModules: true
    }, diagnostics: false}],
    '^.+\\.jsx?$': [path.join(deps, 'babel-jest'), {
      babelrc: false, configFile: false,
      presets: [[path.join(deps, '@babel/preset-env'), {targets: {node: 'current'}, modules: 'commonjs'}]]
    }]
  },
  transformIgnorePatterns: []
};
