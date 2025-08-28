import { useState } from 'react';
import { generatePDFReport } from '@/utils/pdfGenerator';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimulationBadge } from '@/components/SimulationBadge';
import { LiveBadge } from '@/components/LiveBadge';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Shield, 
  Cookie, 
  Eye, 
  Mail,
  Download,
  Camera,
  Users,
  Database,
  Lock,
  FileText,
  Monitor,
  Scale,
  Loader2
} from 'lucide-react';
import { AuditData } from '@/types/audit';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { calculateRiskScoresFromDisplay, calculateOverallRiskFromScores } from '@/utils/riskScoring';
import { useToast } from '@/hooks/use-toast';

interface AuditResultsProps {
  data: AuditData;
  onGenerateEmail: () => void;
}

// Helper function to get consistent status colors
const getStatusColor = (status: 'ok' | 'warning' | 'error'): string => {
  switch (status) {
    case 'ok': return 'text-green-600';
    case 'warning': return 'text-orange-600';
    case 'error': return 'text-red-600';
    default: return 'text-gray-600';
  }
};

const getStatusBgColor = (status: 'ok' | 'warning' | 'error'): string => {
  switch (status) {
    case 'ok': return 'bg-green-600';
    case 'warning': return 'bg-orange-500';
    case 'error': return 'bg-red-600';
    default: return 'bg-gray-600';
  }
};

const getStatusIcon = (status: 'ok' | 'warning' | 'error') => {
  switch (status) {
    case 'ok': return <CheckCircle className="h-4 w-4" />;
    case 'warning': return <AlertTriangle className="h-4 w-4" />;
    case 'error': return <XCircle className="h-4 w-4" />;
    default: return <AlertTriangle className="h-4 w-4" />;
  }
};

const getRiskScoreColor = (score: number): string => {
  if (score <= 30) return 'bg-green-600';
  if (score <= 60) return 'bg-orange-500';
  return 'bg-red-600';
};

const getVerdictColor = (verdict: string): string => {
  switch (verdict) {
    case 'súlad': return 'bg-green-600';
    case 'čiastočný súlad': return 'bg-orange-500';
    case 'nesúlad': return 'bg-red-600';
    default: return 'bg-gray-500';
  }
};

