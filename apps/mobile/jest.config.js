/**
 * Minimal jest config for pure, framework-free unit tests in the mobile app
 * (e.g. RemoteTranscriptionService, which has no React/Expo imports and takes
 * all I/O via injected deps). Uses the root ts-jest. It intentionally only
 * matches test files under src so it never loads Expo/React Native modules.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@rojanda/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@rojanda/api$": "<rootDir>/../../packages/api/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  testMatch: ["<rootDir>/src/**/*.test.ts"],
};
