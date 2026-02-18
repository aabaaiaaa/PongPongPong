import globals from "globals";

export default [
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        ...globals.browser,
        Peer: "readonly",
        qrcode: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { vars: "all", args: "none" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-empty": "error",
      "eqeqeq": ["error", "always"],
      "no-implicit-globals": "error",
      "semi": ["error", "always"]
    }
  }
];
