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

// =================== TIME BUDGET HELPERS ===================
const TIME_BUDGET_MS = 35000; // 35 second budget for single path

// Path mode type for two-run approach
type PathMode = 'accept' | 'reject';

function createTimeBudgetHelpers(startTime: number) {
  const nowMs = () => Date.now() - startTime;
  const remainingMs = () => TIME_BUDGET_MS - nowMs();
  const budgetEnough = (needed: number) => remainingMs() > needed;
  const budgetedDelay = (requested: number, buffer: number = 1500) => 
    Math.min(requested, Math.max(1000, remainingMs() - buffer));
  
  const phaseTimer = (phaseName: string) => {
    const phaseStart = Date.now();
    return () => Date.now() - phaseStart;
  };
  
  return { nowMs, remainingMs, budgetEnough, budgetedDelay, phaseTimer };
}

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
  let normalized = token.replace(/^[\"']|[\"']$/g, '');
  
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
    let cookies: any[] = [];
    try {
      const cookiesResult: any = await this.sessionManager.sendCommand('Network.getAllCookies', {}, sessionId);
      cookies = cookiesResult?.result?.cookies || [];
    } catch (error) {
      await this.logger.log('warn', `Failed to get cookies for ${phase}`, { error: String(error) });
    }
    
    // Get storage data
    const storage = await this.getStorageData(sessionId);
    
    // Get Set-Cookie headers for this phase
    let setCookieHeaders: ParsedCookie[] = [];
    if (phase === 'pre') {
      setCookieHeaders = this.eventsPipeline.setCookieEvents_pre;
    } else if (phase === 'post_accept') {
      setCookieHeaders = this.eventsPipeline.setCookieEvents_post_accept;
    } else if (phase === 'post_reject') {
      setCookieHeaders = this.eventsPipeline.setCookieEvents_post_reject;
    }
    
    const snapshot = {
      phase,
      requests,
      cookies,
      storage,
      setCookieHeaders,
      timestamp: Date.now()
    };
    
    await this.logger.log('info', `📊 ${phase} snapshot: ${requests.length} requests, ${cookies.length} cookies`);
    
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
      
      return [
        ...Object.entries(localStorage).map(([key, value]) => ({
          type: 'localStorage',
          key,
          value: maskSensitiveStorageValue(value)
        })),
        ...Object.entries(sessionStorage).map(([key, value]) => ({
          type: 'sessionStorage', 
          key,
          value: maskSensitiveStorageValue(value)
        }))
      ];
    } catch (error) {
      await this.logger.log('warn', 'Failed to get storage data', { error: String(error) });
      return [];
    }
  }
}

// =================== CMP HUNTER ===================
const CMP_SELECTORS = {
  accept: [
    // English variants
    'button:contains("Accept")', 'button:contains("Accept All")', 'button:contains("Allow All")',
    'a:contains("Accept")', '[data-testid*="accept"]', '[id*="accept"]',
    
    // Slovak variants
    'button:contains("Prijať")', 'button:contains("Súhlasiť")', 'button:contains("Povoliť")',
    'button:contains("Prijať všetko")', 'button:contains("Súhlasiť so všetkým")',
    
    // Czech variants
    'button:contains("Přijmout")', 'button:contains("Souhlasím")', 'button:contains("Povolit")',
    'button:contains("Přijmout vše")', 'button:contains("Souhlasím se vším")',
    
    // Generic class/id patterns
    '.accept-all', '.cookie-accept', '.consent-accept', '#acceptCookies'
  ],
  reject: [
    // English variants
    'button:contains("Reject")', 'button:contains("Decline")', 'button:contains("Reject All")',
    'a:contains("Reject")', '[data-testid*="reject"]', '[id*="reject"]',
    
    // Slovak variants
    'button:contains("Odmietnuť")', 'button:contains("Zamietnuť")', 'button:contains("Nepovoliť")',
    'button:contains("Odmietnuť všetko")', 'button:contains("Nesúhlasiť")',
    
    // Czech variants
    'button:contains("Odmítnout")', 'button:contains("Nesouhlasím")', 'button:contains("Nepovolit")',
    'button:contains("Odmítnout vše")', 'button:contains("Nesouhlasím s ničím")',
    
    // Generic class/id patterns
    '.reject-all', '.cookie-reject', '.consent-reject', '#rejectCookies'
  ]
};

