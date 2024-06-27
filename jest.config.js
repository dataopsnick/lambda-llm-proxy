/** @type {import('ts-jest').JestConfigWithTsJest} */

const awslambda = {
  streamifyResponse: (handler) => {
    return handler;
  },
  HttpResponseStream: {
    from: (stream, httpResponseMetadata) => {
      console.log("metadata", httpResponseMetadata);
      return stream
    },
  },
}

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    awslambda: awslambda
  },
  testTimeout: 120000,
  setupFiles: ['<rootDir>/setEnvVars.ts'],
};