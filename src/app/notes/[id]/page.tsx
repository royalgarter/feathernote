'use client';

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { NoteContext } from '@/contexts/NoteContext';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bell, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import {
  AppShell,
  AppShellContent,
  AppShellHeader,
} from '@/components/AppShell';
import Header from '@/components/Header';
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
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function NotePage() {
  const router = useRouter();
  const params = useParams();
  const noteId = params.id as string;
  const { toast } = useToast();

  const noteContext = useContext(NoteContext);
  if (!noteContext) {
    throw new Error('NoteContext not found');
  }
  const { getNote, updateNote, deleteNote, syncNotes } = noteContext;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [reminder, setReminder] = useState<Date | undefined>(undefined);

  const debounce = <F extends (...args: any[]) => any>(
    func: F,
    delay: number
  ) => {
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

  const saveNote = useCallback(
    async (newTitle: string, newContent: string) => {
      await updateNote(noteId, { title: newTitle, content: newContent });
    },
    [noteId, updateNote]
  );

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
  
    const scheduleNotification = (permission: NotificationPermission) => {
      if (permission === 'granted') {
        const now = new Date();
        if (date > now) {
          const delay = date.getTime() - now.getTime();
  
          navigator.serviceWorker.ready.then(registration => {
            registration.showNotification('FeatherNote Reminder', {
              body: `Reminder for your note: "${title}"`,
              tag: `reminder-${noteId}`,
              showTrigger: new (window as any).TimestampTrigger(Date.now() + delay),
            });
          });
  
          toast({
            title: 'Reminder Set',
            description: `You will be notified on ${date.toLocaleString()}.`,
          });
        } else {
          toast({
            variant: 'destructive',
            title: 'Invalid Date',
            description: 'Please select a future date and time for the reminder.',
          });
          return; // Don't save reminder if it's in the past
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Notifications Blocked',
          description: 'Please enable notifications in your browser settings to set reminders.',
        });
        return; // Don't save reminder if permission denied
      }
      // Only set reminder if notification was scheduled
      setReminder(date);
      updateNote(noteId, { reminder: date.toISOString() });
    };
  
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        scheduleNotification('granted');
      } else {
        Notification.requestPermission().then(permission => {
          scheduleNotification(permission);
        });
      }
    } else {
      toast({
        variant: 'destructive',
        title: 'Unsupported Browser',
        description: 'Your browser does not support notifications.',
      });
    }
  };

  const handleDelete = async () => {
    await deleteNote(noteId);
    router.push('/');
  };

  const handleBack = async () => {
    await syncNotes(true); // Sync silently before going back
    router.push('/');
  };

  if (isLoading) {
    return (
      <AppShell>
        <AppShellHeader>
          <Header />
        </AppShellHeader>
        <AppShellContent>
          <main className="flex-grow container mx-auto p-4 animate-pulse">
            <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
            <div className="h-12 bg-muted rounded w-3/4 mb-6"></div>
            <div className="grid md:grid-cols-2 gap-4 flex-grow">
              <div className="h-full bg-muted rounded"></div>
              <div className="h-full bg-muted rounded"></div>
            </div>
          </main>
        </AppShellContent>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AppShellHeader>
        <Header>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft />
              Back
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Bell />
                  {reminder
                    ? `Remind on ${format(reminder, 'PPP')}`
                    : 'Set Reminder'}
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive-outline" size="sm">
                  <Trash2 /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete your
                    note titled "{title}".
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Header>
      </AppShellHeader>
      <AppShellContent>
        <main className="flex-grow container mx-auto p-4 flex flex-col gap-4 overflow-hidden h-full">
          <Input
            value={title}
            onChange={handleTitleChange}
            placeholder="Note Title"
            className="text-2xl font-bold font-headline h-auto p-2 border-0 focus-visible:ring-0 shadow-none flex-shrink-0"
          />

          <div className="grid md:grid-cols-2 gap-4 flex-grow min-h-0">
            <div className="flex flex-col">
              <label
                htmlFor="editor"
                className="text-sm font-medium text-muted-foreground mb-2"
              >
                Markdown
              </label>
              <Textarea
                id="editor"
                value={content}
                onChange={handleContentChange}
                placeholder="Start writing your note here..."
                className="h-full resize-none text-base leading-relaxed font-code"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-sm font-medium text-muted-foreground mb-2">
                Preview
              </label>
              <div className="bg-muted/50 p-4 rounded-md h-full overflow-auto prose prose-sm max-w-none prose-p:font-body prose-p:text-base prose-p:leading-relaxed">
                 <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </div>
        </main>
      </AppShellContent>
    </AppShell>
  );
}
