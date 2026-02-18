// ---- Role Detection ----
const params = new URLSearchParams(window.location.search);
const hostPeerId = params.get('join');
const isHostRole = !hostPeerId;

let peer = null;
let connections = {}; // peerId -> DataConnection (host only)
let hostConn = null;  // DataConnection to host (joiner only)

let gameState = null;
let myPosition = null;
let myPeerId = null;
let gameLoop = null;

const COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3'];
const POSITIONS = ['top', 'bottom', 'left', 'right'];

// ---- DOM Elements ----
const lobbyScreen = document.getElementById('lobby');
const gameScreen = document.getElementById('game');
const endGameScreen = document.getElementById('endGame');

const nameInputSection = document.getElementById('nameInputSection');
const waitingSection = document.getElementById('waitingSection');
const playerNameInput = document.getElementById('playerName');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const lobbyBtn = document.getElementById('lobbyBtn');

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const yourPositionText = document.getElementById('yourPosition');
const playerListDiv = document.getElementById('playerList');
const controlsText = document.getElementById('controlsText');
const finalScoresDiv = document.getElementById('finalScores');
const winnerAnnouncementDiv = document.getElementById('winnerAnnouncement');

const connectionStatusEl = document.getElementById('connectionStatus');
const qrSection = document.getElementById('qrSection');
const qrCodeEl = document.getElementById('qrCode');
const joinUrlEl = document.getElementById('joinUrl');
const touchControlsEl = document.getElementById('touchControls');

// ---- Key States ----
const keys = {};

function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Initialize Game State (used by host) ----
function createInitialGameState() {
    return {
        status: 'lobby',
        players: {},
        ball: {
            x: 400,
            y: 300,
            vx: 0,
            vy: 0,
            speed: 5,
            radius: 8
        },
        paddles: {
            top: { x: 400, y: 20, width: 100, height: 15, moving: 0 },
            bottom: { x: 400, y: 580, width: 100, height: 15, moving: 0 },
            left: { x: 20, y: 300, width: 15, height: 100, moving: 0 },
            right: { x: 780, y: 300, width: 15, height: 100, moving: 0 }
        },
        canvasWidth: 800,
        canvasHeight: 600,
        paddleSpeed: 10
    };
}

// ---- PeerJS Setup ----
function initPeer() {
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        setConnectionStatus('Connected', 'connected');

        if (isHostRole) {
            // Host: initialize game state and listen for joiners
            gameState = createInitialGameState();
            generateQRCode(id);
            peer.on('connection', handleNewConnection);
        } else {
            // Joiner: connect to host
            hostConn = peer.connect(hostPeerId, { reliable: true });
            setupJoinerConnection(hostConn);
        }
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'peer-unavailable') {
            setConnectionStatus('Host not found', 'error');
        } else {
            setConnectionStatus('Connection error', 'error');
        }
    });
}

function setConnectionStatus(text, className) {
    connectionStatusEl.textContent = text;
    connectionStatusEl.className = 'connection-status ' + (className || '');
}

// ---- QR Code Generation ----
function generateQRCode(peerId) {
    const joinUrl = window.location.origin + window.location.pathname + '?join=' + peerId;

    QRCode.toCanvas(document.createElement('canvas'), joinUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#000', light: '#fff' }
    }, (err, canvasEl) => {
        if (err) {
            console.error('QR code error:', err);
            return;
        }
        qrCodeEl.innerHTML = '';
        qrCodeEl.appendChild(canvasEl);
    });

    joinUrlEl.textContent = joinUrl;

    // Copy URL button
    const copyBtn = document.getElementById('copyUrlBtn');
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(joinUrl).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        }).catch(() => {
            // Fallback: select the URL text
            const range = document.createRange();
            range.selectNode(joinUrlEl);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });
    });
}

// ---- Host: Handle New Joiner Connection ----
function handleNewConnection(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;

        // Send current game state
        conn.send({ type: 'gameState', data: gameState });

        conn.on('data', (msg) => {
            handleMessageAsHost(conn.peer, msg);
        });

        conn.on('close', () => {
            handleJoinerDisconnect(conn.peer);
        });
    });
}

