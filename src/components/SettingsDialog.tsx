'use client';

import React, { useState, useEffect, useContext } from 'react';
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
import { uploadNoteToS3, listNotesInS3, downloadNoteFromS3 } from '@/lib/s3';
import { getNotesDB, addNoteDB } from '@/lib/db';
import { NoteContext } from '@/contexts/NoteContext';

export function SettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();
  const noteContext = useContext(NoteContext);

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
      bucket: localStorage.getItem('s3Bucket') || '',
      region: localStorage.getItem('s3Region') || undefined,
      endpoint: localStorage.getItem('s3Endpoint') || undefined,
      accessKeyId: localStorage.getItem('accessKeyId') || '',
      secretAccessKey: localStorage.getItem('secretAccessKey') || '',
    };
  
    if (!credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey || (!credentials.endpoint && !credentials.region)) {
      toast({
        variant: 'destructive',
        title: 'Missing Credentials',
        description: 'Please configure all required S3 settings. Region is optional only when a custom endpoint is used.',
      });
      setIsSyncing(false);
      return;
    }
  
    try {
      const localNotes = await getNotesDB();
      const localNoteIds = new Set(localNotes.map(n => n.id));
      
      // Upload local notes
      await Promise.all(localNotes.map(note => uploadNoteToS3(note, credentials)));
  
      // List remote notes
      const remoteNoteIds = await listNotesInS3(credentials);
  
      // Download notes from S3 that are not present locally
      const missingNoteIds = remoteNoteIds.filter(id => !localNoteIds.has(id));
      let downloadedCount = 0;
      for (const noteId of missingNoteIds) {
        try {
          const note = await downloadNoteFromS3(noteId, credentials);
          await addNoteDB(note);
          downloadedCount++;
        } catch (downloadError) {
          console.error(`Failed to download or add note ${noteId}:`, downloadError);
        }
      }

      await noteContext?.fetchNotes(); // Refresh notes in context
  
      toast({
        title: 'Sync Successful',
        description: `${localNotes.length} notes uploaded, ${downloadedCount} notes downloaded.`,
      });
  
    } catch (error) {
      let errorMessage = 'An unknown error occurred.';
      let errorTitle = 'Sync Failed';
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          errorTitle = 'CORS Policy Error';
          errorMessage = `Could not connect to S3. This is likely a CORS issue. Please configure your S3 bucket's CORS policy to allow PUT and GET requests from this app's origin (${window.location.origin}).`;
        } else {
          errorMessage = error.message;
        }
      }
      toast({
        variant: 'destructive',
        title: errorTitle,
        description: errorMessage,
        duration: 9000,
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
            <Input id="s3-bucket" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} className="col-span-3" placeholder="my-feathernote-bucket" autoComplete="off" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="s3-region" className="text-right">
              Region
            </Label>
            <Input id="s3-region" value={s3Region} onChange={(e) => setS3Region(e.target.value)} className="col-span-3" placeholder="us-east-1 (optional with endpoint)" autoComplete="off" />
          </div>
           <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="s3-endpoint" className="text-right">
              Endpoint
            </Label>
            <Input id="s3-endpoint" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} className="col-span-3" placeholder="Optional: e.g., s3.us-west-000.backblazeb2.com" autoComplete="off" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="access-key" className="text-right">
              Access Key
            </Label>
            <Input id="access-key" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} className="col-span-3" autoComplete="off" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="secret-key" className="text-right">
              Secret Key
            </Label>
            <Input id="secret-key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} className="col-span-3" placeholder="Leave blank to keep existing key" autoComplete="off" />
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
