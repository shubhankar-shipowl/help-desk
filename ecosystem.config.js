module.exports = {
  apps: [
    {
      name: 'support-portal',
      script: './scripts/start-server.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      // Auto restart
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // Advanced features
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    },
    {
      name: 'email-worker',
      script: './scripts/start-email-worker.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/email-worker-error.log',
      out_file: './logs/email-worker-out.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'push-worker',
      script: './scripts/start-push-worker.sh',
      interpreter: 'bash',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/push-worker-error.log',
      out_file: './logs/push-worker-out.log',
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
}
