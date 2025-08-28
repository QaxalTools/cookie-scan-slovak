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
  
  // Show debug overlay in development or if ?debug=true is in URL
  const showDebugOverlay = 
    import.meta.env.DEV || 
    new URLSearchParams(window.location.search).get('debug') === 'true';

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
