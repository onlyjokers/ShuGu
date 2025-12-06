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
        // Assuming the client needs to know the public URL of the server for some reason, 
        // though it mostly determines it client-side.
        // We can expose it if needed.
        origin: 'http://localhost:3000'
      }
    }
  ]
};
