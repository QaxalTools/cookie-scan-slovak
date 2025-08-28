// Utility for automated consent banner screenshot capture using headless browser services

export interface CaptureOptions {
  apiKey?: string;
  url: string;
  delay?: number;
  viewport?: { width: number; height: number };
  locale?: string;
}

export interface CaptureResult {
  success: boolean;
  screenshot?: string; // base64 encoded image
  error?: string;
}

// Browserless.io API wrapper for screenshot capture
export class ConsentCapture {
  private apiKey: string;
  private baseUrl = 'https://chrome.browserless.io';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async captureConsentBanner(options: CaptureOptions): Promise<CaptureResult> {
    try {
      const { url, delay = 3000, viewport = { width: 1920, height: 1080 }, locale = 'sk-SK' } = options;

      // Configure screenshot request for consent banner detection
      const requestBody = {
        url,
        options: {
          fullPage: false,
          type: 'png',
          quality: 90,
          clip: {
            x: 0,
            y: 0,
            width: viewport.width,
            height: Math.min(600, viewport.height) // Focus on top area where banners usually appear
          }
        },
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000
        },
        viewport,
        // Wait for potential consent banners to load
        waitFor: delay,
        // Set EU locale to trigger GDPR banners
        locale,
        // Inject script to scroll to top and wait for banners
        evaluate: `
          // Scroll to top to ensure banner is visible
          window.scrollTo(0, 0);
          
          // Wait a bit more for dynamic banners
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Return true when ready
          true;
        `
      };

      const response = await fetch(`${this.baseUrl}/screenshot?token=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Screenshot API error: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const dataUrl = `data:image/png;base64,${base64}`;

      return {
        success: true,
        screenshot: dataUrl
      };

    } catch (error) {
      console.error('Consent banner capture failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // Alternative: Use Puppeteer cloud service
  async captureWithPuppeteerCloud(options: CaptureOptions): Promise<CaptureResult> {
    try {
      // This would use a different service like ScrapingBee, ScrapeOwl, etc.
      // Implementation would be similar but with different API endpoints
      return { success: false, error: 'Alternative service not implemented' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}

// Factory function for creating capture instances
export function createConsentCapture(apiKey: string): ConsentCapture {
  return new ConsentCapture(apiKey);
}

// Helper to validate API key format
export function validateApiKey(apiKey: string): boolean {
  // Browserless.io keys are typically UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(apiKey) || apiKey.length > 20; // Allow other formats too
}