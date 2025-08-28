import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Send } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

interface EmailDraftProps {
  emailContent: string;
  onClose: () => void;
}

export const EmailDraft = ({ emailContent, onClose }: EmailDraftProps) => {
  const [content, setContent] = useState(emailContent);
  const { toast } = useToast();

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast({
        title: "Skopírované",
        description: "Email bol skopírovaný do schránky",
      });
    } catch (err) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa skopírovať text",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="shadow-large">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Draft emailu pre klienta
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[400px] font-mono text-sm"
          placeholder="Email content..."
        />
        <div className="flex gap-2">
          <Button onClick={copyToClipboard} variant="outline" className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Kopírovať do schránky
          </Button>
          <Button onClick={onClose} variant="secondary">
            Zavrieť
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};