function handleMessageAsHost(peerId, msg) {
    switch (msg.type) {
        case 'joinGame':
            hostAddPlayer(peerId, msg.data);
            break;
        case 'startGame':
            // Only the host peer can start
            break;
        case 'paddleMove':
            hostHandlePaddleMove(peerId, msg.data);
            break;
        case 'returnToLobby':
            // Only the host peer can return to lobby
            break;
    }
}

function handleJoinerDisconnect(peerId) {
    delete connections[peerId];

    if (gameState.players[peerId]) {
        delete gameState.players[peerId];
    }

    broadcastGameState();

    if (Object.keys(gameState.players).length === 0) {
        stopGameLoop();
        resetGameState();
    }
}

// ---- Host: Game Logic (ported from server.js) ----
function hostAddPlayer(peerId, playerName) {
    const usedPositions = Object.values(gameState.players).map(p => p.position);
    const availablePosition = POSITIONS.find(pos => !usedPositions.includes(pos));

    if (availablePosition && Object.keys(gameState.players).length < 4) {
        const usedColors = Object.values(gameState.players).map(p => p.color);
        const availableColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[0];

        gameState.players[peerId] = {
            position: availablePosition,
            name: playerName || 'Player ' + (Object.keys(gameState.players).length + 1),
            color: availableColor,
            score: 0
        };

        broadcastGameState();

        // Send player assignment
        const assignMsg = {
            type: 'playerAssigned',
            data: { position: availablePosition }
        };

        if (peerId === myPeerId) {
            // Host self-play
            onPlayerAssigned(assignMsg.data);
        } else if (connections[peerId]) {
            connections[peerId].send(assignMsg);
        }
    } else {
        if (peerId === myPeerId) {
            alert('Game is full! Maximum 4 players.');
        } else if (connections[peerId]) {
            connections[peerId].send({ type: 'gameFull' });
        }
    }
}

function hostHandlePaddleMove(peerId, direction) {
    const player = gameState.players[peerId];
    if (player && gameState.status === 'playing') {
        gameState.paddles[player.position].moving = direction;
    }
}

function hostStartGame() {
    if (gameState.status !== 'lobby') return;

    gameState.status = 'playing';

    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].score = 0;
    });

    resetBall();
    startGameLoop();
    broadcastGameState();
}

function startGameLoop() {
    if (!gameLoop) {
        gameLoop = setInterval(updateGame, 1000 / 60);
    }
}

function stopGameLoop() {
    if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
    }
}

function resetBall() {
    gameState.ball.x = gameState.canvasWidth / 2;
    gameState.ball.y = gameState.canvasHeight / 2;
    gameState.ball.speed = 5;

    const activePositions = Object.values(gameState.players).map(p => p.position);

    if (activePositions.length === 0) {
        const angle = (Math.random() * Math.PI / 2) - Math.PI / 4 + (Math.floor(Math.random() * 4) * Math.PI / 2);
        gameState.ball.vx = Math.cos(angle) * gameState.ball.speed;
        gameState.ball.vy = Math.sin(angle) * gameState.ball.speed;
        return;
    }

    const targetPosition = activePositions[Math.floor(Math.random() * activePositions.length)];
    let baseAngle;
    switch (targetPosition) {
        case 'top': baseAngle = -Math.PI / 2; break;
        case 'bottom': baseAngle = Math.PI / 2; break;
        case 'left': baseAngle = Math.PI; break;
        case 'right': baseAngle = 0; break;
    }

    const variance = (Math.random() - 0.5) * (Math.PI / 3);
    const angle = baseAngle + variance;

    gameState.ball.vx = Math.cos(angle) * gameState.ball.speed;
    gameState.ball.vy = Math.sin(angle) * gameState.ball.speed;
}

function updateGame() {
    if (gameState.status !== 'playing') return;

    // Update paddles
    Object.entries(gameState.paddles).forEach(([position, paddle]) => {
        if (position === 'top' || position === 'bottom') {
            paddle.x += paddle.moving * gameState.paddleSpeed;
            paddle.x = Math.max(paddle.width / 2, Math.min(gameState.canvasWidth - paddle.width / 2, paddle.x));
        } else {
            paddle.y += paddle.moving * gameState.paddleSpeed;
            paddle.y = Math.max(paddle.height / 2, Math.min(gameState.canvasHeight - paddle.height / 2, paddle.y));
        }
    });

    // Update ball position
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;

    checkPaddleCollisions();
    checkBallOut();

    broadcastGameState();
}

