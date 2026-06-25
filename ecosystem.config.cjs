module.exports = {
  apps: [
    {
      name: 'algobot-backend',
      script: 'App.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '8080',
      },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};
