import { env } from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[env.LOG_LEVEL];
}

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    return `${prefix} ${message} ${typeof meta === 'object' ? JSON.stringify(meta) : String(meta)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message, meta));
  },
  info(message: string, meta?: unknown): void {
    if (shouldLog('info')) console.info(formatMessage('info', message, meta));
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, meta));
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(formatMessage('error', message, meta));
  },
};
