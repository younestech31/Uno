# Standalone PWA & Adaptive Opponent Fanned Hand Plan

Configure CardClash so that:
1. In **1 vs 1 mode**, the opponent's hand at the top of the table renders as a **full fanned hand of card backs** mirroring your own deck at the bottom, with adaptive overlap so even large hands fit cleanly on screen.
2. In **3+ Player mode**, opponents are arranged around the top table perimeter with **compact curved mini-fans of card backs** that dynamically tighten their overlap based on card count.
3. The **PWA installs and launches in true `standalone` mode** (WebAPK on Android Chrome / standalone on iOS Safari) with zero browser navigation/URL bar.

---

## Proposed Changes

### 1. Adaptive Opponent Hand Rendering (`components/card-table-view.tsx`)
- **1 vs 1 Mode (`view.opponents.length === 1`)**:
  - Render the single opponent directly across the top of the table with a mirrored fanned hand of `CardBackGraphic` cards (up to 14 visible cards in a smooth inverted arc `(index - (count - 1) / 2) * -2.5deg`).
  - Dynamically calculate horizontal overlap (`marginLeft`) based on card count so that whether the opponent holds 2 cards or 20 cards, the fanned deck stays centered and never overflows or clips off-screen.
  - Display the opponent's status bar (Name, Card Count badge, Score, UNO! alert, Turn glow) cleanly docked above their fanned hand, mirroring the player's bottom HUD.
- **Multi-Player Mode (`view.opponents.length >= 2`)**:
  - Arrange opponents in a responsive tabletop arc across the top arena.
  - Give each opponent a tactile curved mini-fan of `CardBackGraphic` cards (up to 8 visible cards scaled to `0.65x`–`0.75x`) with adaptive overlap and subtle fan rotation so every seat visibly holds a real fanned hand of card backs without crowding the table.
- **Player's Own Bottom Hand (`view.hand`)**:
  - Also apply adaptive overlap and fan-angle clamping when the player holds many cards (e.g., 10+ cards) so the player's own hand stays centered and comfortable to tap on mobile screens.

### 2. True Standalone PWA — No Chrome Navigation Bar (`public/`, `app/manifest.ts`, `app/layout.tsx`, `lib/usePWAInstall.ts`)
- **Generate Valid PNG & SVG Icons in `public/`**:
  - Create `public/icon-192.png` (`192x192`), `public/icon-512.png` (`512x512`), `public/icon-maskable.png` (`512x512` maskable with safe-zone margin), `public/apple-touch-icon.png` (`180x180`), and `public/icon.svg`. Fixing these missing icons prevents Chrome from downgrading the home-screen app to a browser shortcut with an address bar.
- **Active Service Worker (`public/sw.js`)**:
  - Create `public/sw.js` with `install`, `activate`, and `fetch` listeners and register it automatically in `usePWAInstall()` so Android Chrome compiles a true standalone WebAPK.
- **Standalone Manifest & Meta Tags**:
  - Set `display: 'standalone'`, `display_override: ['standalone', 'fullscreen']`, `orientation: 'any'`, `background_color: '#0B2B26'`, and `theme_color: '#0B2B26'` in `app/manifest.ts`.
  - Add `themeColor: '#0B2B26'`, `manifest: '/manifest.webmanifest'`, `appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'CardClash' }`, and `other: { 'mobile-web-app-capable': 'yes' }` in `app/layout.tsx`.
