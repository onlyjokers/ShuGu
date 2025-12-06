module.exports = {
  apps: [
    {
      name: 'shugu-server',
      script: './apps/server/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'shugu-client',
      script: './apps/client/build/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        ORIGIN: 'https://zi7.space'
      }
    },
    {
      name: 'shugu-manager',
      script: './apps/manager/build/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        ORIGIN: 'https://zi7.space'
      }
    }
  ]
};
