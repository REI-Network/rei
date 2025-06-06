module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ],
  overrides: [
    {
      files: ['*.js'],
      rules: {
        'no-undef': 'off'
      }
    },
    {
      files: ['*.ts'],
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      rules: {
        'no-empty': 'off',
        'prefer-const': 'off',
        'no-useless-escape': 'off',
        'no-inner-declarations': 'off',
        'no-async-promise-executor': 'off',
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'off'
      }
    },
    {
      files: ['*.json'],
      parser: 'jsonc-eslint-parser',
      rules: {}
    }
  ],
  rules: {
    'prettier/prettier': 'error'
  }
};
