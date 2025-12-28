module.exports = {
  apps: [
    {
      name: 'shugu-server',
      script: './apps/server/dist-out/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'shugu-client',
      script: './apps/client/build-client/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'shugu-manager',
      script: './apps/manager/build-manager/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    },
    {
      name: 'shugu-display',
      script: './apps/display/build-display/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3003
      }
    }
  ]
};
