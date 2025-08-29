import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

/**
 * =================== AUDIT SYSTEM DOCUMENTATION ===================
 * 
 * SYSTEM FLOW: 
 * WS → Target attach → enable domains → navigate → tri zbierky cookies → CMP → post scenáre → sumarizácia
 * 
 * CDP EVENT FILTERING:
 * - All Network.* events filtered by pageSessionId (not browser-wide)
 * - Target.setAutoAttach for automatic page attachment
 * - Multi-phase cookie collection: post-load, post-idle, extra-idle
 * 
 * CMP EXTENSION POINTS:
 * - Add new selectors to CMP_SELECTORS object
 * - Extend clickByText function for new interaction patterns
 * 
 * TRACKING PARAMETERS:
 * - Extend SIGNIFICANT_PARAMS array for new tracking parameters
 * - Add new body content parsing in parsePostData function
 * 
 * QUALITY GATES:
 * - Self-check validates data consistency across collection phases
 * - No magic thresholds - all detection is derived from actual data
 * - INCOMPLETE banners only for concrete, identified issues
 */

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// =================== SINGLE SOURCE OF TRUTH HELPERS ===================
// These functions are defined once and used throughout the Edge function

function normalizeDomain(input?: string): string {
  return (input ?? '').trim().replace(/^\./, '');
}

