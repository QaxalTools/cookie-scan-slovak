import { useState, useCallback, useEffect } from 'react';

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  type: 'error' | 'warn' | 'info' | 'console';
  message: string;
  source?: string;
  stack?: string;
}

export const useDebugLog = () => {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  const addLog = useCallback((entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) => {
    const logEntry: DebugLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    
    setLogs(prev => [...prev.slice(-49), logEntry]); // Keep last 50 logs
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const toggle = useCallback(() => {
    setIsVisible(prev => !prev);
  }, []);

  // Setup global error handlers
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      addLog({
        type: 'error',
        message: event.message,
        source: event.filename,
        stack: event.error?.stack
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addLog({
        type: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        source: 'Promise'
      });
    };

    // Override console methods
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    console.error = (...args) => {
      originalConsoleError(...args);
      addLog({
        type: 'error',
        message: args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '),
        source: 'console.error'
      });
    };

    console.warn = (...args) => {
      originalConsoleWarn(...args);
      addLog({
        type: 'warn',
        message: args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '),
        source: 'console.warn'
      });
    };

    console.log = (...args) => {
      originalConsoleLog(...args);
      // Only log console.log if it contains important keywords
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
      if (message.includes('🌐') || message.includes('✅') || message.includes('❌') || message.includes('performLiveAudit')) {
        addLog({
          type: 'info',
          message,
          source: 'console.log'
        });
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.log = originalConsoleLog;
    };
  }, [addLog]);

  return {
    logs,
    isVisible,
    addLog,
    clearLogs,
    toggle
  };
};