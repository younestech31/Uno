# Comprehensive Gameplay, Sound, VFX, & PWA Tuning Plan

Implement high-fidelity gameplay upgrades, modern arcade-style sound chimes, dynamic card play visual effects, and professional native app-like mobile gesture optimizations for the Progressive Web App (PWA):

1. **High-Fidelity Audio Upgrades (Modern Arcade & Card Snaps)**:
   - **Card Play Sound with Physical Snap ('play')**: Upgrade the Web Audio synthesizer in `/components/cardclash-app.tsx` to use **polyphonic dual oscillators**. Oscillator 1 plays a clean triangle wave tuned to the card's color (C5 for Red, E5 for Blue, G5 for Yellow, C6 for Green). Oscillator 2 plays a highly-damped, low-frequency sawtooth wave (100Hz down to 40Hz) over 0.05 seconds, simulating the physical tactile "snap/clack" of cardboard.
   - **Rich Draw Card Sweep ('draw')**: Generate a detuned dual-frequency ascending sweep (Oscillator 1: 300Hz -> 700Hz, Oscillator 2: 315Hz -> 730Hz) simulating a smooth "slick/swoosh" drawing movement.
   - **Warm "Your Turn" Major Chord Chime ('yourTurn')**: Arpeggiate an uplifting E-Major electronic bell chime (E5 -> G#5 -> B5 -> E6) using multiple sine waves to grab attention elegantly.
   - **Brassy UNO Synth sweep ('uno')**: Trigger a fat, dual-tone brassy synth chord (C5 + G5 simultaneously) with an LFO-like frequency vibration sweep.
   - **Uplifting Victory Fanfare ('win')**: Play an arpeggiated, upward-moving Major-7th arpeggio (C5 -> E5 -> G5 -> B5 -> C6 -> E6 -> G6) in rapid arcade style.

2. **Dynamic Visual Effects (Flashes, Bounces, & Slick Moves)**:
   - **Background Screen Flash Pulse**: In `/components/card-table-view.tsx`, watch for changes in `view.topDiscard.id`. When a card is played, trigger a brief (450ms) full-viewport background glow or screen-border gradient flash matching the played card color (Red, Blue, Yellow, Green, or Purple/Gold for Wild cards), rendering a beautiful ambient lightning flash that fades out.
   - **Discard Card-Play Bounce**: Bind a `motion.div` wrapper around the discard pile card graphic. When `view.topDiscard.id` changes, use spring-physics scale/rotate animations to make the new card bounce onto the pile with a tactile, heavy, physical settling effect.
   - **Draw Deck Interaction**: Add a gentle breathing/pulsing animation to the draw deck when `canDrawNow` is active, inviting player touch with a clean visual affordance.

3. **Compact Opponent Card Deck Styling**:
   - Restructure the opponent card deck display inside `/components/card-table-view.tsx` to display **at most 3 closely overlapping card backs** using a tight `-space-x-5` layout with `shrink-0` bounds to prevent UI wrapping/layout breaking on mobile viewports.

4. **Native PWA User Experience Optimizations (Touch, Scroll, & Gesture Overrides)**:
   - **Anti-Zooming**: Configure Next.js layout viewport settings in `/app/layout.tsx` to lock initial/maximum scales to `1.0` and set `user-scalable=no` with `viewport-fit=cover` to block input focus and double-tap zoom triggers.
   - **Suppress Pull-to-Refresh & Bounce**: Add global CSS overrides to `/app/globals.css` with `overscroll-behavior: none` and `overscroll-behavior-y: none` to disable vertical elastic refresh and body scroll bounces.
   - **Remove Highlights & Selection**: Apply `-webkit-tap-highlight-color: transparent` globally to eliminate grey touch rects, and set `-webkit-user-select: none; user-select: none;` on all interactive buttons and cards to avoid text selection triggers during rapid actions.
