import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';

interface SimulationBadgeProps {
  className?: string;
}

export const SimulationBadge = ({ className }: SimulationBadgeProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-warning border-warning/50 bg-warning/10 ${className} cursor-help`}>
          <AlertTriangle className="h-3 w-3 mr-1" />
          Simulačný režim
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm">
        <p className="text-sm">
          Výsledky sú založené na simulácii kvôli obmedzeniam prehliadača (CORS). 
          Pre presné výsledky odporúčame použitie profesionálneho nástroja.
        </p>
      </TooltipContent>
    </Tooltip>
  );
};