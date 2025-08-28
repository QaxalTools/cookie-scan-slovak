import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      {/* Manažérsky sumár */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Manažérsky sumár
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-gradient-accent">
              <h3 className="font-semibold mb-2">Celkové hodnotenie</h3>
              <p className="text-muted-foreground">
                {data.summary.overall}
              </p>
            </div>
            <div className="p-4 rounded-lg border border-border">
              <h3 className="font-semibold mb-2">Identifikované riziká</h3>
              <p className="text-muted-foreground">
                {data.summary.risks}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailná analýza */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* HTTPS */}
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {getStatusIcon(data.https.status)}
              HTTPS Zabezpečenie
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span>{data.https.description}</span>
              {getStatusBadge(data.https.status)}
            </div>
          </CardContent>
        </Card>

        {/* Cookies */}
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cookie className="h-5 w-5" />
              Cookies ({data.cookies.total})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span>Technické:</span>
              <Badge variant="secondary">{data.cookies.technical}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Analytické:</span>
              <Badge variant="secondary">{data.cookies.analytical}</Badge>
            </div>
            <div className="flex justify-between">
              <span>Marketingové:</span>
              <Badge variant="secondary">{data.cookies.marketing}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Trackery */}
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Trackery & Pixely
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.trackers.map((tracker, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm">{tracker.name}</span>
                  {getStatusBadge(tracker.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tretie strany */}
        <Card className="shadow-soft">
          <CardHeader>
            <CardTitle className="text-lg">Tretie strany</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.thirdParties.map((party, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm">{party.domain}</span>
                  <Badge variant="outline">{party.requests}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabuľka rizík */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>Prehľad rizík a odporúčaní</CardTitle>
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

      {/* Checklist odporúčaní */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle>Checklist odporúčaní</CardTitle>
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