// Logger service with colored console output and history tracking

export interface LogEntry {
  timestamp: string;
  level: string;
  prefix: string;
  message: string;
  data?: unknown;
}

const LOG_COLORS: Record<string, string> = {
  DEBUG: '#888888',
  INFO: '#00a3ff',
  WARN: '#ffaa00',
  ERROR: '#ff4444',
  TX: '#00ff88',
};

class Logger {
  private prefix: string;
  private static history: LogEntry[] = [];
  private static maxHistory = 500;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  debug(message: string, data?: unknown): void {
    this.log('DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('WARN', message, data);
  }

  error(message: string, error?: unknown): void {
    this.log('ERROR', message, error);
  }

  tx(message: string, data?: unknown): void {
    this.log('TX', message, data);
  }

  private log(level: string, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      prefix: this.prefix,
      message,
      data,
    };

    // Add to history
    Logger.history.push(logEntry);
    if (Logger.history.length > Logger.maxHistory) {
      Logger.history.shift();
    }

    // Console output with colors
    const color = LOG_COLORS[level] || '#ffffff';
    const style = `color: ${color}; font-weight: bold;`;
    const timeShort = timestamp.split('T')[1].split('.')[0];

    if (data !== undefined) {
      console.log(
        `%c[${timeShort}] [${this.prefix}] ${level}: ${message}`,
        style,
        data
      );
    } else {
      console.log(`%c[${timeShort}] [${this.prefix}] ${level}: ${message}`, style);
    }

    // Update window reference
    (window as Window & { __QUANTAPOOL_LOGS__?: LogEntry[] }).__QUANTAPOOL_LOGS__ = Logger.history;
  }

  static getHistory(): LogEntry[] {
    return Logger.history;
  }

  static clear(): void {
    Logger.history = [];
    console.clear();
  }
}

// Pre-configured loggers for different modules
export const web3Logger = new Logger('WEB3');
export const contractLogger = new Logger('CONTRACT');
export const txLogger = new Logger('TX');
export const storeLogger = new Logger('STORE');
export const walletLogger = new Logger('WALLET');
export const uiLogger = new Logger('UI');

// Export Logger class for custom loggers
export { Logger };

// Initialize console helpers
console.log(
  '%c QuantaPool Testing App ',
  'background: #00a3ff; color: white; font-size: 16px; padding: 4px 8px; border-radius: 4px;'
);
console.log(
  '%c Debug: window.__QUANTAPOOL__ for stores, window.__QUANTAPOOL_LOGS__ for logs ',
  'color: #888; font-size: 12px;'
);
