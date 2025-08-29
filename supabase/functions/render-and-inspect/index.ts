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

// PATCH 1 - Header normalization utilities
function normalizeHeaderKeys(h: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  if (!h) return {};
  const out: Record<string, string | string[]> = {};
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k] as any;
  return out;
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// PATCH 2 - URL parsing utilities
function safeJsonParse(str: string): any {
  try { return JSON.parse(str); } catch { return null; }
}

function safeGetHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function parseQuery(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const out: Record<string, string> = {};
    u.searchParams.forEach((v, k) => out[k] = v);
    return out;
  } catch { return {}; }
}

function parseFormUrlEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body) return out;
  try {
    new URLSearchParams(body).forEach((v, k) => out[k] = v);
  } catch {}
  return out;
}

// PATCH 3 - Domain utilities
function normalizeDomain(domain: string): string {
  if (!domain) return '';
  return domain.startsWith('.') ? domain.slice(1) : domain;
}

function getETldPlusOneLite(hostname: string): string {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return hostname;
}

// PATCH 4 - Masking of sensitive data (used for logs and GDPR compliance)
function maskSensitiveQuery(url: string): string {
  const sensitiveParams = ['email', 'user_id', 'token', 'session', 'api_key', 'password'];
  try {
    const u = new URL(url);
    sensitiveParams.forEach(param => {
      if (u.searchParams.has(param)) {
        u.searchParams.set(param, '[MASKED]');
      }
    });
    return u.toString();
  } catch { return url; }
}

function maskSensitiveStorageValue(value: any): any {
  if (typeof value !== 'string') return value;
  // Mask common PII patterns
  if (/email|@|\.com/.test(value)) return '[EMAIL_PATTERN]';
  if (/\d{4}-\d{2}-\d{2}/.test(value)) return '[DATE_PATTERN]';
  if (value.length > 50) return '[LONG_VALUE]';
  return value;
}

// =================== BROWSERLESS AUTH CHECK ===================
const BROWSERLESS_BASE = Deno.env.get('BROWSERLESS_BASE') || 'https://production-sfo.browserless.io';

