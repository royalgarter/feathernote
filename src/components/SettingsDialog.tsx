
'use client';

import React, { useState, useEffect, useContext, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, BrainCircuit, Copy, FileInput, FileOutput } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react"
import { NoteContext } from '@/contexts/NoteContext';
import { Textarea } from './ui/textarea';

export function SettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Subfolder, setS3Subfolder] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [exportString, setExportString] = useState('');
  const [importString, setImportString] = useState('');
  const { toast } = useToast();
  const noteContext = useContext(NoteContext);

  const loadSettingsFromStorage = useCallback(() => {
    setS3Bucket(localStorage.getItem('s3Bucket') || '');
    setS3Region(localStorage.getItem('s3Region') || '');
    setS3Endpoint(localStorage.getItem('s3Endpoint') || '');
    setS3Subfolder(localStorage.getItem('s3Subfolder') || '');
    setAccessKeyId(localStorage.getItem('accessKeyId') || '');
    setSecretAccessKey(''); // Never re-populate secret key
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSettingsFromStorage();
    }
  }, [isOpen, loadSettingsFromStorage]);

  const handleSave = useCallback(() => {
    localStorage.setItem('s3Bucket', s3Bucket);
    localStorage.setItem('s3Region', s3Region);
    localStorage.setItem('s3Endpoint', s3Endpoint);
    localStorage.setItem('s3Subfolder', s3Subfolder);
    localStorage.setItem('accessKeyId', accessKeyId);
    if(secretAccessKey) {
      localStorage.setItem('secretAccessKey', secretAccessKey);
    }
    toast({ title: 'Settings Saved', description: 'Your S3 credentials have been updated.' });
    setIsOpen(false);
  }, [s3Bucket, s3Region, s3Endpoint, s3Subfolder, accessKeyId, secretAccessKey, toast]);
  
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    if(noteContext?.syncNotes) {
        await noteContext.syncNotes();
    }
    setIsSyncing(false);
  }, [noteContext]);

  const handleExport = useCallback(() => {
    const settings = {
      s3Bucket: localStorage.getItem('s3Bucket') || '',
      s3Region: localStorage.getItem('s3Region') || '',
      s3Endpoint: localStorage.getItem('s3Endpoint') || '',
      s3Subfolder: localStorage.getItem('s3Subfolder') || '',
      accessKeyId: localStorage.getItem('accessKeyId') || '',
      secretAccessKey: localStorage.getItem('secretAccessKey') || '',
    };
    const settingsString = JSON.stringify(settings);
    setExportString(btoa(settingsString));
  }, []);

  const copyExportStringToClipboard = useCallback(() => {
    navigator.clipboard.writeText(exportString);
    toast({title: 'Copied!', description: 'Settings string copied to clipboard.'})
  }, [exportString, toast]);
  
  const handleImport = useCallback(() => {
    try {
      const decodedString = atob(importString);
      const settings = JSON.parse(decodedString);
      
      const { s3Bucket, s3Region, s3Endpoint, s3Subfolder, accessKeyId, secretAccessKey } = settings;

      if(s3Bucket && accessKeyId && secretAccessKey) {
        localStorage.setItem('s3Bucket', s3Bucket);
        localStorage.setItem('s3Region', s3Region || '');
        localStorage.setItem('s3Endpoint', s3Endpoint || '');
        localStorage.setItem('s3Subfolder', s3Subfolder || '');
        localStorage.setItem('accessKeyId', accessKeyId);
        localStorage.setItem('secretAccessKey', secretAccessKey);
        
        loadSettingsFromStorage();
        setImportString('');
        toast({ title: 'Settings Imported', description: 'Your S3 credentials have been imported successfully.'});
      } else {
        throw new Error('Invalid or incomplete settings data.');
      }
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Import Failed', description: 'The provided string is not a valid settings configuration.'})
    }
  }, [importString, toast, loadSettingsFromStorage]);

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
            <Label htmlFor="s3-subfolder" className="text-right">
              Subfolder
            </Label>
            <Input id="s3-subfolder" value={s3Subfolder} onChange={(e) => setS3Subfolder(e.target.value)} className="col-span-3" placeholder="Optional: notes/personal" autoComplete="off" />
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
            <Input id="secret-key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} className="col-span-3" placeholder="Leave blank to keep existing key" autoComplete="new-password" />
          </div>
        </div>

        <DialogFooter className="sm:justify-between flex-wrap gap-2">
            <div className='flex gap-2'>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="outline" onClick={() => setImportString('')}>
                            <FileInput /> Import
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Import S3 Settings</DialogTitle>
                            <DialogDescription>
                                Paste the settings string from another device to import your S3 configuration.
                            </DialogDescription>
                        </DialogHeader>
                        <Textarea
                            value={importString}
                            onChange={(e) => setImportString(e.target.value)}
                            placeholder="Paste your settings string here..."
                            rows={5}
                        />
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button onClick={handleImport}>Import and Save</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="outline" onClick={handleExport}>
                            <FileOutput /> Export
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Export S3 Settings</DialogTitle>
                            <DialogDescription>
                                Copy this string and import it on another device to transfer your S3 configuration.
                            </DialogDescription>
                        </Header>
                        <div className="relative">
                            <Textarea
                                readOnly
                                value={exportString}
                                rows={5}
                            />
                            <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-7 w-7" onClick={copyExportStringToClipboard}>
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
            <div className="flex gap-2">
                <Button onClick={handleSync} variant="secondary" disabled={isSyncing}>
                    {isSyncing ? 'Syncing...' : 'Sync Now'}
                </Button>
                <Button onClick={handleSave}>Save Credentials</Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
