# GhostShare

Browser-to-browser file transfers over your local network. No cloud, no accounts, no file data on any server. WebRTC handles the encryption.

## Setup

```bash
git clone https://github.com/your-org/ghostshare.git
cd ghostshare
npm install
npm start
```

You'll see:

```
👻 GhostShare is active on your private network!
Local Interface: http://localhost:9001
Network Access:   http://192.168.1.42:9001
```

Open that URL in two browser tabs to test. Other devices on your LAN can use `http://<your-local-ip>:9001`.

## How it works

The server does two things: serves the HTML page and relays WebSocket signaling messages between peers. That's it. No database, no disk writes, no file logging.

The actual file transfer happens directly between browsers over a WebRTC data channel. DTLS encryption is mandatory in WebRTC — there is no plaintext mode. File chunks stream over an SCTP channel with ordered, reliable delivery.

On the same LAN, browsers connect via host candidates (direct local IP). The signaling server never sees file names, sizes, or contents. Session IDs are 12 random characters generated with `crypto.getRandomValues()`. When both peers disconnect, the session is wiped from memory.

## Usage

**Sending:** Drop a file (up to 1 GB), click Generate Link, share the link.

**Receiving:** Open the link. The file downloads automatically when the transfer completes.

## Settings

Click the gear icon in the top-right corner to open the settings panel. You can change:

- **Light theme** — toggle between dark and light appearance
- **Accent color** — amber, blue, green, purple, or rose
- **Font** — Inter, system default, or JetBrains Mono
- **Animations** — disable all transitions and effects
- **Background pattern** — toggle the dot grid overlay
- **Compact mode** — reduce padding and spacing
- **Chunk size** — 8 KB to 64 KB (larger = faster on fast networks)
- **Buffer threshold** — backpressure pause point (32 KB to 256 KB)
- **STUN servers** — comma-separated list of your own STUN/TURN servers

All settings are saved to localStorage and persist across sessions.

## Running your own STUN/TURN

For fully offline networks, replace the public Google STUN servers with your own in the settings panel. The field accepts a comma-separated list like:

```
stun:stun.your-network.local:3478, turn:turn.your-network.local:3478
```

A TURN server with credentials uses the format `turn:host:port?username=user&credential=pass`.

## Remote access

GhostShare works behind Tailscale, ZeroTier, WireGuard, or on a private VPS. Put a reverse proxy (Caddy, Nginx) in front that handles TLS and forwards WebSocket upgrades.

## Requirements

- Node.js 16 or newer
- A modern browser (Chrome 80+, Firefox 80+, Edge 80+, Safari 15+)

## License

MIT