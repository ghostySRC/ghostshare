/**
 * GhostShare — Local-First Private File Transfer
 *
 * This server serves the GhostShare web interface and relays WebRTC
 * signaling messages (offers, answers, ICE candidates) between two
 * peers in the same session. No file data ever passes through this server.
 *
 * Usage: node server.js [port]
 * Default port: 9001
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2]) || 9001;

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    // Serve index.html for root or /index.html requests
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, 'utf-8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Internal Server Error');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    }
});

// ── WebSocket Server ────────────────────────────────────────────────────────

// Use noServer mode so we can share the HTTP port via handleUpgrade
const wss = new WebSocketServer({ noServer: true });

// Session tracking: sessionId -> { sender, receiver }
const sessions = new Map();

// Reverse lookup: ws -> sessionId + role
const clientMap = new Map();

function log(level, message) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const prefix = { info: 'ℹ', warn: '⚠', error: '✗', success: '✓' }[level] || '·';
    console.log(`[${timestamp}] ${prefix} ${message}`);
}

function send(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(data));
    }
}

function getPeer(ws) {
    const client = clientMap.get(ws);
    if (!client) return null;

    const session = sessions.get(client.sessionId);
    if (!session) return null;

    if (client.role === 'sender') return session.receiver;
    if (client.role === 'receiver') return session.sender;
    return null;
}

function cleanupSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;

    // Notify remaining peer
    if (session.sender && session.sender.readyState === 1) {
        send(session.sender, { type: 'peer-left' });
    }
    if (session.receiver && session.receiver.readyState === 1) {
        send(session.receiver, { type: 'peer-left' });
    }

    sessions.delete(sessionId);
    log('info', `Session ${sessionId} cleaned up`);
}

wss.on('connection', (ws) => {
    // Heartbeat tracking
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    log('info', `New connection (total: ${wss.clients.size})`);

    let registered = false;

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            log('warn', `Invalid JSON received`);
            send(ws, { type: 'error', message: 'Invalid message format' });
            return;
        }

        if (!msg.type) {
            log('warn', `Message missing type field`);
            return;
        }

        switch (msg.type) {
            case 'register': {
                const { sessionId, role } = msg;
                if (!sessionId || !role || !['sender', 'receiver'].includes(role)) {
                    send(ws, { type: 'error', message: 'Invalid registration: sessionId and role (sender/receiver) required' });
                    return;
                }

                // Create or get session
                let session = sessions.get(sessionId);
                if (!session) {
                    session = { sender: null, receiver: null };
                    sessions.set(sessionId, session);
                    log('info', `Session ${sessionId} created`);
                }

                // Assign role
                if (role === 'sender') {
                    if (session.sender && session.sender !== ws) {
                        send(ws, { type: 'error', message: 'Sender already exists for this session' });
                        return;
                    }
                    session.sender = ws;
                } else {
                    if (session.receiver && session.receiver !== ws) {
                        send(ws, { type: 'error', message: 'Receiver already exists for this session' });
                        return;
                    }
                    session.receiver = ws;
                }

                clientMap.set(ws, { sessionId, role });
                registered = true;

                send(ws, { type: 'registered', sessionId, role });
                log('success', `${role} registered in session ${sessionId}`);

                // If both peers are present, notify the sender
                if (session.sender && session.receiver) {
                    send(session.sender, { type: 'peer-joined' });
                    log('info', `Session ${sessionId}: both peers connected`);
                }
                break;
            }

            case 'offer':
            case 'answer':
            case 'ice-candidate': {
                if (!registered) {
                    send(ws, { type: 'error', message: 'Not registered. Send register first.' });
                    return;
                }

                const peer = getPeer(ws);
                if (!peer) {
                    send(ws, { type: 'error', message: 'Peer not connected yet' });
                    log('warn', `No peer found for ${msg.type} relay`);
                    return;
                }

                // Relay the message to the peer
                send(peer, msg);
                break;
            }

            default:
                log('warn', `Unknown message type: ${msg.type}`);
                send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
    });

    ws.on('close', () => {
        const client = clientMap.get(ws);
        if (client) {
            const session = sessions.get(client.sessionId);
            if (session) {
                // Notify the peer
                const peer = getPeer(ws);
                if (peer) {
                    send(peer, { type: 'peer-left' });
                }

                // Clear the slot
                if (client.role === 'sender') session.sender = null;
                if (client.role === 'receiver') session.receiver = null;

                // Clean up empty sessions
                if (!session.sender && !session.receiver) {
                    sessions.delete(client.sessionId);
                    log('info', `Session ${client.sessionId} removed (no peers)`);
                }
            }
            clientMap.delete(ws);
        }
        log('info', `Connection closed (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
        log('error', `WebSocket error: ${err.message}`);
    });
});

// ── HTTP → WebSocket Upgrade ─────────────────────────────────────────────────

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeat);
});

// ── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log('GhostShare is active on your private network!');
    console.log(`Interface & Signal Hub: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    wss.clients.forEach((ws) => ws.close());
    wss.close(() => {
        server.close(() => {
            console.log('Server stopped.');
            process.exit(0);
        });
    });
});