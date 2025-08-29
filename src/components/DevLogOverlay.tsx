import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, ChevronUp, ChevronDown, Bug } from 'lucide-react';
import { DebugLogEntry } from '@/hooks/use-debug-log';

interface DevLogOverlayProps {
  logs: DebugLogEntry[];
  isVisible: boolean;
  onToggle: () => void;
  onClear: () => void;
}

export const DevLogOverlay: React.FC<DevLogOverlayProps> = ({
  logs,
  isVisible,
  onToggle,
  onClear
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('sk-SK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'error': return 'destructive';
      case 'warn': return 'secondary';
      case 'info': return 'default';
      case 'console': return 'outline';
      default: return 'default';
    }
  };

  const errorCount = logs.filter(log => log.type === 'error').length;
  const warnCount = logs.filter(log => log.type === 'warn').length;

  // Check for audit trace_id in logs
  const auditLogs = logs.filter(log => log.traceId);
  const latestTrace = auditLogs.length > 0 ? auditLogs[auditLogs.length - 1].traceId : null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      {!isVisible && (
        <div className="space-y-2">
          {latestTrace && (
            <div className="bg-background/95 border rounded-lg p-2 text-sm backdrop-blur">
              <div className="font-mono text-xs text-muted-foreground">
                Trace: {latestTrace.slice(0, 8)}...
              </div>
            </div>
          )}
          <Button
            onClick={onToggle}
            size="sm"
            variant="outline"
            className="mb-2 bg-background/80 backdrop-blur-sm border shadow-md"
          >
            <Bug className="h-4 w-4 mr-2" />
            Debug Log
            {(errorCount > 0 || warnCount > 0) && (
              <Badge variant="destructive" className="ml-2 text-xs">
                {errorCount + warnCount}
              </Badge>
            )}
          </Button>
        </div>
      )}
      
      {isVisible && (
        <Card className="bg-background/95 backdrop-blur-sm border shadow-lg max-h-96">
          <CardHeader className="py-2 px-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bug className="h-4 w-4" />
                Debug Log ({logs.length})
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  onClick={onClear}
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  disabled={logs.length === 0}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <Button
                  onClick={onToggle}
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-80 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">
                  No logs yet
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.slice(-20).reverse().map((log) => (
                    <div
                      key={log.id}
                      className="p-2 border-b border-border/50 text-xs hover:bg-muted/50"
                    >
                      <div className="flex items-start gap-2 mb-1 flex-wrap">
                        <Badge 
                          variant={getTypeColor(log.type) as any}
                          className="text-xs px-1 py-0"
                        >
                          {log.type}
                        </Badge>
                        <span className="text-muted-foreground font-mono text-xs">
                          {formatTime(log.timestamp)}
                        </span>
                        {log.source && (
                          <span className="text-muted-foreground text-xs">
                            ({log.source})
                          </span>
                        )}
                        {log.traceId && (
                          <Badge 
                            variant="secondary" 
                            className="text-xs cursor-pointer hover:bg-secondary/80"
                            onClick={() => navigator.clipboard.writeText(log.traceId!)}
                            title="Click to copy trace ID"
                          >
                            🔍 {log.traceId.substring(0, 8)}
                          </Badge>
                        )}
                        {log.blStatusCode && (
                          <Badge 
                            variant={log.blStatusCode === 200 ? "default" : "destructive"}
                            className="text-xs"
                          >
                            BL:{log.blStatusCode}
                          </Badge>
                        )}
                        {log.blHealthStatus && (
                          <Badge 
                            variant={log.blHealthStatus === 'healthy' ? "default" : "destructive"}
                            className="text-xs"
                          >
                            {log.blHealthStatus}
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs break-words">
                        {log.message}
                      </div>
                      {log.stack && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted-foreground text-xs">
                            Stack trace
                          </summary>
                          <pre className="mt-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                            {log.stack}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};