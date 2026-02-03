const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const healthDisplay = document.getElementById('health');
const overlay = document.getElementById('overlay');
const ui = document.getElementById('ui');
const usernameInput = document.getElementById('username-input');
const startButton = document.getElementById('start-button');
const leaderboardList = document.getElementById('leaderboard-list');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let myId = null;
let players = {};
let projectiles = [];
let powerups = [];
let arenaSize = 10000;
let gameStarted = false;

let localPlayer = {
    x: 0,
    y: 0,
    rotation: 0,
    speed: 2.5
};

const keys = {};
let mouseDown = false;

const statElements = {
    damage: document.getElementById('stat-damage'),
    speed: document.getElementById('stat-speed'),
    defense: document.getElementById('stat-defense'),
    attackSpeed: document.getElementById('stat-attackSpeed'),
    health: document.getElementById('stat-health'),
    size: document.getElementById('stat-size')
};

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);
window.addEventListener('mousemove', e => {
    if (!gameStarted) return;
    const dx = e.clientX - canvas.width / 2;
    const dy = e.clientY - canvas.height / 2;
    localPlayer.rotation = Math.atan2(dy, dx);
});

window.addEventListener('mousedown', () => {
    if (!gameStarted) return;
    mouseDown = true;
});

window.addEventListener('mouseup', () => {
    mouseDown = false;
});

startButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        socket.emit('join', username);
        overlay.style.display = 'none';
        ui.style.display = 'flex';
        gameStarted = true;
    }
});

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        startButton.click();
    }
});

socket.on('init', (data) => {
    myId = data.id;
    players = data.players;
    arenaSize = data.arenaSize || 2000;
    localPlayer.x = players[myId].x;
    localPlayer.y = players[myId].y;
});

socket.on('state', (data) => {
    players = data.players;
    projectiles = data.projectiles;
    powerups = data.powerups || [];

    if (players[myId]) {
        const p = players[myId];
        healthDisplay.innerText = Math.ceil(p.health);

        // Update Stats UI
        if (statElements.damage) statElements.damage.innerText = (p.stats.damage / 10).toFixed(1);
        if (statElements.speed) statElements.speed.innerText = (p.stats.speed / 2.5).toFixed(1);
        if (statElements.defense) statElements.defense.innerText = (1 / p.stats.defense).toFixed(1);
        if (statElements.attackSpeed) statElements.attackSpeed.innerText = p.stats.attackSpeed.toFixed(1);
        if (statElements.health) statElements.health.innerText = Math.ceil(p.health);
        if (statElements.size) statElements.size.innerText = p.stats.size.toFixed(1);

        // Update local speed from server stats
        localPlayer.speed = p.stats.speed;

        // Sync position if killed or significant desync
        const dist = Math.hypot(p.x - localPlayer.x, p.y - localPlayer.y);
        if (dist > 300) {
            localPlayer.x = p.x;
            localPlayer.y = p.y;
        }

        updateLeaderboard();
    }
});

function updateLeaderboard() {
    if (!leaderboardList) return;

    const sortedPlayers = Object.values(players)
        .sort((a, b) => b.stats.size - a.stats.size)
        .slice(0, 10);

    leaderboardList.innerHTML = '';
    sortedPlayers.forEach(p => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        if (p.id === myId) item.classList.add('self');

        item.innerHTML = `
            <span class="leaderboard-name">${p.name}</span>
            <span class="leaderboard-size">×${p.stats.size.toFixed(1)}</span>
        `;
        leaderboardList.appendChild(item);
    });
}

function update() {
    if (!myId || !players[myId] || !gameStarted) return;

    let moveX = 0;
    let moveY = 0;

    if (keys['KeyW']) {
        moveX += Math.cos(localPlayer.rotation);
        moveY += Math.sin(localPlayer.rotation);
    }
    if (keys['KeyS']) {
        moveX -= Math.cos(localPlayer.rotation);
        moveY -= Math.sin(localPlayer.rotation);
    }
    if (keys['KeyA']) {
        moveX += Math.cos(localPlayer.rotation - Math.PI / 2);
        moveY += Math.sin(localPlayer.rotation - Math.PI / 2);
    }
    if (keys['KeyD']) {
        moveX += Math.cos(localPlayer.rotation + Math.PI / 2);
        moveY += Math.sin(localPlayer.rotation + Math.PI / 2);
    }

    if (moveX !== 0 || moveY !== 0) {
        const mag = Math.hypot(moveX, moveY);
        localPlayer.x += (moveX / mag) * localPlayer.speed;
        localPlayer.y += (moveY / mag) * localPlayer.speed;
    }

    // Local clamping
    localPlayer.x = Math.max(0, Math.min(arenaSize, localPlayer.x));
    localPlayer.y = Math.max(0, Math.min(arenaSize, localPlayer.y));

    socket.emit('update', {
        x: localPlayer.x,
        y: localPlayer.y,
        rotation: localPlayer.rotation
    });

    if (mouseDown) {
        socket.emit('shoot', {
            x: localPlayer.x,
            y: localPlayer.y,
            rotation: localPlayer.rotation
        });
    }
}

