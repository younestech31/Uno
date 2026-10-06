'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/lib/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600/90 border border-amber-400/40 px-3.5 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md animate-pulse">
      <WifiOff className="w-4 h-4 text-amber-200" />
      <span>Offline Mode — Attempting to reconnect...</span>
    </div>
  );
};
