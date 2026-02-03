const socket = io();

let gameState = null;
let myPosition = null;
let isHost = false;

// DOM elements
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

// Key states
const keys = {};

// Socket event listeners
socket.on('gameState', (state) => {
    gameState = state;
    updateUI();
});

socket.on('playerAssigned', (data) => {
    myPosition = data.position;
    isHost = data.isHost;

    nameInputSection.style.display = 'none';
    waitingSection.style.display = 'block';

    yourPositionText.textContent = `You are: ${myPosition.toUpperCase()} (${getPlayerColor()})`;

    if (isHost) {
        startBtn.style.display = 'block';
        document.getElementById('waitingMessage').style.display = 'none';
    }

    updatePlayerList();
});

socket.on('gameFull', () => {
    alert('Game is full! Maximum 4 players.');
});

// Button event listeners
joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    socket.emit('joinGame', name);
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinBtn.click();
    }
});

startBtn.addEventListener('click', () => {
    socket.emit('startGame');
});

lobbyBtn.addEventListener('click', () => {
    socket.emit('returnToLobby');
});

// Keyboard controls
document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    updatePaddleMovement();
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    updatePaddleMovement();
});

function updatePaddleMovement() {
    if (!myPosition || gameState.status !== 'playing') return;

    let direction = 0;

    if (myPosition === 'top' || myPosition === 'bottom') {
        // Horizontal movement
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
            direction = -1;
        } else if (keys['ArrowRight'] || keys['d'] || keys['D']) {
            direction = 1;
        }
    } else {
        // Vertical movement
        if (keys['ArrowUp'] || keys['w'] || keys['W']) {
            direction = -1;
        } else if (keys['ArrowDown'] || keys['s'] || keys['S']) {
            direction = 1;
        }
    }

    socket.emit('paddleMove', direction);
}

function updateUI() {
    if (!gameState) return;

    if (gameState.status === 'lobby') {
        showScreen('lobby');
        updatePlayerList();
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
        playerItem.innerHTML = `
            <span class="player-color" style="background-color: ${player.color}"></span>
            <span>${player.name} - ${player.position.toUpperCase()}</span>
        `;
        playerListDiv.appendChild(playerItem);
    });
}

function renderGame() {
    if (!gameState) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw center line
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

    // Draw paddles (only if there's a player)
    Object.entries(gameState.paddles).forEach(([position, paddle]) => {
        const player = Object.values(gameState.players).find(p => p.position === position);

        // Only draw paddle if there's a player in this position
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

        // Draw player name on paddle
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

    // Draw ball trail effect
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
        const scoreElement = document.getElementById(`score-${position}`);
        const player = Object.values(gameState.players).find(p => p.position === position);

        if (player) {
            scoreElement.style.display = 'block';
            scoreElement.innerHTML = `
                <span class="player-color" style="background-color: ${player.color}; width: 15px; height: 15px; display: inline-block; border-radius: 50%; margin-right: 8px;"></span>
                ${player.name} (${position.toUpperCase()}): ${player.score}
            `;
            scoreElement.style.borderLeft = `4px solid ${player.color}`;
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
        scoreItem.innerHTML = `
            <span class="player-color" style="background-color: ${player.color}; width: 25px; height: 25px; border-radius: 50%;"></span>
            <span>${player.name} (${player.position.toUpperCase()}): ${player.score} points</span>
            ${isWinner ? '<span class="winner-badge">WINNER</span>' : ''}
        `;

        finalScoresDiv.appendChild(scoreItem);
    });

    if (players.length > 0) {
        winnerAnnouncementDiv.textContent = `${players[0].name} wins!`;
    }

    if (isHost) {
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

// Animation loop for smooth rendering during gameplay
function gameLoop() {
    if (gameState && gameState.status === 'playing') {
        renderGame();
    }
    requestAnimationFrame(gameLoop);
}

gameLoop();
