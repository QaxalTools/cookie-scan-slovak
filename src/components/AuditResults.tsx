import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimulationBadge } from '@/components/SimulationBadge';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Shield, 
  Cookie, 
  Eye, 
  Mail,
  Download
} from 'lucide-react';
import { AuditData } from '@/types/audit';

interface AuditResultsProps {
  data: AuditData;
  onGenerateEmail: () => void;
}

export const AuditResults = ({ data, onGenerateEmail }: AuditResultsProps) => {
  const getStatusIcon = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok':
        return <Badge variant="secondary" className="bg-success/10 text-success">OK</Badge>;
      case 'warning':
        return <Badge variant="secondary" className="bg-warning/10 text-warning">Upozornenie</Badge>;
      case 'error':
        return <Badge variant="secondary" className="bg-destructive/10 text-destructive">Riziko</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-2">
          <h2 className="text-2xl font-bold">Výsledky auditu</h2>
          <SimulationBadge />
        </div>
        <p className="text-muted-foreground">
          Komplexná analýza GDPR a ePrivacy súladu
        </p>
      </div>

      {/* A) Manažérsky sumár */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            A) Manažérsky sumár
            <Badge variant={data.managementSummary.verdict === 'súlad' ? 'secondary' : 
                          data.managementSummary.verdict === 'čiastočný súlad' ? 'outline' : 'destructive'}>
              {data.managementSummary.verdict.toUpperCase()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-gradient-accent">
              <h3 className="font-semibold mb-2">Celkové hodnotenie</h3>
              <p className="text-muted-foreground">
                {data.managementSummary.overall}
              </p>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h3 className="font-semibold mb-2">{data.managementSummary.verdict === 'súlad' ? 'Pozitívne zistenia' : 'Identifikované riziká'}</h3>
              <p className="text-muted-foreground">
                {data.managementSummary.risks}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* B) Detailná analýza */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>B) Detailná analýza</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 1. HTTPS */}
          <div>
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              {getStatusIcon(data.detailedAnalysis.https.status)}
              1. HTTPS zabezpečenie
            </h3>
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span>{data.detailedAnalysis.https.comment}</span>
              {getStatusBadge(data.detailedAnalysis.https.status)}
            </div>
          </div>

          {/* 2. Tretie strany */}
          <div>
            <h3 className="font-semibold mb-2">2. Tretie strany ({data.detailedAnalysis.thirdParties.total})</h3>
            <div className="space-y-2">
              {data.detailedAnalysis.thirdParties.list.map((party, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                  <span className="text-sm">{party.domain}</span>
                  <Badge variant="outline">{party.requests} požiadaviek</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Trackery/Beacony */}
          <div>
            <h3 className="font-semibold mb-2">3. Trackery a web-beacony</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Služba</th>
                    <th className="text-left p-2">Host</th>
                    <th className="text-left p-2">Dôkaz (URL/parametre)</th>
                    <th className="text-left p-2">Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {data.detailedAnalysis.trackers.map((tracker, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2">{tracker.service}</td>
                      <td className="p-2 text-xs text-muted-foreground">{tracker.host}</td>
                      <td className="p-2 text-xs font-mono bg-muted/50 rounded px-1">{tracker.evidence}</td>
                      <td className="p-2">{getStatusBadge(tracker.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Cookies */}
          <div>
            <h3 className="font-semibold mb-2">4. Cookies ({data.detailedAnalysis.cookies.total})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Názov</th>
                    <th className="text-left p-2">1P/3P</th>
                    <th className="text-left p-2">Typ</th>
                    <th className="text-left p-2">Expirácia</th>
                    <th className="text-left p-2">Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {data.detailedAnalysis.cookies.details.map((cookie, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 font-mono text-xs">{cookie.name}</td>
                      <td className="p-2">{cookie.type === 'first-party' ? '1P' : '3P'}</td>
                      <td className="p-2">{cookie.category}</td>
                      <td className="p-2">{cookie.expiration}</td>
                      <td className="p-2">{getStatusBadge(cookie.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. LocalStorage/SessionStorage */}
          {data.detailedAnalysis.storage.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">5. LocalStorage/SessionStorage</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Kľúč</th>
                      <th className="text-left p-2">Vzor hodnôt</th>
                      <th className="text-left p-2">Poznámka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.detailedAnalysis.storage.map((storage, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono text-xs">{storage.key}</td>
                        <td className="p-2 font-mono text-xs bg-muted/50 rounded px-1">{storage.valuePattern}</td>
                        <td className="p-2">{storage.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. CMP a časovanie */}
          <div>
            <h3 className="font-semibold mb-2">6. Consent Management a časovanie</h3>
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span>Consent nástroj:</span>
                <Badge variant={data.detailedAnalysis.consentManagement.hasConsentTool ? 'secondary' : 'destructive'}>
                  {data.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný' : 'Chýba'}
                </Badge>
              </div>
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

          {/* 7. Právne zhrnutie */}
          <div>
            <h3 className="font-semibold mb-2">7. Právne zhrnutie</h3>
            <div className="p-4 bg-gradient-accent rounded-lg">
              <p className="text-sm">{data.detailedAnalysis.legalSummary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* C) OK vs. Rizikové */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>C) OK vs. Rizikové</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
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
                    <td className="p-2">{getStatusBadge(risk.status)}</td>
                    <td className="p-2 text-sm text-muted-foreground">{risk.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* D) Checklist odporúčaní */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>D) Checklist odporúčaní</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.recommendations.map((rec, index) => (
              <div key={index} className="p-3 rounded-lg border border-border">
                <h4 className="font-semibold mb-1">{rec.title}</h4>
                <p className="text-sm text-muted-foreground">{rec.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Akcie */}
      <div className="flex gap-4">
        <Button onClick={onGenerateEmail} variant="gradient" className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Vygenerovať email pre klienta
        </Button>
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Stiahnuť PDF správu
        </Button>
      </div>
    </div>
  );
};