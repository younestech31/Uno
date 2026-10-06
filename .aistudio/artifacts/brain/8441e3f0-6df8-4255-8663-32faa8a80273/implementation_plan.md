# Sequential Non-Interrupting Spoken Game Announcements Plan

Implement a sequential FIFO speech queue for Web Speech API Text-To-Speech (TTS) game announcements with compact snappy phrases (e.g., "Alex: Red 7", "Nova: Draw 2", "Atlas: UNO!"). Speech will never be cut off or cancelled when another player commits a move.

## User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed the following preferences in Phase 1:
> - **Queueing Behavior**: Sequential FIFO queue. Every spoken announcement plays to completion without being cut off (`cancel()` removed; `onend` triggers the next queued item).
> - **Sentence Format**: Compact snappy phrases (e.g. "Alex: Red 7", "Nova: Draw 2", "Charlie: Jump-In!", "Atlas: UNO!").
> - **Playback Speed**: 1.15x speech rate for natural, snappy turn announcements.

- **Confirmed Choice 1**: Sequential non-interrupting FIFO queueing so every turn announcement finishes naturally.
- **Confirmed Choice 2**: Compact snappy phrase format ("Name: Action/Card").

---

## 1. Overview & Core Concept

Previously, new turn events called `window.speechSynthesis.cancel()`, which interrupted the active voice announcement if a subsequent player or bot acted quickly.

This change introduces a non-interrupting FIFO speech queue (`speechQueue`). When a turn event occurs:
1. The announcement is formatted as a compact snappy phrase ("Alex: Red 7", "Nova: Draw 2").
2. The phrase is appended to `speechQueue`.
3. An utterance processor plays each item in sequence. When `utterance.onend` fires, the next announcement in the queue begins automatically, ensuring zero speech truncation.

---

## 2. User Experience & Visual Design

- **Complete Spoken Announcements**: Every player action is spoken to completion. The voice naturally continues speaking through rapid multi-player turns.
- **Compact & Snappy Phrasing**:
  - Card Play: `"Alex: Red 7"`, `"Bob: Blue Skip"`, `"Charlie: Wild +4"`
  - Draw: `"Nova: Draw 1"`, `"Orion: Draw 2"`
  - UNO Call: `"Atlas: UNO!"`
  - Hand Swap: `"Hands Swapped!"`
  - Victory: `"Alex wins Round 1!"`
- **Zero On-Screen Clutter**: No text toast boxes blocking the card table or player hand.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Removal of `speechSynthesis.cancel()`**:
  - *Chosen Approach*: Replace `cancel()` with a stateful FIFO queue (`speechQueue.push()`, `utterance.onend = processSpeechQueue`).
  - *Why*: Guarantees that every player's move announcement is heard in full, fulfilling the user's explicit requirement.
  - *Alternatives Considered*: Truncating voice lines mid-sentence (rejected because it sounds harsh and clips names).
- **Decision 2: Compact Phrasing ("Name: Action")**:
  - *Chosen Approach*: Use short 2–3 word announcements instead of long conversational sentences.
  - *Why*: Keeps audio length concise (under 0.8 seconds per turn) so the speech queue stays synchronized with gameplay.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                 Socket Event Stream Listener                │
├─────────────────────────────────────────────────────────────┤
│  SOCKET_EVENTS.GAME_EVENTS                                  │
│    │                                                        │
│    ├──► Format: "Alex: Red 7"                               │
│    ├──► Format: "Nova: Draw 2"                              │
│    └──► Format: "Atlas: UNO!"                               │
│            │                                                │
│            ▼                                                │
│    speechQueue.push(text)                                   │
│            │                                                │
│            ▼                                                │
│    processSpeechQueue()                                     │
│      ├──► speak(currentUtterance)                            │
│      └──► utterance.onend = () => processNextItemInQueue()  │
└─────────────────────────────────────────────────────────────┘
```

### Component Updates
- `components/cardclash-app.tsx`:
  - Implement `speechQueue: string[]` and `isSpeaking` state machine.
  - Add compact phrase formatter (`formatCompactSpokenPhrase(evt, players)`).
  - Update `SOCKET_EVENTS.GAME_EVENTS` listener to push compact phrases to `queueSpokenAnnouncement`.
