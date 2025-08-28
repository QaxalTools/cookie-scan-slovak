// Unified consent banner capture service with Edge Function + client fallback
import { createConsentCapture } from './consentCapture';
import type { CaptureResult } from './consentCapture';

export interface AutoCaptureResult {
  success: boolean;
  screenshot?: string;
  used: 'edge' | 'client';
  error?: string;
}

export interface EdgeFunctionResponse {
  success: boolean;
  screenshot?: string;
  error?: string;
}

// Check if Edge Function is available
export async function checkEdgeFunctionAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/functions/v1/capture-consent-banner', {
      method: 'OPTIONS',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Main auto-capture function with fallback strategy
export async function autoCaptureConsent(
  url: string,
  options?: {
    delay?: number;
    viewport?: { width: number; height: number };
    locale?: string;
  }
): Promise<AutoCaptureResult> {
  const { delay = 3000, viewport = { width: 1920, height: 1080 }, locale = 'sk-SK' } = options || {};

  // Try Edge Function first (secure, server-side)
  try {
    const response = await fetch('/functions/v1/capture-consent-banner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        delay,
        viewport,
        locale,
      }),
    });

    if (response.ok) {
      const result: EdgeFunctionResponse = await response.json();
      return {
        success: result.success,
        screenshot: result.screenshot,
        used: 'edge',
        error: result.error,
      };
    }
  } catch (error) {
    console.log('Edge Function not available, falling back to client-side capture');
  }

  // Fallback to client-side capture with localStorage API key
  const apiKey = localStorage.getItem('browserless_api_key');
  
  if (!apiKey) {
    return {
      success: false,
      used: 'client',
      error: 'Browserless API key required for client-side capture. Please enter your API key.',
    };
  }

  try {
    const captureService = createConsentCapture(apiKey);
    const result: CaptureResult = await captureService.captureConsentBanner({
      url,
      delay,
      viewport,
      locale,
    });

    return {
      success: result.success,
      screenshot: result.screenshot,
      used: 'client',
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      used: 'client',
      error: error instanceof Error ? error.message : 'Client-side capture failed',
    };
  }
}

// API key management
export function getStoredApiKey(): string | null {
  return localStorage.getItem('browserless_api_key');
}

export function setStoredApiKey(apiKey: string): void {
  localStorage.setItem('browserless_api_key', apiKey);
}

export function clearStoredApiKey(): void {
  localStorage.removeItem('browserless_api_key');
}