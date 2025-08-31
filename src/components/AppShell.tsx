import * as React from 'react';
import { cn } from '@/lib/utils';

const AppShell = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col min-h-screen bg-background', className)}
      {...props}
    />
  );
});
AppShell.displayName = 'AppShell';

const AppShellHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('sticky top-0 z-50', className)}
      {...props}
    />
  );
});
AppShellHeader.displayName = 'AppShellHeader';

const AppShellContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <main
      ref={ref}
      className={cn('flex-1 overflow-y-auto', className)}
      {...props}
    />
  );
});
AppShellContent.displayName = 'AppShellContent';

export { AppShell, AppShellHeader, AppShellContent };
