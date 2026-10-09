import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';

export default [
  { ignores: ['node_modules/**'] },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', URL: 'readonly' },
    },
    plugins: { jsdoc, tsdoc },
    rules: {
      ...js.configs.recommended.rules,
      // require-jsdoc 要求注释存在；tsdoc/syntax 再校验其遵循 TSDoc 格式。
      'jsdoc/require-jsdoc': ['error', {
        enableFixer: false,
        require: {
          FunctionDeclaration: true,
          FunctionExpression: true,
          ArrowFunctionExpression: true,
          ClassDeclaration: true,
          ClassExpression: true,
          MethodDefinition: true,
        },
      }],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/check-param-names': 'error',
      'tsdoc/syntax': 'error',
    },
  },
];
