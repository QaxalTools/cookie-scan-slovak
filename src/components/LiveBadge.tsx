import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle } from 'lucide-react';

interface LiveBadgeProps {
  className?: string;
}

export const LiveBadge = ({ className }: LiveBadgeProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-success border-success/50 bg-success/10 ${className} cursor-help`}>
          <CheckCircle className="h-3 w-3 mr-1" />
          Live režim
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <p className="text-sm">
          Výsledky sú založené na reálnych dátach načítaných zo servera. 
          Analýza zahŕňa aktuálny obsah webstránky.
        </p>
      </TooltipContent>
    </Tooltip>
  );
};