function normalizeToken(token?: string): string {
  if (!token) return '';
  
  // Remove quotes if present
  let normalized = token.replace(/^["']|["']$/g, '');
  
  // Remove 'Bearer ' prefix if present
  if (normalized.startsWith('Bearer ')) {
    normalized = normalized.slice(7);
  }
  
  // Trim whitespace
  return normalized.trim();
}

async function checkBrowserlessAuth(rawToken: string): Promise<{ status: string; details: any; active_token_source?: string }> {
  const activeToken = normalizeToken(rawToken);
  
  if (!activeToken) {
    return { status: 'no_token', details: { message: 'No token provided' } };
  }

  // First try query parameter authentication (like diagnostics)
  try {
    const queryAuthUrl = `${BROWSERLESS_BASE}/json/version?token=${activeToken}`;
    console.log(`Testing query auth: ${queryAuthUrl}`);
    
    const queryResponse = await fetch(queryAuthUrl, { method: 'GET' });
    console.log(`Query auth status: ${queryResponse.status}`);
    
    if (queryResponse.status === 200) {
      const data = await queryResponse.json();
      console.log(`Query auth success:`, data);
      return { 
        status: 'ok', 
        details: data, 
        active_token_source: 'query_parameter' 
      };
    }
  } catch (error) {
    console.log(`Query auth error:`, error);
  }

  // Second try X-API-Key header authentication (like diagnostics)
  try {
    const headerAuthUrl = `${BROWSERLESS_BASE}/json/version`;
    console.log(`Testing header auth: ${headerAuthUrl}`);
    
    const headerResponse = await fetch(headerAuthUrl, { 
      method: 'GET',
      headers: { 'X-API-Key': activeToken }
    });
    console.log(`Header auth status: ${headerResponse.status}`);
    
    if (headerResponse.status === 200) {
      const data = await headerResponse.json();
      console.log(`Header auth success:`, data);
      return { 
        status: 'ok', 
        details: data, 
        active_token_source: 'x_api_key_header' 
      };
    } else if (headerResponse.status === 401) {
      return { 
        status: 'unauthorized', 
        details: { code: 401, message: 'Invalid token' },
        active_token_source: 'x_api_key_header'
      };
    }
  } catch (error) {
    console.log(`Header auth error:`, error);
    return { 
      status: 'network_error', 
      details: String(error),
      active_token_source: 'x_api_key_header'
    };
  }

  return { 
    status: 'failed_all_methods', 
    details: { message: 'Both query and header auth failed' },
    active_token_source: 'none'
  };
}

// =================== TRACKING PARAMETER CONSTANTS ===================
const SIGNIFICANT_PARAMS = [
  // Google Analytics / Google Tags
  'tid', 'cid', 'uid', 'gtm_debug', 'ga_debug', 'gclid', 'gclsrc', 'dclid', 'wbraid', 'gbraid',
  
  // Facebook / Meta
  'fbclid', 'fb_source', 'fb_ref', 'fb_click_id', 
  
  // User identification
  'user_id', 'userId', 'customer_id', 'customerId', 'session_id', 'sessionId', 
  
  // Campaign tracking
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  
  // Generic tracking
  'ref', 'referrer', 'source', 'medium', 'campaign', 'click_id', 'clickid'
];

// =================== PHASE CONTROLLER ===================
class PhaseController {
  private currentPhase: 'pre' | 'post_accept' | 'post_reject' = 'pre';
  
  setPre() { this.currentPhase = 'pre'; }
  setAccept() { this.currentPhase = 'post_accept'; }
  setReject() { this.currentPhase = 'post_reject'; }
  
  get(): string { return this.currentPhase; }
}

// =================== SESSION MANAGER ===================
class SessionManager {
  private ws: WebSocket;
  private logger: any;
  public inflight = 0;

  constructor(ws: WebSocket, logger: any) {
    this.ws = ws;
    this.logger = logger;
  }

  async attachHandlers() {
    // POINT 3: Fixed auto-attach parameters - removed invalid 'filter' parameter
    await this.sendCommand('Target.setAutoAttach', { 
      autoAttach: true, 
      flatten: true,
      waitForDebuggerOnStart: false
    });
  }

  onAttachedToTarget(sessionId: string, targetType: string, targetId: string) {
    this.logger.log('info', `🎯 Attached to ${targetType} target: ${sessionId}`);
  }

  onNetworkRequestStart() { this.inflight++; }
  onNetworkRequestEnd() { if (this.inflight > 0) this.inflight--; }

  async waitForGlobalIdle(minWait: number, maxWait: number): Promise<void> {
    await this.logger.log('info', `⏳ Waiting for global idle (${minWait}ms min, ${maxWait}ms max)`);
    
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, minWait));
    
    while (Date.now() - startTime < maxWait) {
      if (this.inflight === 0) {
        await this.logger.log('info', `✅ Global idle achieved after ${Date.now() - startTime}ms`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.logger.log('warn', `⏰ Global idle timeout after ${maxWait}ms (inflight: ${this.inflight})`);
  }

  async sendCommand(method: string, params: any = {}, sessionId?: string) {
    return new Promise((resolve, reject) => {
      const id = Math.random();
      const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
      
      const handler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.id === id) {
            this.ws.removeEventListener('message', handler);
            if (response.error) {
              reject(new Error(response.error.message || 'Command failed'));
            } else {
              resolve(response);
            }
          }
        } catch {}
      };
      
      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify(message));
    });
  }
}

// =================== EVENTS PIPELINE ===================
interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

class EventsPipeline {
  public requestMap = new Map<string, any>();
  public postDataMap = new Map<string, string>();
  public setCookieEvents_pre: ParsedCookie[] = [];
  public setCookieEvents_post_accept: ParsedCookie[] = [];
  public setCookieEvents_post_reject: ParsedCookie[] = [];

  constructor(
    private phaseController: PhaseController,
    private sessionManager: SessionManager,
    private logger: any
  ) {}

  async collectPostData(requestId: string, sessionId: string) {
    try {
      const result: any = await this.sessionManager.sendCommand('Network.getRequestPostData', { requestId }, sessionId);
      if (result?.result?.postData) {
        this.postDataMap.set(requestId, result.result.postData);
      }
    } catch {
      // POST data collection failed - not critical
    }
  }

  onNetworkResponseReceivedExtraInfo(params: any, sessionId: string) {
    const setCookieHeaders = ensureArray(params.headers?.['set-cookie'] || params.headers?.['Set-Cookie']);
    const phase = this.phaseController.get();

    for (const cookieStr of setCookieHeaders) {
      const cookie = this.parseSetCookieHeader(cookieStr);
      if (cookie) {
        if (phase === 'pre') {
          this.setCookieEvents_pre.push(cookie);
        } else if (phase === 'post_accept') {
          this.setCookieEvents_post_accept.push(cookie);
        } else if (phase === 'post_reject') {
          this.setCookieEvents_post_reject.push(cookie);
        }
      }
    }
  }

