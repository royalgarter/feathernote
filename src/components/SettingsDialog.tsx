'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, BrainCircuit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react"
import { syncNotesToS3 } from '@/lib/s3';
import { getNotesDB } from '@/lib/db';

export function SettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setS3Bucket(localStorage.getItem('s3Bucket') || '');
      setS3Region(localStorage.getItem('s3Region') || '');
      setS3Endpoint(localStorage.getItem('s3Endpoint') || '');
      setAccessKeyId(localStorage.getItem('accessKeyId') || '');
      // We don't re-fill the secret key for security.
      setSecretAccessKey('');
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('s3Bucket', s3Bucket);
    localStorage.setItem('s3Region', s3Region);
    localStorage.setItem('s3Endpoint', s3Endpoint);
    localStorage.setItem('accessKeyId', accessKeyId);
    if(secretAccessKey) {
      localStorage.setItem('secretAccessKey', secretAccessKey);
    }
    toast({ title: 'Settings Saved', description: 'Your S3 credentials have been updated.' });
    setIsOpen(false);
  };
  
  const handleSync = async () => {
    setIsSyncing(true);
    const credentials = {
      bucket: localStorage.getItem('s3Bucket'),
      region: localStorage.getItem('s3Region'),
      endpoint: localStorage.getItem('s3Endpoint'),
      accessKeyId: localStorage.getItem('accessKeyId'),
      secretAccessKey: localStorage.getItem('secretAccessKey'),
    }

    if (!credentials.bucket || !credentials.region || !credentials.accessKeyId || !credentials.secretAccessKey) {
       toast({
        variant: 'destructive',
        title: 'Missing Credentials',
        description: 'Please configure all required S3 settings.',
      });
      setIsSyncing(false);
      return;
    }

    try {
      const notes = await getNotesDB();
      const result = await syncNotesToS3(notes, {
          bucket: credentials.bucket,
          region: credentials.region,
          endpoint: credentials.endpoint || undefined,
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
      });

      toast({
        title: 'Sync Successful',
        description: `Notes successfully uploaded to ${result.Location}`,
      });

    } catch(error) {
       let errorMessage = 'An unknown error occurred.';
       if (error instanceof Error) {
         errorMessage = error.message;
       }
       toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: errorMessage,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="h-5 w-5" />
          <span className="sr-only">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure application settings and data synchronization.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <h3 className="font-semibold text-lg flex items-center">
            <BrainCircuit className="mr-2 h-5 w-5" /> S3 Sync (Optional)
          </h3>
          <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Security Warning</AlertTitle>
            <AlertDescription>
              Storing AWS credentials in the browser is insecure. Use this feature only with IAM credentials that have minimal, restricted permissions. For production use, a secure backend with temporary credentials is required.
            </AlertDescription>
          </Alert>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="s3-bucket" className="text-right">
              Bucket
            </Label>
            <Input id="s3-bucket" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="col-span-3" placeholder="my-feathernote-bucket" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="s3-region" className="text-right">
              Region
            </Label>
            <Input id="s3-region" value={s3Region} onChange={(e) => setS3Region(e.target.value)} className="col-span-3" placeholder="us-east-1" />
          </div>
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="s3-endpoint" className="text-right">
              Endpoint
            </Label>
            <Input id="s3-endpoint" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} className="col-span-3" placeholder="Optional: e.g., s3.us-west-000.backblazeb2.com" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="access-key" className="text-right">
              Access Key
            </Label>
            <Input id="access-key" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="secret-key" className="text-right">
              Secret Key
            </Label>
            <Input id="secret-key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} className="col-span-3" placeholder="Leave blank to keep existing key" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSync} variant="secondary" disabled={isSyncing}>
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
          <Button onClick={handleSave}>Save Credentials</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
