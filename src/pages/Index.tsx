import { useState } from 'react';
import { AuditForm } from '@/components/AuditForm';
import { AuditResults } from '@/components/AuditResults';
import { EmailDraft } from '@/components/EmailDraft';
import { simulateAudit, generateEmailDraft } from '@/utils/auditSimulator';
import { AuditData } from '@/types/audit';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const { toast } = useToast();

  const handleAuditSubmit = async (input: string, email: string, isHtml: boolean) => {
    setIsLoading(true);
    setClientEmail(email);
    
    try {
      const data = await simulateAudit(input, isHtml);
      setAuditData(data);
      toast({
        title: "Audit dokončený",
        description: "Analýza webovej stránky bola úspešne dokončená",
      });
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa vykonať audit webovej stránky",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateEmail = () => {
    if (auditData) {
      setShowEmailDraft(true);
    }
  };

  const emailContent = auditData ? generateEmailDraft(auditData, clientEmail) : '';

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            GDPR Cookie Audit Tool
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Profesionálny nástroj na audit súladu s GDPR a ePrivacy direktívou. 
            Analyzuje cookies, trackery a consent management na vašej webovej stránke.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          {!auditData && !showEmailDraft && (
            <div className="max-w-md mx-auto">
              <AuditForm onSubmit={handleAuditSubmit} isLoading={isLoading} />
            </div>
          )}

          {auditData && !showEmailDraft && (
            <AuditResults data={auditData} onGenerateEmail={handleGenerateEmail} />
          )}

          {showEmailDraft && (
            <EmailDraft 
              emailContent={emailContent} 
              onClose={() => setShowEmailDraft(false)} 
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
