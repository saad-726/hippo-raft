# 🦛 Hippo Raft

**Four hippos. One inflatable raft. Steering by farts.**

Hippo Raft is a chaotic 3D river-running game for 1–4 players. You steer a shared raft with off-center fart blasts: reach the grass, dodge the spikes and hammers, and try not to start a blame spiral.

## ▶️ [Play it now: hippo-raft.vercel.app](https://hippo-raft.vercel.app/)

No install needed. Open it in your browser and play solo, with friends on one keyboard, or online in a room.

> ⏳ The game server runs on Render's free tier, so the first online connection may take a few seconds while it wakes up.

---

## Features

- **1–4 players** with local co-op, solo practice, or online rooms (4-letter room codes)
- **Three ways to play**
  - **Co-op**: work together to get the raft downstream
  - **Blame Mode**: a spike gives a point to the last hippo who farted. Points carry across the trip and the lowest-blame hippo wins
  - **Solo practice**: bots fill the other three seats
- **7 river stages**: Lazy River, Bendy Creek, Spike Alley, Rapids, Hammer Time, Whirlpool Pond, Chaos Finale
- **Real physics**: Rapier-powered raft body with impulses, spin, drag and river current
- **Server-authoritative multiplayer**: 60 Hz simulation with 30 Hz state broadcasts, plus auto-rejoin after a disconnect
- **Chase camera and top-down party view**, with Low / Medium / High scene quality for weaker devices
- **Everything is generated**: scenery comes from Three.js primitives and shaders, and sound is synthesized in the browser. No external assets.
- Touch support with four tap zones

## How to Play

On one keyboard, each hippo gets a key:

| Key | Pushes the raft |
|-----|-----------------|
| `Q` | North |
| `P` | East |
| `Z` | South |
| `M` | West |

Each hippo has a short gas cooldown, so coordinate. On touch devices, tap the four zones. Press `F1` during play for a debug overlay (FPS, speed, spin, force vectors, current arrows).

**Online:** one player creates a room and shares the 4-letter code or invite link. The host picks the mode and river, and everyone joins and starts the trip. Empty seats stay idle in online rooms.

## Built With

- [Three.js](https://threejs.org/) for 3D rendering
- [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`) for physics
- [Vite](https://vitejs.dev/) for the client build
- Node.js + [`ws`](https://github.com/websockets/ws) for the WebSocket game server
- Hosted on **Vercel** (client) and **Render** (server)
- Built with the help of AI (Claude), with a human steering the ideas, design and testing

## Run It Locally

Requirements: Node.js 20.19+ (or 22.12+) and npm.

```bash
git clone https://github.com/saad-726/hippo-raft.git
cd hippo-raft
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The client runs on port `4173` and the game server on `3001` (override with `CLIENT_PORT` and `PORT`). See `.env.example` for the environment variables.

### Checks and build

```bash
npm test
npm run lint
npm run build:client
```

## Project Structure

```
client/   Vite HTML/CSS, Three.js scene, Rapier adapter, controls, WebSocket client
server/   Room codes, seat assignment, 60 Hz authoritative simulation
shared/   Physics, collision helpers, game rules, level schema and 7 level definitions
test/     Node test-runner checks for shared rules and physics
scripts/  Dev launcher
```


## 🤝 Contributing: Collaboration Is Open!

This project is open to collaboration, and I'd love your help making it better. You can send a pull request and I'll review it and merge improvements.

Ideas for contributions:

- 🌊 New river levels (see `shared/levels.json` and `shared/levelSchema.js`)
- 🪤 New hazards or power-ups
- 🤖 Smarter bots for solo practice
- 🎨 Visual polish, effects and sound
- 📱 Mobile and touch improvements
- 🐛 Bug fixes and performance tweaks

**How to contribute**

1. Fork this repository
2. Create a branch: `git checkout -b feature/your-idea`
3. Make your changes, then run `npm test` and `npm run lint`
4. Commit: `git commit -m "feat: describe your change"`
5. Push: `git push origin feature/your-idea`
6. Open a **Pull Request** and describe what you changed and why

Not a coder? Play the game and open an **Issue** with bugs, feedback, or ideas.

## 💬 Feedback

Played it? Tell me which stage you loved, which one made you rage, and who ended up with the most blame.

---

Made with ❤️, a lot of testing, and a little help from AI.