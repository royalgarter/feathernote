'use client';

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import { getNotesDB, addNoteDB, updateNoteDB, deleteNoteDB, getNoteDB, getSharedContentDB, clearSharedContentDB } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';
import { uploadNoteToS3, listNotesInS3, downloadNoteFromS3 } from '@/lib/s3';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  reminder?: string;
}

interface NoteContextType {
  notes: Note[];
  loading: boolean;
  isSyncing: boolean;
  addNote: (title: string, content: string) => Promise<Note | null>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  getNote: (id: string) => Promise<Note | undefined>;
  fetchNotes: () => Promise<void>;
  syncNotes: (isSilent?: boolean) => Promise<void>;
}

export const NoteContext = createContext<NoteContextType | null>(null);

export const NoteProvider = ({ children }: { children: React.ReactNode }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      const notesFromDB = await getNotesDB();
      setNotes(notesFromDB);
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not load notes.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const processSharedContent = useCallback(async () => {
    try {
      const sharedItems = await getSharedContentDB();
      if (sharedItems.length > 0) {
        for (const item of sharedItems) {
            await addNote('Shared Note', item.content);
        }
        await clearSharedContentDB();
        await fetchNotes(); // Refresh notes list
        toast({
          title: 'Content Imported',
          description: `${sharedItems.length} item(s) have been added to your notes.`,
        });
      }
    } catch (error) {
      console.error('Failed to process shared content', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not import shared content.' });
    }
  }, [toast, fetchNotes]);

  useEffect(() => {
    processSharedContent();
  }, [processSharedContent]);


  const addNote = async (title: string, content: string): Promise<Note | null> => {
    try {
      const now = new Date().toISOString();
      const newNote: Note = {
        id: crypto.randomUUID(),
        title,
        content,
        createdAt: now,
        updatedAt: now,
      };
      await addNoteDB(newNote);
      setNotes((prevNotes) => [newNote, ...prevNotes]);
      return newNote;
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not create note.' });
      return null;
    }
  };

  const updateNote = async (id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) => {
    try {
      const noteToUpdate = await getNoteDB(id);
      if (!noteToUpdate) throw new Error('Note not found');

      const updatedNote = { ...noteToUpdate, ...updates, updatedAt: new Date().toISOString() };
      await updateNoteDB(updatedNote);
      // Do not update the global state here to prevent re-renders on the note page
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update note.' });
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await deleteNoteDB(id);
      setNotes((prevNotes) => prevNotes.filter((note) => note.id !== id));
      toast({ title: 'Note Deleted', description: 'Your note has been successfully deleted.' });
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete note.' });
    }
  };

  const getNote = async (id: string) => {
    try {
      return await getNoteDB(id);
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch note.' });
      return undefined;
    }
  };

  const syncNotes = useCallback(async (isSilent = false) => {
    const credentials = {
      bucket: localStorage.getItem('s3Bucket') || '',
      region: localStorage.getItem('s3Region') || undefined,
      endpoint: localStorage.getItem('s3Endpoint') || undefined,
      subfolder: localStorage.getItem('s3Subfolder') || undefined,
      accessKeyId: localStorage.getItem('accessKeyId') || '',
      secretAccessKey: localStorage.getItem('secretAccessKey') || '',
    };
  
    if (!credentials.bucket || !credentials.accessKeyId || !credentials.secretAccessKey) {
      if (!isSilent) {
        toast({
          variant: 'destructive',
          title: 'Missing Credentials',
          description: 'Please configure your S3 Bucket, Access Key, and Secret Key.',
        });
      }
      return;
    }
  
    setIsSyncing(true);
    try {
      const localNotes = await getNotesDB();
      const localNotesMap = new Map(localNotes.map(n => [n.id, n]));
      const remoteNoteIds = await listNotesInS3(credentials);
      
      let uploadedCount = 0;
      let downloadedCount = 0;
      
      // Upload local notes that are new or updated
      for (const localNote of localNotes) {
        const remoteNote = remoteNoteIds.find(id => id === localNote.id) ? await downloadNoteFromS3(localNote.id, credentials).catch(() => null) : null;
        if (!remoteNote || new Date(localNote.updatedAt) > new Date(remoteNote.updatedAt)) {
          await uploadNoteToS3(localNote, credentials);
          uploadedCount++;
        }
      }

      // Download remote notes that are new or updated
      for (const noteId of remoteNoteIds) {
        const localNote = localNotesMap.get(noteId);
        const remoteNote = await downloadNoteFromS3(noteId, credentials);
        if (!localNote || new Date(remoteNote.updatedAt) > new Date(localNote.updatedAt)) {
          await updateNoteDB(remoteNote);
          downloadedCount++;
        }
      }
      
      if (downloadedCount > 0) {
        await fetchNotes();
      }

      if (!isSilent) {
        toast({
          title: 'Sync Successful',
          description: `Uploaded: ${uploadedCount}, Downloaded/Updated: ${downloadedCount}.`,
        });
      }
  
    } catch (error) {
      if (isSilent) {
        console.error('Silent sync failed:', error);
        return;
      }

      let errorMessage = 'An unknown error occurred.';
      let errorTitle = 'Sync Failed';
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          errorTitle = 'CORS Policy Error';
          errorMessage = `Could not connect to S3. This is likely a CORS issue. Please configure your S3 bucket's CORS policy to allow PUT, GET and LIST requests from this app's origin (${window.location.origin}).`;
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
  }, [toast, fetchNotes]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      syncNotes(true); // Run a silent sync
    }, 2 * 60 * 1000); // Every 2 minutes
  
    return () => clearInterval(intervalId);
  }, [syncNotes]);

  return (
    <NoteContext.Provider value={{ notes, loading, isSyncing, addNote, updateNote, deleteNote, getNote, fetchNotes, syncNotes }}>
      {children}
    </NoteContext.Provider>
  );
};
