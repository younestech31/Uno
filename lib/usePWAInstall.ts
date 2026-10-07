'use client';

import { useEffect, useState } from 'react';

export function usePWAInstall() {
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Register Service Worker so Chrome/Android compiles a standalone WebAPK and triggers its native install popup
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {
          // Ignore registration errors in restricted preview frames
        });
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
    const isStandalone =
      mediaQuery.matches ||
      isFullscreen ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setTimeout(() => {
      setIsInstalled(isStandalone);
    }, 0);

    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
    };

    mediaQuery.addEventListener?.('change', handleDisplayModeChange);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener?.('change', handleDisplayModeChange);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  return {
    isInstalled,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