function checkPaddleCollisions() {
    const ball = gameState.ball;
    const paddles = gameState.paddles;
    const currentSpeed = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);

    // Top paddle
    if (ball.vy < 0 && ball.y - ball.radius <= paddles.top.y + paddles.top.height) {
        if (ball.x >= paddles.top.x - paddles.top.width / 2 &&
            ball.x <= paddles.top.x + paddles.top.width / 2) {
            const hitPosition = (ball.x - paddles.top.x) / (paddles.top.width / 2);
            const maxAngle = Math.PI / 3;
            const bounceAngle = hitPosition * maxAngle;
            ball.vx = Math.sin(bounceAngle) * currentSpeed;
            ball.vy = Math.abs(Math.cos(bounceAngle) * currentSpeed);
            ball.y = paddles.top.y + paddles.top.height + ball.radius;

            const playerId = Object.keys(gameState.players).find(
                id => gameState.players[id].position === 'top'
            );
            if (playerId) gameState.players[playerId].score++;
            increaseSpeed();
        }
    }

    // Bottom paddle
    if (ball.vy > 0 && ball.y + ball.radius >= paddles.bottom.y) {
        if (ball.x >= paddles.bottom.x - paddles.bottom.width / 2 &&
            ball.x <= paddles.bottom.x + paddles.bottom.width / 2) {
            const hitPosition = (ball.x - paddles.bottom.x) / (paddles.bottom.width / 2);
            const maxAngle = Math.PI / 3;
            const bounceAngle = hitPosition * maxAngle;
            ball.vx = Math.sin(bounceAngle) * currentSpeed;
            ball.vy = -Math.abs(Math.cos(bounceAngle) * currentSpeed);
            ball.y = paddles.bottom.y - ball.radius;

            const playerId = Object.keys(gameState.players).find(
                id => gameState.players[id].position === 'bottom'
            );
            if (playerId) gameState.players[playerId].score++;
            increaseSpeed();
        }
    }

    // Left paddle
    if (ball.vx < 0 && ball.x - ball.radius <= paddles.left.x + paddles.left.width) {
        if (ball.y >= paddles.left.y - paddles.left.height / 2 &&
            ball.y <= paddles.left.y + paddles.left.height / 2) {
            const hitPosition = (ball.y - paddles.left.y) / (paddles.left.height / 2);
            const maxAngle = Math.PI / 3;
            const bounceAngle = hitPosition * maxAngle;
            ball.vx = Math.abs(Math.cos(bounceAngle) * currentSpeed);
            ball.vy = Math.sin(bounceAngle) * currentSpeed;
            ball.x = paddles.left.x + paddles.left.width + ball.radius;

            const playerId = Object.keys(gameState.players).find(
                id => gameState.players[id].position === 'left'
            );
            if (playerId) gameState.players[playerId].score++;
            increaseSpeed();
        }
    }

    // Right paddle
    if (ball.vx > 0 && ball.x + ball.radius >= paddles.right.x) {
        if (ball.y >= paddles.right.y - paddles.right.height / 2 &&
            ball.y <= paddles.right.y + paddles.right.height / 2) {
            const hitPosition = (ball.y - paddles.right.y) / (paddles.right.height / 2);
            const maxAngle = Math.PI / 3;
            const bounceAngle = hitPosition * maxAngle;
            ball.vx = -Math.abs(Math.cos(bounceAngle) * currentSpeed);
            ball.vy = Math.sin(bounceAngle) * currentSpeed;
            ball.x = paddles.right.x - ball.radius;

            const playerId = Object.keys(gameState.players).find(
                id => gameState.players[id].position === 'right'
            );
            if (playerId) gameState.players[playerId].score++;
            increaseSpeed();
        }
    }
}

