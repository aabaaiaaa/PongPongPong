(function() {
"use strict";

// ---- Configuration ----
var COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3'];
var POSITIONS = ['top', 'bottom', 'left', 'right'];

// ---- URL Params ----
var params = new URLSearchParams(window.location.search);
var joinParam = params.get('join');

// ---- State ----
var isHostRole = false;
var peer = null;
var connections = {};
var hostConn = null;
var gameState = null;
var myPosition = null;
var myPeerId = null;
var gameLoop = null;

// ---- DOM Elements ----
var roleSelectScreen = document.getElementById('roleSelect');
var lobbyScreen = document.getElementById('lobby');
var gameScreen = document.getElementById('game');
var endGameScreen = document.getElementById('endGame');

var hostGameBtn = document.getElementById('hostGameBtn');

var nameInputSection = document.getElementById('nameInputSection');
var waitingSection = document.getElementById('waitingSection');
var playerNameInput = document.getElementById('playerName');
var joinBtn = document.getElementById('joinBtn');
var startBtn = document.getElementById('startBtn');
var lobbyBtn = document.getElementById('lobbyBtn');

var canvas = document.getElementById('gameCanvas');
var ctx = canvas.getContext('2d');

var yourPositionText = document.getElementById('yourPosition');
var playerListDiv = document.getElementById('playerList');
var controlsText = document.getElementById('controlsText');
var finalScoresDiv = document.getElementById('finalScores');
var winnerAnnouncementDiv = document.getElementById('winnerAnnouncement');

var connectionStatusEl = document.getElementById('connectionStatus');
var qrSection = document.getElementById('qrSection');
var qrCodeEl = document.getElementById('qrCode');
var joinUrlEl = document.getElementById('joinUrl');
var touchControlsEl = document.getElementById('touchControls');

// ---- Key States ----
var keys = {};

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
function initAsHost() {
    isHostRole = true;
    setConnectionStatus('Connecting...', '');
    peer = new Peer();

    peer.on('open', function(id) {
        myPeerId = id;
        setConnectionStatus('Connected', 'connected');
        gameState = createInitialGameState();
        showScreen('lobby');
        qrSection.style.display = 'block';
        generateQRCode();
        peer.on('connection', handleNewConnection);
    });

    peer.on('error', function(err) {
        console.error('PeerJS error:', err);
        setConnectionStatus('Connection error', 'error');
    });
}

function initAsJoiner(hostPeerId) {
    isHostRole = false;
    setConnectionStatus('Connecting...', '');
    peer = new Peer();

    peer.on('open', function(id) {
        myPeerId = id;
        setConnectionStatus('Connecting to host...', '');
        hostConn = peer.connect(hostPeerId, { reliable: true });
        setupJoinerConnection(hostConn);
    });

    peer.on('error', function(err) {
        console.error('PeerJS error:', err);
        if (err.type === 'peer-unavailable') {
            setConnectionStatus('Game not found', 'error');
            peer.destroy();
            showScreen('roleSelect');
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
function generateQRCode() {
    var joinUrl = window.location.origin + window.location.pathname + '?join=' + myPeerId;

    // Generate QR code using qrcode-generator
    var qr = qrcode(0, 'M');
    qr.addData(joinUrl);
    qr.make();

    var img = document.createElement('img');
    img.src = qr.createDataURL(6, 2);
    img.alt = 'QR Code to join game';
    qrCodeEl.innerHTML = '';
    qrCodeEl.appendChild(img);

    joinUrlEl.textContent = joinUrl;

    var copyBtn = document.getElementById('copyUrlBtn');
    copyBtn.onclick = function() {
        navigator.clipboard.writeText(joinUrl).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy Link'; }, 2000);
        }).catch(function() {
            var range = document.createRange();
            range.selectNode(joinUrlEl);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        });
    };
}

// ---- Host: Handle New Joiner Connection ----
function handleNewConnection(conn) {
    conn.on('open', function() {
        connections[conn.peer] = conn;

        conn.send({ type: 'gameState', data: gameState });

        conn.on('data', function(msg) {
            handleMessageAsHost(conn.peer, msg);
        });

        conn.on('close', function() {
            handleJoinerDisconnect(conn.peer);
        });
    });
}

function handleMessageAsHost(peerId, msg) {
    switch (msg.type) {
        case 'joinGame':
            hostAddPlayer(peerId, msg.data);
            break;
        case 'paddleMove':
            hostHandlePaddleMove(peerId, msg.data);
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

// ---- Host: Game Logic ----
function hostAddPlayer(peerId, playerName) {
    var usedPositions = Object.values(gameState.players).map(function(p) { return p.position; });
    var availablePosition = POSITIONS.find(function(pos) { return usedPositions.indexOf(pos) === -1; });

    if (availablePosition && Object.keys(gameState.players).length < 4) {
        var usedColors = Object.values(gameState.players).map(function(p) { return p.color; });
        var availableColor = COLORS.find(function(c) { return usedColors.indexOf(c) === -1; }) || COLORS[0];

        gameState.players[peerId] = {
            position: availablePosition,
            name: playerName || 'Player ' + (Object.keys(gameState.players).length + 1),
            color: availableColor,
            score: 0
        };

        broadcastGameState();

        var assignMsg = {
            type: 'playerAssigned',
            data: { position: availablePosition }
        };

        if (peerId === myPeerId) {
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
    var player = gameState.players[peerId];
    if (player && gameState.status === 'playing') {
        gameState.paddles[player.position].moving = direction;
    }
}

function hostStartGame() {
    if (gameState.status !== 'lobby') return;

    gameState.status = 'playing';

    Object.keys(gameState.players).forEach(function(id) {
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

    var activePositions = Object.values(gameState.players).map(function(p) { return p.position; });

    if (activePositions.length === 0) {
        var angle = (Math.random() * Math.PI / 2) - Math.PI / 4 + (Math.floor(Math.random() * 4) * Math.PI / 2);
        gameState.ball.vx = Math.cos(angle) * gameState.ball.speed;
        gameState.ball.vy = Math.sin(angle) * gameState.ball.speed;
        return;
    }

    var targetPosition = activePositions[Math.floor(Math.random() * activePositions.length)];
    var baseAngle;
    switch (targetPosition) {
        case 'top': baseAngle = -Math.PI / 2; break;
        case 'bottom': baseAngle = Math.PI / 2; break;
        case 'left': baseAngle = Math.PI; break;
        case 'right': baseAngle = 0; break;
    }

    var variance = (Math.random() - 0.5) * (Math.PI / 3);
    var finalAngle = baseAngle + variance;

    gameState.ball.vx = Math.cos(finalAngle) * gameState.ball.speed;
    gameState.ball.vy = Math.sin(finalAngle) * gameState.ball.speed;
}

function updateGame() {
    if (gameState.status !== 'playing') return;

    Object.entries(gameState.paddles).forEach(function(entry) {
        var position = entry[0];
        var paddle = entry[1];
        if (position === 'top' || position === 'bottom') {
            paddle.x += paddle.moving * gameState.paddleSpeed;
            paddle.x = Math.max(paddle.width / 2, Math.min(gameState.canvasWidth - paddle.width / 2, paddle.x));
        } else {
            paddle.y += paddle.moving * gameState.paddleSpeed;
            paddle.y = Math.max(paddle.height / 2, Math.min(gameState.canvasHeight - paddle.height / 2, paddle.y));
        }
    });

    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;

    checkPaddleCollisions();
    checkBallOut();

    broadcastGameState();
}

function checkPaddleCollisions() {
    var ball = gameState.ball;
    var paddles = gameState.paddles;
    var currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

    // Top paddle
    if (ball.vy < 0 && ball.y - ball.radius <= paddles.top.y + paddles.top.height) {
        if (ball.x >= paddles.top.x - paddles.top.width / 2 &&
            ball.x <= paddles.top.x + paddles.top.width / 2) {
            var hitPos = (ball.x - paddles.top.x) / (paddles.top.width / 2);
            var maxAngle = Math.PI / 3;
            var bounceAngle = hitPos * maxAngle;
            ball.vx = Math.sin(bounceAngle) * currentSpeed;
            ball.vy = Math.abs(Math.cos(bounceAngle) * currentSpeed);
            ball.y = paddles.top.y + paddles.top.height + ball.radius;

            var playerId = Object.keys(gameState.players).find(function(id) {
                return gameState.players[id].position === 'top';
            });
            if (playerId) gameState.players[playerId].score++;
            increaseSpeed();
        }
    }

    // Bottom paddle
    if (ball.vy > 0 && ball.y + ball.radius >= paddles.bottom.y) {
        if (ball.x >= paddles.bottom.x - paddles.bottom.width / 2 &&
            ball.x <= paddles.bottom.x + paddles.bottom.width / 2) {
            var hitPosB = (ball.x - paddles.bottom.x) / (paddles.bottom.width / 2);
            var maxAngleB = Math.PI / 3;
            var bounceAngleB = hitPosB * maxAngleB;
            ball.vx = Math.sin(bounceAngleB) * currentSpeed;
            ball.vy = -Math.abs(Math.cos(bounceAngleB) * currentSpeed);
            ball.y = paddles.bottom.y - ball.radius;

            var playerIdB = Object.keys(gameState.players).find(function(id) {
                return gameState.players[id].position === 'bottom';
            });
            if (playerIdB) gameState.players[playerIdB].score++;
            increaseSpeed();
        }
    }

    // Left paddle
    if (ball.vx < 0 && ball.x - ball.radius <= paddles.left.x + paddles.left.width) {
        if (ball.y >= paddles.left.y - paddles.left.height / 2 &&
            ball.y <= paddles.left.y + paddles.left.height / 2) {
            var hitPosL = (ball.y - paddles.left.y) / (paddles.left.height / 2);
            var maxAngleL = Math.PI / 3;
            var bounceAngleL = hitPosL * maxAngleL;
            ball.vx = Math.abs(Math.cos(bounceAngleL) * currentSpeed);
            ball.vy = Math.sin(bounceAngleL) * currentSpeed;
            ball.x = paddles.left.x + paddles.left.width + ball.radius;

            var playerIdL = Object.keys(gameState.players).find(function(id) {
                return gameState.players[id].position === 'left';
            });
            if (playerIdL) gameState.players[playerIdL].score++;
            increaseSpeed();
        }
    }

    // Right paddle
    if (ball.vx > 0 && ball.x + ball.radius >= paddles.right.x) {
        if (ball.y >= paddles.right.y - paddles.right.height / 2 &&
            ball.y <= paddles.right.y + paddles.right.height / 2) {
            var hitPosR = (ball.y - paddles.right.y) / (paddles.right.height / 2);
            var maxAngleR = Math.PI / 3;
            var bounceAngleR = hitPosR * maxAngleR;
            ball.vx = -Math.abs(Math.cos(bounceAngleR) * currentSpeed);
            ball.vy = Math.sin(bounceAngleR) * currentSpeed;
            ball.x = paddles.right.x - ball.radius;

            var playerIdR = Object.keys(gameState.players).find(function(id) {
                return gameState.players[id].position === 'right';
            });
            if (playerIdR) gameState.players[playerIdR].score++;
            increaseSpeed();
        }
    }
}

function checkBallOut() {
    var ball = gameState.ball;
    var scored = false;

    if (ball.y - ball.radius <= 0) {
        var hasTop = Object.values(gameState.players).some(function(p) { return p.position === 'top'; });
        if (hasTop) {
            scored = true;
        } else {
            ball.vy = Math.abs(ball.vy);
            ball.y = ball.radius;
        }
    } else if (ball.y + ball.radius >= gameState.canvasHeight) {
        var hasBottom = Object.values(gameState.players).some(function(p) { return p.position === 'bottom'; });
        if (hasBottom) {
            scored = true;
        } else {
            ball.vy = -Math.abs(ball.vy);
            ball.y = gameState.canvasHeight - ball.radius;
        }
    } else if (ball.x - ball.radius <= 0) {
        var hasLeft = Object.values(gameState.players).some(function(p) { return p.position === 'left'; });
        if (hasLeft) {
            scored = true;
        } else {
            ball.vx = Math.abs(ball.vx);
            ball.x = ball.radius;
        }
    } else if (ball.x + ball.radius >= gameState.canvasWidth) {
        var hasRight = Object.values(gameState.players).some(function(p) { return p.position === 'right'; });
        if (hasRight) {
            scored = true;
        } else {
            ball.vx = -Math.abs(ball.vx);
            ball.x = gameState.canvasWidth - ball.radius;
        }
    }

    if (scored) {
        resetBall();
        var scores = Object.values(gameState.players).map(function(p) { return p.score; });
        var maxScore = Math.max.apply(null, scores);
        if (maxScore >= 10) {
            endGame();
        }
    }
}

function increaseSpeed() {
    var maxSpeed = 10;
    var currentSpeed = Math.sqrt(gameState.ball.vx * gameState.ball.vx + gameState.ball.vy * gameState.ball.vy);
    if (currentSpeed < maxSpeed) {
        var speedIncrease = 1.05;
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

    Object.keys(gameState.players).forEach(function(id) {
        gameState.players[id].score = 0;
    });

    gameState.paddles.top.x = 400;
    gameState.paddles.bottom.x = 400;
    gameState.paddles.left.y = 300;
    gameState.paddles.right.y = 300;
    Object.values(gameState.paddles).forEach(function(p) { p.moving = 0; });

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
    var msg = { type: 'gameState', data: gameState };
    Object.values(connections).forEach(function(conn) {
        if (conn.open) {
            conn.send(msg);
        }
    });
    updateUI();
}

// ---- Joiner: Connection Setup ----
function setupJoinerConnection(conn) {
    conn.on('open', function() {
        setConnectionStatus('Connected to host', 'connected');
    });

    conn.on('data', function(msg) {
        handleMessageAsJoiner(msg);
    });

    conn.on('close', function() {
        setConnectionStatus('Host disconnected', 'error');
        if (gameState && gameState.status === 'playing') {
            gameState.status = 'ended';
            updateUI();
        }
        alert('The host has disconnected. The game is over.');
    });

    conn.on('error', function(err) {
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

// ---- Shared: Send messages ----
function sendToHost(msg) {
    if (isHostRole) {
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

// ---- Role Selection Event Listeners ----
hostGameBtn.addEventListener('click', function() {
    initAsHost();
});

// ---- Lobby Event Listeners ----
joinBtn.addEventListener('click', function() {
    var name = playerNameInput.value.trim() || 'Player ' + Math.floor(Math.random() * 1000);
    sendToHost({ type: 'joinGame', data: name });
});

playerNameInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        joinBtn.click();
    }
});

startBtn.addEventListener('click', function() {
    if (isHostRole) {
        hostStartGame();
    }
});

lobbyBtn.addEventListener('click', function() {
    if (isHostRole) {
        hostReturnToLobby();
    }
});

// ---- Prevent mobile scroll/refresh during gameplay ----
document.addEventListener('touchmove', function(e) {
    if (gameState && gameState.status === 'playing') {
        e.preventDefault();
    }
}, { passive: false });

// ---- Keyboard Controls ----
document.addEventListener('keydown', function(e) {
    keys[e.key] = true;
    updatePaddleMovement();
});

document.addEventListener('keyup', function(e) {
    keys[e.key] = false;
    updatePaddleMovement();
});

function updatePaddleMovement() {
    if (!myPosition || !gameState || gameState.status !== 'playing') return;

    var direction = 0;

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

    var touchLeft = document.getElementById('touchLeft');
    var touchRight = document.getElementById('touchRight');
    var touchUp = document.getElementById('touchUp');
    var touchDown = document.getElementById('touchDown');

    if (myPosition === 'top' || myPosition === 'bottom') {
        touchControlsEl.classList.remove('vertical');
        touchLeft.style.display = 'flex';
        touchRight.style.display = 'flex';
        touchUp.style.display = 'none';
        touchDown.style.display = 'none';
    } else {
        touchControlsEl.classList.add('vertical');
        touchLeft.style.display = 'none';
        touchRight.style.display = 'none';
        touchUp.style.display = 'flex';
        touchDown.style.display = 'flex';
    }

    [touchLeft, touchRight, touchUp, touchDown].forEach(function(btn) {
        var dir = parseInt(btn.dataset.dir);

        btn.addEventListener('touchstart', function(e) {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: dir });
        });

        btn.addEventListener('touchend', function(e) {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: 0 });
        });

        btn.addEventListener('touchcancel', function(e) {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: 0 });
        });

        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            sendToHost({ type: 'paddleMove', data: dir });
        });

        btn.addEventListener('mouseup', function(e) {
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
        if (isHostRole) {
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
    roleSelectScreen.style.display = screenName === 'roleSelect' ? 'block' : 'none';
    lobbyScreen.style.display = screenName === 'lobby' ? 'block' : 'none';
    gameScreen.style.display = screenName === 'game' ? 'block' : 'none';
    endGameScreen.style.display = screenName === 'endGame' ? 'block' : 'none';

    if (screenName === 'game') {
        document.body.classList.add('playing');
    } else {
        document.body.classList.remove('playing');
    }
}

function updatePlayerList() {
    if (!gameState) return;

    var players = Object.values(gameState.players);
    playerListDiv.innerHTML = '';

    if (players.length === 0) {
        playerListDiv.innerHTML = '<p>No players yet...</p>';
        return;
    }

    players.forEach(function(player) {
        var playerItem = document.createElement('div');
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
    Object.entries(gameState.paddles).forEach(function(entry) {
        var position = entry[0];
        var paddle = entry[1];
        var player = Object.values(gameState.players).find(function(p) { return p.position === position; });
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

    var positions = ['top', 'bottom', 'left', 'right'];

    positions.forEach(function(position) {
        var scoreElement = document.getElementById('score-' + position);
        var player = Object.values(gameState.players).find(function(p) { return p.position === position; });

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

    var players = Object.values(gameState.players);
    players.sort(function(a, b) { return b.score - a.score; });

    finalScoresDiv.innerHTML = '';

    players.forEach(function(player, index) {
        var scoreItem = document.createElement('div');
        scoreItem.className = 'final-score-item';

        var isWinner = index === 0;
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
    var player = Object.values(gameState.players).find(function(p) { return p.position === myPosition; });
    return player ? player.color : '';
}

// ---- Animation Loop ----
function renderLoop() {
    if (gameState && gameState.status === 'playing') {
        renderGame();
    }
    requestAnimationFrame(renderLoop);
}

// ---- Initialize ----
if (joinParam) {
    showScreen('lobby');
    initAsJoiner(joinParam);
} else {
    showScreen('roleSelect');
}

renderLoop();

})();
