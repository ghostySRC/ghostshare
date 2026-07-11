# GhostShare

A high-performance, 100% serverless, local-first peer-to-peer (P2P) file sharing web utility. Streams files up to 1GB directly between two browsers securely over your local network (LAN) without ever touching a cloud storage backend or third-party server.

## Quick Start

Fire up the entire interface and signaling hub with a single command sequence:

```bash
git clone https://github.com/ghostysrc/ghostshare.git
cd ghostshare
npm install
npm start

```

**Upon startup, you will see exactly:**

```text
👻 GhostShare is active on your private network!
Local Interface: http://localhost:9001
Network Access:   http://192.168.1.42:9001

```

Open that URL in two browser tabs to test. Other devices on your LAN can use the Network Access URL directly to begin secure, zero-cloud transfers instantly.

---

## Privacy & Architecture

* **Zero Cloud Storage:** The integrated Node.js script performs a dual role: it delivers the static frontend interface over HTTP and handles the initial WebRTC WebSocket signaling handshake. No file data, metadata, filenames, or sizes ever touch the server.
* **Mandatory Encryption:** File transfers occur directly browser-to-browser via a WebRTC `RTCDataChannel`. Communication is strictly secured using DTLS encryption over an SCTP transport layer configured for ordered, reliable chunk delivery. There is no plaintext mode.
* **Crypto-Secured Sessions:** Room sessions utilize cryptographically random 12-character identifiers generated via the native browser `crypto.getRandomValues()` API.
* **Volatile Memory:** On the same LAN, browsers connect directly via host candidates (local IP). The signaling server retains connection states strictly in-memory. Once both peers disconnect, the lobby instance is permanently wiped from memory.

---

## High-Performance Stream Management

GhostShare is architected to handle large files up to 1GB without freezing the UI or risking browser tab memory crashes:

* **Asynchronous Chunking:** Files are sliced sequentially into fixed chunks using the HTML5 `FileReader` API.
* **Active Backpressure Control:** To prevent memory overflows, the engine dynamically monitors `dataChannel.bufferedAmount`. If the buffer exceeds the safety threshold, the chunking loop instantly pauses and yields execution, automatically resuming via the `onbufferedamountlow` event handler once the queue drops below the safety threshold.

---

## Usage

* **Sending:** Drop a file (up to 1 GB), click Generate Link, and share the generated link.
* **Receiving:** Open the shared link. The file downloads automatically directly into the browser storage when the transfer completes.

---

## Features & Configuration

Click the gear icon in the top-right corner to open the settings panel. All settings are automatically saved to `localStorage` and persist across browser sessions:

* **Light theme:** Toggle between dark and light appearance.
* **Accent color:** Personalize the theme using amber, blue, green, purple, or rose tones.
* **Font:** Select between Inter, system default, or JetBrains Mono.
* **Animations:** Disable all transitions and effects for a lightweight experience.
* **Background pattern:** Toggle the dot grid overlay layout.
* **Compact mode:** Reduce padding and spacing across the interface dashboard.
* **Chunk size:** Fine-tune streams from 8 KB to 64 KB (larger sizes equal faster speeds on robust local networks).
* **Buffer threshold:** Adjust the backpressure pause point threshold between 32 KB and 256 KB.
* **STUN servers:** Provide a custom comma-separated list of your own STUN/TURN targets.
* **Transfer Logs:** A collapsible runtime panel tracking every file sent or received during the active session, retaining timestamp, filename, size, and peak transfer performance records.
* **Network Resilience:** Equipped with a 10-second re-negotiation grace window. If a peer suffers a transient local network drop, the stream queues auto-pause and attempt reconnection before failing out.

---

## Running your own STUN/TURN

For fully offline or completely air-gapped networks, replace the public Google STUN servers with your own inside the configuration panel. The field accepts a comma-separated list format like:

```text
stun:stun.your-network.local:3478, turn:turn.your-network.local:3478

```

A TURN server requiring explicit credentials uses the following query format:
`turn:host:port?username=user&credential=pass`

---

## Remote access

GhostShare works flawlessly behind virtual private networks such as Tailscale, ZeroTier, and WireGuard, or deployed on a private VPS. For remote use cases, put a reverse proxy (like Caddy or Nginx) in front of the application to handle TLS termination and cleanly forward WebSocket upgrade headers.

---

## Requirements

* **Runtime:** Node.js 16.x or newer
* **Environment:** Any modern WebRTC-compliant browser (Chrome 80+, Firefox 80+, Edge 80+, Safari 15+)

## License

Distributed under the MIT License. See `LICENSE` for details.