function checkBallOut() {
    const ball = gameState.ball;
    let scored = false;

    if (ball.y - ball.radius <= 0) {
        const hasPlayer = Object.values(gameState.players).some(p => p.position === 'top');
        if (hasPlayer) {
            scored = true;
        } else {
            ball.vy = Math.abs(ball.vy);
            ball.y = ball.radius;
        }
    } else if (ball.y + ball.radius >= gameState.canvasHeight) {
        const hasPlayer = Object.values(gameState.players).some(p => p.position === 'bottom');
        if (hasPlayer) {
            scored = true;
        } else {
            ball.vy = -Math.abs(ball.vy);
            ball.y = gameState.canvasHeight - ball.radius;
        }
    } else if (ball.x - ball.radius <= 0) {
        const hasPlayer = Object.values(gameState.players).some(p => p.position === 'left');
        if (hasPlayer) {
            scored = true;
        } else {
            ball.vx = Math.abs(ball.vx);
            ball.x = ball.radius;
        }
    } else if (ball.x + ball.radius >= gameState.canvasWidth) {
        const hasPlayer = Object.values(gameState.players).some(p => p.position === 'right');
        if (hasPlayer) {
            scored = true;
        } else {
            ball.vx = -Math.abs(ball.vx);
            ball.x = gameState.canvasWidth - ball.radius;
        }
    }

    if (scored) {
        resetBall();
        const maxScore = Math.max(...Object.values(gameState.players).map(p => p.score));
        if (maxScore >= 10) {
            endGame();
        }
    }
}

function increaseSpeed() {
    const maxSpeed = 10;
    const currentSpeed = Math.sqrt(gameState.ball.vx ** 2 + gameState.ball.vy ** 2);
    if (currentSpeed < maxSpeed) {
        const speedIncrease = 1.05;
        gameState.ball.vx *= speedIncrease;
        gameState.ball.vy *= speedIncrease;
    }
}

function endGame() {
    gameState.status = 'ended';
    stopGameLoop();
    broadcastGameState();
}

function hostReturnToLobby() {
    gameState.status = 'lobby';

    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].score = 0;
    });

    // Reset paddles
    gameState.paddles.top.x = 400;
    gameState.paddles.bottom.x = 400;
    gameState.paddles.left.y = 300;
    gameState.paddles.right.y = 300;
    Object.values(gameState.paddles).forEach(p => p.moving = 0);

    gameState.ball.x = gameState.canvasWidth / 2;
    gameState.ball.y = gameState.canvasHeight / 2;
    gameState.ball.vx = 0;
    gameState.ball.vy = 0;

    broadcastGameState();
}

function resetGameState() {
    gameState = createInitialGameState();
}

// ---- Host: Broadcast to all joiners ----
function broadcastGameState() {
    const msg = { type: 'gameState', data: gameState };
    Object.values(connections).forEach(conn => {
        if (conn.open) {
            conn.send(msg);
        }
    });
    // Also update local UI
    updateUI();
}

// ---- Joiner: Connection Setup ----
function setupJoinerConnection(conn) {
    conn.on('open', () => {
        setConnectionStatus('Connected to host', 'connected');
    });

    conn.on('data', (msg) => {
        handleMessageAsJoiner(msg);
    });

    conn.on('close', () => {
        setConnectionStatus('Host disconnected', 'error');
        // Show a message overlay
        if (gameState && gameState.status === 'playing') {
            gameState.status = 'ended';
            updateUI();
        }
        alert('The host has disconnected. The game is over.');
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        setConnectionStatus('Connection error', 'error');
    });
}

function handleMessageAsJoiner(msg) {
    switch (msg.type) {
        case 'gameState':
            gameState = msg.data;
            updateUI();
            break;
        case 'playerAssigned':
            onPlayerAssigned(msg.data);
            break;
        case 'gameFull':
            alert('Game is full! Maximum 4 players.');
            break;
    }
}

// ---- Shared: Send messages (abstracts host-self vs network) ----
function sendToHost(msg) {
    if (isHostRole) {
        // Host sending to self — process directly
        handleMessageAsHost(myPeerId, msg);
    } else if (hostConn && hostConn.open) {
        hostConn.send(msg);
    }
}

// ---- Shared: Player Assigned Callback ----
function onPlayerAssigned(data) {
    myPosition = data.position;

    nameInputSection.style.display = 'none';
    waitingSection.style.display = 'block';

    yourPositionText.textContent = 'You are: ' + myPosition.toUpperCase() + ' (' + getPlayerColor() + ')';

    if (isHostRole) {
        startBtn.style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
    }

    updatePlayerList();
    setupTouchControls();
}

