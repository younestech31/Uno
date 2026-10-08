'use client';

import React from 'react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B2B26] text-stone-100 p-4 text-center">
      <h1 className="text-4xl font-bold mb-2">404 - Page Not Found</h1>
      <p className="text-stone-300 mb-6">The match or room you are looking for does not exist.</p>
      <a
        href="/"
        className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold transition-all shadow-lg"
      >
        Return to CardClash Lobby
      </a>
    </div>
  );
}
