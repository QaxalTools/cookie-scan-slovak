import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { chromium } from 'https://esm.sh/playwright@1.45.3';

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let traceId = crypto.randomUUID();
  let startedAt = Date.now();
  let requestData = null;
  let url = '';
  let supabase, browserlessApiKey;
  
  // Parse request body once at the start
  try {
    requestData = await req.json();
    url = requestData?.url || '';
  } catch (parseError) {
    console.error(`❌ Failed to parse request body [${traceId}]:`, parseError.message);
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'PARSE_ERROR',
      error_message: 'Invalid request format',
      data: { _error: parseError.message }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }

  if (!url) {
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'MISSING_URL',
      error_message: 'URL is required',
      data: { _error: 'URL parameter is missing' }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }

  // Initialize Supabase client
  supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Helper function to log to database
  const logToDatabase = async (level: string, message: string, data?: any) => {
    try {
      await supabase.from('audit_logs').insert({
        trace_id: traceId,
        level,
        message,
        source: 'render-and-inspect',
        data: data || null
      });
    } catch (logError) {
      console.error('Failed to log to database:', logError.message);
    }
  };

  try {
    console.log(`🚀 Starting render-and-inspect function [${traceId}]`);
    await logToDatabase('info', '🚀 Starting render-and-inspect function', { url });
    
    console.log(`📝 Analyzing URL: ${url}`);

    browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      throw new Error('BROWSERLESS_API_KEY not configured');
    }

    // Log masked token for verification
    const maskedToken = `${browserlessApiKey.substring(0, 8)}...${browserlessApiKey.substring(browserlessApiKey.length - 4)}`;
    console.log(`🔑 Using Browserless token: ${maskedToken}`);
    await logToDatabase('info', '🔑 Token verification', { masked_token: maskedToken });

    // Health check Browserless first
    console.log('🏥 Checking Browserless health...');
    let healthStatus = 'unknown';
    
    try {
      const healthResponse = await fetch(`https://production-sfo.browserless.io/json/version?token=${browserlessApiKey}`, {
        method: 'GET'
      });
      
      healthStatus = healthResponse.ok ? 'healthy' : 'unhealthy';
      
      if (healthResponse.ok) {
        console.log('✅ Browserless health check passed');
      } else {
        console.log(`⚠️ Browserless health check failed: ${healthResponse.status}`);
      }
    } catch (healthError) {
      healthStatus = 'error';
      console.log(`❌ Browserless health check error: ${healthError.message}`);
    }
    
    await logToDatabase('info', '🏥 Browserless health check', { status: healthStatus });

    // Playwright over WebSocket CDP implementation
    console.log('🌐 Starting Playwright CDP analysis...');
    
    const WSE = `wss://production-sfo.browserless.io?token=${browserlessApiKey}`;
    
    let browser;
    let browserlessData = {
      finalUrl: url,
      cookies_pre: [],
      cookies_post_accept: [],
      cookies_post_reject: [],
      storage_pre: { localStorage: {}, sessionStorage: {} },
      storage_post_accept: { localStorage: {}, sessionStorage: {} },
      storage_post_reject: { localStorage: {}, sessionStorage: {} },
      requests_pre: [],
      requests_post_accept: [],
      requests_post_reject: [],
      cmp_detected: false,
      consent_clicked: false,
      accept_clicked: false,
      reject_clicked: false,
      readyState: 'unknown',
      bl_status_code: 200,
      bl_health_status: healthStatus
    };
    
    try {
      // A) CONNECTION - Connect to Browserless over CDP
      console.log('🔗 Connecting to Browserless via CDP...');
      browser = await chromium.connectOverCDP(WSE, { timeout: 120000 });
      console.log('✅ Connected to Browserless');
      
      // B) BROWSER-LEVEL CDP SESSION (before anything else)
      console.log('🌐 Setting up browser-level CDP session...');
      const browserSession = await browser.newBrowserCDPSession();
      await browserSession.send('Target.setAutoAttach', {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
      await browserSession.send('Target.setDiscoverTargets', { discover: true });
      console.log('✅ Browser-level auto-attach enabled');
      
      // C) CONTEXT & PAGE (CDP mode - use default context)
      const [context] = browser.contexts();
      if (!context) throw new Error('No default context from CDP connection');
      
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      console.log('✅ Page and CDP session created');
      
      // Enable domains on page-level session
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      await client.send('Network.enable', {
        maxTotalBufferSize: 10_000_000,
        maxResourceBufferSize: 5_000_000,
      });
      await client.send('Page.setLifecycleEventsEnabled', { enabled: true });
      console.log('✅ CDP domains enabled');
      
      // D) LISTENERS (register before navigation)
      const requests = [];
      let isPreConsent = true;
      
      // Page-level fallback listener
      page.on('request', (r) => {
        try {
          const u = new URL(r.url());
          const qs = {};
          u.searchParams.forEach((v, k) => qs[k] = v);
          
          // Extract tracking parameters
          const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
          const trackingParams = {};
          Object.entries(qs).forEach(([key, value]) => {
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
              trackingParams[key] = value;
            }
          });
          
          requests.push({
            ts: Date.now(),
            phase: isPreConsent ? 'pre-fallback' : 'post-fallback',
            url: r.url(),
            method: r.method(),
            type: r.resourceType(),
            query: qs,
            trackingParams: trackingParams,
            isPreConsent: isPreConsent
          });
        } catch (e) {
          console.log('Page listener error:', e.message);
        }
      });
      
      // CDP Network listener
      client.on('Network.requestWillBeSent', (e) => {
        try {
          const u = new URL(e.request.url);
          const qs = {};
          u.searchParams.forEach((v, k) => qs[k] = v);
          
          // Extract tracking parameters
          const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
          const trackingParams = {};
          Object.entries(qs).forEach(([key, value]) => {
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
              trackingParams[key] = value;
            }
          });
          
          const request = {
            ts: Date.now(),
            phase: isPreConsent ? 'pre' : 'post',
            requestId: e.requestId,
            url: e.request.url,
            method: e.request.method,
            type: e.type || e.initiator?.type || 'other',
            frameId: e.frameId,
            query: qs,
            trackingParams: trackingParams,
            isPreConsent: isPreConsent
          };
          
          // Parse POST data if available
          if (e.request.postData) {
            const contentType = e.request.headers['content-type'] || '';
            request.postData = e.request.postData;
            
            if (contentType.includes('application/json')) {
              try {
                request.postDataParsed = JSON.parse(e.request.postData);
                // Extract tracking params from POST data
                if (typeof request.postDataParsed === 'object') {
                  Object.entries(request.postDataParsed).forEach(([key, value]) => {
                    if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                      trackingParams[key] = value;
                    }
                  });
                }
              } catch (err) {
                console.log('JSON parse error:', err.message);
              }
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
              try {
                const urlencoded = new URLSearchParams(e.request.postData);
                const formData = {};
                urlencoded.forEach((value, key) => {
                  formData[key] = value;
                  if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
                    trackingParams[key] = value;
                  }
                });
                request.postDataParsed = formData;
              } catch (err) {
                console.log('URLEncoded parse error:', err.message);
              }
            }
          }
          
          requests.push(request);
        } catch (err) {
          console.log('CDP listener error:', err.message);
        }
      });
      
      console.log('✅ Network listeners registered');
      
      // E) NAVIGATION (now that everything is set up)
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
        'DNT': '1',
        'Sec-GPC': '1'
      });
      
      try {
        await page.setBypassServiceWorker(true);
      } catch (e) {
        console.log('ServiceWorker bypass failed:', e.message);
      }
      
      console.log('🌐 Navigating to URL...');
      await page.goto(url, { waitUntil: 'load' });
      
      try {
        await page.waitForLoadState('networkidle');
      } catch (e) {
        console.log('Network idle timeout (expected)');
      }
      
      await page.waitForTimeout(6000);
      
      const ready = await page.evaluate(() => document.readyState);
      const finalUrl = await page.url();
      
      console.log('CDP ok', { url: finalUrl, ready });
      browserlessData.finalUrl = finalUrl;
      browserlessData.readyState = ready;
      
      // Check if we captured any network traffic
      const preCdp = requests.filter(r => r.phase === 'pre').length;
      const preFb = requests.filter(r => r.phase === 'pre-fallback').length;
      
      console.log('REQUESTS PRE', { cdp: preCdp, fallback: preFb });
      
      if (preCdp === 0 && preFb === 0) {
        console.log('NO TRAFFIC DETECTED');
        browserlessData._quality = {
          incomplete: true,
          reason: 'NETWORK_CAPTURE_EMPTY_CDP_AND_PAGE'
        };
        
        // Return early with empty data but success: true
        return new Response(JSON.stringify({
          success: true,
          trace_id: traceId,
          timestamp: Date.now(),
          data: browserlessData
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 200
        });
      }
      
      // F) COOKIES & STORAGE - Phase 1: Pre-consent
      console.log('🍪 Collecting pre-consent cookies and storage...');
      
      // Collect cookies
      const collectCookies = async (label) => {
        const cookies = [];
        
        // CDP cookies
        try {
          const cdpCookies = await client.send('Network.getAllCookies');
          if (cdpCookies.cookies) {
            cookies.push(...cdpCookies.cookies.map(c => ({
              ...c,
              expiry_days: c.expires ? Math.round((c.expires - Date.now() / 1000) / (24 * 60 * 60)) : null,
              source: 'cdp'
            })));
          }
        } catch (e) {
          console.log(`CDP cookies failed for ${label}:`, e.message);
        }
        
        // Context cookies as fallback
        try {
          const contextCookies = await context.cookies();
          cookies.push(...contextCookies.map(c => ({
            ...c,
            expiry_days: c.expires ? Math.round((c.expires - Date.now() / 1000) / (24 * 60 * 60)) : null,
            source: 'context'
          })));
        } catch (e) {
          console.log(`Context cookies failed for ${label}:`, e.message);
        }
        
        // Document.cookie fallback
        try {
          const docCookie = await page.evaluate(() => document.cookie);
          if (docCookie) {
            const docCookies = docCookie.split('; ').filter(c => c.trim()).map(c => {
              const [name, ...rest] = c.split('=');
              return {
                name: name?.trim(),
                value: rest.join('='),
                domain: window.location.hostname,
                source: 'document'
              };
            });
            cookies.push(...docCookies);
          }
        } catch (e) {
          console.log(`Document cookie failed for ${label}:`, e.message);
        }
        
        console.log(`Cookies ${label}:`, cookies.length);
        return cookies;
      };
      
      // Collect storage
      const collectStorage = async (label) => {
        const storage = { localStorage: {}, sessionStorage: {} };
        
        try {
          const runtimeStorage = await page.evaluate(() => {
            const res = { local: {}, session: {} };
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k) res.local[k] = localStorage.getItem(k);
              }
            } catch (e) {
              console.log('localStorage access failed:', e.message);
            }
            try {
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k) res.session[k] = sessionStorage.getItem(k);
              }
            } catch (e) {
              console.log('sessionStorage access failed:', e.message);
            }
            return res;
          });
          
          storage.localStorage = runtimeStorage.local || {};
          storage.sessionStorage = runtimeStorage.session || {};
        } catch (e) {
          console.log(`Storage collection failed for ${label}:`, e.message);
        }
        
        const totalItems = Object.keys(storage.localStorage).length + Object.keys(storage.sessionStorage).length;
        console.log(`Storage ${label}:`, totalItems, 'items');
        return storage;
      };
      
      // Phase 1: Pre-consent data collection
      browserlessData.cookies_pre = await collectCookies('pre-consent');
      browserlessData.storage_pre = await collectStorage('pre-consent');
      browserlessData.requests_pre = requests.filter(r => r.isPreConsent);
      
      console.log('✅ Pre-consent data collected');
      console.log('📊 Pre-consent stats:', {
        cookies: browserlessData.cookies_pre.length,
        storage: Object.keys(browserlessData.storage_pre.localStorage).length + Object.keys(browserlessData.storage_pre.sessionStorage).length,
        requests: browserlessData.requests_pre.length
      });
      
      // G) CMP DETECTION AND INTERACTION
      console.log('🔍 Detecting CMP...');
      
      const cmpDetection = await page.evaluate(() => {
        const results = {
          cmpDetected: false,
          cmpType: '',
          cmpSelectors: [],
          acceptButton: null,
          rejectButton: null
        };
        
        // Common CMP detection patterns
        const cmpChecks = [
          { name: 'CookieScript', check: () => !!window.CookieScript || !!document.querySelector('[data-cs-i18n-read-more]') },
          { name: 'Cookiebot', check: () => !!window.Cookiebot || !!document.querySelector('#CybotCookiebotDialog') },
          { name: 'OneTrust', check: () => !!window.OneTrust || !!document.querySelector('#onetrust-banner-sdk') },
          { name: 'Quantcast', check: () => !!window.__qc || !!document.querySelector('.qc-cmp-ui') },
          { name: 'TrustArc', check: () => !!window.truste || !!document.querySelector('#truste-consent-track') },
          { name: 'Didomi', check: () => !!window.Didomi || !!document.querySelector('.didomi-consent-popup') },
          { name: 'Klaro', check: () => !!window.klaro || !!document.querySelector('.klaro') },
          { name: 'Cookie Yes', check: () => !!document.querySelector('.cky-consent-container') }
        ];
        
        // Detect CMP
        for (const cmp of cmpChecks) {
          try {
            if (cmp.check()) {
              results.cmpDetected = true;
              results.cmpType = cmp.name;
              break;
            }
          } catch (e) {
            console.log(`CMP check failed for ${cmp.name}:`, e.message);
          }
        }
        
        // Generic CMP detection based on common selectors
        const genericCmpSelectors = [
          '[data-cs-i18n-read-more]',
          '#CybotCookiebotDialog',
          '#onetrust-banner-sdk',
          '.qc-cmp-ui',
          '#truste-consent-track',
          '.didomi-consent-popup',
          '.klaro',
          '.cky-consent-container',
          '[class*="cookie"][class*="banner"]',
          '[class*="consent"][class*="popup"]',
          '[id*="cookie"][id*="consent"]'
        ];
        
        for (const selector of genericCmpSelectors) {
          const element = document.querySelector(selector);
          if (element && element.offsetParent !== null) {
            results.cmpDetected = true;
            if (!results.cmpType) results.cmpType = 'Generic';
            results.cmpSelectors.push(selector);
          }
        }
        
        // Find accept/reject buttons
        if (results.cmpDetected) {
          const acceptSelectors = [
            '[data-cs-accept-all]',
            '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
            '#onetrust-accept-btn-handler',
            '.qc-cmp-button[mode="primary"]',
            '[class*="accept"]',
            '[class*="allow"]',
            '[id*="accept"]',
            'button:contains("Súhlasím")',
            'button:contains("Prijať")',
            'button:contains("Accept")',
            'button:contains("Allow")'
          ];
          
          const rejectSelectors = [
            '[data-cs-reject-all]',
            '#CybotCookiebotDialogBodyButtonDecline',
            '#onetrust-reject-all-handler',
            '.qc-cmp-button[mode="secondary"]',
            '[class*="reject"]',
            '[class*="decline"]',
            '[id*="reject"]',
            'button:contains("Odmietnuť")',
            'button:contains("Reject")',
            'button:contains("Decline")'
          ];
          
          for (const selector of acceptSelectors) {
            const button = document.querySelector(selector);
            if (button && button.offsetParent !== null) {
              results.acceptButton = selector;
              break;
            }
          }
          
          for (const selector of rejectSelectors) {
            const button = document.querySelector(selector);
            if (button && button.offsetParent !== null) {
              results.rejectButton = selector;
              break;
            }
          }
        }
        
        return results;
      });
      
      browserlessData.cmp_detected = cmpDetection.cmpDetected;
      
      console.log('🔍 CMP detection result:', {
        detected: cmpDetection.cmpDetected,
        type: cmpDetection.cmpType,
        acceptButton: !!cmpDetection.acceptButton,
        rejectButton: !!cmpDetection.rejectButton
      });
      
      // Try to click accept if CMP detected
      if (cmpDetection.cmpDetected && cmpDetection.acceptButton) {
        try {
          console.log('✅ Attempting to accept cookies...');
          
          // Switch to post-consent phase
          isPreConsent = false;
          
          await page.click(cmpDetection.acceptButton);
          await page.waitForTimeout(3000); // Wait for consent processing
          
          browserlessData.consent_clicked = true;
          browserlessData.accept_clicked = true;
          
          console.log('✅ Accept clicked successfully');
          
          // Phase 2: Post-accept data collection
          await page.waitForTimeout(3000); // Wait for tracking to fire
          
          browserlessData.cookies_post_accept = await collectCookies('post-accept');
          browserlessData.storage_post_accept = await collectStorage('post-accept');
          browserlessData.requests_post_accept = requests.filter(r => !r.isPreConsent);
          
          console.log('✅ Post-accept data collected');
          console.log('📊 Post-accept stats:', {
            cookies: browserlessData.cookies_post_accept.length,
            storage: Object.keys(browserlessData.storage_post_accept.localStorage).length + Object.keys(browserlessData.storage_post_accept.sessionStorage).length,
            requests: browserlessData.requests_post_accept.length
          });
          
        } catch (clickError) {
          console.log('❌ Failed to click accept button:', clickError.message);
        }
      }
      
      // Optional: Try reject scenario (commented out for now to keep response times reasonable)
      /*
      if (cmpDetection.cmpDetected && cmpDetection.rejectButton) {
        try {
          console.log('❌ Attempting to reject cookies...');
          
          // Reload page for clean state
          await page.reload({ waitUntil: 'load' });
          await page.waitForTimeout(3000);
          
          await page.click(cmpDetection.rejectButton);
          await page.waitForTimeout(3000);
          
          browserlessData.reject_clicked = true;
          
          // Phase 3: Post-reject data collection
          browserlessData.cookies_post_reject = await collectCookies('post-reject');
          browserlessData.storage_post_reject = await collectStorage('post-reject');
          
          console.log('✅ Post-reject data collected');
          
        } catch (rejectError) {
          console.log('❌ Failed to click reject button:', rejectError.message);
        }
      }
      */
      
      console.log('✅ Analysis completed successfully');
      
    } catch (cdpError) {
      console.error('❌ CDP analysis failed:', cdpError.message);
      browserlessData._error = cdpError.message;
      
      await logToDatabase('error', 'CDP analysis failed', {
        error: cdpError.message,
        url: url
      });
    } finally {
      // Cleanup
      if (browser) {
        try {
          await browser.close();
          console.log('🔌 Browser connection closed');
        } catch (closeError) {
          console.log('Browser close warning:', closeError.message);
        }
      }
    }
    
    // Insert audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        status: browserlessData._error ? 'error' : 'completed',
        duration_ms: Date.now() - startedAt,
        data: browserlessData
      });
    } catch (insertError) {
      console.error('Failed to insert audit run:', insertError.message);
    }
    
    console.log('✅ Analysis function completed successfully');
    await logToDatabase('info', 'Analysis completed', {
      finalUrl: browserlessData.finalUrl,
      cookiesPre: browserlessData.cookies_pre?.length,
      requestsPre: browserlessData.requests_pre?.length,
      cmpDetected: browserlessData.cmp_detected,
      consentClicked: browserlessData.consent_clicked
    });
    
    return new Response(JSON.stringify({
      success: true,
      trace_id: traceId,
      timestamp: Date.now(),
      bl_status_code: 200,
      bl_health_status: healthStatus,
      data: browserlessData
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });

  } catch (error) {
    console.error(`❌ Function error [${traceId}]:`, error.message);
    
    await logToDatabase('error', 'Function error', {
      error: error.message,
      stack: error.stack,
      url: url
    });
    
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'FUNCTION_ERROR',
      error_message: error.message,
      data: {
        _error: error.message,
        debug: {
          url: url,
          timestamp: Date.now(),
          duration_ms: Date.now() - startedAt
        }
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }
});
