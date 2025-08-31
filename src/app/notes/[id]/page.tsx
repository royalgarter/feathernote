'use client';

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { NoteContext } from '@/contexts/NoteContext';
import Header from '@/components/Header';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, Clock, Bell, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';

export default function NotePage() {
  const router = useRouter();
  const params = useParams();
  const noteId = params.id as string;
  const { toast } = useToast();

  const noteContext = useContext(NoteContext);
  if (!noteContext) {
    throw new Error('NoteContext not found');
  }
  const { getNote, updateNote, deleteNote } = noteContext;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reminder, setReminder] = useState<Date | undefined>(undefined);

  const debounce = <F extends (...args: any[]) => any>(func: F, delay: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func(...args);
      }, delay);
    };
  };

  const saveNote = useCallback(async (newTitle: string, newContent: string) => {
    setIsSaving(true);
    await updateNote(noteId, { title: newTitle, content: newContent });
    setTimeout(() => setIsSaving(false), 1000);
  }, [noteId, updateNote]);

  const debouncedSave = useCallback(debounce(saveNote, 1500), [saveNote]);

  useEffect(() => {
    const fetchNote = async () => {
      setIsLoading(true);
      const note = await getNote(noteId);
      if (note) {
        setTitle(note.title);
        setContent(note.content);
        setReminder(note.reminder ? new Date(note.reminder) : undefined);
      } else {
        router.push('/');
      }
      setIsLoading(false);
    };
    if (noteId) {
      fetchNote();
    }
  }, [noteId, getNote, router]);
  
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    debouncedSave(e.target.value, content);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    debouncedSave(title, e.target.value);
  };
  
  const handleSetReminder = async (date: Date | undefined) => {
      if (!date) return;
      setReminder(date);
      await updateNote(noteId, { reminder: date.toISOString() });
      toast({
          title: "Reminder Set",
          description: `You will be notified on ${date.toLocaleString()}.`,
      });

      if ('Notification' in window && Notification.permission === 'granted') {
         // Logic to schedule notification would go here.
         // This is complex with service workers and would typically involve a server.
         // For now, we rely on the visual cue and the saved date.
      } else if ('Notification' in window) {
          Notification.requestPermission();
      }
  };

  const handleDelete = async () => {
    await deleteNote(noteId);
    router.push('/');
  }

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-grow container mx-auto p-4 animate-pulse">
            <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
            <div className="h-12 bg-muted rounded w-3/4 mb-6"></div>
            <div className="grid md:grid-cols-2 gap-4 flex-grow">
                <div className="h-full bg-muted rounded"></div>
                <div className="h-full bg-muted rounded"></div>
            </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen">
      <Header />
      <main className="flex-grow container mx-auto p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex justify-between items-center flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => router.push('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Notes
          </Button>
          <div className="flex items-center gap-2">
            <div className={`text-sm text-muted-foreground transition-opacity duration-300 ${isSaving ? 'opacity-100' : 'opacity-0'}`}>
                <Save className="h-4 w-4 inline-block mr-1" /> Saving...
            </div>
            
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                        <Bell className="mr-2 h-4 w-4" />
                        {reminder ? `Remind on ${reminder.toLocaleDateString()}` : "Set Reminder"}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={reminder}
                        onSelect={handleSetReminder}
                        initialFocus
                    />
                </PopoverContent>
            </Popover>

             <Button variant="destructive-outline" size="sm" onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
        
        <Input
            value={title}
            onChange={handleTitleChange}
            placeholder="Note Title"
            className="text-2xl font-bold font-headline h-auto p-2 border-0 focus-visible:ring-0 shadow-none flex-shrink-0"
        />

        <div className="grid md:grid-cols-2 gap-4 flex-grow min-h-0">
          <div className="flex flex-col">
            <label htmlFor="editor" className="text-sm font-medium text-muted-foreground mb-2">Markdown</label>
            <Textarea
              id="editor"
              value={content}
              onChange={handleContentChange}
              placeholder="Start writing your note here..."
              className="h-full resize-none text-base leading-relaxed"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm font-medium text-muted-foreground mb-2">Preview</label>
            <div className="bg-muted/50 p-4 rounded-md h-full overflow-auto prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-body text-base leading-relaxed">{content}</pre>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
