import tsconfigs from 'eslint-config-salesforce-typescript';

const configs = [
  ...tsconfigs,
  {
    rules: {
      // Allow assert style expressions. i.e. expect(true).to.be.true
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',

      'no-useless-assignment': 'off',
      // It is common for tests to stub out method.

      // Return types are defined by the source code. Allows for quick overwrites.
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Mocked out the methods that shouldn't do anything in the tests.
      '@typescript-eslint/no-empty-function': 'off',
      // Easily return a promise in a mocked method.
      '@typescript-eslint/require-await': 'off',

      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default configs;
