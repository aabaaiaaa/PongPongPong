const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 80;

// Serve static files
app.use(express.static('public'));

// Game state
const gameState = {
  status: 'lobby', // 'lobby', 'playing', 'ended'
  players: {}, // {socketId: {position: 'top'|'bottom'|'left'|'right', name, color, score}}
  hostId: null,
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

const COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3'];
const POSITIONS = ['top', 'bottom', 'left', 'right'];

let gameLoop = null;

// Handle socket connections
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Send current game state to new player
  socket.emit('gameState', gameState);

  // Handle player joining
  socket.on('joinGame', (playerName) => {
    // Set host if first player
    if (!gameState.hostId) {
      gameState.hostId = socket.id;
    }

    // Find available position
    const usedPositions = Object.values(gameState.players).map(p => p.position);
    const availablePosition = POSITIONS.find(pos => !usedPositions.includes(pos));

    if (availablePosition && Object.keys(gameState.players).length < 4) {
      const usedColors = Object.values(gameState.players).map(p => p.color);
      const availableColor = COLORS.find(c => !usedColors.includes(c)) || COLORS[0];

      gameState.players[socket.id] = {
        position: availablePosition,
        name: playerName || `Player ${Object.keys(gameState.players).length + 1}`,
        color: availableColor,
        score: 0
      };

      console.log(`${playerName} joined as ${availablePosition}`);
      io.emit('gameState', gameState);
      socket.emit('playerAssigned', {
        position: availablePosition,
        isHost: socket.id === gameState.hostId
      });
    } else {
      socket.emit('gameFull');
    }
  });

  // Handle game start (host only)
  socket.on('startGame', () => {
    if (socket.id === gameState.hostId && gameState.status === 'lobby') {
      startGame();
    }
  });

  // Handle paddle movement
  socket.on('paddleMove', (direction) => {
    const player = gameState.players[socket.id];
    if (player && gameState.status === 'playing') {
      const position = player.position;
      gameState.paddles[position].moving = direction; // -1, 0, or 1
    }
  });

  // Handle return to lobby
  socket.on('returnToLobby', () => {
    if (socket.id === gameState.hostId && gameState.status === 'ended') {
      returnToLobby();
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);

    if (gameState.players[socket.id]) {
      delete gameState.players[socket.id];
    }

    // Assign new host if current host left
    if (socket.id === gameState.hostId) {
      const remainingPlayers = Object.keys(gameState.players);
      gameState.hostId = remainingPlayers.length > 0 ? remainingPlayers[0] : null;
    }

    io.emit('gameState', gameState);

    // Stop game if no players left
    if (Object.keys(gameState.players).length === 0) {
      if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
      }
      resetGameState();
    }
  });
});

function startGame() {
  gameState.status = 'playing';

  // Reset scores
  Object.keys(gameState.players).forEach(id => {
    gameState.players[id].score = 0;
  });

  // Reset ball
  resetBall();

  // Start game loop
  if (!gameLoop) {
    gameLoop = setInterval(updateGame, 1000 / 60); // 60 FPS
  }

  io.emit('gameState', gameState);
}

function resetBall() {
  gameState.ball.x = gameState.canvasWidth / 2;
  gameState.ball.y = gameState.canvasHeight / 2;

  // Get positions with active players
  const activePositions = Object.values(gameState.players).map(p => p.position);

  // If no active players, use random direction
  if (activePositions.length === 0) {
    const angle = (Math.random() * Math.PI / 2) - Math.PI / 4 + (Math.floor(Math.random() * 4) * Math.PI / 2);
    gameState.ball.vx = Math.cos(angle) * gameState.ball.speed;
    gameState.ball.vy = Math.sin(angle) * gameState.ball.speed;
    return;
  }

  // Pick a random active position to send the ball towards
  const targetPosition = activePositions[Math.floor(Math.random() * activePositions.length)];

  // Set angle based on target position with some randomness
  let baseAngle;
  switch(targetPosition) {
    case 'top':
      baseAngle = -Math.PI / 2; // Up
      break;
    case 'bottom':
      baseAngle = Math.PI / 2; // Down
      break;
    case 'left':
      baseAngle = Math.PI; // Left
      break;
    case 'right':
      baseAngle = 0; // Right
      break;
  }

  // Add random variance of +/- 30 degrees
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

  // Check collisions with paddles
  checkPaddleCollisions();

  // Check if ball went out of bounds (point scored)
  checkBallOut();

  // Broadcast updated state
  io.emit('gameState', gameState);
}