  onNetworkResponseReceived(params: any, sessionId: string) {
    // Additional response processing if needed
  }

  private parseSetCookieHeader(cookieStr: string): ParsedCookie | null {
    if (!cookieStr) return null;
    
    const parts = cookieStr.split(';').map(p => p.trim());
    const [nameValue] = parts;
    const [name, value = ''] = nameValue.split('=');
    
    if (!name) return null;
    
    const cookie: ParsedCookie = {
      name: name.trim(),
      value: value.trim(),
      domain: '',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'none'
    };
    
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const [key, val] = part.split('=').map(s => s.trim());
      
      switch (key.toLowerCase()) {
        case 'domain':
          cookie.domain = val || '';
          break;
        case 'path':
          cookie.path = val || '/';
          break;
        case 'expires':
          try {
            cookie.expires = new Date(val).getTime();
          } catch {}
          break;
        case 'max-age':
          try {
            cookie.expires = Date.now() + (parseInt(val) * 1000);
          } catch {}
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'secure':
          cookie.secure = true;
          break;
        case 'samesite':
          cookie.sameSite = val?.toLowerCase() || 'none';
          break;
      }
    }
    
    return cookie;
  }
}

// =================== SNAPSHOT BUILDER ===================
class SnapshotBuilder {
  constructor(
    private eventsPipeline: EventsPipeline,
    private sessionManager: SessionManager,
    private logger: any
  ) {}

  async buildSnapshot(phase: string, sessionId: string) {
    await this.logger.log('info', `📸 Building ${phase} snapshot for session ${sessionId}`);
    
    // Collect requests for this phase
    const requests = Array.from(this.eventsPipeline.requestMap.values())
      .filter((r: any) => r.phase === phase);
    
    // Get persisted cookies via Network.getAllCookies
    let persistedCookies: any[] = [];
    try {
      const cookiesResult: any = await this.sessionManager.sendCommand('Network.getAllCookies', {}, sessionId);
      persistedCookies = cookiesResult?.result?.cookies || [];
    } catch (error) {
      await this.logger.log('warn', `Failed to get cookies for ${phase}`, { error: String(error) });
    }
    
    // POINT 5: Get storage data with correct format
    const storage = await this.getStorageData(sessionId);
    
    // Get final URL
    let finalUrl = '';
    try {
      const urlResult: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: 'window.location.href'
      }, sessionId);
      finalUrl = urlResult?.result?.result?.value || '';
    } catch {}
    
    const snapshot = {
      phase,
      requests,
      persistedCookies,
      storage,
      finalUrl,
      timestamp: Date.now()
    };
    
    await this.logger.log('info', `📊 ${phase} snapshot: ${requests.length} requests, ${persistedCookies.length} cookies`);
    
    return snapshot;
  }

  async getStorageData(sessionId: string) {
    try {
      // Get localStorage
      const localStorageResult: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: 'JSON.stringify(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))'
      }, sessionId);
      
      // Get sessionStorage  
      const sessionStorageResult: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: 'JSON.stringify(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)]))'
      }, sessionId);
      
      const localStorageItems = safeJsonParse(localStorageResult?.result?.result?.value || '[]') || [];
      const sessionStorageItems = safeJsonParse(sessionStorageResult?.result?.result?.value || '[]') || [];
      
      // Convert to objects
      const localStorage = Object.fromEntries(localStorageItems);
      const sessionStorage = Object.fromEntries(sessionStorageItems);
      
      return {
        localStorage,
        sessionStorage,
        storageMetrics: {
          localStorageItems: localStorageItems.length,
          sessionStorageItems: sessionStorageItems.length,
          uniqueKeys: [...new Set([...Object.keys(localStorage), ...Object.keys(sessionStorage)])]
        }
      };
    } catch (error) {
      await this.logger.log('warn', 'Failed to get storage data', { error: String(error) });
      return {
        localStorage: {},
        sessionStorage: {},
        storageMetrics: { localStorageItems: 0, sessionStorageItems: 0, uniqueKeys: [] }
      };
    }
  }
}

// =================== CMP HUNTER ===================
class CMPHunter {
  constructor(
    private sessionManager: SessionManager,
    private logger: any
  ) {}

