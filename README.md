# Rock Paper Scissors — 2 Player Camera Edition ✊✋✌️

A real-time, two-player Rock Paper Scissors game played with **actual hand gestures** over your webcam. One player creates a room, shares a link, and the other joins — you see each other's live camera and throw at the same "Shoot!". Hand tracking runs locally in each browser via Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), and players connect **peer-to-peer via WebRTC** ([PeerJS](https://peerjs.com/)) — there is **no game server to run**.

## How to play

1. Player 1 opens the app, enters a name, and clicks **Create a game**.
2. They copy the generated link and send it to a friend.
3. Player 2 opens the link, enters a name, and clicks **Join now**.
4. Both allow camera access. Once connected you'll see both cameras.
5. Either player clicks **Play round** — a synced "Rock, Paper, Scissors, Shoot!" countdown runs, and each player's gesture at "Shoot!" is compared.

Gestures:
- **Rock** ✊ — closed fist
- **Paper** ✋ — open hand
- **Scissors** ✌️ — index + middle finger up

## Running it

The app is fully static (HTML/CSS/JS). It must be served over `http://localhost` or **HTTPS** — cameras and WebRTC don't work from a `file://` path.

### Local (both players on the same machine / network)

```bash
python3 -m http.server 8000
# or: npx serve .
```

Open <http://localhost:8000>.

### Sharing with a friend over the internet

A friend on another computer can't reach your `localhost`, so the link must be publicly reachable. Two easy options:

**Option A — Quick tunnel (no deploy):**

```bash
# Terminal 1: serve the app
python3 -m http.server 8000

# Terminal 2: expose it (pick one)
npx localtunnel --port 8000
# or, if you have it:
ngrok http 8000
# or:
cloudflared tunnel --url http://localhost:8000
```

Share the public `https://…` URL the tool prints. Both players open it; create/join as above.

**Option B — Free static deploy:** push these files to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). The deployed URL becomes your shareable link.

> Notes
> - Peer-to-peer connections use STUN for NAT traversal, which works on most home networks. Very restrictive networks may require a TURN server (not included).
> - An internet connection is needed to download the MediaPipe model and to reach the PeerJS broker for matchmaking.
> - Requires a modern browser (Chrome, Edge, or Safari) with camera permission granted.

## Files

- `index.html` — page structure, lobby overlay, and two-camera board
- `style.css` — styling, lobby, and layout
- `app.js` — camera, hand detection, PeerJS networking, and synced game logic

## Tips for reliable detection

- Keep your hand well-lit and fully inside the camera frame.
- Make gestures distinct: tight fist (rock), wide open palm (paper), clear V (scissors).
- Watch the badge over your camera — it shows what the game currently detects for you.
