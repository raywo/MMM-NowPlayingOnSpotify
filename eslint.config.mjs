import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "vendor/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.node,
        Module: "readonly",
        Log: "readonly",
        MM: "readonly",
        config: "readonly",
        moment: "readonly"
      }
    }
  },
  {
    // Loaded via getScripts(), so the class is a browser global.
    files: ["MMM-NowPlayingOnSpotify.js"],
    languageOptions: {
      globals: {
        NPOS_DomBuilder: "readonly"
      }
    }
  },
  {
    files: ["core/NPOS_DomBuilder.js"],
    languageOptions: {
      globals: {
        // Loaded via getScripts() from vendor/qrcode-generator.
        qrcode: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^NPOS_DomBuilder$" }]
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    }
  }
];
