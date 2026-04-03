// .eslintrc.js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    "next/core-web-vitals",
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // TypeScript
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    // Allow require() — used intentionally for capability-gated lazy imports
    // (e.g. loading @prisma/client, bullmq, nodemailer only when configured)
    "@typescript-eslint/no-require-imports": "off",
    "@typescript-eslint/no-var-requires": "off",

    // Safety
    "no-console": ["warn", { allow: ["log", "warn", "error", "info"] }],
    "no-eval":    "error",
    "no-implied-eval": "error",

    // Style
    "prefer-const":    "error",
    "no-var":          "error",
    "eqeqeq":          ["error", "always"],
    "no-throw-literal":"error",
  },
  overrides: [
    {
      // Relax rules for test files
      files: ["src/__tests__/**/*.ts", "**/*.test.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      // Relax rules for worker files (they use console.log intentionally)
      files: ["src/workers/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      // Seed files
      files: ["prisma/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
  ],
  ignorePatterns: [
    "node_modules/",
    ".next/",
    "out/",
    "coverage/",
    "*.js",
    "!.eslintrc.js",
    "!next.config.js",
  ],
};
