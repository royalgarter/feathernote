'use client';

import React, { useContext } from 'react';
import { useRouter } from 'next/navigation';
import { Note, NoteContext } from '@/contexts/NoteContext';
import { Button } from '@/components/ui/button';
import { Trash2, Edit } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
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
} from '@/components/ui/alert-dialog';

interface NoteCardProps {
  note: Note;
}

const NoteCard: React.FC<NoteCardProps> = ({ note }) => {
  const router = useRouter();
  const noteContext = useContext(NoteContext);

  if (!noteContext) {
    throw new Error('NoteContext not found');
  }
  const { deleteNote } = noteContext;

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Prevent navigation when clicking on buttons inside the card
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    router.push(`/notes/${note.id}`);
  };
  
  const contentPreview = note.content ? `${note.content.substring(0, 100)}...` : 'No content preview';

  return (
    <Card
      onClick={handleCardClick}
      className="flex flex-col justify-between transition-shadow hover:shadow-lg cursor-pointer h-full"
    >
      <div className="flex-grow">
        <CardHeader>
          <CardTitle className="font-headline truncate">{note.title}</CardTitle>
          <CardDescription>
            Last updated: {new Date(note.updatedAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
           <p className="text-sm text-muted-foreground line-clamp-3">{contentPreview}</p>
        </CardContent>
      </div>
      <CardFooter className="flex justify-end items-center gap-2 p-4 pt-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/notes/${note.id}`);
          }}
          aria-label="Edit note"
        >
          <Edit className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              aria-label="Delete note"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete your
                note titled "{note.title}".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteNote(note.id)}
                className="bg-destructive hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
};

export default NoteCard;
