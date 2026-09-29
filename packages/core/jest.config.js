/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@rojanda/types$": "<rootDir>/../types/src/index.ts",
    "^@rojanda/api$": "<rootDir>/../api/src/index.ts",
  },
  testMatch: ["<rootDir>/src/**/*.test.ts"],
};