export const AuditResults = ({ data, onGenerateEmail }: AuditResultsProps) => {
  const { toast } = useToast();
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Consistency checks
  const performConsistencyChecks = () => {
    const checks = [];
    
    // Check cookie count consistency
    const expectedCookieCount = data.detailedAnalysis.cookies.firstParty + data.detailedAnalysis.cookies.thirdParty;
    if (expectedCookieCount !== data.detailedAnalysis.cookies.total) {
      checks.push(`Cookie count mismatch: ${data.detailedAnalysis.cookies.total} total vs ${expectedCookieCount} calculated`);
    }
    
    // Check pre-consent trackers count
    const preConsentCount = data.detailedAnalysis.trackers.filter(t => t.spamsBeforeConsent).length;
    if (preConsentCount !== data.detailedAnalysis.consentManagement.trackersBeforeConsent) {
      checks.push(`Pre-consent tracker count mismatch: ${data.detailedAnalysis.consentManagement.trackersBeforeConsent} stated vs ${preConsentCount} in table`);
    }
    
    // Check third party count
    const thirdPartyDomains = new Set(data.detailedAnalysis.thirdParties.list.map(p => p.domain));
    if (thirdPartyDomains.size !== data.detailedAnalysis.thirdParties.total) {
      checks.push(`Third party count mismatch: ${data.detailedAnalysis.thirdParties.total} stated vs ${thirdPartyDomains.size} unique domains`);
    }
    
    return checks;
  };

  const consistencyIssues = performConsistencyChecks();

  const handleDownloadJSON = () => {
    const jsonData = JSON.stringify(data._internal, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = await generatePDFReport(data);
      const dateStr = new Date().toISOString().split('T')[0];
      pdf.save(`gdpr-audit-report-${dateStr}.pdf`);
      
      toast({
        title: "PDF vygenerované",
        description: "GDPR audit report bol úspešne stiahnutý ako PDF.",
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: "Chyba pri generovaní PDF",
        description: "Nepodarilo sa vygenerovať PDF report. Skúste to znova.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };


  return (
    <div id="audit-report" className="space-y-8">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6" />
                GDPR Cookie Audit Report
                {data.managementSummary.data_source?.includes('Simulácia') ? (
                  <SimulationBadge />
                ) : (
                  <LiveBadge />
                )}
              </CardTitle>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={isGeneratingPDF}>
                {isGeneratingPDF ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadJSON}>
                <Download className="h-4 w-4 mr-2" />
                JSON
              </Button>
              <Button onClick={onGenerateEmail}>
                <Mail className="h-4 w-4 mr-2" />
                Generovať email
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Consistency Issues */}
      {consistencyIssues.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Data Consistency Issues:</strong>
            <ul className="mt-2 list-disc list-inside">
              {consistencyIssues.map((issue, index) => (
                <li key={index} className="text-sm">{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* A) Management Summary */}
      <Card>
        <CardHeader>
          <CardTitle>A) Manažérsky sumár</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(() => {
            // Calculate risk scores using utility function
            const riskScores = calculateRiskScoresFromDisplay(data);
            const { averageScore, riskLevel, riskColor } = calculateOverallRiskFromScores(riskScores);

            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Verdikt:</span>
                    <Badge className={`text-white ${getVerdictColor(data.managementSummary.verdict)}`}>
                      {data.managementSummary.verdict.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Celkové riziko:</span>
                    <Badge className={`text-white ${riskColor}`}>
                      {riskLevel} ({averageScore.toFixed(1)}/5)
                    </Badge>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-semibold mb-2">Celkové hodnotenie</h4>
                  <p className="text-sm text-muted-foreground">{data.managementSummary.overall}</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Riziká</h4>
                  <p className="text-sm text-muted-foreground">{data.managementSummary.risks}</p>
                </div>
                {data.managementSummary.data_source && (
                  <div>
                    <h4 className="font-semibold mb-2">Zdroj dát</h4>
                    <p className="text-sm text-muted-foreground">{data.managementSummary.data_source}</p>
                  </div>
                )}
                
                <div>
                  <h4 className="font-semibold mb-3">Rizikový scoring (0–5)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Oblasť</th>
                          <th className="text-left p-2">Skóre</th>
                          <th className="text-left p-2">Vysvetlenie</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riskScores.map((score, index) => (
                          <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                            <td className="p-2 font-medium">{score.area}</td>
                            <td className="p-2">
                              <Badge className={`text-white ${score.score <= 1 ? 'bg-green-600' : score.score <= 3 ? 'bg-orange-500' : 'bg-red-600'}`}>
                                {score.score}/5
                              </Badge>
                            </td>
                            <td className="p-2 text-muted-foreground text-xs">{score.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>


      {/* B) Detailed Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>B) Detailná analýza</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* 1. HTTPS */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Lock className="h-5 w-5" />
              1. HTTPS zabezpečenie
            </div>
            <Card className="border-l-4 border-l-transparent" style={{borderLeftColor: data.detailedAnalysis.https.status === 'ok' ? '#16a34a' : '#dc2626'}}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <div className={getStatusColor(data.detailedAnalysis.https.status)}>
                    {getStatusIcon(data.detailedAnalysis.https.status)}
                  </div>
                  <Badge className={`text-white ${getStatusBgColor(data.detailedAnalysis.https.status)}`}>
                    {data.detailedAnalysis.https.status === 'ok' ? 'OK' : 'PROBLÉM'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{data.detailedAnalysis.https.comment}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 2. Third Parties */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5" />
              2. Tretie strany
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Celkovo</span>
                  </div>
                  <div className="text-2xl font-bold">{data.detailedAnalysis.thirdParties.total}</div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Doména</th>
                        <th className="text-left p-2">Počet požiadaviek</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.detailedAnalysis.thirdParties.list.map((party, index) => (
                        <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                          <td className="p-2 font-mono text-xs">{party.domain}</td>
                          <td className="p-2">{party.requests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 3. Trackery a web-beacony */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Eye className="h-5 w-5" />
              3. Trackery a web-beacony
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Služba</th>
                        <th className="text-left p-2">Host</th>
                        <th className="text-left p-2">Dôkaz</th>
                        <th className="text-left p-2">Pred súhlasom</th>
                        <th className="text-left p-2">Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.detailedAnalysis.trackers.map((tracker, index) => (
                        <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                          <td className="p-2">{tracker.service}</td>
                          <td className="p-2 font-mono text-xs">{tracker.host}</td>
                          <td className="p-2 text-xs">{tracker.evidence}</td>
                          <td className="p-2">
                            <Badge className={`text-white text-xs ${tracker.spamsBeforeConsent ? 'bg-red-600' : 'bg-green-600'}`}>
                              {tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE'}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge className={`text-white text-xs ${getStatusBgColor(tracker.status)}`}>
                              {tracker.status.toUpperCase()}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            
            {/* Critical Error: Pre-consent trackers */}
            {(() => {
              const preConsentTrackers = data.detailedAnalysis.trackers.filter(t => t.spamsBeforeConsent);
              return preConsentTrackers.length > 0 && (
                <div className="border border-red-600 bg-red-50 text-red-800 rounded p-4 flex gap-2 items-start">
                  <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <div>
                      <strong>Kritická chyba: Detegované pred‑súhlasové trackery ({preConsentTrackers.length})</strong>
                    </div>
                    <div className="text-sm">
                      <div className="font-medium mb-1">Pred‑súhlasové trackery ({preConsentTrackers.length}):</div>
                      <ul className="list-disc list-inside space-y-1">
                        {preConsentTrackers.map((tracker, index) => (
                          <li key={index}>
                            <strong>{tracker.service}</strong> - {tracker.host}
                            {tracker.evidence && (
                              <div className="ml-4 text-xs font-mono bg-red-100 px-2 py-1 rounded mt-1">
                                {tracker.evidence}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 4. Cookies */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Cookie className="h-5 w-5" />
              4. Cookies ({data.detailedAnalysis.cookies.total})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Celkovo</span>
                  </div>
                  <div className="text-2xl font-bold">{data.detailedAnalysis.cookies.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">First-party</span>
                  </div>
                  <div className="text-2xl font-bold">{data.detailedAnalysis.cookies.firstParty}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium">Third-party</span>
                  </div>
                  <div className="text-2xl font-bold">{data.detailedAnalysis.cookies.thirdParty}</div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Názov</th>
                        <th className="text-left p-2">Doména</th>
                        <th className="text-left p-2">Typ</th>
                        <th className="text-left p-2">Kategória</th>
                        <th className="text-left p-2">Expirácia</th>
                        <th className="text-left p-2">Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.detailedAnalysis.cookies.details.map((cookie, index) => (
                        <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                          <td className="p-2 font-mono text-xs">{cookie.name}</td>
                          <td className="p-2 font-mono text-xs">{cookie.domain}</td>
                          <td className="p-2">
                            <Badge className={`text-xs ${cookie.type === 'first-party' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-orange-100 text-orange-800 border border-orange-200'}`}>
                              {cookie.type === 'first-party' ? '1P' : '3P'}
                            </Badge>
                          </td>
                          <td className="p-2">{cookie.category}</td>
                          <td className="p-2 text-xs">{cookie.expiration}</td>
                          <td className="p-2">
                             <Badge className={`text-white text-xs ${getStatusBgColor(cookie.status)}`}>
                               {cookie.status === 'error' ? 'PROBLÉM' : cookie.status.toUpperCase()}
                             </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 5. Storage */}
          {data.detailedAnalysis.storage && data.detailedAnalysis.storage.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <Database className="h-5 w-5" />
                5. LocalStorage/SessionStorage
              </div>
              <Card>
                <CardContent className="pt-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Kľúč</th>
                          <th className="text-left p-2">Typ</th>
                          <th className="text-left p-2">Vzor hodnôt</th>
                          <th className="text-left p-2">Zdroj</th>
                          <th className="text-left p-2">Vznik pred súhlasom</th>
                          <th className="text-left p-2">Poznámka</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.detailedAnalysis.storage.map((storage, index) => (
                          <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                            <td className="p-2 font-mono text-xs">{storage.key}</td>
                            <td className="p-2">{storage.type}</td>
                            <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{storage.valuePattern}</td>
                            <td className="p-2">{storage.source}</td>
                            <td className="p-2">
                              <Badge className={`text-white text-xs ${storage.createdPreConsent ? 'bg-red-600' : 'bg-green-600'}`}>
                                {storage.createdPreConsent ? 'ÁNO' : 'NIE'}
                              </Badge>
                            </td>
                            <td className="p-2">{storage.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 6. Consent Management */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5" />
              6. Consent Management a časovanie
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span>Consent nástroj:</span>
                    <Badge className={`text-white ${data.detailedAnalysis.consentManagement.hasConsentTool ? 'bg-green-600' : 'bg-red-600'}`}>
                      {data.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný' : 'Chýba'}
                    </Badge>
                  </div>
                  {data.detailedAnalysis.consentManagement.consentCookieName && (
                    <div className="flex items-center justify-between">
                      <span>Detegovaný consent cookie:</span>
                      <span className="font-mono text-xs bg-muted rounded px-2 py-1">
                        {data.detailedAnalysis.consentManagement.consentCookieName}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Trackery pred súhlasom:</span>
                    <Badge className={`text-white ${data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 'bg-red-600' : 'bg-green-600'}`}>
                      {data.detailedAnalysis.consentManagement.trackersBeforeConsent}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    <strong>Dôkazy:</strong> {data.detailedAnalysis.consentManagement.evidence}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 7. UX Analysis */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Monitor className="h-5 w-5" />
              7. UX analýza cookie lišty
            </div>
            
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  UX analýza cookie lišty sa vykonáva iba ako technická kontrola súladu s GDPR/ePrivacy požiadavkami na základe detegovaných cookie a consent management riešení.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* 8. Retention Periods */}
          {(() => {
            // Helper function to parse retention days
            const parseDays = (expiration: string): number | null => {
              if (!expiration) return null;
              const lowerExp = expiration.toLowerCase();
              if (lowerExp.includes('session') || lowerExp.includes('relacia')) return null;
              
              const match = expiration.match(/(\d+)\s*(dní|dni|day|days)/i);
              if (match) return parseInt(match[1]);
              
              const yearMatch = expiration.match(/(\d+)\s*(rok|year|rokov|years)/i);
              if (yearMatch) return parseInt(yearMatch[1]) * 365;
              
              const monthMatch = expiration.match(/(\d+)\s*(mesiac|month|mesiace|months)/i);
              if (monthMatch) return parseInt(monthMatch[1]) * 30;
              
              return null;
            };

            const longRetentionCookies = data.detailedAnalysis.cookies.details.filter(cookie => {
              const isMarketingOrAnalytical = cookie.category === 'marketingové' || cookie.category === 'analytické';
              const days = parseDays(cookie.expiration);
              return isMarketingOrAnalytical && days !== null && days > 365;
            });

            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <AlertTriangle className="h-5 w-5" />
                  8. Retenčné doby cookies
                </div>
                
                <Card>
                  <CardContent className="pt-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2">Názov</th>
                            <th className="text-left p-2">Doména</th>
                            <th className="text-left p-2">Kategória</th>
                            <th className="text-left p-2">Retenčná doba</th>
                            <th className="text-left p-2">Stav</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.detailedAnalysis.cookies.details.map((cookie, index) => {
                            const days = parseDays(cookie.expiration);
                            const isLongRetention = (cookie.category === 'marketingové' || cookie.category === 'analytické') && days !== null && days > 365;
                            
                            return (
                              <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                                <td className="p-2 font-mono text-xs">{cookie.name}</td>
                                <td className="p-2 font-mono text-xs">{cookie.domain}</td>
                                <td className="p-2">{cookie.category}</td>
                                <td className="p-2 text-xs">{cookie.expiration}</td>
                                <td className="p-2">
                                  <Badge className={`text-white text-xs ${isLongRetention ? 'bg-orange-500' : 'bg-green-600'}`}>
                                    {isLongRetention ? 'DLHÁ RETENCIA' : 'OK'}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    
                    {longRetentionCookies.length > 0 && (
                      <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                          <div className="text-sm text-orange-800">
                            <strong>Poznámka:</strong> {longRetentionCookies.length} marketingových/analytických cookies má retenciu nad 1 rok. Odporúčame skrátiť na max. 12 mesiacov podľa GDPR.
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          {/* 9. Legal Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Scale className="h-5 w-5" />
              9. Právne zhrnutie
            </div>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  {data.detailedAnalysis.legalSummary}
                </p>
              </CardContent>
            </Card>
          </div>

        </CardContent>
      </Card>

      {/* C) OK vs. Rizikové */}
      <Card>
        <CardHeader>
          <CardTitle>C) OK vs. Rizikové</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Oblasť</th>
                  <th className="text-left p-2">Stav</th>
                  <th className="text-left p-2">Komentár</th>
                </tr>
              </thead>
              <tbody>
                {data.riskTable.map((risk, index) => (
                  <tr key={index} className={`border-b ${index % 2 === 0 ? 'bg-muted/20' : ''}`}>
                    <td className="p-2 font-medium">{risk.area}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div className={getStatusColor(risk.status)}>
                          {getStatusIcon(risk.status)}
                        </div>
                        <Badge className={`text-white ${getStatusBgColor(risk.status)}`}>
                          {risk.status.toUpperCase()}
                        </Badge>
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">{risk.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* D) Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>D) Odporúčania</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.recommendations.map((rec, index) => (
              <Card key={index} className="border-l-4 border-l-primary">
                <CardContent className="pt-4">
                  <h4 className="font-semibold mb-2">{rec.title}</h4>
                  <p className="text-sm text-muted-foreground">{rec.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};