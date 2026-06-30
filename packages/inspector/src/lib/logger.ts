/** Write a single timestamped log line to stderr. */
function log(level: string, msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${level} ${msg}\n`);
}

/** Structured logger that writes timestamped lines to stderr. */
export const logger = {
  /** Log an informational message. */
  info:  (msg: string) => log('INFO ', msg),
  /** Log a warning. */
  warn:  (msg: string) => log('WARN ', msg),
  /** Log an error. */
  error: (msg: string) => log('ERROR', msg),
};

