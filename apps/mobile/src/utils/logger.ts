/**
 * Lightweight structured logger.
 *
 * Every log line is printed to the Metro terminal with:
 *   [LEVEL] [tag] message  {optional JSON payload}
 *
 * In production builds console.debug is stripped by the JS engine,
 * but warn/error always surface.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function format(level: Level, tag: string, message: string, data?: unknown): string {
  const prefix = `[${level.toUpperCase()}] [${tag}]`;
  if (data === undefined) return `${prefix} ${message}`;
  try {
    return `${prefix} ${message} ${JSON.stringify(data, null, 0)}`;
  } catch {
    return `${prefix} ${message} [unserializable payload]`;
  }
}

export const logger = {
  debug(tag: string, message: string, data?: unknown): void {
    console.debug(format('debug', tag, message, data));
  },
  info(tag: string, message: string, data?: unknown): void {
    console.log(format('info', tag, message, data));
  },
  warn(tag: string, message: string, data?: unknown): void {
    console.warn(format('warn', tag, message, data));
  },
  error(tag: string, message: string, data?: unknown): void {
    console.error(format('error', tag, message, data));
  },
};
