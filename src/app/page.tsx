'use client';

import React, { useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NoteContext, Note } from '@/contexts/NoteContext';
import { Button } from '@/components/ui/button';
import Header from '@/components/Header';
import { Plus, Trash2, Edit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export default function Home() {
  const router = useRouter();
  const noteContext = useContext(NoteContext);

  if (!noteContext) {
    throw new Error('NoteContext not found');
  }
  const { notes, addNote, deleteNote, loading } = noteContext;
  
  const handleNewNote = async () => {
    const newNote = await addNote('Untitled Note', '');
    if (newNote) {
      router.push(`/notes/${newNote.id}`);
    }
  };

  const sortedNotes = [...notes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto p-4 md:p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl md:text-3xl font-bold font-headline text-foreground">My Notes</h1>
          <Button onClick={handleNewNote}>
            <Plus className="mr-2 h-4 w-4" /> New Note
          </Button>
        </div>

        {loading ? (
           <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
             {[...Array(3)].map((_, i) => (
                <Card key={i} className="bg-card/80 animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2 mt-2"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-4 bg-muted rounded w-full"></div>
                    <div className="h-4 bg-muted rounded w-5/6 mt-2"></div>
                  </CardContent>
                </Card>
             ))}
           </div>
        ) : notes.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sortedNotes.map((note) => (
              <Card key={note.id} className="flex flex-col justify-between transition-shadow hover:shadow-lg">
                <CardHeader className="cursor-pointer" onClick={() => router.push(`/notes/${note.id}`)}>
                  <CardTitle className="font-headline truncate">{note.title}</CardTitle>
                  <CardDescription>
                    Last updated: {new Date(note.updatedAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-end items-center gap-2 p-4 pt-0">
                   <Button variant="ghost" size="icon" onClick={() => router.push(`/notes/${note.id}`)} aria-label="Edit note">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Delete note">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete your note titled "{note.title}".
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteNote(note.id)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <h2 className="text-xl font-semibold text-muted-foreground">No notes yet.</h2>
            <p className="text-muted-foreground mt-2">Click "New Note" to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
