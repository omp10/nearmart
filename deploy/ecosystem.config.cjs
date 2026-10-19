// PM2: `pm2 start deploy/ecosystem.config.cjs --env production` from the repo root.
// With instances > 1, give the rate limiters a shared Redis store first (see backend/src/middleware/rateLimit.js).
module.exports = {
    apps: [
        {
            name: 'nearmart-api',
            cwd: './backend',
            script: 'src/server.js',
            instances: 1,
            exec_mode: 'fork',
            max_memory_restart: '512M',
            kill_timeout: 12000,
            env_production: { NODE_ENV: 'production' }
        }
    ]
};
