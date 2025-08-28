// Core internal JSON structure for deterministic audit results
export interface InternalAuditJson {
  final_url: string;
  https: {
    supports: boolean;
    redirects_http_to_https: boolean;
  };
  third_parties: Array<{
    host: string;
    service: string;
  }>;
  beacons: Array<{
    host: string;
    sample_url: string;
    params: string[];
    service: string;
    pre_consent: boolean;
  }>;
  cookies: Array<{
    name: string;
    domain: string;
    party: '1P' | '3P';
    type: 'technical' | 'analytics' | 'marketing';
    expiry_days: number | null;
  }>;
  storage: Array<{
    scope: 'local' | 'session';
    key: string;
    sample_value: string;
    contains_personal_data: boolean;
    source_party: '1P' | '3P';
    created_pre_consent: boolean;
  }>;
  cmp: {
    present: boolean;
    cookie_name: string;
    raw_value: string;
    pre_consent_fires: boolean;
  };
  verdict: 'COMPLIANT' | 'NON_COMPLIANT' | 'INCOMPLETE';
  reasons: string[];
}

export interface AuditData {
  url: string;
  finalUrl: string;
  hasRedirect: boolean;
  timestamp: string;
  
  // A) Manažérsky sumár
  managementSummary: {
    verdict: 'súlad' | 'čiastočný súlad' | 'nesúlad' | 'neúplné dáta';
    overall: string;
    risks: string;
    data_source?: string;
  };

  // B) Detailná analýza
  detailedAnalysis: {
    https: {
      status: 'ok' | 'warning' | 'error';
      comment: string;
    };
    thirdParties: {
      total: number;
      list: Array<{
        domain: string;
        requests: number;
      }>;
    };
    trackers: Array<{
      service: string;
      host: string;
      evidence: string;
      status: 'ok' | 'warning' | 'error';
      spamsBeforeConsent: boolean;
    }>;
  cookies: {
    total: number;
    firstParty: number;
    thirdParty: number;
    details: Array<{
      name: string;
      domain: string;
      type: 'first-party' | 'third-party';
      category: 'technické' | 'analytické' | 'marketingové';
      expiration: string;
      status: 'ok' | 'warning' | 'error';
    }>;
  };
  storage: Array<{
    key: string;
    type: 'localStorage' | 'sessionStorage';
    valuePattern: string;
    source: '1P' | '3P';
    createdPreConsent: boolean;
    note: string;
  }>;
  consentManagement: {
    hasConsentTool: boolean;
    consentCookieName: string;
    consentCookieValue: string;
    trackersBeforeConsent: number;
    evidence: string;
  };
    legalSummary: string;
  };

  // C) OK vs. Rizikové
  riskTable: Array<{
    area: string;
    status: 'ok' | 'warning' | 'error';
    comment: string;
  }>;

  // D) Odporúčania
  recommendations: Array<{
    title: string;
    description: string;
  }>;

  // Backward compatibility properties
  summary: {
    overall: string;
    risks: string;
  };
  https: {
    status: 'ok' | 'warning' | 'error';
    description: string;
  };
  cookies: {
    total: number;
    technical: number;
    analytical: number;
    marketing: number;
  };
  trackers: Array<{
    name: string;
    status: 'ok' | 'warning' | 'error';
  }>;
  thirdParties: Array<{
    domain: string;
    requests: number;
  }>;

  // Internal JSON for consistency
  _internal: InternalAuditJson;
}