// ---- Button Event Listeners ----
joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Player ' + Math.floor(Math.random() * 1000);
    sendToHost({ type: 'joinGame', data: name });
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinBtn.click();
    }
});

startBtn.addEventListener('click', () => {
    if (isHostRole) {
        hostStartGame();
    }
});

lobbyBtn.addEventListener('click', () => {
    if (isHostRole) {
        hostReturnToLobby();
    }
});

// ---- Prevent mobile scroll/refresh during gameplay ----
document.addEventListener('touchmove', (e) => {
    if (gameState && gameState.status === 'playing') {
        e.preventDefault();
    }
}, { passive: false });

// ---- Keyboard Controls ----
document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    updatePaddleMovement();
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    updatePaddleMovement();
});

function updatePaddleMovement() {
    if (!myPosition || !gameState || gameState.status !== 'playing') return;

    let direction = 0;

    if (myPosition === 'top' || myPosition === 'bottom') {
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
            direction = -1;
        } else if (keys['ArrowRight'] || keys['d'] || keys['D']) {
            direction = 1;
        }
    } else {
        if (keys['ArrowUp'] || keys['w'] || keys['W']) {
            direction = -1;
        } else if (keys['ArrowDown'] || keys['s'] || keys['S']) {
            direction = 1;
        }
    }

    sendToHost({ type: 'paddleMove', data: direction });
}

// ---- Touch Controls ----
function setupTouchControls() {
    touchControlsEl.style.display = 'flex';

    const touchLeft = document.getElementById('touchLeft');
    const touchRight = document.getElementById('touchRight');
    const touchUp = document.getElementById('touchUp');
    const touchDown = document.getElementById('touchDown');

    if (myPosition === 'top' || myPosition === 'bottom') {
        // Horizontal movement: show left/right side by side
        touchControlsEl.classList.remove('vertical');
        touchLeft.style.display = 'flex';
        touchRight.style.display = 'flex';
        touchUp.style.display = 'none';
        touchDown.style.display = 'none';
    } else {
        // Vertical movement: show up/down stacked vertically
        touchControlsEl.classList.add('vertical');
        touchLeft.style.display = 'none';
        touchRight.style.display = 'none';
        touchUp.style.display = 'flex';
        touchDown.style.display = 'flex';
    }

    // Attach touch and mouse events to all buttons
    [touchLeft, touchRight, touchUp, touchDown].forEach(btn => {
        const dir = parseInt(btn.dataset.dir);

        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: dir });
        });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: 0 });
        });

        btn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: 0 });
        });

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: dir });
        });

        btn.addEventListener('mouseup', (e) => {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: 0 });
        });
    });
}

// ---- UI Rendering ----
function updateUI() {
    if (!gameState) return;

    if (gameState.status === 'lobby') {
        showScreen('lobby');
        updatePlayerList();
        if (isHostRole && myPosition) {
            qrSection.style.display = 'block';
        }
    } else if (gameState.status === 'playing') {
        showScreen('game');
        renderGame();
        updateScoreboard();
        updateControls();
    } else if (gameState.status === 'ended') {
        showScreen('endGame');
        displayFinalScores();
    }
}

function showScreen(screenName) {
    lobbyScreen.style.display = screenName === 'lobby' ? 'block' : 'none';
    gameScreen.style.display = screenName === 'game' ? 'block' : 'none';
    endGameScreen.style.display = screenName === 'endGame' ? 'block' : 'none';

    // Lock body scroll during gameplay, allow scrolling in lobby/end screens
    if (screenName === 'game') {
        document.body.classList.add('playing');
    } else {
        document.body.classList.remove('playing');
    }
}

function updatePlayerList() {
    if (!gameState) return;

    const players = Object.values(gameState.players);
    playerListDiv.innerHTML = '';

    if (players.length === 0) {
        playerListDiv.innerHTML = '<p>No players yet...</p>';
        return;
    }

    players.forEach(player => {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        playerItem.innerHTML =
            '<span class="player-color" style="background-color: ' + player.color + '"></span>' +
            '<span>' + escapeHTML(player.name) + ' - ' + player.position.toUpperCase() + '</span>';
        playerListDiv.appendChild(playerItem);
    });
}

