
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
import { Settings, BrainCircuit, Copy, FileInput, FileOutput, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Terminal } from "lucide-react"
import { NoteContext } from '@/contexts/NoteContext';
import { AuthContext } from '@/contexts/AuthContext';
import { Textarea } from './ui/textarea';
import { encryptSettings, decryptSettings } from '@/lib/crypto';

interface StoredSettings {
    s3Bucket: string;
    s3Region: string;
    s3Endpoint: string;
    s3Subfolder: string;
    accessKeyId: string;
    secretAccessKey?: string; // Secret key is optional during load
}

export function SettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Subfolder, setS3Subfolder] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const [exportString, setExportString] = useState('');
  const [importString, setImportString] = useState('');
  const { toast } = useToast();
  const noteContext = useContext(NoteContext);
  const authContext = useContext(AuthContext);

  const getSettingsStorageKey = useCallback(() => {
    if (!authContext?.user) return null;
    return `feathernote-settings-${authContext.user.id}`;
  }, [authContext?.user]);


  const loadSettingsFromStorage = useCallback(async () => {
    if (!authContext?.user) return;
    const key = getSettingsStorageKey();
    if (!key) return;

    const encryptedSettings = localStorage.getItem(key);
    if (encryptedSettings) {
      const decrypted = await decryptSettings<StoredSettings>(encryptedSettings, authContext.user.id);
      if (decrypted) {
        setS3Bucket(decrypted.s3Bucket || '');
        setS3Region(decrypted.s3Region || '');
        setS3Endpoint(decrypted.s3Endpoint || '');
        setS3Subfolder(decrypted.s3Subfolder || '');
        setAccessKeyId(decrypted.accessKeyId || '');
        setSecretAccessKey(''); // Always require re-entry of secret key
      }
    }
  }, [authContext?.user, getSettingsStorageKey]);

  useEffect(() => {
    if (isOpen) {
      loadSettingsFromStorage();
    }
  }, [isOpen, loadSettingsFromStorage]);

  const handleSave = useCallback(async () => {
    if (!authContext?.user) {
        toast({ variant: 'destructive', title: 'Not Logged In', description: 'You must be logged in to save settings.' });
        return;
    }
    const key = getSettingsStorageKey();
    if (!key) return;

    const settingsToStore: StoredSettings = {
        s3Bucket,
        s3Region,
        s3Endpoint,
        s3Subfolder,
        accessKeyId,
    };
    if (secretAccessKey) {
        settingsToStore.secretAccessKey = secretAccessKey;
    }

    const encryptedSettings = await encryptSettings(settingsToStore, authContext.user.id);
    localStorage.setItem(key, encryptedSettings);
    
    // This is a separate unencrypted value so the sync function in NoteContext
    // knows that credentials *might* be available without needing user context
    localStorage.setItem('s3Configured', 'true');
    
    toast({ title: 'Settings Saved', description: 'Your encrypted S3 credentials have been updated.' });
    setIsOpen(false);
  }, [s3Bucket, s3Region, s3Endpoint, s3Subfolder, accessKeyId, secretAccessKey, toast, authContext?.user, getSettingsStorageKey]);

  const handleSync = useCallback(async () => {
    setIsManualSyncing(true);
    if (noteContext?.syncNotes) {
      await noteContext.syncNotes(false); // Pass false to indicate a manual sync
    }
    setIsManualSyncing(false);
  }, [noteContext]);

  const handleExport = useCallback(async () => {
    if (!authContext?.user) return;
    const key = getSettingsStorageKey();
    if (!key) return;
    
    const encryptedString = localStorage.getItem(key);
    if (encryptedString) {
        setExportString(encryptedString);
    } else {
        toast({ variant: 'destructive', title: 'Nothing to Export', description: 'No saved settings found.' });
    }
  }, [authContext?.user, getSettingsStorageKey, toast]);

  const copyExportStringToClipboard = useCallback(() => {
    navigator.clipboard.writeText(exportString);
    toast({ title: 'Copied!', description: 'Encrypted settings string copied to clipboard.' })
  }, [exportString, toast]);

  const handleImport = useCallback(() => {
    if (!authContext?.user) {
        toast({ variant: 'destructive', title: 'Not Logged In', description: 'You must be logged in to import settings.' });
        return;
    }
    const key = getSettingsStorageKey();
    if (!key) return;

    try {
        // Basic validation that it looks like our encrypted object
        const parsed = JSON.parse(importString);
        if (parsed.salt && parsed.iv && parsed.content) {
            localStorage.setItem(key, importString);
            loadSettingsFromStorage();
            setImportString('');
            toast({ title: 'Settings Imported', description: 'Your encrypted S3 credentials have been imported.' });
            setIsOpen(false); // Close main dialog after successful import
        } else {
            throw new Error('Invalid or incomplete settings data.');
        }
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Import Failed', description: 'The provided string is not a valid encrypted settings configuration.' })
    }
  }, [importString, loadSettingsFromStorage, toast, authContext?.user, getSettingsStorageKey]);
  
  const isSyncConfigured = !!authContext?.user;
  const isSyncButtonDisabled = !isSyncConfigured || isManualSyncing || (noteContext?.isSyncing ?? false);

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
            <BrainCircuit className="mr-2 h-5 w-5" /> S3 Sync (Login Required)
          </h3>
          {!isSyncConfigured && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Login Required</AlertTitle>
              <AlertDescription>
                Please sign in with your Google account to enable, configure, and use the S3 sync feature.
              </AlertDescription>
            </Alert>
          )}
           <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Security Note</AlertTitle>
            <AlertDescription>
              Your credentials are encrypted in this browser, tied to your Google account ID. Use IAM credentials with minimal, restricted permissions.
            </AlertDescription>
          </Alert>
          <fieldset disabled={!isSyncConfigured} className="grid gap-4">
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
          </fieldset>
        </div>

        <DialogFooter className="sm:justify-between flex-wrap gap-2">
          <div className='flex gap-2'>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" onClick={() => setImportString('')} disabled={!isSyncConfigured}>
                  <FileInput /> Import
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import S3 Settings</DialogTitle>
                  <DialogDescription>
                    Paste the encrypted settings string from another device to import your S3 configuration.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={importString}
                  onChange={(e) => setImportString(e.target.value)}
                  placeholder="Paste your encrypted settings string here..."
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
                <Button variant="outline" onClick={handleExport} disabled={!isSyncConfigured}>
                  <FileOutput /> Export
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Export S3 Settings</DialogTitle>
                  <DialogDescription>
                    Copy this encrypted string and import it on another device to transfer your S3 configuration.
                  </DialogDescription>
                </DialogHeader>
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
            <Button onClick={handleSync} variant="secondary" disabled={isSyncButtonDisabled}>
              {isManualSyncing ? 'Syncing...' : (noteContext?.isSyncing ? 'Syncing...' : 'Sync Now')}
            </Button>
            <Button onClick={handleSave} disabled={!isSyncConfigured}>Save Credentials</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
