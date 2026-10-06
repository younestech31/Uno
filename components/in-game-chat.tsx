'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Flag,
  MessageSquare,
  Send,
  Smile,
  Users,
  X,
} from 'lucide-react';
import type { ChatMessagePayload } from '@cardclash/protocol';

export const EMOJI_REACTIONS = ['🔥', '😂', '👏', '😱', '🃏', '💥', '🎉', '⚡'] as const;

export interface FloatingEmoji {
  readonly id: string;
  readonly emoji: string;
  readonly x: number;
  readonly y: number;
}

export interface InGameChatDrawerProps {
  readonly roomCode: string;
  readonly currentUserId: string;
  readonly isSpectator?: boolean;
  readonly messages: readonly ChatMessagePayload[];
  readonly onSendMessage: (text: string) => void;
  readonly onSendEmoji: (emoji: string) => void;
  readonly onReportMessage: (messageId: string, reason: string) => void;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly spectatorCount?: number;
}

const getDeterministicOffset = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (Math.abs(hash) % 40) - 20;
};

export const FloatingEmojiContainer: React.FC<{
  readonly emojis: readonly FloatingEmoji[];
}> = ({ emojis }) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <AnimatePresence>
        {emojis.map((item) => {
          const offset = getDeterministicOffset(item.id);
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.4, x: item.x, y: item.y }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.4, 1.4, 1.2, 0.8],
                y: item.y - 140,
                x: item.x + offset,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.2, ease: 'easeOut' }}
              className="absolute text-4xl select-none filter drop-shadow-lg"
            >
              {item.emoji}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export const InGameChatDrawer: React.FC<InGameChatDrawerProps> = ({
  roomCode,
  currentUserId,
  isSpectator,
  messages,
  onSendMessage,
  onSendEmoji,
  onReportMessage,
  isOpen,
  onClose,
  spectatorCount = 0,
}) => {
  const [inputText, setInputText] = useState('');
  const [showEmojiWheel, setShowEmojiWheel] = useState(false);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('Inappropriate language');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText('');
  };

  const handleEmojiClick = (emoji: string) => {
    onSendEmoji(emoji);
    setShowEmojiWheel(false);
  };

  const handleConfirmReport = () => {
    if (reportingMessageId) {
      onReportMessage(reportingMessageId, reportReason);
      setReportingMessageId(null);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 340 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 340 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-80 bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col text-white"
          >
            {/* Header */}
            <div className="p-3.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-sm">Room Chat</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {roomCode}
                </span>
                {spectatorCount > 0 && (
                  <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">
                    <Users className="w-3 h-3" />
                    {spectatorCount}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Emoji Reactions Bar */}
            <div className="px-3 py-2 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between gap-1 overflow-x-auto">
              {EMOJI_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiClick(emoji)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 hover:scale-125 transform transition text-lg active:scale-95"
                  title={`Send ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Message List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-4">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                  <p>No messages yet.</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Send a quick greeting or reaction!
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.senderId === currentUserId;
                  return (
                    <div
                      key={msg.id}
                      className={`group flex flex-col ${
                        isMine ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-0.5 text-[10px] text-slate-400">
                        <span className="font-semibold text-slate-300">
                          {msg.senderName}
                        </span>
                        {msg.isSpectator && (
                          <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-400">
                            Spectator
                          </span>
                        )}
                        {!isMine && (
                          <button
                            onClick={() => setReportingMessageId(msg.id)}
                            className="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition p-0.5 ml-1"
                            title="Report message"
                          >
                            <Flag className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {msg.emoji ? (
                        <div className="text-2xl p-1 animate-bounce">
                          {msg.emoji}
                        </div>
                      ) : (
                        <div
                          className={`px-3 py-2 rounded-xl max-w-[85%] break-words shadow-sm ${
                            isMine
                              ? 'bg-indigo-600 text-white rounded-tr-none'
                              : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700/60'
                          }`}
                        >
                          <p>{msg.text}</p>
                          {msg.filtered && (
                            <span className="text-[9px] text-amber-300 block mt-0.5 font-medium">
                              (Filtered)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <form
              onSubmit={handleSend}
              className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center gap-2"
            >
              <div className="relative flex-1">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value.slice(0, 240))}
                  placeholder={
                    isSpectator
                      ? 'Chat as spectator...'
                      : 'Send a message (240 max)...'
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowEmojiWheel(!showEmojiWheel)}
                  className="absolute right-2 top-2 text-slate-400 hover:text-amber-400 transition"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </div>

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition shadow-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Report Modal Dialog */}
      {reportingMessageId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 shadow-2xl text-white">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm mb-3">
              <AlertTriangle className="w-4 h-4" />
              Report Chat Message
            </div>
            <p className="text-xs text-slate-300 mb-3">
              Please specify the reason for reporting this chat message:
            </p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white mb-4 focus:outline-none focus:border-rose-500"
            >
              <option value="Inappropriate language">Inappropriate language / Slurs</option>
              <option value="Spam / Flooding">Spam / Flooding</option>
              <option value="Harassment">Harassment or bullying</option>
              <option value="Cheating accusations">Toxic behavior</option>
            </select>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setReportingMessageId(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReport}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition"
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
