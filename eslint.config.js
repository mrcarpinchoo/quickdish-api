import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "worker-configuration.d.ts",
    "src/generated/",
    ".agents/",
    ".claude/",
    ".wrangler/",
    "coverage/",
    "reports/",
    "dist/"
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.serviceworker }
  },
  {
    files: ["*.{js,ts}", "test/**/*.ts"],
    languageOptions: { globals: globals.node }
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked]
  },
  prettier
]);
