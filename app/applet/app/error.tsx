'use client';

import React from 'react';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B2B26] text-stone-100 p-4 text-center">
      <h1 className="text-4xl font-bold mb-2">Something went wrong</h1>
      <p className="text-stone-300 mb-6">An unexpected error occurred during gameplay.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold transition-all shadow-lg"
      >
        Try Again
      </button>
    </div>
  );
}