function checkPaddleCollisions() {
  const ball = gameState.ball;
  const paddles = gameState.paddles;
  const currentSpeed = Math.sqrt(ball.vx ** 2 + ball.vy ** 2);

  // Top paddle
  if (ball.vy < 0 && ball.y - ball.radius <= paddles.top.y + paddles.top.height) {
    if (ball.x >= paddles.top.x - paddles.top.width / 2 &&
        ball.x <= paddles.top.x + paddles.top.width / 2) {

      // Calculate hit position (-1 to 1, where 0 is center)
      const hitPosition = (ball.x - paddles.top.x) / (paddles.top.width / 2);

      // Calculate new angle based on hit position (max 60 degrees from vertical)
      const maxAngle = Math.PI / 3; // 60 degrees
      const bounceAngle = hitPosition * maxAngle;

      // Apply new velocity with maintained speed
      ball.vx = Math.sin(bounceAngle) * currentSpeed;
      ball.vy = Math.abs(Math.cos(bounceAngle) * currentSpeed);
      ball.y = paddles.top.y + paddles.top.height + ball.radius;

      // Add score to player who hit the ball
      const playerId = Object.keys(gameState.players).find(
        id => gameState.players[id].position === 'top'
      );
      if (playerId) {
        gameState.players[playerId].score++;
      }

      // Increase speed slightly
      increaseSpeed();
    }
  }

  // Bottom paddle
  if (ball.vy > 0 && ball.y + ball.radius >= paddles.bottom.y) {
    if (ball.x >= paddles.bottom.x - paddles.bottom.width / 2 &&
        ball.x <= paddles.bottom.x + paddles.bottom.width / 2) {

      // Calculate hit position (-1 to 1, where 0 is center)
      const hitPosition = (ball.x - paddles.bottom.x) / (paddles.bottom.width / 2);

      // Calculate new angle based on hit position
      const maxAngle = Math.PI / 3; // 60 degrees
      const bounceAngle = hitPosition * maxAngle;

      // Apply new velocity with maintained speed
      ball.vx = Math.sin(bounceAngle) * currentSpeed;
      ball.vy = -Math.abs(Math.cos(bounceAngle) * currentSpeed);
      ball.y = paddles.bottom.y - ball.radius;

      const playerId = Object.keys(gameState.players).find(
        id => gameState.players[id].position === 'bottom'
      );
      if (playerId) {
        gameState.players[playerId].score++;
      }

      increaseSpeed();
    }
  }

  // Left paddle
  if (ball.vx < 0 && ball.x - ball.radius <= paddles.left.x + paddles.left.width) {
    if (ball.y >= paddles.left.y - paddles.left.height / 2 &&
        ball.y <= paddles.left.y + paddles.left.height / 2) {

      // Calculate hit position (-1 to 1, where 0 is center)
      const hitPosition = (ball.y - paddles.left.y) / (paddles.left.height / 2);

      // Calculate new angle based on hit position
      const maxAngle = Math.PI / 3; // 60 degrees
      const bounceAngle = hitPosition * maxAngle;

      // Apply new velocity with maintained speed
      ball.vx = Math.abs(Math.cos(bounceAngle) * currentSpeed);
      ball.vy = Math.sin(bounceAngle) * currentSpeed;
      ball.x = paddles.left.x + paddles.left.width + ball.radius;

      const playerId = Object.keys(gameState.players).find(
        id => gameState.players[id].position === 'left'
      );
      if (playerId) {
        gameState.players[playerId].score++;
      }

      increaseSpeed();
    }
  }

  // Right paddle
  if (ball.vx > 0 && ball.x + ball.radius >= paddles.right.x) {
    if (ball.y >= paddles.right.y - paddles.right.height / 2 &&
        ball.y <= paddles.right.y + paddles.right.height / 2) {

      // Calculate hit position (-1 to 1, where 0 is center)
      const hitPosition = (ball.y - paddles.right.y) / (paddles.right.height / 2);

      // Calculate new angle based on hit position
      const maxAngle = Math.PI / 3; // 60 degrees
      const bounceAngle = hitPosition * maxAngle;

      // Apply new velocity with maintained speed
      ball.vx = -Math.abs(Math.cos(bounceAngle) * currentSpeed);
      ball.vy = Math.sin(bounceAngle) * currentSpeed;
      ball.x = paddles.right.x - ball.radius;

      const playerId = Object.keys(gameState.players).find(
        id => gameState.players[id].position === 'right'
      );
      if (playerId) {
        gameState.players[playerId].score++;
      }

      increaseSpeed();
    }
  }
}

