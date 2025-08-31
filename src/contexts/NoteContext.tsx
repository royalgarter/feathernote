'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { getNotesDB, addNoteDB, updateNoteDB, deleteNoteDB, getNoteDB, getSharedContentDB, clearSharedContentDB } from '@/lib/db';
import { useToast } from '@/hooks/use-toast';

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
  addNote: (title: string, content: string) => Promise<Note | null>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<Note | undefined>;
  deleteNote: (id: string) => Promise<void>;
  getNote: (id: string) => Promise<Note | undefined>;
  fetchNotes: () => Promise<void>;
}

export const NoteContext = createContext<NoteContextType | null>(null);

export const NoteProvider = ({ children }: { children: React.ReactNode }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
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
      
      setNotes((prevNotes) =>
        prevNotes.map((note) => (note.id === id ? updatedNote : note))
      );
      return updatedNote;
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update note.' });
      return undefined;
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

  return (
    <NoteContext.Provider value={{ notes, loading, addNote, updateNote, deleteNote, getNote, fetchNotes }}>
      {children}
    </NoteContext.Provider>
  );
};
