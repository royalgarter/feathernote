'use client';

import { useEffect } from 'react';
import { useToast } from './ui/use-toast';

const SWRegistration = () => {
  const { toast } = useToast();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/serviceworker.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
          toast({
            variant: "destructive",
            title: "Offline Mode Failed",
            description: "Could not initialize offline features."
          })
        });
    }
  }, [toast]);

  return null;
};

export default SWRegistration;