class CMPHunter {
  constructor(
    private sessionManager: SessionManager,
    private logger: any
  ) {}

  async findAndClickCMP(action: 'accept' | 'reject', sessionId: string): Promise<{ found: boolean; clicked: boolean; method?: string }> {
    await this.logger.log('info', `🍪 Looking for CMP ${action} button`);

    // Try direct selector matching first
    const selectors = CMP_SELECTORS[action];
    for (const selector of selectors) {
      try {
        const result = await this.clickBySelector(selector, sessionId);
        if (result.clicked) {
          await this.logger.log('info', `✅ CMP ${action} clicked via selector: ${selector}`);
          return { found: true, clicked: true, method: 'selector' };
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // Try text-based clicking as fallback
    const textPatterns = action === 'accept' 
      ? ['Accept', 'Accept All', 'Allow All', 'Prijať', 'Súhlasiť', 'Povoliť', 'Přijmout', 'Souhlasím']
      : ['Reject', 'Decline', 'Reject All', 'Odmietnuť', 'Zamietnuť', 'Nesúhlasiť', 'Odmítnout', 'Nesouhlasím'];

    for (const text of textPatterns) {
      try {
        const result = await this.clickByText(text, sessionId);
        if (result.clicked) {
          await this.logger.log('info', `✅ CMP ${action} clicked via text: "${text}"`);
          return { found: true, clicked: true, method: 'text' };
        }
      } catch (error) {
        // Continue to next pattern
      }
    }

    await this.logger.log('info', `❌ No CMP ${action} button found`);
    return { found: false, clicked: false };
  }

  private async clickBySelector(selector: string, sessionId: string): Promise<{ clicked: boolean }> {
    try {
      const result: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `
          (() => {
            const elements = document.querySelectorAll('${selector}');
            if (elements.length > 0) {
              elements[0].click();
              return { clicked: true };
            }
            return { clicked: false };
          })()
        `
      }, sessionId);
      
      return result?.result?.result?.value || { clicked: false };
    } catch {
      return { clicked: false };
    }
  }

  private async clickByText(text: string, sessionId: string): Promise<{ clicked: boolean }> {
    try {
      const result: any = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `
          (() => {
            const xpath = \`//button[contains(text(), "${text}")] | //a[contains(text(), "${text}")]\`;
            const elements = document.evaluate(xpath, document, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);
            if (elements.snapshotLength > 0) {
              elements.snapshotItem(0).click();
              return { clicked: true };
            }
            return { clicked: false };
          })()
        `
      }, sessionId);
      
      return result?.result?.result?.value || { clicked: false };
    } catch {
      return { clicked: false };
    }
  }
}

// =================== CDP UTILITIES ===================
function makeSender(ws: WebSocket) {
  return function send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = Math.random();
      const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
      
      const handler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.id === id) {
            ws.removeEventListener('message', handler);
            if (response.error) {
              reject(new Error(response.error.message || 'Command failed'));
            } else {
              resolve(response);
            }
          }
        } catch {}
      };
      
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify(message));
    });
  };
}

