// ESLint 配置：typescript-eslint 的严格规则加类型检查，函数复杂度和长度的上限，以及客户端的平台隔离。
// JavaScript 文件不做类型检查；测试文件不限函数长度，因为 describe 块本身就很长。
// 审查流程的脚本来自 setup-ai-review 模板，不属于项目代码，不在这里检查。
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const platformGlobals = [
  'wx',
  'WXWebAssembly',
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'fetch',
];

export default defineConfig(
  {
    ignores: [
      '**/dist/',
      '**/coverage/',
      '**/test-results/',
      '**/playwright-report/',
      '.claude/worktrees/',
      '.claude/hooks/',
      '.github/scripts/',
      'evals/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 5],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['apps/client/src/**/*.ts'],
    ignores: [
      'apps/client/src/platform/**',
      'apps/client/src/main.*.ts',
      'apps/client/src/gallery/**',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        ...platformGlobals.map((name) => ({
          name,
          message: '微信和浏览器的全局对象只能在 platform 层和入口文件里使用。',
        })),
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['apps/client/vite/*.wx.js'],
    languageOptions: { globals: { WXWebAssembly: 'readonly' } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
);
