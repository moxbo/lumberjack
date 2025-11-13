const { defineConfig, globalIgnores } = require("eslint/config");

const tsParser = require("@typescript-eslint/parser");
const globals = require("globals");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const prettier = require("eslint-plugin-prettier");
const js = require("@eslint/js");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/release/",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.js",
    "**/forge.config.js",
    "**/vite.config.mjs",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },

        project: "./tsconfig.json",
      },

      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    extends: compat.extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "prettier",
    ),

    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
    },

    rules: {
      "prettier/prettier": "error",

      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],

      "@typescript-eslint/no-explicit-any": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      "no-console": [
        "warn",
        {
          allow: ["warn", "error"],
        },
      ],
    },
  },
  {
    files: ["**/*.tsx"],
    extends: compat.extends("plugin:@typescript-eslint/recommended"),

    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);
