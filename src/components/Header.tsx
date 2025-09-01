'use client';

import React from 'react';
import Link from 'next/link';
import FeatherIcon from './FeatherIcon';
import UserProfile from './UserProfile';
import { SettingsDialog } from './SettingsDialog';
import SyncStatus from './SyncStatus';

type HeaderProps = {
  children?: React.ReactNode;
};

const Header = ({ children }: HeaderProps) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-2">
          <FeatherIcon className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg font-headline text-foreground">FeatherNote</span>
        </Link>
        <div className="flex items-center gap-4">
          {children}
          <SyncStatus />
          <SettingsDialog />
          <UserProfile />
        </div>
      </div>
    </header>
  );
};

export default Header;
