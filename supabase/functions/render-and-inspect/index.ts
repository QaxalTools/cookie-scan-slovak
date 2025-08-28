import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  const supabase = createClient(
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

    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
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

    // WebSocket CDP implementation - Direct script execution
    console.log('🌐 Starting CDP WebSocket analysis...');
    
    // Build the complete CDP analysis script
    const cdpScript = `
// CDP WebSocket Analysis Script
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize results structure
const results = {
  finalUrl: "${url}",
  cookies_pre: [],
  cookies_post_accept: [],
  cookies_post_reject: [],
  requests_pre: [],
  requests_post_accept: [],
  requests_post_reject: [],
  storage_pre: {},
  storage_post_accept: {},
  storage_post_reject: {},
  cmp_detected: false,
  cmp_cookie_name: '',
  cmp_cookie_value: '',
  consent_clicked: false,
  scenarios: { baseline: true, accept: false, reject: false }
};

// Helper: Get eTLD+1 domain
const getDomain = (urlStr) => {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\\./, '');
  } catch {
    return 'unknown';
  }
};

// Helper: Deduplicate cookies
const dedupeCookies = (cookies) => {
  const seen = new Set();
  return cookies.filter(cookie => {
    const key = \`\${cookie.name}|\${cookie.domain}|\${cookie.path || '/'}\`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Helper: Calculate expiry days
const getExpiryDays = (expires) => {
  if (!expires || expires <= 0) return null;
  const now = Date.now() / 1000;
  return Math.round((expires - now) / (24 * 60 * 60));
};

// Helper: Collect cookies (3 methods)
const collectCookies = async (page, client) => {
  const cookies = [];
  
  // Method 1: CDP Network.getAllCookies
  if (client) {
    try {
      const { cookies: cdpCookies } = await client.send('Network.getAllCookies');
      cookies.push(...cdpCookies.map(c => ({
        ...c,
        expiry_days: getExpiryDays(c.expires)
      })));
    } catch (e) {
      console.log('CDP cookies failed:', e.message);
    }
  }
  
  // Method 2: page.cookies()
  try {
    const pageCookies = await page.cookies();
    cookies.push(...pageCookies.map(c => ({
      ...c,
      expiry_days: getExpiryDays(c.expires)
    })));
  } catch (e) {
    console.log('Page cookies failed:', e.message);
  }
  
  // Method 3: document.cookie
  try {
    const docCookies = await page.evaluate(() => {
      const cookies = [];
      if (document.cookie) {
        document.cookie.split(';').forEach(cookie => {
          const [name, value] = cookie.trim().split('=');
          if (name && value) {
            cookies.push({
              name: name.trim(),
              value: value.trim(),
              domain: window.location.hostname,
              path: '/',
              secure: false,
              httpOnly: false,
              sameSite: 'Lax',
              expires: 0
            });
          }
        });
      }
      return cookies;
    });
    cookies.push(...docCookies);
  } catch (e) {
    console.log('Document cookies failed:', e.message);
  }

  return dedupeCookies(cookies);
};

// Helper: Collect storage
const collectStorage = async (page, client, origin) => {
  const storage = { localStorage: {}, sessionStorage: {} };
  
  // CDP method
  if (client) {
    try {
      const localStorage = await client.send('DOMStorage.getDOMStorageItems', {
        storageId: { securityOrigin: origin, isLocalStorage: true }
      });
      if (localStorage.entries) {
        localStorage.entries.forEach(([key, value]) => {
          storage.localStorage[key] = value;
        });
      }
    } catch (e) {
      console.log('CDP localStorage failed:', e.message);
    }
    
    try {
      const sessionStorage = await client.send('DOMStorage.getDOMStorageItems', {
        storageId: { securityOrigin: origin, isLocalStorage: false }
      });
      if (sessionStorage.entries) {
        sessionStorage.entries.forEach(([key, value]) => {
          storage.sessionStorage[key] = value;
        });
      }
    } catch (e) {
      console.log('CDP sessionStorage failed:', e.message);
    }
  }
  
  // Fallback: evaluate storage
  try {
    const evalStorage = await page.evaluate(() => {
      const ls = {}, ss = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) ls[key] = localStorage.getItem(key);
        }
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) ss[key] = sessionStorage.getItem(key);
        }
      } catch (e) {
        console.log('Storage eval error:', e.message);
      }
      return { localStorage: ls, sessionStorage: ss };
    });
    
    Object.assign(storage.localStorage, evalStorage.localStorage);
    Object.assign(storage.sessionStorage, evalStorage.sessionStorage);
  } catch (e) {
    console.log('Storage evaluate failed:', e.message);
  }
  
  return storage;
};

// Helper: Detect and handle CMP
const handleCMP = async (page) => {
  let cmpDetected = false;
  let cmpCookieName = '';
  let cmpCookieValue = '';
  
  try {
    // Look for common CMP elements and click patterns
    const cmpInfo = await page.evaluate(() => {
      const selectors = [
        // Slovak/Czech patterns
        'button[id*="accept"], button[class*="accept"]',
        'button:contains("Súhlasím"), button:contains("Prijať")',
        'button:contains("Akceptovať"), button:contains("Povoliť")',
        // English patterns  
        'button:contains("Accept"), button:contains("Allow")',
        'button:contains("Agree"), button:contains("Consent")',
        // Generic CMP patterns
        '[data-testid*="accept"], [data-cy*="accept"]',
        '.cookie-accept, .consent-accept, #cookie-accept',
        '[onclick*="accept"], [onclick*="consent"]'
      ];
      
      let foundButton = null;
      let cmpDetected = false;
      
      // Check for CMP presence indicators
      const cmpIndicators = [
        'CookieScriptConsent', 'OptanonConsent', 'euconsent-v2', 
        'CookieConsent', 'tarteaucitron', 'cookieyes-consent'
      ];
      
      // Check cookies for CMP
      cmpIndicators.forEach(indicator => {
        if (document.cookie.includes(indicator)) {
          cmpDetected = true;
        }
      });
      
      // Check DOM for CMP
      const cmpElements = document.querySelectorAll([
        '[id*="cookie"], [class*="cookie"]',
        '[id*="consent"], [class*="consent"]',
        '[id*="gdpr"], [class*="gdpr"]'
      ].join(', '));
      
      if (cmpElements.length > 0) cmpDetected = true;
      
      // Find accept button
      for (const selector of selectors) {
        try {
          if (selector.includes(':contains')) {
            const text = selector.match(/\\(["'](.+?)["']\\)/)?.[1];
            if (text) {
              const buttons = Array.from(document.querySelectorAll('button'));
              foundButton = buttons.find(btn => 
                btn.textContent && btn.textContent.toLowerCase().includes(text.toLowerCase())
              );
              if (foundButton) break;
            }
          } else {
            foundButton = document.querySelector(selector);
            if (foundButton) break;
          }
        } catch (e) {
          console.log('Selector error:', e.message);
        }
      }
      
      return { cmpDetected, foundButton: !!foundButton };
    });
    
    cmpDetected = cmpInfo.cmpDetected;
    
    if (cmpInfo.foundButton) {
      // Try to click the accept button
      try {
        await page.evaluate(() => {
          const selectors = [
            'button[id*="accept"], button[class*="accept"]',
            '.cookie-accept, .consent-accept, #cookie-accept'
          ];
          
          for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              btn.click();
              return true;
            }
          }
          
          // Text-based search
          const buttons = Array.from(document.querySelectorAll('button'));
          const acceptTexts = ['súhlasím', 'prijať', 'accept', 'allow', 'agree'];
          
          for (const btn of buttons) {
            if (btn.textContent && acceptTexts.some(text => 
              btn.textContent.toLowerCase().includes(text)
            )) {
              btn.click();
              return true;
            }
          }
          
          return false;
        });
        
        console.log('CMP accept button clicked');
      } catch (e) {
        console.log('CMP click failed:', e.message);
      }
    }
    
  } catch (e) {
    console.log('CMP detection failed:', e.message);
  }
  
  return { cmpDetected, cmpCookieName, cmpCookieValue };
};

// Main execution
export default async ({ page, context }) => {
  console.log('🔍 Starting CDP WebSocket analysis for:', "${url}");
  
  try {
    // 1. Setup page with stealth and locale
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
      'DNT': '1',
      'Sec-GPC': '1'
    });
    
    try {
      await page.emulateTimezone('Europe/Bratislava');
    } catch (e) {
      console.log('Timezone emulation failed:', e.message);
    }
    
    try {
      await page.setBypassServiceWorker(true);
    } catch (e) {
      console.log('Service worker bypass not available:', e.message);
    }
    
    // 2. Setup CDP session and enable domains BEFORE navigation
    let client;
    try {
      client = await page.target().createCDPSession();
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      await client.send('Network.enable', { 
        maxTotalBufferSize: 10000000, 
        maxResourceBufferSize: 5000000 
      });
    } catch (cdpError) {
      console.log('⚠️ CDP setup failed:', cdpError.message);
      client = null;
    }
    
    // 3. Register network listeners BEFORE navigation
    const requests = [];
    let requestIndex = 0;
    let isPreConsent = true;
    
    if (client) {
      client.on('Network.requestWillBeSent', (params) => {
        const request = {
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          timestamp: params.timestamp,
          index: requestIndex++,
          phase: isPreConsent ? 'pre' : 'post',
          query: {},
          postData: null,
          trackingParams: {}
        };
        
        // Parse query parameters
        try {
          const urlObj = new URL(params.request.url);
          const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
          
          urlObj.searchParams.forEach((value, key) => {
            request.query[key] = value;
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
              request.trackingParams[key] = value;
            }
          });
        } catch (e) {
          console.log('URL parsing error:', e.message);
        }
        
        // Parse POST data
        if (params.request.postData) {
          const contentType = params.request.headers['content-type'] || '';
          request.postData = params.request.postData;
          
          if (contentType.includes('application/json')) {
            try {
              request.postDataParsed = JSON.parse(params.request.postData);
            } catch (e) {
              console.log('JSON parse error:', e.message);
            }
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            try {
              const parsed = {};
              params.request.postData.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value !== undefined) {
                  parsed[decodeURIComponent(key)] = decodeURIComponent(value);
                }
              });
              request.postDataParsed = parsed;
            } catch (e) {
              console.log('Form parse error:', e.message);
            }
          }
        }
        
        requests.push(request);
      });
      
      client.on('Network.responseReceived', (params) => {
        // Find corresponding request and update
        const req = requests.find(r => r.id === params.requestId);
        if (req) {
          req.status = params.response.status;
          req.mimeType = params.response.mimeType;
          req.resourceType = params.type;
        }
      });
    }
    
    // Fallback page-level network capture
    page.on('request', (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        phase: isPreConsent ? 'pre' : 'post',
        resourceType: request.resourceType(),
        timestamp: Date.now(),
        fallback: true
      });
    });
    
    // 4. Navigate and wait
    console.log('📄 Navigating to URL...');
    await page.goto("${url}", { waitUntil: 'load' });
    
    try {
      await page.waitForLoadState('networkidle');
    } catch (e) {
      console.log('Network idle wait failed:', e.message);
    }
    
    await sleep(6000); // Extra idle time
    
    const origin = new URL(page.url()).origin;
    results.finalUrl = page.url();
    
    // 5. Collect pre-consent data (3 phases)
    console.log('📊 Phase 1: After load');
    const cookiesPhase1 = await collectCookies(page, client);
    const storagePhase1 = await collectStorage(page, client, origin);
    
    await sleep(2000);
    
    console.log('📊 Phase 2: After network idle');
    const cookiesPhase2 = await collectCookies(page, client);
    const storagePhase2 = await collectStorage(page, client, origin);
    
    await sleep(2000);
    
    console.log('📊 Phase 3: After extra idle');
    const cookiesPhase3 = await collectCookies(page, client);
    const storagePhase3 = await collectStorage(page, client, origin);
    
    // Merge pre-consent cookies and storage
    const allPreCookies = dedupeCookies([...cookiesPhase1, ...cookiesPhase2, ...cookiesPhase3]);
    const allPreStorage = { 
      localStorage: { ...storagePhase1.localStorage, ...storagePhase2.localStorage, ...storagePhase3.localStorage },
      sessionStorage: { ...storagePhase1.sessionStorage, ...storagePhase2.sessionStorage, ...storagePhase3.sessionStorage }
    };
    
    results.cookies_pre = allPreCookies;
    results.storage_pre = allPreStorage;
    results.requests_pre = requests.filter(r => r.phase === 'pre');
    
    // 6. CMP Detection and handling
    console.log('🍪 Detecting CMP...');
    const cmpInfo = await handleCMP(page);
    results.cmp_detected = cmpInfo.cmpDetected;
    results.cmp_cookie_name = cmpInfo.cmpCookieName;
    results.cmp_cookie_value = cmpInfo.cmpCookieValue;
    
    if (results.cmp_detected) {
      console.log('✅ CMP detected, collecting post-consent data...');
      
      // Switch to post-consent phase
      isPreConsent = false;
      
      // Wait for consent processing
      await sleep(4000);
      await page.waitForLoadState('networkidle').catch(() => {});
      
      // Collect post-consent data
      const cookiesPostAccept = await collectCookies(page, client);
      const storagePostAccept = await collectStorage(page, client, origin);
      
      results.cookies_post_accept = cookiesPostAccept;
      results.storage_post_accept = storagePostAccept;
      results.requests_post_accept = requests.filter(r => r.phase === 'post');
      results.consent_clicked = true;
      results.scenarios.accept = true;
      
      console.log('📊 Post-consent collection complete');
    } else {
      console.log('ℹ️ No CMP detected, skipping post-consent scenarios');
    }
    
    // 7. Generate summary stats
    console.log('📊 Scenario comparison:');
    console.log(\`Cookies: pre=\${results.cookies_pre.length}, post=\${results.cookies_post_accept.length}\`);
    console.log(\`Requests: pre=\${results.requests_pre.length}, post=\${results.requests_post_accept.length}\`);
    console.log(\`Storage items: pre=\${Object.keys(results.storage_pre.localStorage || {}).length + Object.keys(results.storage_pre.sessionStorage || {}).length}\`);
    console.log(\`Final URL: \${results.finalUrl}\`);
    
    console.log('✅ CDP analysis complete');
    return results;
    
  } catch (error) {
    console.error('❌ CDP analysis failed:', error);
    
    // Return minimal results on failure
    return {
      finalUrl: "${url}",
      cookies_pre: [],
      cookies_post_accept: [],
      cookies_post_reject: [],
      requests_pre: [],
      requests_post_accept: [],
      requests_post_reject: [],
      storage_pre: {},
      storage_post_accept: {},
      storage_post_reject: {},
      cmp_detected: false,
      cmp_cookie_name: '',
      cmp_cookie_value: '',
      consent_clicked: false,
      scenarios: { baseline: true, accept: false, reject: false },
      _error: error.message
    };
  }
};
`;

    // Execute the CDP script via Browserless /function
    console.log('🌐 Calling Browserless API...');
    
    const browserlessResponse = await fetch(`https://production-sfo.browserless.io/function?token=${browserlessApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-browserless-timeout': '180000'
      },
      body: JSON.stringify({
        code: cdpScript,
        context: {
          url: url
        }
      })
    });

    let browserlessData = null;
    
    if (!browserlessResponse.ok) {
      const errorText = await browserlessResponse.text();
      console.log(`❌ Browserless API error: ${browserlessResponse.status} - ${errorText}`);
      
      await logToDatabase('error', '❌ Browserless API error', {
        status: browserlessResponse.status,
        error: errorText
      });
      
      return new Response(JSON.stringify({
        success: false,
        trace_id: traceId,
        error_code: 'BROWSERLESS_API_ERROR',
        error_message: `Browserless API failed: ${browserlessResponse.status}`,
        data: {
          _error: errorText,
          debug: {
            bl_status_code: browserlessResponse.status,
            bl_health_status: healthStatus
          }
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        status: 200
      });
    }

    try {
      browserlessData = await browserlessResponse.json();
      console.log('✅ Browserless data received');
      
      // Log key metrics
      console.log('📊 Scenario comparison:');
      console.log(`Cookies: pre=${browserlessData.cookies_pre?.length || 0}, post=${browserlessData.cookies_post_accept?.length || 0}`);
      console.log(`Requests: pre=${browserlessData.requests_pre?.length || 0}, post=${browserlessData.requests_post_accept?.length || 0}`);
      console.log(`Storage items: pre=${Object.keys(browserlessData.storage_pre?.localStorage || {}).length + Object.keys(browserlessData.storage_pre?.sessionStorage || {}).length}`);
      console.log(`Final URL: ${browserlessData.finalUrl}`);
      
    } catch (parseError) {
      console.log(`❌ Failed to parse Browserless response: ${parseError.message}`);
      
      return new Response(JSON.stringify({
        success: false,
        trace_id: traceId,
        error_code: 'BROWSERLESS_PARSE_ERROR',
        error_message: 'Failed to parse Browserless response',
        data: {
          _error: parseError.message,
          debug: {
            bl_status_code: browserlessResponse.status,
            bl_health_status: healthStatus
          }
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
        status: 200
      });
    }

    // Log successful completion to database
    await logToDatabase('info', '✅ Analysis completed successfully', {
      final_url: browserlessData.finalUrl,
      cookies_pre_count: browserlessData.cookies_pre?.length || 0,
      cookies_post_count: browserlessData.cookies_post_accept?.length || 0,
      requests_pre_count: browserlessData.requests_pre?.length || 0,
      requests_post_count: browserlessData.requests_post_accept?.length || 0,
      cmp_detected: browserlessData.cmp_detected,
      consent_clicked: browserlessData.consent_clicked
    });

    // Insert audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        final_url: browserlessData.finalUrl,
        status: 'completed',
        bl_status_code: browserlessResponse.status,
        bl_health_status: healthStatus,
        cookies_pre_count: browserlessData.cookies_pre?.length || 0,
        cookies_post_count: browserlessData.cookies_post_accept?.length || 0,
        requests_pre_count: browserlessData.requests_pre?.length || 0,
        requests_post_count: browserlessData.requests_post_accept?.length || 0,
        cmp_detected: browserlessData.cmp_detected,
        consent_clicked: browserlessData.consent_clicked,
        duration_ms: Date.now() - startedAt
      });
    } catch (dbError) {
      console.error('Failed to insert audit run:', dbError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      trace_id: traceId,
      bl_status_code: browserlessResponse.status,
      bl_health_status: healthStatus,
      timestamp: new Date().toISOString(),
      data: browserlessData
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error(`❌ Function error [${traceId}]:`, error);
    
    await logToDatabase('error', '❌ Function error', {
      error: error.message,
      stack: error.stack
    });

    // Insert failed audit run record
    try {
      await supabase.from('audit_runs').insert({
        trace_id: traceId,
        url: url,
        final_url: url,
        status: 'failed',
        error_code: 'FUNCTION_ERROR',
        error_message: error.message,
        duration_ms: Date.now() - startedAt
      });
    } catch (dbError) {
      console.error('Failed to insert failed audit run:', dbError.message);
    }

    // Never return 500, always return 200 with success:false
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      error_code: 'FUNCTION_ERROR',
      error_message: error.message,
      data: {
        _error: error.message,
        debug: {
          req_pre: 0,
          req_post_accept: 0,
          req_post_reject: 0,
          cookies_pre_count: 0,
          cookies_post_count: 0
        }
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });
  }
});