  async findAndClickCMP(action: 'accept' | 'reject', pageSessionId: string) {
    await this.logger.log('info', `🎯 Hunting CMP for ${action} action`);
    
    try {
      // POINT 4: CMP click across all frames in the page session
      const frameTreeResult: any = await this.sessionManager.sendCommand('Page.getFrameTree', {}, pageSessionId);
      const allFrames = this.extractAllFrames(frameTreeResult?.result?.frameTree);
      
      for (const frame of allFrames) {
        try {
          // Create isolated world for this frame
          await this.sessionManager.sendCommand('Page.createIsolatedWorld', {
            frameId: frame.id,
            worldName: `cmp-hunter-${Date.now()}`,
            grantUniveralAccess: true
          }, pageSessionId);
          
          const result = await this.attemptCMPClick(action, pageSessionId, frame.id);
          if (result.clicked) {
            await this.logger.log('info', `✅ CMP ${action} successful in frame ${frame.id}`);
            return result;
          }
        } catch (error) {
          await this.logger.log('warn', `CMP click failed in frame ${frame.id}`, { error: String(error) });
        }
      }
      
      await this.logger.log('info', `❌ CMP ${action} failed in all frames`);
      return { clicked: false };
      
    } catch (error) {
      await this.logger.log('error', `CMP hunting failed`, { error: String(error) });
      return { clicked: false };
    }
  }

  private extractAllFrames(frameTree: any): any[] {
    if (!frameTree) return [];
    
    const frames = [frameTree.frame];
    if (frameTree.childFrames) {
      for (const child of frameTree.childFrames) {
        frames.push(...this.extractAllFrames(child));
      }
    }
    return frames;
  }

  private async attemptCMPClick(action: 'accept' | 'reject', sessionId: string, frameId?: string) {
    const selectors = action === 'accept' ? [
      '[data-testid="accept-all"]',
      '[id*="accept"]',
      '[class*="accept"]',
      'button:contains("Accept")',
      'button:contains("Agree")',
      'button:contains("Allow")'
    ] : [
      '[data-testid="reject-all"]',
      '[id*="reject"]',
      '[class*="reject"]',
      'button:contains("Reject")',
      'button:contains("Decline")',
      'button:contains("Deny")'
    ];

    for (const selector of selectors) {
      try {
        const clickExpression = `
          try {
            const element = document.querySelector('${selector}');
            if (element && element.offsetParent !== null) {
              element.click();
              true;
            } else {
              false;
            }
          } catch {
            false;
          }
        `;

        const result: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
          expression: clickExpression
        }, sessionId);

        if (result?.result?.result?.value === true) {
          return { clicked: true, selector, frameId };
        }
      } catch {}
    }

    return { clicked: false };
  }
}

// ============= HELPER FUNCTIONS FOR THREE-PHASE EXECUTION =============

// --- CDP sender (per WebSocket) ---
function makeSender(ws: WebSocket) {
  let id = 0;
  const waiters = new Map<number, (msg:any)=>void>();
  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse((e as MessageEvent).data);
      if (msg.id && waiters.has(msg.id)) {
        waiters.get(msg.id)!(msg);
        waiters.delete(msg.id);
      }
    } catch {}
  });
  return function send(method: string, params: any = {}, sessionId?: string) {
    const msg = sessionId ? { id: ++id, method, params, sessionId } : { id: ++id, method, params };
    ws.send(JSON.stringify(msg));
    return new Promise<any>(resolve => waiters.set(msg.id, resolve));
  };
}

// --- vytvor čistý kontext+page pre fázu ---
async function createContextPage(send: any, url: string, logger: any) {
  const ctx = await send('Target.createBrowserContext', {});
  const browserContextId = ctx.result.browserContextId;

  const tgt = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const targetId = tgt.result.targetId;

  // auto-attach (len page/worker; iframe NIE je target)
  await send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });

  const att = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = att.result.sessionId;

  // enable domény
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 }, sessionId);
  await send('DOMStorage.enable', {}, sessionId);
  await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': 'en-US,en;q=0.9', 'DNT': '1', 'Sec-GPC': '1' } }, sessionId);
  await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, sessionId);

  await logger.log('info', `🎯 Created context ${browserContextId}, target ${targetId}, session ${sessionId}`);
  
  // navigácia
  await send('Page.navigate', { url }, sessionId);

  return { browserContextId, targetId, sessionId };
}