function checkBallOut() {
  const ball = gameState.ball;
  let scored = false;

  // Check if ball went out on any side
  if (ball.y - ball.radius <= 0) {
    // Top side - check if there's a player
    const hasPlayer = Object.values(gameState.players).some(p => p.position === 'top');
    if (hasPlayer) {
      // Player missed, everyone else could score
      scored = true;
    } else {
      // No player, bounce back
      ball.vy = Math.abs(ball.vy);
      ball.y = ball.radius;
    }
  } else if (ball.y + ball.radius >= gameState.canvasHeight) {
    // Bottom side
    const hasPlayer = Object.values(gameState.players).some(p => p.position === 'bottom');
    if (hasPlayer) {
      scored = true;
    } else {
      ball.vy = -Math.abs(ball.vy);
      ball.y = gameState.canvasHeight - ball.radius;
    }
  } else if (ball.x - ball.radius <= 0) {
    // Left side
    const hasPlayer = Object.values(gameState.players).some(p => p.position === 'left');
    if (hasPlayer) {
      scored = true;
    } else {
      ball.vx = Math.abs(ball.vx);
      ball.x = ball.radius;
    }
  } else if (ball.x + ball.radius >= gameState.canvasWidth) {
    // Right side
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

    // Check if anyone reached winning score
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

  if (gameLoop) {
    clearInterval(gameLoop);
    gameLoop = null;
  }

  io.emit('gameState', gameState);
}

function returnToLobby() {
  gameState.status = 'lobby';

  // Keep players and their colors but reset scores
  Object.keys(gameState.players).forEach(id => {
    gameState.players[id].score = 0;
  });

  // Reset ball
  gameState.ball.x = gameState.canvasWidth / 2;
  gameState.ball.y = gameState.canvasHeight / 2;
  gameState.ball.vx = 0;
  gameState.ball.vy = 0;

  io.emit('gameState', gameState);
}

function resetGameState() {
  gameState.status = 'lobby';
  gameState.players = {};
  gameState.hostId = null;
  gameState.ball.x = 400;
  gameState.ball.y = 300;
  gameState.ball.vx = 0;
  gameState.ball.vy = 0;
}

http.listen(PORT, () => {
  // Check if running under iisnode
  const isIISNode = !!process.env.IISNODE_VERSION;

  if (!isIISNode) {
    // Only show network info when running directly (not under IIS)
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    const localIPs = [];

    // Find all local IP addresses
    Object.values(networkInterfaces).forEach(interfaces => {
      interfaces.forEach(iface => {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      });
    });

    console.log(`\n4-Player Pong Server Started!`);
    console.log(`================================`);
    console.log(`Local:    http://localhost:${PORT}`);
    if (localIPs.length > 0) {
      localIPs.forEach(ip => {
        console.log(`Network:  http://${ip}:${PORT}`);
      });
    }
    console.log(`================================\n`);
    console.log(`Share the Network URL with other players on your local network!\n`);
  } else {
    console.log('4-Player Pong running under IIS via iisnode');
  }
});