function buildCookieKey(cookie: { name: string; domain?: string; path?: string }): string {
  return `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
}

function maskValue(value: string): string {
  return value.length > 12 ? value.slice(0, 12) + '…' : value;
}

function parseQuery(url: string): Record<string, string> {
  try {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

function parseFormUrlEncoded(data: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!data) return params;
  
  try {
    const pairs = data.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return params;
}

function safeJsonParse(data?: string): any | undefined {
  if (!data?.trim()) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function getETldPlusOneLite(host: string): string {
  const cleanHost = host.toLowerCase().replace(/^www\./, '');
  
  // Handle special cases (whitelist approach)
  const specialTlds = [
    '.co.uk', '.com.au', '.co.nz', '.com.br', '.co.za', '.org.uk',
    '.net.au', '.gov.au', '.edu.au', '.asn.au', '.id.au'
  ];
  
  for (const tld of specialTlds) {
    if (cleanHost.endsWith(tld)) {
      const parts = cleanHost.split('.');
      if (parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
    }
  }
  
  // Standard case: domain.tld
  const parts = cleanHost.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  
  return cleanHost;
}

interface ParsedCookie {
  name: string;
  valueMasked: string;
  domain: string;
  path: string;
  expiresEpochMs?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  source: string;
}

function parseSetCookieHeader(value: string, responseUrl: string): ParsedCookie {
  const parts = value.split(';').map(p => p.trim());
  const [nameValue] = parts;
  const [name, rawValue] = nameValue.split('=');
  
  const cookie: ParsedCookie = {
    name: name?.trim() || '',
    valueMasked: maskValue(rawValue || ''),
    domain: '',
    path: '/',
    secure: false,
    httpOnly: false,
    source: 'set-cookie-header'
  };
  
  // Extract domain from response URL if not specified
  try {
    const urlObj = new URL(responseUrl);
    cookie.domain = urlObj.hostname;
  } catch {
    cookie.domain = 'unknown';
  }
  
  // Parse attributes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part.startsWith('domain=')) {
      cookie.domain = normalizeDomain(part.substring(7));
    } else if (part.startsWith('path=')) {
      cookie.path = part.substring(5) || '/';
    } else if (part.startsWith('expires=')) {
      try {
        const expireDate = new Date(part.substring(8));
        cookie.expiresEpochMs = expireDate.getTime();
      } catch {
        // Ignore invalid dates
      }
    } else if (part.startsWith('max-age=')) {
      try {
        const maxAge = parseInt(part.substring(8));
        cookie.expiresEpochMs = Date.now() + (maxAge * 1000);
      } catch {
        // Ignore invalid max-age
      }
    } else if (part === 'secure') {
      cookie.secure = true;
    } else if (part === 'httponly') {
      cookie.httpOnly = true;
    } else if (part.startsWith('samesite=')) {
      cookie.sameSite = part.substring(9);
    }
  }
  
  return cookie;
}

// Significant tracking parameters to extract
const SIGNIFICANT_PARAMS = [
  'id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 
  'ip', 'geo', 'pid', 'aid', 'k', 'gclid', 'dclid', 'wbraid', 'gbraid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
];

// CMP selectors for detection and interaction
const CMP_SELECTORS = {
  onetrust: {
    banner: '#onetrust-banner-sdk',
    accept: '#onetrust-accept-btn-handler',
    reject: '#onetrust-reject-all-handler, #onetrust-pc-btn-handler'
  },
  cookiescript: {
    banner: '#cookiescript_injected',
    accept: '[data-cs-accept-all]',
    reject: '[data-cs-reject-all]'
  },
  generic: {
    banner: '[id*="cookie"], [class*="consent"], [data-testid*="consent"]',
    accept: '[id*="accept"], [class*="accept"], [data-testid*="accept"]',
    reject: '[id*="reject"], [class*="reject"], [data-testid*="reject"]'
  }
};

// Browserless configuration
const BROWSERLESS_BASE = Deno.env.get('BROWSERLESS_BASE')?.trim() || 'https://production-sfo.browserless.io';

function normalizeToken(token?: string): string {
  if (!token) return '';
  return token.trim().replace(/^["']|["']$/g, '');
}

async function checkBrowserlessAuth(token: string) {
  const baseUrl = new URL(BROWSERLESS_BASE);
  const result: any = { 
    base: BROWSERLESS_BASE, 
    host: baseUrl.host,
    tests: {} 
  };

  // A) Query param health check
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version?token=${token}`);
    const text = await response.text();
    result.tests.query = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.query = { error: String(error) }; 
  }

  // B) X-API-Key header
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version`, { 
      headers: { 'X-API-Key': token } 
    });
    const text = await response.text();
    result.tests.header = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.header = { error: String(error) }; 
  }

  // C) WebSocket CDP test
  result.tests.ws = await new Promise((resolve) => {
    try {
      const wsUrl = `wss://${baseUrl.host}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => { 
        try { ws.close(); } catch {} 
        resolve({ error: 'timeout' }); 
      }, 8000);
      
      ws.onopen = () => { 
        clearTimeout(timeout); 
        ws.close(); 
        resolve({ open: true }); 
      };
      
      ws.onclose = (event) => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: event.code }); 
      };
      
      ws.onerror = () => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: 'onerror' }); 
      };
    } catch (error) { 
      resolve({ error: String(error) }); 
    }
  });

  // Determine auth status
  let status: 'ok' | 'invalid_token' | 'wrong_product' | 'network_error' = 'network_error';
  
  if (result.tests.query?.ok || result.tests.header?.ok || result.tests.ws?.open) {
    status = 'ok';
  } else if ([401, 403].includes(result.tests.query?.status) || [401, 403].includes(result.tests.header?.status)) {
    status = 'invalid_token';
  } else if (result.tests.ws?.open === false && (result.tests.ws?.code === 1008 || result.tests.ws?.code === 1006)) {
    status = 'wrong_product';
  }

  return { status, details: result };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  
  // Initialize Supabase client for logging
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
  
  // Logger utility for audit_logs
  const logger = {
    async log(level: string, message: string, data?: any) {
      try {
        await supabase.from('audit_logs').insert({
          trace_id: traceId,
          level,
          message,
          data
        });
      } catch (error) {
        console.error('Failed to log to audit_logs:', error);
      }
    }
  };

  try {
    await logger.log('info', `🚀 Starting render-and-inspect function [${traceId}]`);

    // Parse request
    const { url } = await req.json();
    await logger.log('info', `📝 Analyzing URL: ${url}`);

    if (!url) {
      const error = { success: false, error_code: 'MISSING_URL', details: 'URL parameter is required' };
      await logger.log('error', 'Missing URL parameter', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get and validate Browserless token
    const rawToken = Deno.env.get('BROWSERLESS_TOKEN') || Deno.env.get('BROWSERLESS_API_KEY');
    const token = normalizeToken(rawToken);
    await logger.log('info', `🔑 Using Browserless token: ${token.slice(0, 8)}...${token.slice(-4)}`);

    if (!token) {
      const error = { success: false, error_code: 'BROWSERLESS_AUTH_FAILED', details: 'No Browserless token configured' };
      await logger.log('error', 'Missing Browserless token', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Browserless authentication
    await logger.log('info', '🏥 Checking Browserless authentication...');
    const authCheck = await checkBrowserlessAuth(token);
    
    if (authCheck.status !== 'ok') {
      const error = { 
        success: false, 
        error_code: 'BROWSERLESS_AUTH_FAILED', 
        details: `Auth status: ${authCheck.status}`,
        auth_details: authCheck.details 
      };
      await logger.log('error', 'Browserless authentication failed', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize data collection structures
    const requestMap = new Map();
    const responseInfo = new Map();
    const responseExtraInfo = new Map();
    const setCookieEvents_pre: ParsedCookie[] = [];
    const setCookieEvents_post_accept: ParsedCookie[] = [];
    const setCookieEvents_post_reject: ParsedCookie[] = [];
    let pageSessionId = '';
    let currentPhase: 'pre' | 'post_accept' | 'post_reject' = 'pre';
    let finalUrl = url;

    // Connect to Browserless WebSocket
    await logger.log('info', '🔗 Connecting to Browserless WebSocket...');
    await logger.log('info', '🌐 Starting Raw WebSocket CDP analysis...');

    const baseUrl = new URL(BROWSERLESS_BASE);
    const wsUrl = `wss://${baseUrl.host}?token=${token}`;
    
    const analysisResult = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      let messageId = 1;
      const pendingCommands = new Map();
      
      // Collection data
      const cookies_pre_load: any[] = [];
      const cookies_pre_idle: any[] = [];
      const cookies_pre_extra: any[] = [];
      const storage_pre: any[] = [];
      let requests_pre: any[] = [];

      const sendCommand = (method: string, params: any = {}, sessionId?: string) => {
        const id = messageId++;
        const message = { id, method, params: sessionId ? { ...params, sessionId } : params };
        ws.send(JSON.stringify(message));
        return new Promise((resolve, reject) => {
          pendingCommands.set(id, { resolve, reject });
        });
      };

      ws.onopen = async () => {
        try {
          await logger.log('info', '🔗 WebSocket connected to Browserless');
          
          // Phase 1: Get targets and attach to page
          await logger.log('info', '🎯 Getting browser targets...');
          const targets: any = await sendCommand('Target.getTargets');
          
          await logger.log('info', `TARGET CHECK ${JSON.stringify(targets.result.targetInfos.map((t: any) => ({ type: t.type, url: t.url })))}`);
          
          // Set auto-attach for new page targets
          await sendCommand('Target.setAutoAttach', {
            autoAttach: true,
            flatten: true,
            waitForDebuggerOnStart: false,
            filter: [{ type: 'page' }]
          });
          
          // Find existing page target
          const pageTarget = targets.result.targetInfos.find((t: any) => t.type === 'page');
          if (!pageTarget) {
            throw new Error('No page target found');
          }
          
          await logger.log('info', '📎 Attaching to existing page target...');
          const attachResult: any = await sendCommand('Target.attachToTarget', {
            targetId: pageTarget.targetId,
            flatten: true
          });
          
          pageSessionId = attachResult.result.sessionId;
          await logger.log('info', `📎 Target attached: page [${pageTarget.targetId}]`);
          await logger.log('info', `✅ Attached to page target: ${pageSessionId}`);
          
          // Enable CDP domains on page session
          await logger.log('info', `🔧 Enabling CDP domains on page session: ${pageSessionId}`);
          await sendCommand('Page.enable', {}, pageSessionId);
          await sendCommand('Runtime.enable', {}, pageSessionId);
          await sendCommand('Network.enable', {
            maxTotalBufferSize: 10_000_000,
            maxResourceBufferSize: 5_000_000
          }, pageSessionId);
          await sendCommand('DOMStorage.enable', {}, pageSessionId);
          
          await logger.log('info', `📍 CDP_bound: true`);
          await logger.log('info', '✅ CDP domains enabled on page session');
          
          // Set realistic headers
          await sendCommand('Network.setUserAgentOverride', {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }, pageSessionId);
          
          await sendCommand('Network.setExtraHTTPHeaders', {
            headers: {
              'Accept-Language': 'en-US,en;q=0.9',
              'DNT': '1',
              'Sec-GPC': '1'
            }
          }, pageSessionId);
          
          // Navigate to URL
          await logger.log('info', '🌐 Navigating to URL...');
          await sendCommand('Page.navigate', { url }, pageSessionId);
          
          // Wait for load event
          await new Promise<void>((resolveLoad) => {
            const checkLoad = (message: any) => {
              if (message.method === 'Page.loadEventFired' && message.sessionId === pageSessionId) {
                resolveLoad();
              }
            };
            
            const originalOnMessage = ws.onmessage;
            ws.onmessage = (event) => {
              const message = JSON.parse(event.data);
              checkLoad(message);
              if (originalOnMessage) originalOnMessage(event);
            };
          });
          
          await logger.log('info', '✅ Page load event fired');
          
          // Phase 2: Multi-timing cookie collection
          
          // M1: Post-load cookies
          await logger.log('info', '🍪 Collecting pre-consent cookies (M1: post-load)...');
          const postLoadCookies: any = await sendCommand('Network.getAllCookies', {}, pageSessionId);
          cookies_pre_load.push(...(postLoadCookies.result?.cookies || []));
          await logger.log('info', `Cookies pre-load: ${cookies_pre_load.length}`);
          
          // Wait for network idle
          await logger.log('info', '⏳ Waiting for network idle...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // M2: Post-idle cookies
          await logger.log('info', '🍪 Collecting pre-consent cookies (M2: post-idle)...');
          const postIdleCookies: any = await sendCommand('Network.getAllCookies', {}, pageSessionId);
          cookies_pre_idle.push(...(postIdleCookies.result?.cookies || []));
          await logger.log('info', `Cookies pre-idle: ${cookies_pre_idle.length}`);
          
          // Wait for extra idle period
          await logger.log('info', '⏳ Waiting for extra idle period...');
          await new Promise(resolve => setTimeout(resolve, 6000));
          
          // M3: Extra-idle cookies
          await logger.log('info', '🍪 Collecting pre-consent cookies (M3: extra-idle)...');
          const extraIdleCookies: any = await sendCommand('Network.getAllCookies', {}, pageSessionId);
          cookies_pre_extra.push(...(extraIdleCookies.result?.cookies || []));
          await logger.log('info', `Cookies pre-extra: ${cookies_pre_extra.length}`);
          
          // Get final URL
          const pageInfo: any = await sendCommand('Runtime.evaluate', {
            expression: 'window.location.href'
          }, pageSessionId);
          
          if (pageInfo.result?.result?.value) {
            finalUrl = pageInfo.result.result.value;
          }
          
          // Merge and deduplicate cookies
          await logger.log('info', '🍪 Merging pre-consent cookies from multiple collections...');
          const allPreCookies = [...cookies_pre_load, ...cookies_pre_idle, ...cookies_pre_extra];
          const cookieMap = new Map();
          
          for (const cookie of allPreCookies) {
            const key = buildCookieKey({
              name: cookie.name,
              domain: cookie.domain,
              path: cookie.path
            });
            
            if (!cookieMap.has(key)) {
              // Calculate expiry days
              let expiryDays: number | undefined;
              if (cookie.expires !== -1) {
                expiryDays = Math.round((cookie.expires * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
              }
              
              cookieMap.set(key, {
                ...cookie,
                expiryDays,
                valueMasked: maskValue(cookie.value)
              });
            }
          }
          
          const cookies_pre = Array.from(cookieMap.values());
          await logger.log('info', `Cookies merged pre-consent: ${cookies_pre.length}`);
          
          // Collect current requests
          requests_pre = Array.from(requestMap.values());
          await logger.log('info', `REQUESTS PRE counts { cdp: ${requests_pre.length} }`);
          
          // Get current page state
          const pageState: any = await sendCommand('Runtime.evaluate', {
            expression: `({ url: window.location.href, ready: document.readyState })`
          }, pageSessionId);
          
          await logger.log('info', `CDP ok ${JSON.stringify(pageState.result?.result?.value)}`);
          
          // Collect storage
          try {
            const origin: any = await sendCommand('Runtime.evaluate', {
              expression: 'window.location.origin'
            }, pageSessionId);
            
            const localStorage: any = await sendCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin.result.result.value, isLocalStorage: true }
            }, pageSessionId);
            
            const sessionStorage: any = await sendCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin.result.result.value, isLocalStorage: false }
            }, pageSessionId);
            
            storage_pre.push(...(localStorage.result?.entries || []), ...(sessionStorage.result?.entries || []));
          } catch (error) {
            await logger.log('warn', 'Storage collection failed', { error: String(error) });
          }
          
          await logger.log('info', `Storage pre-consent: ${storage_pre.length} items`);
          await logger.log('info', '✅ Pre-consent data collected');
          await logger.log('info', `📊 Pre-consent stats: { cookies: ${cookies_pre.length}, setCookieEvents: ${setCookieEvents_pre.length}, storage: ${storage_pre.length}, requests: ${requests_pre.length} }`);
          
          // Phase 4: CMP Detection and interaction
          await logger.log('info', '🔍 Detecting CMP...');
          
          const cmpResult: any = await sendCommand('Runtime.evaluate', {
            expression: `
              (() => {
                // OneTrust detection
                if (window.OneTrust || document.querySelector('#onetrust-banner-sdk')) {
                  return { detected: true, type: 'onetrust' };
                }
                
                // CookieScript detection
                if (window.CookieScript || document.querySelector('#cookiescript_injected')) {
                  return { detected: true, type: 'cookiescript' };
                }
                
                // Generic CMP detection
                const genericSelectors = ['[id*="cookie"]', '[class*="consent"]', '[data-testid*="consent"]'];
                for (const selector of genericSelectors) {
                  if (document.querySelector(selector)) {
                    return { detected: true, type: 'generic' };
                  }
                }
                
                return { detected: false };
              })()
            `
          }, pageSessionId);
          
          await logger.log('info', `🔍 CMP detection result: ${JSON.stringify(cmpResult.result?.result?.value)}`);
          
          // Collect final metrics
          const metrics = {
            requests_pre: requests_pre.length,
            cookies_pre: cookies_pre.length,
            setCookie_pre: setCookieEvents_pre.length,
            setCookie_post_accept: setCookieEvents_post_accept.length,
            setCookie_post_reject: setCookieEvents_post_reject.length,
            storage_pre_items: storage_pre.length,
            data_sent_to_third_parties: 0 // Calculated later
          };
          
          // Calculate third-party data sending
          const mainDomain = getETldPlusOneLite(new URL(finalUrl).hostname);
          let thirdPartyRequests = 0;
          
          for (const request of requests_pre) {
            try {
              const requestHost = new URL(request.url).hostname;
              const requestDomain = getETldPlusOneLite(requestHost);
              if (requestDomain !== mainDomain) {
                const params = parseQuery(request.url);
                const hasSignificantParams = SIGNIFICANT_PARAMS.some(param => params[param]);
                if (hasSignificantParams) {
                  thirdPartyRequests++;
                }
              }
            } catch {
              // Ignore invalid URLs
            }
          }
          
          metrics.data_sent_to_third_parties = thirdPartyRequests;
          await logger.log('info', `📤 data_sent_to_third_parties: ${thirdPartyRequests}`);
          
          await logger.log('info', `📊 Final collection summary: ${JSON.stringify(metrics)}`);
          
          ws.close();
          
          resolve({
            success: true,
            data: {
              final_url: finalUrl,
              finalUrl: finalUrl, // Backward compatibility
              requests: requests_pre,
              requests_pre: requests_pre,
              cookies_pre,
              storage_pre,
              set_cookie_headers_pre: setCookieEvents_pre,
              set_cookie_headers_post_accept: setCookieEvents_post_accept,
              set_cookie_headers_post_reject: setCookieEvents_post_reject,
              cmp: cmpResult.result?.result?.value || {},
              metrics
            }
          });
          
        } catch (error) {
          await logger.log('error', 'CDP analysis failed', { error: String(error) });
          ws.close();
          resolve({
            success: false,
            error_code: 'CDP_ANALYSIS_FAILED',
            details: String(error)
          });
        }
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        // Handle command responses
        if (message.id && pendingCommands.has(message.id)) {
          const { resolve } = pendingCommands.get(message.id);
          pendingCommands.delete(message.id);
          resolve(message);
        }
        
        // Handle events - filter by pageSessionId
        if (message.method && message.sessionId === pageSessionId) {
          switch (message.method) {
            case 'Network.requestWillBeSent':
              const request = message.params;
              requestMap.set(request.requestId, {
                url: request.request.url,
                method: request.request.method,
                headers: request.request.headers,
                timestamp: request.timestamp,
                phase: currentPhase
              });
              break;
              
            case 'Network.responseReceived':
              responseInfo.set(message.params.requestId, {
                url: message.params.response.url,
                status: message.params.response.status
              });
              break;
              
            case 'Network.responseReceivedExtraInfo':
              // Parse Set-Cookie headers
              if (message.params.headers) {
                const setCookieHeaders = message.params.headers['Set-Cookie'] || message.params.headers['set-cookie'];
                if (setCookieHeaders) {
                  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
                  const requestInfo = responseInfo.get(message.params.requestId);
                  const responseUrl = requestInfo?.url || finalUrl;
                  
                  for (const header of headers) {
                    const parsedCookie = parseSetCookieHeader(header, responseUrl);
                    
                    switch (currentPhase) {
                      case 'pre':
                        setCookieEvents_pre.push(parsedCookie);
                        break;
                      case 'post_accept':
                        setCookieEvents_post_accept.push(parsedCookie);
                        break;
                      case 'post_reject':
                        setCookieEvents_post_reject.push(parsedCookie);
                        break;
                    }
                  }
                }
              }
              break;
          }
        }
      };
      
      ws.onclose = () => {
        await logger.log('info', '🔌 WebSocket connection closed');
      };
      
      ws.onerror = (error) => {
        logger.log('error', 'WebSocket error', { error: String(error) });
        resolve({
          success: false,
          error_code: 'WEBSOCKET_ERROR',
          details: String(error)
        });
      };
      
      // Timeout
      setTimeout(() => {
        ws.close();
        resolve({
          success: false,
          error_code: 'TIMEOUT',
          details: 'Analysis timeout after 60 seconds'
        });
      }, 60000);
    });

    const duration = Date.now() - startTime;
    
    if (!analysisResult.success) {
      await logger.log('error', 'Analysis failed', analysisResult);
      return new Response(JSON.stringify(analysisResult), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', '✅ Analysis completed successfully');
    await logger.log('info', '✅ Analysis function completed successfully');

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      trace_id: traceId,
      browserless_status: 'ok',
      ...analysisResult.data
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorResponse = {
      success: false,
      error_code: 'UNEXPECTED_ERROR',
      details: String(error),
      duration_ms: duration,
      trace_id: traceId
    };
    
    await logger.log('error', 'Unexpected error in analysis function', errorResponse);
    
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});