# Implementation Plan: Card Hand Spacing & Balanced Bot AI with Difficulty Selector

## Problem Analysis
1. **Hand Scrolling & Edge Clipping**: In `components/card-table-view.tsx`, the card container used `justify-center` on an `overflow-x-auto` flexbox, which in CSS standard creates an unreachable scroll coordinate space on the extreme left, and tight margins clip the extreme right cards when a player has 15–25 cards in hand.
2. **Gameplay Difficulty & Perceived Scripting**: The bots were operating on deterministic, 100% aggressive heuristics (always punishing the leading human player with maximum stacked penalties and optimal card picks). Introducing human-like variance and a selectable **Bot Difficulty** (Casual, Balanced, Challenger) will make gameplay feel organic, random, and enjoyable.

---

## Proposed Changes

### 1. Card Hand Container Spacing & Overflow Fix (`components/card-table-view.tsx`)
- **Fix CSS Flexbox Overflow**: Replace `justify-center` with a start-aligned container when cards overflow, ensuring the scroll area can reach `scrollLeft = 0` and the extreme right without clipping.
- **Generous Edge Padding**: Add `px-12 sm:px-16` padding and trailing spacer elements so the very first and very last cards have ample breathing room and are 100% visible.
- **Left / Right Scroll Helper Controls**: Add subtle floating scroll chevrons on the left and right edges that appear when the hand overflows, enabling one-tap scrolling to the ends.
- **Smooth Mousewheel & Touch Glide**: Support horizontal mousewheel scrolling and smooth CSS touch scrolling (`scroll-behavior: smooth`, `overscroll-behavior-x: contain`).

### 2. Balanced Bot AI with Difficulty Modes (`apps/server/src/bot.ts` & `components/cardclash-app.tsx`)
- **Difficulty Modes**:
  - **Casual (Friendly & Fun)**: Plays casually, occasionally holds back brutal penalties (+6/+10/Wilds), picks colors evenly or based on board state, and plays at a human-like pace.
  - **Balanced (Default)**: Strategic but natural; prioritizes standard matches and plays specials when sensible, with randomized color distribution.
  - **Challenger (Expert)**: High-level competitive strategy with aggressive penalty stacking and counter-plays.
- **Difficulty Selector in UI**: Add a clean Bot Difficulty selector in the "Create Room" panel and lobby settings.
- **True Entropy Shuffling**: Verify that every match and round seed uses fresh 256-bit cryptographic entropy via rejection-sampled Fisher-Yates shuffle.

---

## Verification Plan

### Automated Tests
- Run `npm run typecheck` across all packages to verify TypeScript types.
- Run `npm run test` (vitest) to ensure all 34 existing test suites continue to pass.

### Manual & Visual Verification
- Deal 20–25 cards to a player's hand in No Mercy mode and verify that the first and last cards are fully visible and easy to slide/scroll to without clipping.
- Test bot matches on Casual and Balanced difficulties to verify smooth, organic, and fair game flow.