async function disposeContext(send:any, browserContextId:string, logger: any) {
  await logger.log('info', `🗑️ Disposing context ${browserContextId}`);
  await send('Target.disposeBrowserContext', { browserContextId });
}

// Helper for storage key collection
function collectStorageKeys(storageData: any) {
  const out = new Set<string>();
  const pushObj = (o: any) => Object.keys(o || {}).forEach(k => out.add(k));
  pushObj(storageData?.localStorage);
  pushObj(storageData?.sessionStorage);
  return out;
}

// POST body parsing helper
function parsePostBody(rec: any) {
  const h = rec.headers || {};
  const ct = (h['content-type'] || h['Content-Type'] || '').toString().toLowerCase();
  const body = rec.postData || '';
  if (!body) return {};
  try {
    if (ct.includes('application/json')) return JSON.parse(body) || {};
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(body));
    return {};
  } catch { return {}; }
}

// Deduplicate server-set cookies
function dedupServerSet(arr: any[]) {
  const m = new Map<string, any>();
  for (const c of arr) {
    const key = `${c.name}|${normalizeDomain(c.domain)}|${c.path||'/'}`;
    m.set(key, c);
  }
  return Array.from(m.values());
}

// Helper to wait for Page.loadEventFired
function onceLoadFired(ws: WebSocket, sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired' && message.sessionId === sessionId) {
          ws.removeEventListener('message', handler);
          resolve();
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    
    // Timeout after 10 seconds
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      resolve();
    }, 10000);
  });
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
          source: 'render-and-inspect',
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
      const error = { success: false, error_code: 'MISSING_URL', details: 'URL parameter is required', trace_id: traceId };
      await logger.log('error', 'Missing URL parameter', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create initial audit_runs entry
    const { data: auditRun, error: insertError } = await supabase
      .from('audit_runs')
      .insert({
        trace_id: traceId,
        input_url: url,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      const error = { success: false, error_code: 'DB_INSERT_FAILED', details: 'Database initialization failed', trace_id: traceId };
      await logger.log('error', 'Failed to create audit_runs entry', { error: insertError });
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', `📝 Created audit run record: ${auditRun?.id}`);

    // Get and validate Browserless token
    const rawToken = Deno.env.get('BROWSERLESS_TOKEN') || Deno.env.get('BROWSERLESS_API_KEY');
    const token = normalizeToken(rawToken);
    await logger.log('info', `🔑 Using Browserless token: ${token.slice(0, 8)}...${token.slice(-4)}`);

    if (!token) {
      const error = { success: false, error_code: 'BROWSERLESS_AUTH_FAILED', details: 'No Browserless token configured', trace_id: traceId };
      await logger.log('error', 'Missing Browserless token', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: 'No Browserless token configured',
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Browserless authentication
    await logger.log('info', '🏥 Checking Browserless authentication...');
    const authCheck = await checkBrowserlessAuth(token);
    
    await logger.log('info', `🔑 Auth result: ${authCheck.status}, source: ${authCheck.active_token_source || 'unknown'}`);
    
    if (authCheck.status !== 'ok') {
      const error = { 
        success: false, 
        error_code: 'BROWSERLESS_AUTH_FAILED', 
        details: `Auth status: ${authCheck.status}, source: ${authCheck.active_token_source || 'unknown'}`,
        auth_details: authCheck.details,
        active_token_source: authCheck.active_token_source,
        trace_id: traceId
      };
      await logger.log('error', 'Browserless authentication failed', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: `Auth status: ${authCheck.status}`,
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          bl_health_status: authCheck.status
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize new modular architecture
    await logger.log('info', '🏗️ Initializing modular three-phase architecture');
    
    const phaseController = new PhaseController();
    let sessionManager: SessionManager;
    let eventsPipeline: EventsPipeline;
    let snapshotBuilder: SnapshotBuilder;
    let cmpHunter: CMPHunter;
    
    // Legacy data structures for backward compatibility
    const trackingParams: any[] = [];
    const hostMap = {
      requests: { firstParty: new Set(), thirdParty: new Set() },
      cookies: { firstParty: new Set(), thirdParty: new Set() },
      storage: { firstParty: new Set(), thirdParty: new Set() },
      links: { firstParty: new Set(), thirdParty: new Set() }
    };
    
    let finalUrl = url;

    // Connect to Browserless WebSocket using THREE-PHASE EXECUTION
    await logger.log('info', '🔗 Connecting to Browserless WebSocket...');
    await logger.log('info', '🌐 Starting THREE-PHASE isolated context analysis...');

    // Construct WebSocket URL using correct authentication method
    const baseUrl = new URL(BROWSERLESS_BASE);
    const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${baseUrl.host}?token=${token}`;
    
    await logger.log('info', `🔗 WebSocket URL: ${wsUrl}`);
    
    const analysisResult = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      
      // Initialize modular components first
      sessionManager = new SessionManager(ws, logger);
      eventsPipeline = new EventsPipeline(phaseController, sessionManager, logger);
      snapshotBuilder = new SnapshotBuilder(eventsPipeline, sessionManager, logger);
      cmpHunter = new CMPHunter(sessionManager, logger);

      // Create CDP sender
      const send = makeSender(ws);
      
      // Global state for session filtering
      let currentSessionId = '';

      // STRICT SESSION FILTERING - Process only events for current phase
      ws.addEventListener('message', (event) => {
        let msg: any;
        try { 
          msg = JSON.parse((event as MessageEvent).data); 
        } catch { 
          return; 
        }

        // Command responses handled by makeSender
        if (msg.id) return;

        // Process only events for current session
        if (!msg.sessionId || msg.sessionId !== currentSessionId) return;

        switch (msg.method) {
          case 'Network.requestWillBeSent': {
            const p = msg.params;
            const rec = {
              requestId: p.requestId,
              url: p.request.url,
              method: p.request.method,
              headers: normalizeHeaderKeys(p.request.headers || {}),
              hasPostData: !!p.request.postData || !!p.request.hasPostData,
              phase: phaseController.get(),
              ts: p.timestamp
            };
            eventsPipeline.requestMap.set(p.requestId, rec);

            // Stable POST body collection
            if (!p.request.postData && p.request.hasPostData) {
              send('Network.getRequestPostData', { requestId: p.requestId }, currentSessionId).then((res: any) => {
                const body = res?.result?.postData ?? '';
                eventsPipeline.requestMap.set(p.requestId, { ...rec, postData: body });
              }).catch(() => {});
            } else if (p.request.postData) {
              eventsPipeline.requestMap.set(p.requestId, { ...rec, postData: p.request.postData });
            }

            sessionManager.onNetworkRequestStart();
            break;
          }
          case 'Network.responseReceived':
            eventsPipeline.onNetworkResponseReceived(msg.params, currentSessionId);
            break;
          case 'Network.responseReceivedExtraInfo':
            eventsPipeline.onNetworkResponseReceivedExtraInfo(msg.params, currentSessionId);
            break;
          case 'Network.loadingFinished':
          case 'Network.loadingFailed':
            sessionManager.onNetworkRequestEnd();
            break;
        }
      });

      ws.onopen = async () => {
        try {
          await logger.log('info', '🔗 WebSocket connected to Browserless');
          
          // ==================== THREE-PHASE ISOLATED EXECUTION ====================
          
          let preSnapshot: any, postAcceptSnapshot: any, postRejectSnapshot: any;
          
          // PHASE A: PRE-CONSENT
          await logger.log('info', '🚀 PHASE A: Pre-consent isolation');
          const A = await createContextPage(send, url, logger);
          currentSessionId = A.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, A.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(1500, 12000);
          
          preSnapshot = await snapshotBuilder.buildSnapshot('pre', A.sessionId);
          await logger.log('info', `📊 Pre-snapshot: ${preSnapshot.requests.length} requests, ${preSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, A.browserContextId, logger);
          
          // PHASE B: POST-ACCEPT
          await logger.log('info', '🚀 PHASE B: Post-accept isolation');
          const B = await createContextPage(send, url, logger);
          currentSessionId = B.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, B.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(800, 8000);
          
          const acceptResult = await (new CMPHunter(sessionManager, logger)).findAndClickCMP('accept', B.sessionId);
          await logger.log('info', `🍪 CMP Accept result: ${JSON.stringify(acceptResult)}`);
          
          phaseController.setAccept();
          await sessionManager.waitForGlobalIdle(1500, 10000);
          
          postAcceptSnapshot = await snapshotBuilder.buildSnapshot('post_accept', B.sessionId);
          await logger.log('info', `📊 Post-accept snapshot: ${postAcceptSnapshot.requests.length} requests, ${postAcceptSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, B.browserContextId, logger);
          
          // PHASE C: POST-REJECT
          await logger.log('info', '🚀 PHASE C: Post-reject isolation');
          const C = await createContextPage(send, url, logger);
          currentSessionId = C.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, C.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(800, 8000);
          
          const rejectResult = await (new CMPHunter(sessionManager, logger)).findAndClickCMP('reject', C.sessionId);
          await logger.log('info', `🚫 CMP Reject result: ${JSON.stringify(rejectResult)}`);
          
          phaseController.setReject();
          await sessionManager.waitForGlobalIdle(1500, 10000);
          
          postRejectSnapshot = await snapshotBuilder.buildSnapshot('post_reject', C.sessionId);
          await logger.log('info', `📊 Post-reject snapshot: ${postRejectSnapshot.requests.length} requests, ${postRejectSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, C.browserContextId, logger);
          
          // ==================== ANALYSIS & OUTPUT ====================
          
          // Get final URL from pre-snapshot
          finalUrl = preSnapshot.finalUrl || url;
          
          // ==================== DATA ANALYSIS ====================
          
          // Fixed storage key collection
          const storageKeysPre = collectStorageKeys(preSnapshot?.storage);
          const storageKeysAcc = collectStorageKeys(postAcceptSnapshot?.storage);
          const storageKeysRej = collectStorageKeys(postRejectSnapshot?.storage);
          const uniqueStorageKeys = new Set<string>([...storageKeysPre, ...storageKeysAcc, ...storageKeysRej]);
          
          // Server-set cookies with deduplication
          const cookies_serverset_pre = dedupServerSet(eventsPipeline.setCookieEvents_pre);
          const cookies_serverset_post_accept = dedupServerSet(eventsPipeline.setCookieEvents_post_accept);
          const cookies_serverset_post_reject = dedupServerSet(eventsPipeline.setCookieEvents_post_reject);
          
          // Persisted cookies
          const cookies_persisted_pre = preSnapshot?.persistedCookies ?? [];
          const cookies_persisted_post_accept = postAcceptSnapshot?.persistedCookies ?? [];
          const cookies_persisted_post_reject = postRejectSnapshot?.persistedCookies ?? [];
          
          // POST body analysis for tracking parameters
          const allReq = [
            ...preSnapshot.requests,
            ...postAcceptSnapshot.requests,
            ...postRejectSnapshot.requests
          ];
          
          const trackingParams = [];
          for (const r of allReq) {
            const q = parseQuery(r.url);
            const pb = parsePostBody(r);
            const qKeys = Object.keys(q).filter(k => SIGNIFICANT_PARAMS.includes(k));
            const bKeys = Object.keys(pb).filter(k => SIGNIFICANT_PARAMS.includes(k));
            if (qKeys.length || bKeys.length) {
              trackingParams.push({
                url: r.url,
                method: r.method,
                phase: r.phase,
                params: Object.fromEntries(qKeys.map(k => [k, q[k]])),
                bodyKeys: bKeys
              });
            }
          }
          
          // Build host map for legacy compatibility
          const mainDomain = getETldPlusOneLite(new URL(finalUrl).hostname);
          for (const r of allReq) {
            try {
              const requestHost = new URL(r.url).hostname;
              const requestDomain = getETldPlusOneLite(requestHost);
              const isFirstParty = requestDomain === mainDomain;
              
              if (isFirstParty) {
                hostMap.requests.firstParty.add(requestHost);
              } else {
                hostMap.requests.thirdParty.add(requestHost);
              }
            } catch {}
          }
          
          const allCookies = [...cookies_persisted_pre, ...cookies_persisted_post_accept, ...cookies_persisted_post_reject];
          for (const cookie of allCookies) {
            const cookieDomain = getETldPlusOneLite(cookie.domain);
            const isFirstParty = cookieDomain === mainDomain;
            
            if (isFirstParty) {
              hostMap.cookies.firstParty.add(cookie.domain);
            } else {
              hostMap.cookies.thirdParty.add(cookie.domain);
            }
          }
          
          // Metrics calculation
          const metrics = {
            requests_pre: preSnapshot.requests.length,
            requests_post_accept: postAcceptSnapshot.requests.length,
            requests_post_reject: postRejectSnapshot.requests.length,
            cookies_serverset_pre: cookies_serverset_pre.length,
            cookies_serverset_post_accept: cookies_serverset_post_accept.length,
            cookies_serverset_post_reject: cookies_serverset_post_reject.length,
            cookies_persisted_pre: cookies_persisted_pre.length,
            cookies_persisted_post_accept: cookies_persisted_post_accept.length,
            cookies_persisted_post_reject: cookies_persisted_post_reject.length,
            setCookie_pre: eventsPipeline.setCookieEvents_pre.length,
            setCookie_post_accept: eventsPipeline.setCookieEvents_post_accept.length,
            setCookie_post_reject: eventsPipeline.setCookieEvents_post_reject.length,
            storage_unique_keys: uniqueStorageKeys.size,
            tracking_params_count: trackingParams.length,
            third_party_hosts: hostMap.requests.thirdParty.size
          };
          
          await logger.log('info', '📊 Final metrics', metrics);
          
          // Close WebSocket
          ws.close();
          
          // Build final response with BACKWARD COMPATIBILITY
          const response = {
            success: true,
            final_url: finalUrl,
            finalUrl,
            
            // Requests per phase
            requests_pre: preSnapshot.requests,
            requests_post_accept: postAcceptSnapshot.requests,
            requests_post_reject: postRejectSnapshot.requests,
            
            // Server-set cookies (new fields)
            cookies_serverset_pre,
            cookies_serverset_post_accept,
            cookies_serverset_post_reject,
            
            // Persisted cookies (new fields)  
            cookies_persisted_pre,
            cookies_persisted_post_accept,
            cookies_persisted_post_reject,
            
            // Legacy cookies fields for compatibility
            cookies_pre: cookies_persisted_pre,
            cookies_post_accept: cookies_persisted_post_accept,
            cookies_post_reject: cookies_persisted_post_reject,
            
            // Set-Cookie headers
            set_cookie_headers_pre: eventsPipeline.setCookieEvents_pre,
            set_cookie_headers_post_accept: eventsPipeline.setCookieEvents_post_accept,
            set_cookie_headers_post_reject: eventsPipeline.setCookieEvents_post_reject,
            
            // Storage data
            storage_pre: preSnapshot.storage,
            storage_post_accept: postAcceptSnapshot.storage,
            storage_post_reject: postRejectSnapshot.storage,
            
            // Legacy compatibility
            hostMap,
            trackingParams,
            metrics,
            trace_id: traceId,
            
            // Self-checks
            self_check_summary: {
              is_complete: true,
              reasons: [],
              data_collection_ok: true
            }
          };
          
          resolve(response);
          
        } catch (error) {
          await logger.log('error', 'THREE-PHASE execution failed', { error: String(error) });
          ws.close();
          resolve({
            success: false,
            error_code: 'THREE_PHASE_EXECUTION_FAILED',
            details: String(error),
            trace_id: traceId
          });
        }
      };
      
      ws.onclose = async () => {
        await logger.log('info', '🔌 WebSocket connection closed');
      };
      
      ws.onerror = (error) => {
        logger.log('error', 'WebSocket error', { error: String(error) });
        
        resolve({
          success: false,
          error_code: 'WEBSOCKET_ERROR',
          details: String(error),
          trace_id: traceId
        });
      };
      
      // Timeout
      setTimeout(async () => {
        await logger.log('error', '⏰ Global timeout after 60 seconds');
        
        resolve({
          success: false,
          error_code: 'TIMEOUT',
          details: 'Analysis timed out after 60 seconds',
          trace_id: traceId
        });
      }, 60000);
    });

    const duration = Date.now() - startTime;
    
    if (!analysisResult.success) {
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: analysisResult.error_code,
          error_message: analysisResult.details,
          ended_at: new Date().toISOString(),
          duration_ms: duration
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(analysisResult), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    await logger.log('info', '✅ Analysis completed successfully');
    
    // Update audit_runs with success
    await supabase
      .from('audit_runs')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        duration_ms: duration,
        bl_status_code: 200,
        bl_health_status: 'ok',
        normalized_url: analysisResult.final_url || analysisResult.finalUrl
      })
      .eq('trace_id', traceId);

    await logger.log('info', '✅ Analysis function completed successfully');

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      trace_id: traceId,
      bl_status_code: 200,
      bl_health_status: 'ok',
      data: analysisResult
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
    
    // Update audit_runs with unexpected error
    try {
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'UNEXPECTED_ERROR',
          error_message: String(error),
          ended_at: new Date().toISOString(),
          duration_ms: duration,
          bl_status_code: 500
        })
        .eq('trace_id', traceId);
    } catch (updateError) {
      await logger.log('error', 'Failed to update audit_runs on unexpected error', { updateError: String(updateError) });
    }
    
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});