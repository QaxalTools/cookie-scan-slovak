import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimulationBadge } from '@/components/SimulationBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Shield, 
  Cookie, 
  Eye, 
  Mail,
  Download,
  Camera
} from 'lucide-react';
import { AuditData } from '@/types/audit';
import { useState, useCallback } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  autoCaptureConsent, 
  checkEdgeFunctionAvailable, 
  getStoredApiKey, 
  setStoredApiKey 
} from '@/utils/consentService';
import { useToast } from '@/hooks/use-toast';
import { useEffect } from 'react';

interface AuditResultsProps {
  data: AuditData;
  onGenerateEmail: () => void;
}

export const AuditResults = ({ data, onGenerateEmail }: AuditResultsProps) => {
  // State for manual capture dialog
  const [showCaptureDialog, setShowCaptureDialog] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [edgeFunctionAvailable, setEdgeFunctionAvailable] = useState<boolean | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Check edge function availability for manual capture button
    const initializeCapture = async () => {
      const isEdgeAvailable = await checkEdgeFunctionAvailable();
      setEdgeFunctionAvailable(isEdgeAvailable);
    };
    initializeCapture();
  }, []);

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

  const handleSmartCapture = useCallback(async () => {
    setIsCapturing(true);
    
    try {
      const result = await autoCaptureConsent(data.url, {
        delay: 3000,
        viewport: { width: 1920, height: 1080 },
        locale: 'sk-SK',
      });
      
      if (result.success) {
        toast({
          title: "Capture Complete",
          description: `Screenshot captured (${result.used === 'edge' ? 'secure mode' : 'client mode'})`,
        });
        setShowCaptureDialog(false);
      } else {
        toast({
          title: "Capture Failed",
          description: result.error || 'Unknown error',
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Capture error:', error);
      toast({
        title: "Capture Failed",
        description: "Failed to capture banner",
        variant: "destructive"
      });
    } finally {
      setIsCapturing(false);
    }
  }, [data.url, toast]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6" />
                GDPR Cookie Audit Report
                <SimulationBadge />
              </CardTitle>
              <p className="text-muted-foreground mt-2">
                URL: <span className="font-mono text-sm">{data.url}</span>
              </p>
              {data.hasRedirect && (
                <p className="text-muted-foreground text-sm">
                  Final URL: <span className="font-mono">{data.finalUrl}</span>
                </p>
              )}
            </div>
            <div className="flex gap-2">
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
          <div className="flex items-center gap-2">
            <span className="font-semibold">Verdikt:</span>
            <Badge variant={
              data.managementSummary.verdict === 'súlad' ? 'default' :
              data.managementSummary.verdict === 'čiastočný súlad' ? 'secondary' : 'destructive'
            }>
              {data.managementSummary.verdict.toUpperCase()}
            </Badge>
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
        </CardContent>
      </Card>

      {/* B) Detailed Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>B) Detailná analýza</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 1. HTTPS */}
          <div>
            <h3 className="font-semibold mb-2">1. HTTPS zabezpečenie</h3>
            <div className="flex items-center gap-2">
              <Badge variant={data.detailedAnalysis.https.status === 'ok' ? 'default' : 'destructive'}>
                {data.detailedAnalysis.https.status === 'ok' ? 'OK' : 'PROBLEM'}
              </Badge>
              <span className="text-sm text-muted-foreground">{data.detailedAnalysis.https.comment}</span>
            </div>
          </div>

          {/* 2. Third Parties */}
          <div>
            <h3 className="font-semibold mb-2">2. Tretie strany ({data.detailedAnalysis.thirdParties.total})</h3>
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
                    <tr key={index} className="border-b">
                      <td className="p-2 font-mono text-xs">{party.domain}</td>
                      <td className="p-2">{party.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. Trackers */}
          <div>
            <h3 className="font-semibold mb-2">3. Trackery a web-beacony</h3>
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
                    <tr key={index} className="border-b">
                      <td className="p-2">{tracker.service}</td>
                      <td className="p-2 font-mono text-xs">{tracker.host}</td>
                      <td className="p-2 text-xs">{tracker.evidence}</td>
                      <td className="p-2">
                        <Badge variant={tracker.spamsBeforeConsent ? 'destructive' : 'default'} className="text-xs">
                          {tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Badge variant={tracker.status === 'ok' ? 'default' : 'destructive'} className="text-xs">
                          {tracker.status.toUpperCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Cookies */}
          <div>
            <h3 className="font-semibold mb-2">4. Cookies ({data.detailedAnalysis.cookies.total})</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Cookie className="h-4 w-4" />
                  <span className="text-sm font-medium">First-party</span>
                </div>
                <div className="text-2xl font-bold">{data.detailedAnalysis.cookies.firstParty}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Cookie className="h-4 w-4" />
                  <span className="text-sm font-medium">Third-party</span>
                </div>
                <div className="text-2xl font-bold">{data.detailedAnalysis.cookies.thirdParty}</div>
              </div>
            </div>
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
                    <tr key={index} className="border-b">
                      <td className="p-2 font-mono text-xs">{cookie.name}</td>
                      <td className="p-2 font-mono text-xs">{cookie.domain}</td>
                      <td className="p-2">
                        <Badge variant={cookie.type === 'first-party' ? 'default' : 'secondary'} className="text-xs">
                          {cookie.type === 'first-party' ? '1P' : '3P'}
                        </Badge>
                      </td>
                      <td className="p-2">{cookie.category}</td>
                      <td className="p-2 text-xs">{cookie.expiration}</td>
                      <td className="p-2">
                        <Badge variant={cookie.status === 'ok' ? 'default' : 'destructive'} className="text-xs">
                          {cookie.status.toUpperCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. Storage */}
          {data.detailedAnalysis.storage && data.detailedAnalysis.storage.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">5. LocalStorage/SessionStorage</h3>
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
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono text-xs">{storage.key}</td>
                        <td className="p-2">{storage.type}</td>
                        <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{storage.valuePattern}</td>
                        <td className="p-2">{storage.source}</td>
                        <td className="p-2">
                          <Badge variant={storage.createdPreConsent ? 'destructive' : 'secondary'} className="text-xs">
                            {storage.createdPreConsent ? 'ÁNO' : 'NIE'}
                          </Badge>
                        </td>
                        <td className="p-2">{storage.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. Consent Management */}
          <div>
            <h3 className="font-semibold mb-2">6. Consent Management a časovanie</h3>
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span>Consent nástroj:</span>
                <Badge variant={data.detailedAnalysis.consentManagement.hasConsentTool ? 'secondary' : 'destructive'}>
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
                <Badge variant={data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0 ? 'destructive' : 'secondary'}>
                  {data.detailedAnalysis.consentManagement.trackersBeforeConsent}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                <strong>Dôkazy:</strong> {data.detailedAnalysis.consentManagement.evidence}
              </div>
            </div>
          </div>

          {/* 8. UX analýza cookie lišty */}
          <div>
            <h3 className="font-semibold mb-2">8. UX analýza cookie lišty</h3>
            
            {data.consentUx ? (
              <div className="space-y-4">
                {/* Pre-captured screenshot and OCR analysis */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Camera className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Screenshot a analýza</span>
                    <Badge variant="secondary" className="text-xs">
                      {data.consentUx.used === 'edge' ? 'Bezpečný režim' : 'Klientsky režim'}
                    </Badge>
                  </div>
                  
                  {data.consentUx.screenshot && (
                    <div className="mb-3">
                      <img 
                        src={data.consentUx.screenshot} 
                        alt="Cookie banner screenshot" 
                        className="w-full max-w-lg mx-auto rounded border"
                      />
                    </div>
                  )}
                  
                  {data.consentUx.ocr ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">OCR Analýza</span>
                        <Badge 
                          variant={data.consentUx.ocr.evaluation.uxAssessment === 'transparent' ? 'default' : 
                                  data.consentUx.ocr.evaluation.uxAssessment === 'unbalanced' ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {data.consentUx.ocr.evaluation.uxAssessment === 'transparent' ? 'Transparentná' :
                           data.consentUx.ocr.evaluation.uxAssessment === 'unbalanced' ? 'Nevyvážená' : 'Problematická'}
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-3 bg-background rounded border">
                          <h4 className="font-semibold text-sm mb-1 text-green-600">Accept tlačidlá</h4>
                          <div className="text-lg font-bold">{data.consentUx.ocr.buttons.accept.length}</div>
                          {data.consentUx.ocr.buttons.accept.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {data.consentUx.ocr.buttons.accept.slice(0, 2).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="p-3 bg-background rounded border">
                          <h4 className="font-semibold text-sm mb-1 text-red-600">Reject tlačidlá</h4>
                          <div className="text-lg font-bold">{data.consentUx.ocr.buttons.reject.length}</div>
                          {data.consentUx.ocr.buttons.reject.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {data.consentUx.ocr.buttons.reject.slice(0, 2).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="p-3 bg-background rounded border">
                          <h4 className="font-semibold text-sm mb-1 text-amber-600">Settings tlačidlá</h4>
                          <div className="text-lg font-bold">{data.consentUx.ocr.buttons.settings.length}</div>
                          {data.consentUx.ocr.buttons.settings.length > 0 && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {data.consentUx.ocr.buttons.settings.slice(0, 2).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-background rounded border">
                          <h4 className="font-semibold text-sm mb-1">Rovnocenné tlačidlá</h4>
                          <Badge variant={data.consentUx.ocr.evaluation.hasBalancedButtons ? 'secondary' : 'destructive'}>
                            {data.consentUx.ocr.evaluation.hasBalancedButtons ? 'Áno' : 'Nie'}
                          </Badge>
                        </div>
                        <div className="p-3 bg-background rounded border">
                          <h4 className="font-semibold text-sm mb-1">Detailné nastavenia</h4>
                          <Badge variant={data.consentUx.ocr.evaluation.hasDetailedSettings ? 'secondary' : 'destructive'}>
                            {data.consentUx.ocr.evaluation.hasDetailedSettings ? 'Áno' : 'Nie'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Screenshot bol zachytený, ale OCR analýza zlyhala.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Fallback: Basic analysis without screenshot */}
                {(() => {
                  const hasCMP = data.detailedAnalysis.consentManagement.hasConsentTool;
                  const preConsentTrackers = data.detailedAnalysis.consentManagement.trackersBeforeConsent > 0;
                  
                  const isPresent = hasCMP;
                  const defaultBehavior = preConsentTrackers ? 'Opt-in (nevyžaduje súhlas)' : 'Opt-out (blokuje trackery)';
                  const balancedButtons = preConsentTrackers ? 'Nie (nevyvážená)' : 'Áno (pravdepodobné)';
                  const detailedSettings = data._internal?.cmp?.present ? 'Áno (detekovaný CMP nástroj)' : 'Neznáme';
                  
                  let assessment = 'Chýba';
                  if (hasCMP) {
                    assessment = preConsentTrackers ? 'Nevyvážená' : 'Transparentná';
                  }
                  
                  return (
                    <div className="space-y-4">
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          UX analýza cookie lišty bola vynechaná. Analýza je založená na technických indikátoroch.
                        </AlertDescription>
                      </Alert>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <h4 className="font-semibold text-sm mb-1">Prítomnosť cookie lišty</h4>
                          <Badge variant={isPresent ? 'secondary' : 'destructive'}>
                            {isPresent ? 'Áno' : 'Nie'}
                          </Badge>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <h4 className="font-semibold text-sm mb-1">Predvolené správanie</h4>
                          <span className="text-sm">{defaultBehavior}</span>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <h4 className="font-semibold text-sm mb-1">Rovnocenné tlačidlá</h4>
                          <span className="text-sm">{balancedButtons}</span>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <h4 className="font-semibold text-sm mb-1">Detailné nastavenia</h4>
                          <span className="text-sm">{detailedSettings}</span>
                        </div>
                      </div>
                      <div className="p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg">
                        <h4 className="font-semibold mb-2">Celkové hodnotenie UX</h4>
                        <Badge variant={assessment === 'Transparentná' ? 'secondary' : 
                                       assessment === 'Nevyvážená' ? 'outline' : 'destructive'} 
                               className="mb-2">
                          {assessment}
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                          {assessment === 'Chýba' && 'Cookie lišta nie je implementovaná.'}
                          {assessment === 'Nevyvážená' && 'CMP nástroj je prítomný, ale neblokuje trackery pred súhlasom.'}
                          {assessment === 'Transparentná' && 'CMP nástroj správne blokuje trackery až po súhlase používateľa.'}
                        </p>
                      </div>
                      
                      {/* Optional manual capture */}
                      <div className="text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowCaptureDialog(true)}
                          className="text-xs"
                        >
                          <Camera className="h-3 w-3 mr-1" />
                          Doplniť screenshot
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* C) Risk Table */}
      <Card>
        <CardHeader>
          <CardTitle>C) Rizikové oblasti</CardTitle>
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
                  <tr key={index} className="border-b">
                    <td className="p-2">{risk.area}</td>
                    <td className="p-2">
                      {risk.status === 'ok' ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : risk.status === 'warning' ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
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
              <div key={index} className="p-4 border-l-4 border-primary bg-primary/5">
                <h4 className="font-semibold">{rec.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{rec.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Manual Capture Dialog */}
      <Dialog open={showCaptureDialog} onOpenChange={setShowCaptureDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Manuálne zachytenie cookie lišty
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Táto funkcia vykoná nový screenshot cookie lišty a OCR analýzu.
              </AlertDescription>
            </Alert>
            
            <div className="flex gap-2">
              <Button
                onClick={handleSmartCapture}
                disabled={isCapturing}
                className="flex-1"
              >
                {isCapturing ? 'Zachytávam...' : 'Zachytiť'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCaptureDialog(false)}
                disabled={isCapturing}
              >
                Zrušiť
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};