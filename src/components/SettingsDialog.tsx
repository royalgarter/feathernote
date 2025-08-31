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

export function SettingsDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setS3Bucket(localStorage.getItem('s3Bucket') || '');
      setS3Region(localStorage.getItem('s3Region') || '');
      setS3Endpoint(localStorage.getItem('s3Endpoint') || '');
      setAccessKeyId(localStorage.getItem('accessKeyId') || '');
      setSecretAccessKey(localStorage.getItem('secretAccessKey') || '');
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('s3Bucket', s3Bucket);
    localStorage.setItem('s3Region', s3Region);
    localStorage.setItem('s3Endpoint', s3Endpoint);
    localStorage.setItem('accessKeyId', accessKeyId);
    localStorage.setItem('secretAccessKey', secretAccessKey);
    toast({ title: 'Settings Saved', description: 'Your S3 credentials have been updated.' });
    setIsOpen(false);
  };
  
  const handleSync = () => {
    toast({
      title: 'Sync Initiated',
      description: 'In a real app, notes would now sync with your S3-compatible bucket.',
    });
    // Placeholder for actual S3 sync logic
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
            <Input id="s3-endpoint" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} className="col-span-3" placeholder="Optional: e.g., https://s3.example.com" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="access-key" className="text-right">
              Access Key
            </Label>
            <Input id="access-key" type="password" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} className="col-span-3" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="secret-key" className="text-right">
              Secret Key
            </Label>
            <Input id="secret-key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} className="col-span-3" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSync} variant="secondary">Sync Now</Button>
          <Button onClick={handleSave}>Save Credentials</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
