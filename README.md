# GhostShare

**Local-first, private browser-to-browser file transfers over your local network.**

GhostShare is a self-hosted, open-source utility that lets you send files directly between browsers — no cloud uploads, no accounts, and no file data ever touches a server. Powered by WebRTC, all transfers are encrypted end-to-end and stream peer-to-peer.

---

## Why GhostShare?

| | GhostShare | Cloud Services |
|---|---|---|
| **File storage** | None — direct P2P | Stored on remote servers |
| **Encryption** | WebRTC DTLS (mandatory) | Varies; often key-escrowed |
| **Network** | LAN / Tailscale / private VPS | Internet-dependent |
| **Tracking** | Zero analytics or telemetry | Usage data often collected |
| **Dependencies** | Node.js + a browser | Complex infrastructure |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/ghostshare.git
cd ghostshare

# Install dependencies
npm install

# Start the server
npm start
```

Output:

```
GhostShare is active on your private network!
Interface & Signal Hub: http://localhost:9001
```

Open **http://localhost:9001** (or `http://<your-local-ip>:9001` from other devices on the same LAN) in two browser tabs to test.

---

## How It Works

### Architecture Overview

```
┌─────────────┐                         ┌─────────────┐
│  Browser A  │◄────── WebRTC ─────────►│  Browser B  │
│  (Sender)   │    encrypted file data   │  (Receiver) │
└──────┬──────┘                         └──────┬──────┘
       │                                       │
       │  WebSocket signaling                  │
       │  (offer / answer / ICE)               │
       │                                       │
       ▼                                       ▼
┌─────────────────────────────────────────────────────┐
│                    GhostShare Server                 │
│  ┌───────────────────────────────────────────────┐  │
│  │  HTTP (port 9001) — serves index.html          │  │
│  │  WebSocket — relays signaling messages only    │  │
│  │  ❌ No file data passes through this server    │  │
│  │  ❌ No logging of file metadata                │  │
│  │  ❌ No persistent storage                      │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 1. Browser-to-Browser Encrypted Lanes (WebRTC)

Once the signaling handshake completes, GhostShare establishes a **direct peer-to-peer WebRTC connection** between the two browsers. WebRTC uses **DTLS** (Datagram Transport Layer Security) for transport encryption — the same protocol that secures WebSocket `wss://` connections. The file chunks are streamed over an **SCTP data channel** (ordered, reliable delivery) with **no server in the data path**.

- ICE (Interactive Connectivity Establishment) handles NAT traversal via public STUN servers.
- On the same LAN, browsers typically connect via host candidates (direct local IP), keeping traffic entirely on your local network.

### 2. The Node.js Signaling Hub

The `server.js` script does exactly three things:

1. **Serves the web interface** (`index.html`) over HTTP on port 9001.
2. **Relays WebSocket signaling messages** (offer, answer, ICE candidates) between two peers registered to the same session ID.
3. **Cleans up** idle sessions and dead connections.

The server maintains a minimal in-memory session map — **no database, no disk writes, no file logging**.

### 3. Zero File Tracking

- The signaling server never sees file names, sizes, contents, or MIME types in its relayed messages (those travel over the direct WebRTC data channel).
- Session IDs are random 12-character strings generated client-side with `crypto.getRandomValues()`.
- When both peers disconnect, the session is purged from memory immediately.
- **No cookies, no analytics scripts, no external CDN calls** (fonts are self-hosted via Google Fonts CSS which you can optionally bundle).

---

## Usage

### Sending a File

1. Open GhostShare in your browser.
2. Drop a file (up to 1 GB) onto the drop zone or click to browse.
3. Click **Generate Link** — a session link is automatically copied to your clipboard.
4. Share the link with the receiver (email, chat, QR code, spoken aloud).

### Receiving a File

1. Open the link the sender shared with you.
2. GhostShare automatically joins the session and establishes a secure WebRTC tunnel.
3. Once connected, the sender clicks **Send File** and the transfer begins immediately.
4. The file downloads automatically when complete.

### Across Devices on the Same LAN

Instead of `http://localhost:9001`, other devices on your local network can use your computer's local IP address:

```
http://192.168.1.42:9001
```

The WebSocket signaling URL is calculated dynamically from `window.location`, so it works automatically with any IP or hostname.

### Remote / Self-Hosted

GhostShare can run behind **Tailscale** (recommended), **ZeroTier**, **WireGuard**, or on a private VPS with a reverse proxy (e.g., Caddy, Nginx) that handles TLS termination and WebSocket upgrade forwarding.

---

## Security & Privacy

| Concern | How GhostShare Addresses It |
|---|---|
| **File confidentiality** | WebRTC DTLS encryption — files never leave the browser-to-browser tunnel |
| **Server compromise** | Server only sees encrypted signaling metadata; zero persistence |
| **NAT/firewall traversal** | Public STUN servers assist hole-punching; consider running your own STUN/TURN for air-gapped networks |
| **Link interception** | Session links contain only a random ID; share them via secure channels |
| **Browser sandbox** | All JavaScript runs client-side; no `eval()`, no dynamic code loading |

### Running Your Own STUN/TURN Server

For fully private networks without internet access, replace the public Google STUN servers in `index.html` with your own:

```js
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.your-network.local:3478' },
        { urls: 'turn:turn.your-network.local:3478', username: 'user', credential: 'pass' }
    ]
};
```

---

## Requirements

- **Node.js** ≥ 16.x
- **Modern browser** with WebRTC support (Chrome 80+, Firefox 80+, Edge 80+, Safari 15+)
- **No** Docker, database, or cloud account needed

---

## Development

```bash
# Start with a custom port
npm start -- 8080

# Or directly:
node server.js 8080
```

All core logic lives in two files:
- `server.js` — HTTP server + WebSocket signaling hub (~230 lines)
- `index.html` — Full SPA with WebRTC data channel management (~1,340 lines)

---

## FAQ

**Q: Can I transfer files between devices that aren't on the same LAN?**
A: Yes, if both can reach each other via a common IP (e.g., using Tailscale). GhostShare uses public STUN servers by default, which may work for simple NATs but will fail on symmetric NATs without TURN. For guaranteed connectivity, run your own STUN/TURN server.

**Q: What's the maximum file size?**
A: The UI enforces a 1 GB limit. WebRTC data channels support streaming arbitrarily large files, but browser memory constraints apply.

**Q: Does this work offline (no internet at all)?**
A: You need the Google Fonts CSS loaded once (cached). After that, if both devices are on the same LAN and you configure a local STUN server, transfers will work without internet access.

**Q: Is the connection really encrypted?**
A: Yes. WebRTC mandates DTLS-SRTP for all data channels. There is no "plaintext" mode in the WebRTC specification.

---

## License

MIT © GhostShare Contributors

---

*GhostShare — Your files, your network, your control.*