function drawGrid(offsetX, offsetY) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 50;

    // Only draw grid within arena bounds
    const startX = Math.max(0, Math.floor(offsetX / gridSize) * gridSize);
    const endX = Math.min(arenaSize, Math.ceil((offsetX + canvas.width) / gridSize) * gridSize);
    const startY = Math.max(0, Math.floor(offsetY / gridSize) * gridSize);
    const endY = Math.min(arenaSize, Math.ceil((offsetY + canvas.height) / gridSize) * gridSize);

    for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x - offsetX, 0 - offsetY);
        ctx.lineTo(x - offsetX, arenaSize - offsetY);
        ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0 - offsetX, y - offsetY);
        ctx.lineTo(arenaSize - offsetX, y - offsetY);
        ctx.stroke();
    }
}

function drawBoundary(offsetX, offsetY) {
    ctx.strokeStyle = '#ff3e3e';
    ctx.lineWidth = 5;
    ctx.strokeRect(0 - offsetX, 0 - offsetY, arenaSize, arenaSize);

    // Optional: Draw a slight glow for the boundary
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff3e3e';
    ctx.strokeRect(0 - offsetX, 0 - offsetY, arenaSize, arenaSize);
    ctx.shadowBlur = 0;
}

function draw() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!myId || !players[myId]) {
        requestAnimationFrame(draw);
        return;
    }

    const camX = Math.round(localPlayer.x - canvas.width / 2);
    const camY = Math.round(localPlayer.y - canvas.height / 2);

    drawGrid(camX, camY);
    drawBoundary(camX, camY);

    // Draw power-ups
    powerups.forEach(pu => {
        ctx.fillStyle = pu.color;
        ctx.shadowBlur = 20;
        ctx.shadowColor = pu.color;

        // Floating effect
        const bob = Math.sin(Date.now() / 200) * 5;

        if (pu.isSpecial) {
            // Render as glowing circle
            ctx.beginPath();
            ctx.arc(pu.x - camX, pu.y - camY + bob, 15, 0, Math.PI * 2);
            ctx.fill();

            // Outer ring
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pu.x - camX, pu.y - camY + bob, 18, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillRect(pu.x - camX - 10, pu.y - camY - 10 + bob, 20, 20);
        }

        // Label
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(pu.type, pu.x - camX, pu.y - camY - 20 + bob);
    });

    // Draw projectiles
    projectiles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x - camX, p.y - camY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    });

    // Draw players
    for (const id in players) {
        const p = players[id];
        const isSelf = id === myId;

        // Use local prediction for self to ensure perfect smoothness
        const drawX = isSelf ? localPlayer.x : p.x;
        const drawY = isSelf ? localPlayer.y : p.y;
        const drawRot = isSelf ? localPlayer.rotation : p.rotation;

        const screenX = drawX - camX;
        const screenY = drawY - camY;

        // Skip if off screen
        if (screenX < -100 || screenX > canvas.width + 100 || screenY < -100 || screenY > canvas.height + 100) continue;

        // Draw Aura for special collectibles
        if (p.specialCollectibles && p.specialCollectibles.length > 0) {
            ctx.save();
            ctx.translate(screenX, screenY);

            const colors = {
                PURPLE: '#a020f0',
                GREEN: '#00ff00',
                RED: '#ff0000',
                BLUE: '#0000ff'
            };

            if (p.specialCollectibles.length === 4) {
                // God Mode Rainbow Aura
                ctx.strokeStyle = `hsl(${Date.now() / 10 % 360}, 100%, 50%)`;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 20;
                ctx.shadowColor = ctx.strokeStyle;
                ctx.beginPath();
                ctx.arc(0, 0, 40 + Math.sin(Date.now() / 100) * 5, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                p.specialCollectibles.forEach((scId, index) => {
                    const color = colors[scId] || '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = color;

                    ctx.beginPath();
                    const radius = 25 + (index * 6) + Math.sin(Date.now() / 200 + index) * 3;
                    ctx.arc(0, 0, radius, 0, Math.PI * 2);
                    ctx.stroke();
                });
            }
            ctx.restore();
        }

        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(drawRot);

        // Player Body
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = p.color;

        // Square ship shape
        const s = 12 * p.stats.size;
        ctx.fillRect(-s, -s, s * 2, s * 2);

        // Direction indicator
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(s / 2, -s / 3);
        ctx.lineTo(s / 2, s / 3);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Draw Name & Health Bar
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, screenX, screenY - 25);

        // Health bar background
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(screenX - 20, screenY - 20, 40, 5);
        // Health bar fill
        ctx.fillStyle = '#ff3e3e';
        ctx.fillRect(screenX - 20, screenY - 20, (p.health / p.stats.maxHealth) * 40, 5);
    }

    drawMinimap();

    update();
    requestAnimationFrame(draw);
}

function drawMinimap() {
    const size = 150;
    const padding = 20;
    const x = canvas.width - size - padding;
    const y = canvas.height - size - padding;
    const scale = size / arenaSize;

    // Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, y, size, size);

    // Boundary
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, size, size);

    // Draw Power-ups (Small dots)
    powerups.forEach(pu => {
        ctx.fillStyle = pu.color;
        const px = x + pu.x * scale;
        const py = y + pu.y * scale;
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Players
    for (const id in players) {
        const p = players[id];
        const px = x + p.x * scale;
        const py = y + p.y * scale;

        if (id === myId) {
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 5;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

draw();

window.onresize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
};
