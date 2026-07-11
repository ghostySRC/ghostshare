const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2]) || 9001;

var server = http.createServer(function(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
        var filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, 'utf-8', function(err, data) {
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

var wss = new WebSocketServer({ noServer: true });
var sessions = new Map();
var clientMap = new Map();

function log(level, message) {
    var timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    var prefix = { info: 'i', warn: '!', error: 'x', success: '+' }[level] || '-';
    console.log('[' + timestamp + '] ' + prefix + ' ' + message);
}

function send(ws, data) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

function getPeer(ws) {
    var client = clientMap.get(ws);
    if (!client) return null;
    var session = sessions.get(client.sessionId);
    if (!session) return null;
    if (client.role === 'sender') return session.receiver;
    if (client.role === 'receiver') return session.sender;
    return null;
}

wss.on('connection', function(ws) {
    ws.isAlive = true;
    ws.on('pong', function() { ws.isAlive = true; });

    log('info', 'connection open (total: ' + wss.clients.size + ')');

    var registered = false;

    ws.on('message', function(raw) {
        var msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            send(ws, { type: 'error', message: 'Invalid message format' });
            return;
        }

        if (!msg.type) return;

        switch (msg.type) {
            case 'register': {
                var sessionId = msg.sessionId;
                var role = msg.role;
                if (!sessionId || !role || (role !== 'sender' && role !== 'receiver')) {
                    send(ws, { type: 'error', message: 'Invalid registration' });
                    return;
                }

                var session = sessions.get(sessionId);
                if (!session) {
                    session = { sender: null, receiver: null };
                    sessions.set(sessionId, session);
                    log('info', 'session ' + sessionId + ' created');
                }

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

                clientMap.set(ws, { sessionId: sessionId, role: role });
                registered = true;

                send(ws, { type: 'registered', sessionId: sessionId, role: role });
                log('success', role + ' registered in session ' + sessionId);

                if (session.sender && session.receiver) {
                    send(session.sender, { type: 'peer-joined' });
                    log('info', 'session ' + sessionId + ': both peers connected');
                }
                break;
            }

            case 'offer':
            case 'answer':
            case 'ice-candidate': {
                if (!registered) {
                    send(ws, { type: 'error', message: 'Not registered' });
                    return;
                }

                var peer = getPeer(ws);
                if (!peer) {
                    send(ws, { type: 'error', message: 'Peer not connected yet' });
                    return;
                }

                send(peer, msg);
                break;
            }

            default:
                log('warn', 'unknown message type: ' + msg.type);
        }
    });

    ws.on('close', function() {
        var client = clientMap.get(ws);
        if (client) {
            var session = sessions.get(client.sessionId);
            if (session) {
                var peer = getPeer(ws);
                if (peer) send(peer, { type: 'peer-left' });
                if (client.role === 'sender') session.sender = null;
                if (client.role === 'receiver') session.receiver = null;
                if (!session.sender && !session.receiver) {
                    sessions.delete(client.sessionId);
                }
            }
            clientMap.delete(ws);
        }
        log('info', 'connection closed (total: ' + wss.clients.size + ')');
    });

    ws.on('error', function(err) {
        log('error', 'websocket error: ' + err.message);
    });
});

server.on('upgrade', function(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function(ws) {
        wss.emit('connection', ws, request);
    });
});

var heartbeat = setInterval(function() {
    wss.clients.forEach(function(ws) {
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', function() {
    clearInterval(heartbeat);
});

function getLocalIP() {
    var interfaces = os.networkInterfaces();
    for (var name in interfaces) {
        var iface = interfaces[name];
        for (var i = 0; i < iface.length; i++) {
            var addr = iface[i];
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return null;
}

server.listen(PORT, function() {
    var localIP = getLocalIP();
    console.log('👻 GhostShare is active on your private network!');
    console.log('Local Interface: http://localhost:' + PORT);
    if (localIP) {
        console.log('Network Access:   http://' + localIP + ':' + PORT);
    }
});

process.on('SIGINT', function() {
    console.log('\nShutting down...');
    wss.clients.forEach(function(ws) { ws.close(); });
    wss.close(function() {
        server.close(function() {
            console.log('Server stopped.');
            process.exit(0);
        });
    });
});