'use client';

import React, { useContext } from 'react';
import { useRouter } from 'next/navigation';
import { NoteContext } from '@/contexts/NoteContext';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import NoteCard from '@/components/NoteCard';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AppShell,
  AppShellContent,
  AppShellHeader,
} from '@/components/AppShell';
import Header from '@/components/Header';
import { format } from 'date-fns';

export default function Home() {
  const router = useRouter();
  const noteContext = useContext(NoteContext);

  if (!noteContext) {
    throw new Error('NoteContext not found');
  }
  const { notes, addNote, loading } = noteContext;

  const handleNewNote = async () => {
    const defaultTitle = `Note from ${format(new Date(), 'PPP p')}`;
    const newNote = await addNote(defaultTitle, '');
    if (newNote) {
      router.push(`/notes/${newNote.id}`);
    }
  };

  const sortedNotes = [...notes].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <AppShell>
      <AppShellHeader>
        <Header>
          <div className="flex items-center gap-4">
            <Button onClick={handleNewNote}>
              <Plus />
              New Note
            </Button>
          </div>
        </Header>
      </AppShellHeader>
      <AppShellContent>
        <div className="flex justify-between items-center mb-6 px-4 md:px-6">
          <h1 className="text-2xl md:text-3xl font-bold font-headline text-foreground">
            My Notes
          </h1>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 px-4 md:px-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex flex-col gap-4 p-4 rounded-lg border">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex justify-end mt-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : notes.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 px-4 md:px-6">
            {sortedNotes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <h2 className="text-xl font-semibold text-muted-foreground">
              No notes yet.
            </h2>
            <p className="text-muted-foreground mt-2">
              Click "New Note" to get started.
            </p>
          </div>
        )}
      </AppShellContent>
    </AppShell>
  );
}