function renderGame() {
    if (!gameState) return;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw center lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw paddles
    Object.entries(gameState.paddles).forEach(([position, paddle]) => {
        const player = Object.values(gameState.players).find(p => p.position === position);
        if (!player) return;

        ctx.fillStyle = player.color;

        if (position === 'top' || position === 'bottom') {
            ctx.fillRect(
                paddle.x - paddle.width / 2,
                paddle.y,
                paddle.width,
                paddle.height
            );
        } else {
            ctx.fillRect(
                paddle.x,
                paddle.y - paddle.height / 2,
                paddle.width,
                paddle.height
            );
        }

        // Draw player name
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (position === 'top') {
            ctx.fillText(player.name, paddle.x, paddle.y + paddle.height + 12);
        } else if (position === 'bottom') {
            ctx.fillText(player.name, paddle.x, paddle.y - 8);
        } else if (position === 'left') {
            ctx.save();
            ctx.translate(paddle.x + paddle.width + 12, paddle.y);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(player.name, 0, 0);
            ctx.restore();
        } else if (position === 'right') {
            ctx.save();
            ctx.translate(paddle.x - 12, paddle.y);
            ctx.rotate(Math.PI / 2);
            ctx.fillText(player.name, 0, 0);
            ctx.restore();
        }
    });

    // Draw ball
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(gameState.ball.x, gameState.ball.y, gameState.ball.radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw ball trail
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(
        gameState.ball.x - gameState.ball.vx * 2,
        gameState.ball.y - gameState.ball.vy * 2,
        gameState.ball.radius * 0.7,
        0,
        Math.PI * 2
    );
    ctx.fill();
}

function updateScoreboard() {
    if (!gameState) return;

    const positions = ['top', 'bottom', 'left', 'right'];

    positions.forEach(position => {
        const scoreElement = document.getElementById('score-' + position);
        const player = Object.values(gameState.players).find(p => p.position === position);

        if (player) {
            scoreElement.style.display = 'block';
            scoreElement.innerHTML =
                '<span class="player-color" style="background-color: ' + player.color + '; width: 15px; height: 15px; display: inline-block; border-radius: 50%; margin-right: 8px;"></span>' +
                escapeHTML(player.name) + ' (' + position.toUpperCase() + '): ' + player.score;
            scoreElement.style.borderLeft = '4px solid ' + player.color;
        } else {
            scoreElement.style.display = 'none';
        }
    });
}

function updateControls() {
    if (!myPosition) {
        controlsText.textContent = 'Spectating';
        return;
    }

    if (myPosition === 'top' || myPosition === 'bottom') {
        controlsText.textContent = 'Controls: Arrow Keys or A/D to move left/right';
    } else {
        controlsText.textContent = 'Controls: Arrow Keys or W/S to move up/down';
    }
}

function displayFinalScores() {
    if (!gameState) return;

    const players = Object.values(gameState.players);
    players.sort((a, b) => b.score - a.score);

    finalScoresDiv.innerHTML = '';

    players.forEach((player, index) => {
        const scoreItem = document.createElement('div');
        scoreItem.className = 'final-score-item';

        const isWinner = index === 0;
        scoreItem.innerHTML =
            '<span class="player-color" style="background-color: ' + player.color + '; width: 25px; height: 25px; border-radius: 50%;"></span>' +
            '<span>' + escapeHTML(player.name) + ' (' + player.position.toUpperCase() + '): ' + player.score + ' points</span>' +
            (isWinner ? '<span class="winner-badge">WINNER</span>' : '');

        finalScoresDiv.appendChild(scoreItem);
    });

    if (players.length > 0) {
        winnerAnnouncementDiv.textContent = players[0].name + ' wins!';
    }

    if (isHostRole) {
        lobbyBtn.style.display = 'block';
        document.getElementById('waitingForHostMessage').style.display = 'none';
    } else {
        lobbyBtn.style.display = 'none';
        document.getElementById('waitingForHostMessage').style.display = 'block';
    }
}

function getPlayerColor() {
    if (!gameState || !myPosition) return '';
    const player = Object.values(gameState.players).find(p => p.position === myPosition);
    return player ? player.color : '';
}

// ---- Animation Loop ----
function renderLoop() {
    if (gameState && gameState.status === 'playing') {
        renderGame();
    }
    requestAnimationFrame(renderLoop);
}

renderLoop();

// ---- Initialize ----
initPeer();
