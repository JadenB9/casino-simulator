# Changelog

What changed in each numbered release of the casino. Older releases are described by their
merge commits in the site repo.

## 1.4 (2026-10-15)

- Light and dark for the 2D layer: the login and menu, the HUD, every sheet and panel, the chat,
  the chip tray and the controls over the tables. A sun and moon button on the login screen and
  in the HUD, and a Theme row in Settings. It is the same choice as the rest of j4den.com, follows
  the device until one is made, and is set before the first paint. The casino keeps its lights.
- The browser's own bar colour follows the theme, and the page declares both colour schemes.
- The renderer hears the device pixel ratio change (the window dragged to another screen, or the
  browser zoomed) and redraws at the new ratio; the floor's adaptive ratio starts over from it.
- The game is in the entry chunk, so the page fetches it and three.js as it reads the HTML rather
  than one round trip later.
- A character leaving (or changing outfit) no longer frees the vertex buffers every other
  character in that outfit draws with, which had the whole crowd re-upload on each leave.
- A reconnect's hello refreshes who is crouching and names; an emote bubble goes with a player
  who leaves mid-emote instead of hanging where it was.
- Worker: a ticket for a lobby id that was never made no longer leaves an empty object's tables
  in storage; a Turnstile token must have been solved on one of the site's own hosts; a paused
  account's expired checks are cleared as the next is issued. See docs/SECURITY-REVIEW.md.

## 1.3.1

- A full casino says so with Try again (no more walking about unseen); sockets come back at once
  from a dead link; bail is paid once per stay; a short big blind all-in no longer folds the small
  blind; the floor answers a failed message instead of throwing.