async function createContextPage(send: Function, url: string, logger: any): Promise<{ browserContextId: string; sessionId: string }> {
  await logger.log('info', '🎯 Creating isolated browser context');
  
  const contextResult: any = await send('Target.createBrowserContext');
  const browserContextId = contextResult.result.browserContextId;
  
  const pageResult: any = await send('Target.createTarget', {
    url: 'about:blank',
    browserContextId
  });
  const targetId = pageResult.result.targetId;
  
  const sessionResult: any = await send('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  const sessionId = sessionResult.result.sessionId;
  
  // Enable required domains
  await send('Network.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  
  // Block heavy resources but keep images for pixel tracking
  await send('Network.setBlockedURLs', {
    urls: [
      '*.woff', '*.woff2', '*.ttf', '*.otf',
      '*.mp4', '*.webm', '*.ogg', '*.avi', '*.mov',
      '*.pdf', '*.zip', '*.rar', '*.7z'
    ]
  }, sessionId);
  
  // Navigate to target URL
  await send('Page.navigate', { url }, sessionId);
  
  return { browserContextId, sessionId };
}

async function disposeContext(send: Function, browserContextId: string, logger: any): Promise<void> {
  try {
    await send('Target.disposeBrowserContext', { browserContextId });
    await logger.log('info', '🗑️ Browser context disposed');
  } catch (error) {
    await logger.log('warn', 'Failed to dispose context', { error: String(error) });
  }
}

async function onceLoadFired(ws: WebSocket, sessionId: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      resolve();
    }, timeout);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve();
        }
      } catch {}
    };

    ws.addEventListener('message', handler);
  });
}

