import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Mail, Shield, Code } from 'lucide-react';

interface AuditFormProps {
  onSubmit: (input: string, email: string, isHtml: boolean) => void;
  isLoading: boolean;
}

export const AuditForm = ({ onSubmit, isLoading }: AuditFormProps) => {
  const [url, setUrl] = useState('');
  const [htmlCode, setHtmlCode] = useState('');
  const [email, setEmail] = useState('');
  const [inputType, setInputType] = useState<'url' | 'html'>('url');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = inputType === 'url' ? url : htmlCode;
    if (input && email) {
      onSubmit(input, email, inputType === 'html');
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
        <form onSubmit={handleSubmit} className="space-y-6">
          <Tabs value={inputType} onValueChange={(value) => setInputType(value as 'url' | 'html')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url">URL adresa</TabsTrigger>
              <TabsTrigger value="html">HTML kód</TabsTrigger>
            </TabsList>
            
            <TabsContent value="url" className="space-y-4">
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
                    required={inputType === 'url'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Zadajte URL stránky na analýzu. Reálna analýza môže trvať 15-30 sekúnd.
                </p>
              </div>
            </TabsContent>
            
            <TabsContent value="html" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="html" className="text-sm font-medium">
                  HTML zdrojový kód
                </Label>
                <div className="relative">
                  <Code className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Textarea
                    id="html"
                    value={htmlCode}
                    onChange={(e) => setHtmlCode(e.target.value)}
                    placeholder="<html>...</html>"
                    className="min-h-32 pl-10 font-mono text-sm"
                    required={inputType === 'html'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Vložte kompletný HTML kód stránky pre presnejšiu analýzu.
                </p>
              </div>
            </TabsContent>
          </Tabs>

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
            size="lg"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 text-lg"
            disabled={isLoading || (!url && !htmlCode) || !email}
          >
            {isLoading ? "Analyzujem..." : "Spustiť audit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};