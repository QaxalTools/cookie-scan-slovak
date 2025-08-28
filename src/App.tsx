import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { DevLogOverlay } from "@/components/DevLogOverlay";
import { useDebugLog } from "@/hooks/use-debug-log";

const queryClient = new QueryClient();

const App = () => {
  const debugLog = useDebugLog();
  
  // Make debug log globally available for audit logging
  (window as any).debugLog = debugLog;
  
  // Show debug overlay always for debugging
  const showDebugOverlay = true;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        {showDebugOverlay && (
          <DevLogOverlay
            logs={debugLog.logs}
            isVisible={debugLog.isVisible}
            onToggle={debugLog.toggle}
            onClear={debugLog.clearLogs}
          />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
