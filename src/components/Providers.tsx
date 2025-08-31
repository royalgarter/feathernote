'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { NoteProvider } from '@/contexts/NoteContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <NoteProvider>{children}</NoteProvider>
    </AuthProvider>
  );
}
