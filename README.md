# Hippo Raft 3D

A 1–4 player river-running game rendered with Three.js and planar physics from Rapier. Four hippos steer one inflatable raft with off-center fart blasts: reach the grass, dodge the spikes, and try not to start a blame spiral. The existing shared 2D rules and server-authoritative room protocol drive gameplay.

## Play locally

Requirements: Node.js 20.19+ (or 22.12+) and npm. The client uses Vite, Three.js, and `@dimforge/rapier3d-compat`.

```sh
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). Vite serves the client on port `4173`; the authoritative game server runs on port `3001`. Override these with `CLIENT_PORT` and `PORT`. `npm run build:client` produces a static Vite site; Vite reads `HIPPO_RAFT_SERVER_URL` at build time for deployment.

On one keyboard, use `Q` for north, `P` for east, `Z` for south, and `M` for west. Each hippo has a short gas cooldown. Touch devices get four tap zones. Solo practice gives the other three seats basic bots. Co-op and Blame Mode support local four-player play. Blame Mode carries points across the trip and names the lowest-blame seat after the final stage; a spike awards a point to the last hippo who farted.

Select a river stage to play any of the seven courses. Best star ratings are stored in browser `localStorage`. Online rooms use four-letter codes; the host picks mode and level, and disconnected or empty seats are bot-controlled. Room tokens are retained in local storage for reconnecting from the same browser. Server snapshots continue to use the shared planar simulation; Three.js and Rapier provide the 3D client presentation and constrained raft body.

## Checks and build

```sh
npm test
npm run lint
npm run build:client
```

`npm run build:client` creates a deployable static site in `dist/` and copies the shared level data. Physics and simulation code in `shared/` is used by both the browser and server. Vite keeps the Three.js and Rapier runtime in separate, lazy-loaded chunks. The host should serve JavaScript with Brotli or gzip compression enabled.

## Physics and cameras

An impulse changes raft speed in proportion to the push and inversely to mass. Applying it away from the center also adds spin in proportion to the lever arm. Fart force is spread over a short curve whose total area equals the configured impulse; exponential drag then eases the raft and spin down. River current pulls velocity toward the spline's flow velocity instead of applying a constant push.

The server and shared rules remain planar; a Rapier body locks vertical translation and X/Z rotation while adding 3D yaw and rendering interpolation. The chase camera follows the raft and looks ahead; the camera button switches to the top-down party view. Open Settings to choose Low, Medium, or High scene quality.

Press `F1` during play to show FPS, speed, spin, fart-force vectors, collision normals, and current arrows. Physics tuning remains available under Settings. Rapier loads behind the startup screen; the world uses instanced trees/reeds, procedural geometry, and capped particles.

## Deploy

### Client on Vercel

1. Import this repository into Vercel and keep the project root at the repository root.
2. Use the included `vercel.json` settings: build command `npm run build:client`, output directory `dist`, install command `npm install`.
3. Set the build environment variable `HIPPO_RAFT_SERVER_URL` to the Render WebSocket URL, for example `wss://hippo-raft-server.onrender.com`. Vite injects it into the generated HTML.
4. Deploy and copy the resulting client origin, such as `https://hippo-raft.vercel.app`.

### Server on Render

1. Create a Render **Web Service** from the same repository with root directory `.` and runtime **Node**.
2. Set build command to `npm install` and start command to `npm run start:server`.
3. Add `CLIENT_ORIGIN` with the Vercel site origin. Render supplies `PORT`; do not hard-code it in the dashboard.
4. Use `/health` as the health-check path. The server accepts WebSocket connections on the same service and port. Render's free service may sleep; clients show a waking-server message while connecting.
5. Set `HIPPO_RAFT_SERVER_URL` in Vercel to the Render `wss://` URL and redeploy the client after changing it.

For another static host, publish `dist/` and set `HIPPO_RAFT_SERVER_URL` at build time. A one-off override can also be passed as `?server=wss://your-server.example`; the room invite link preserves that parameter.

## Play with a friend without deploying

Run `npm run dev`, then expose both ports with Cloudflare Tunnel (or ngrok):

```sh
cloudflared tunnel --url http://localhost:4173
cloudflared tunnel --url http://localhost:3001
```

Open the client tunnel URL with `?server=https://YOUR-SERVER-TUNNEL`, create a room, then copy the invite link. The server URL is converted to secure WebSockets automatically. Keep both tunnels running for the session.

## Project map

- `client/`: Vite HTML/CSS, Three.js scene, Rapier planar adapter, local controls, and WebSocket client.
- `server/`: room codes, seat assignment, bot fill, 60 Hz authoritative simulation, and 30 Hz state broadcasts.
- `shared/`: rigid-body physics, collision helpers, simulation rules, schema, and seven level definitions.
- `test/`: Node test-runner checks for shared rules and Rapier planar constraints.

Scene art is generated from Three.js primitives and shaders; sound effects are synthesized in-browser, so there are no external asset credits to track. On smaller devices, choose Low quality in Settings to reduce pixel ratio, foliage instances, and shadows.