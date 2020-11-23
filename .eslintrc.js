module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es6: true
  },
  extends: ['prettier/@typescript-eslint', 'plugin:prettier/recommended'],
  parserOptions: {
    ecmaVersion: 2020,
    parser: '@typescript-eslint/parser',
    sourceType: 'module'
    // ecmaFeatures: {
    //   experimentalObjectRestSpread: true
    // }
  },
  rules: {
    'no-console': 0,
    semi: [1, 'always'],
    quotes: [1, 'single', 'avoid-escape']
  }
};
