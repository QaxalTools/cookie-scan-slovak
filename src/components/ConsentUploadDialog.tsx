import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Loader2 } from 'lucide-react';
import { analyzeConsentScreenshot } from '@/utils/consentOcr';
import { useToast } from '@/hooks/use-toast';

interface ConsentUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (screenshot: string, ocrAnalysis: any) => void;
  onSkip: () => void;
}

export const ConsentUploadDialog = ({ isOpen, onClose, onUpload, onSkip }: ConsentUploadDialogProps) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      toast({
        title: "Neplatný súbor",
        description: "Prosím vyberte obrázok",
        variant: "destructive"
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const screenshot = e.target?.result as string;
        
        // Perform OCR analysis
        const ocrResult = await analyzeConsentScreenshot(screenshot);
        
        if (ocrResult.success && ocrResult.analysis) {
          onUpload(screenshot, ocrResult.analysis);
          toast({
            title: "Analýza dokončená",
            description: "Screenshot bol úspešne analyzovaný",
          });
        } else {
          onUpload(screenshot, null);
          toast({
            title: "Screenshot nahraný",
            description: "OCR analýza zlyhala, ale screenshot bol uložený",
            variant: "default"
          });
        }
        
        onClose();
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Chyba pri nahrávaní",
        description: "Nepodarilo sa spracovať obrázok",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Screenshot cookie lišty
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Automatické zachytenie cookie lišty sa nepodarilo. Môžete nahrať vlastný screenshot 
            alebo analýzu preskočiť.
          </p>
          
          <div className="space-y-3">
            <div>
              <Label htmlFor="screenshot-upload">Nahrať screenshot</Label>
              <Input
                id="screenshot-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={isAnalyzing}
                className="mt-1"
              />
            </div>
            
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzujem screenshot...
              </div>
            )}
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleSkip}
              disabled={isAnalyzing}
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Preskočiť
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};