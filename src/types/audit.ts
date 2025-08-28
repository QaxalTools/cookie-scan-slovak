export interface AuditData {
  url: string;
  timestamp: string;
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
  riskTable: Array<{
    area: string;
    status: 'ok' | 'warning' | 'error';
    comment: string;
  }>;
  recommendations: Array<{
    title: string;
    description: string;
  }>;
}