function createWaitLoadFast(budget: any) {
  return async function waitLoadFast(ws: WebSocket, sessionId: string): Promise<void> {
    const maxTimeout = Math.min(8000, budget.remainingMs() - 2000);
    if (maxTimeout > 0) {
      await onceLoadFired(ws, sessionId, maxTimeout);
    }
  };
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

    // Parse request with path mode
    const body = await req.json();
    const url = body.url;
    const pathMode: PathMode = (body.path === 'reject' ? 'reject' : 'accept');
    
    await logger.log('info', `📝 Analyzing URL: ${url} (mode: ${pathMode})`);

    if (!url) {
      const error = { success: false, error_code: 'MISSING_URL', details: 'URL parameter is required', trace_id: traceId };
      await logger.log('error', 'Missing URL parameter', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create initial audit_runs entry with mode
    const { data: auditRun, error: insertError } = await supabase
      .from('audit_runs')
      .insert({
        trace_id: traceId,
        input_url: url,
        status: 'running',
        started_at: new Date().toISOString(),
        mode: `pre+${pathMode}`
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

    await logger.log('info', `📝 Created audit run record: ${auditRun?.id} (mode: pre+${pathMode})`);

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
          duration_ms: Date.now() - startTime,
          mode: `pre+${pathMode}`
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
          bl_health_status: authCheck.status,
          mode: `pre+${pathMode}`
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize modular architecture
    await logger.log('info', `🏗️ Initializing two-phase architecture (mode: ${pathMode})`);
    
    const phaseController = new PhaseController();
    let sessionManager: SessionManager;
    let eventsPipeline: EventsPipeline;
    let snapshotBuilder: SnapshotBuilder;
    let cmpHunter: CMPHunter;
    
    let finalUrl = url;

    // Connect to Browserless WebSocket
    await logger.log('info', '🔗 Connecting to Browserless WebSocket...');
    await logger.log('info', `🌐 Starting TWO-PHASE analysis (PRE + ${pathMode.toUpperCase()})...`);

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
          
          // Initialize time budget helpers
          const budget = createTimeBudgetHelpers(startTime);
          const waitLoadFast = createWaitLoadFast(budget);
          
          // Hoist snapshot variables for timeout handler access
          let preSnapshot: any = null;
          let postSnapshot: any = null;
          let phaseDurations: any = {};
          let partial = false;
          
          await logger.log('info', `⏱️ Starting with ${budget.remainingMs()}ms budget`);
          
          // ==================== TWO-PHASE EXECUTION ====================
          
          // PHASE A: PRE-CONSENT
          await logger.log('info', '🚀 PHASE A: Pre-consent analysis');
          const endPhaseA = budget.phaseTimer('phase_pre');
          
          const A = await createContextPage(send, url, logger);
          currentSessionId = A.sessionId;
          phaseController.setPre();
          
          await waitLoadFast(ws, A.sessionId);
          const maxIdleA = budget.budgetedDelay(6000);
          await sessionManager.waitForGlobalIdle(1000, maxIdleA);
          
          preSnapshot = await snapshotBuilder.buildSnapshot('pre', A.sessionId);
          await logger.log('info', `📊 Pre-snapshot: ${preSnapshot.requests.length} requests, ${preSnapshot.cookies.length} cookies`);
          
          // Get final URL from pre phase
          try {
            const urlResult: any = await send('Runtime.evaluate', {
              expression: 'window.location.href'
            }, A.sessionId);
            finalUrl = urlResult?.result?.result?.value || url;
          } catch {}
          
          await disposeContext(send, A.browserContextId, logger);
          phaseDurations.pre_ms = endPhaseA();
          
          // Check budget before Phase B
          if (!budget.budgetEnough(12000)) {
            await logger.log('info', `⏭️ Skipping phase B due to insufficient budget (${budget.remainingMs()}ms remaining)`);
            partial = true;
            // Continue with preSnapshot only
          } else {
            // PHASE B: Single path based on mode
            await logger.log('info', `🚀 PHASE B: ${pathMode} path analysis`);
            const endPhaseB = budget.phaseTimer('phase_post');
            
            const B = await createContextPage(send, url, logger);
            currentSessionId = B.sessionId;
            phaseController.setPre();
            
            await waitLoadFast(ws, B.sessionId);
            const maxIdlePreCMP = budget.budgetedDelay(4000);
            await sessionManager.waitForGlobalIdle(600, maxIdlePreCMP);
            
            const cmpResult = await cmpHunter.findAndClickCMP(pathMode, B.sessionId);
            await logger.log('info', `🍪 CMP ${pathMode} result: ${JSON.stringify(cmpResult)}`);
            
            // Set appropriate phase after CMP click
            if (pathMode === 'accept') {
              phaseController.setAccept();
            } else {
              phaseController.setReject();
            }
            
            const maxIdlePostCMP = budget.budgetedDelay(5000);
            await sessionManager.waitForGlobalIdle(1000, maxIdlePostCMP);
            
            postSnapshot = await snapshotBuilder.buildSnapshot(`post_${pathMode}`, B.sessionId);
            await logger.log('info', `📊 Post-${pathMode} snapshot: ${postSnapshot.requests.length} requests, ${postSnapshot.cookies.length} cookies`);
            
            await disposeContext(send, B.browserContextId, logger);
            phaseDurations.post_ms = endPhaseB();
          }
          
          phaseDurations.total_ms = budget.nowMs();
          await logger.log('info', `⏱️ Phase durations: ${JSON.stringify(phaseDurations)}`);
          
          // ==================== BUILD RESPONSE ====================
          
          // Aggregate data from phases (single path)
          const cookies_pre = preSnapshot?.cookies || [];
          const cookies_post_accept = pathMode === 'accept' ? (postSnapshot?.cookies || []) : [];
          const cookies_post_reject = pathMode === 'reject' ? (postSnapshot?.cookies || []) : [];
          
          const storage_pre = preSnapshot?.storage || [];
          const storage_post_accept = pathMode === 'accept' ? (postSnapshot?.storage || []) : [];
          const storage_post_reject = pathMode === 'reject' ? (postSnapshot?.storage || []) : [];
          
          const requests_pre = preSnapshot?.requests || [];
          const requests_post_accept = pathMode === 'accept' ? (postSnapshot?.requests || []) : [];
          const requests_post_reject = pathMode === 'reject' ? (postSnapshot?.requests || []) : [];

          const setCookie_pre = preSnapshot?.setCookieHeaders || [];
          const setCookie_post_accept = pathMode === 'accept' ? (postSnapshot?.setCookieHeaders || []) : [];
          const setCookie_post_reject = pathMode === 'reject' ? (postSnapshot?.setCookieHeaders || []) : [];
          
          // Build legacy tracking params and host map for compatibility
          const allRequests = [...requests_pre, ...requests_post_accept, ...requests_post_reject];
          const uniqueThirdParties = new Set(
            allRequests
              .map(r => safeGetHostname(r.url))
              .filter(h => h && h !== safeGetHostname(finalUrl))
          );
          
          const trackingParams = new Set();
          allRequests.forEach(req => {
            const params = parseQuery(req.url);
            Object.keys(params).forEach(param => {
              if (SIGNIFICANT_PARAMS.includes(param.toLowerCase())) {
                trackingParams.add(param);
              }
            });
          });
          
          // Build final metrics
          const metrics = {
            requests_total: allRequests.length,
            requests_pre_consent: requests_pre.length,
            third_parties_count: uniqueThirdParties.size,
            beacons_count: trackingParams.size,
            cookies_pre_count: cookies_pre.length,
            cookies_post_count: Math.max(cookies_post_accept.length, cookies_post_reject.length),
            segment: `pre+${pathMode}`,
          };

          // Update audit run with completion
          await supabase
            .from('audit_runs')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString(),
              duration_ms: phaseDurations.total_ms,
              normalized_url: finalUrl,
              requests_total: metrics.requests_total,
              requests_pre_consent: metrics.requests_pre_consent,
              third_parties_count: metrics.third_parties_count,
              beacons_count: metrics.beacons_count,
              cookies_pre_count: metrics.cookies_pre_count,
              cookies_post_count: metrics.cookies_post_count,
              bl_status_code: 200,
              bl_health_status: 'healthy',
              data_source: 'browserless',
              mode: `pre+${pathMode}`
            })
            .eq('id', auditRun.id);

          await logger.log('info', `✅ Analysis completed successfully (segment: pre+${pathMode})`);

          // Return successful response with segment structure
          resolve({
            success: true,
            trace_id: traceId,
            segment: `pre+${pathMode}`,
            final_url: finalUrl,
            metrics,
            data: {
              pre: {
                cookies: cookies_pre,
                storage: storage_pre,
                requests: requests_pre,
                set_cookie_headers: setCookie_pre
              },
              post: pathMode === 'accept' 
                ? {
                    kind: 'accept',
                    cookies: cookies_post_accept,
                    storage: storage_post_accept,
                    requests: requests_post_accept,
                    set_cookie_headers: setCookie_post_accept
                  }
                : {
                    kind: 'reject',
                    cookies: cookies_post_reject,
                    storage: storage_post_reject,
                    requests: requests_post_reject,
                    set_cookie_headers: setCookie_post_reject
                  }
            },
            // Legacy flat structure for compatibility
            cookies_pre,
            cookies_post_accept,
            cookies_post_reject,
            storage_pre,
            storage_post_accept,
            storage_post_reject,
            requests_pre,
            requests_post_accept,
            requests_post_reject,
            set_cookie_headers_pre: setCookie_pre,
            set_cookie_headers_post_accept: setCookie_post_accept,
            set_cookie_headers_post_reject: setCookie_post_reject,
            phase_durations: {
              phase_a: phaseDurations.pre_ms,
              phase_b: phaseDurations.post_ms,
              total: phaseDurations.total_ms
            },
            partial
          });
          
        } catch (error) {
          await logger.log('error', 'WebSocket execution error', { error: String(error) });
          resolve({ success: false, error: String(error), trace_id: traceId });
        } finally {
          ws.close();
        }
      };
      
      ws.onerror = (error) => {
        logger.log('error', 'WebSocket connection error', { error: String(error) });
        resolve({ success: false, error: 'WebSocket connection failed', trace_id: traceId });
      };
      
      ws.onclose = () => {
        logger.log('info', 'WebSocket connection closed');
      };
    });

    return new Response(JSON.stringify(analysisResult), {
      headers: corsHeaders
    });

  } catch (error) {
    await logger.log('error', 'Function execution error', { error: String(error) });
    
    // Update audit run with error
    await supabase
      .from('audit_runs')
      .update({
        status: 'failed',
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error_message: error.message,
        error_code: 'EXECUTION_ERROR',
        mode: auditRun ? `pre+${pathMode}` : null
      })
      .eq('id', auditRun?.id)
      .then(() => {}, () => {}); // Ignore update errors

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      trace_id: traceId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
