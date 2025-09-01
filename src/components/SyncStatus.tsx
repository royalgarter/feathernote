'use client';

import React, { useContext } from 'react';
import { NoteContext } from '@/contexts/NoteContext';
import { Cloud, Loader } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const SyncStatus = () => {
  const noteContext = useContext(NoteContext);

  if (!noteContext || !noteContext.isSyncing) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader className="h-5 w-5 animate-spin" />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Syncing in progress...</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default SyncStatus;
