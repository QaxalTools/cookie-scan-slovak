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
      details: Array<{
        name: string;
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
      note: string;
    }>;
    consentManagement: {
      hasConsentTool: boolean;
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
}