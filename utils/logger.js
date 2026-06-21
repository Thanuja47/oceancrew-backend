const winston = require('winston');

// Define custom format for logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: logFormat,
  defaultMeta: { service: 'oceancrew-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          return `[${timestamp}] ${level}: ${message} ${Object.keys(meta).length && meta.service !== 'oceancrew-backend' ? JSON.stringify(meta) : ''} ${stack || ''}`;
        })
      )
    })
  ],
});

module.exports = logger;
