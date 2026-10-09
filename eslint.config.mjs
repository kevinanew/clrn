import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/**', '**/.venv/**', '**/test-results/**', '**/playwright-report/**', '**/blob-report/**', '.ttyctl/**', '**/snapshots/**'] },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
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
      // TSDoc 只允许形参名；对象字段写在该形参的说明里，避免不合法的 a.b 标签。
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'tsdoc/syntax': 'error',
    },
  },
  {
    // 浏览器脚本依次内嵌同一 HTML；仅声明本文件实际引用的共享变量。
    files: ['visual/snapshot-gallery-browser.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        localeNames: 'readonly',
        displayPageName: 'readonly',
        moduleNames: 'readonly',
        syncGallerySelection: 'readonly',
      },
    },
  },
  {
    // 浏览器脚本依次内嵌同一 HTML；仅声明本文件实际引用的共享变量。
    files: ['visual/snapshot-gallery-keyboard-browser.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        byId: 'readonly',
        galleryRecords: 'readonly',
        snapshotDetailsMarkup: 'readonly',
        displayPageName: 'readonly',
        variantLabel: 'readonly',
        moduleButtons: 'readonly',
        selectedModule: 'writable',
        resetFilters: 'readonly',
      },
    },
  },
  {
    // 浏览器脚本依次内嵌同一 HTML；仅声明本文件实际引用的共享变量。
    files: ['visual/snapshot-gallery-viewer-browser.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        galleryRecords: 'readonly',
        html: 'readonly',
        localeNames: 'readonly',
        displayPageName: 'readonly',
        pageMeta: 'readonly',
        selectGalleryLink: 'readonly',
        getGalleryItems: 'readonly',
        keyboardLinks: 'writable',
        byId: 'readonly',
        rows: 'writable',
        setGalleryVariant: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // TypeScript 编译器检查类型名称；使用识别类型引用的未使用变量规则。
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // Playwright 用空解构参数声明不依赖其他 fixture，不能改成普通参数名。
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
];
