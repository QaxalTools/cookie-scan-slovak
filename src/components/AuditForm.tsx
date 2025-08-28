import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Globe, Mail, Shield } from 'lucide-react';

interface AuditFormProps {
  onSubmit: (url: string, email: string) => void;
  isLoading: boolean;
}

export const AuditForm = ({ onSubmit, isLoading }: AuditFormProps) => {
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url && email) {
      onSubmit(url, email);
    }
  };

  return (
    <Card className="shadow-large">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary">
          <Shield className="h-8 w-8 text-primary-foreground" />
        </div>
        <CardTitle className="text-2xl">Cookie & Tracking Audit</CardTitle>
        <p className="text-muted-foreground">
          Kompletná analýza súladu s GDPR a ePrivacy direktivou
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url" className="text-sm font-medium">
              URL webovej stránky
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="pl-10"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Váš email
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vas@email.sk"
                className="pl-10"
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            variant="gradient"
            size="lg"
            className="w-full"
            disabled={isLoading || !url || !email}
          >
            {isLoading ? "Analyzujem..." : "Spustiť audit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};