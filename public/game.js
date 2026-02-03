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
let arenaSize = 16000;
let gameStarted = false;
let initialized = false;

let localPlayer = {
    x: 0,
    y: 0,
    rotation: 0,
    speed: 4.0
};

const keys = {};
let mouseDown = false;
let joystickMove = null;
let joystickShoot = null;
let mobileControls = {
    moveX: 0,
    moveY: 0,
    shootActive: false,
    shootRotation: 0
};

const statElements = {
    damage: document.getElementById('stat-damage'),
    speed: document.getElementById('stat-speed'),
    defense: document.getElementById('stat-defense'),
    attackSpeed: document.getElementById('stat-attackSpeed'),
    health: document.getElementById('stat-health'),
    size: document.getElementById('stat-size')
};

// Check for touch support
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

function initJoysticks() {
    if (!isTouchDevice) return;

    // Ensure joysticks are visible on mobile
    const leftJ = document.getElementById('joystick-left');
    const rightJ = document.getElementById('joystick-right');
    if (leftJ) leftJ.style.display = 'block';
    if (rightJ) rightJ.style.display = 'block';

    const optionsLeft = {
        zone: leftJ,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: '#00f2ff',
        size: 120,
        threshold: 0.1
    };
    joystickMove = nipplejs.create(optionsLeft);
    joystickMove.on('move', (evt, data) => {
        if (!data.angle || !data.force) return;
        
        const force = Math.min(data.force, 1);
        const angle = data.angle.radians;
        
        // 8-way snapping (45 degree increments)
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        
        mobileControls.moveX = Math.cos(snappedAngle) * force;
        mobileControls.moveY = Math.sin(snappedAngle) * force;
    });
    joystickMove.on('end', () => {
        mobileControls.moveX = 0;
        mobileControls.moveY = 0;
    });

    const optionsRight = {
        zone: rightJ,
        mode: 'static',
        position: { left: '50%', top: '50%' },
        color: '#ff3e3e',
        size: 120,
        threshold: 0.1
    };
    joystickShoot = nipplejs.create(optionsRight);
    joystickShoot.on('move', (evt, data) => {
        if (!data.angle || !data.force) return;
        mobileControls.shootActive = true;
        mobileControls.shootRotation = data.angle.radians;
        localPlayer.rotation = data.angle.radians;
    });
    joystickShoot.on('end', () => {
        mobileControls.shootActive = false;
    });
}

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

window.addEventListener('mousemove', e => {
    if (!gameStarted || isTouchDevice) return;
    const dx = e.clientX - canvas.width / 2;
    const dy = e.clientY - canvas.height / 2;
    localPlayer.rotation = Math.atan2(dy, dx);
});

window.addEventListener('mousedown', () => {
    if (!gameStarted || isTouchDevice) return;
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
        initJoysticks();
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
    arenaSize = data.arenaSize || 16000;
    if (players[myId]) {
        localPlayer.x = players[myId].x;
        localPlayer.y = players[myId].y;
        initialized = true;
    }
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
        if (statElements.speed) statElements.speed.innerText = (p.stats.speed / 4.0).toFixed(1);
        if (statElements.defense) statElements.defense.innerText = (1 / p.stats.defense).toFixed(1);
        if (statElements.attackSpeed) statElements.attackSpeed.innerText = p.stats.attackSpeed.toFixed(1);
        if (statElements.health) statElements.health.innerText = Math.ceil(p.health);
        if (statElements.size) statElements.size.innerText = p.stats.size.toFixed(1);

        // Update local speed from server stats
        localPlayer.speed = p.stats.speed;

        // Sync position if killed or significant desync
        const dist = Math.hypot(p.x - localPlayer.x, p.y - localPlayer.y);
        if (dist > 300 && initialized) {
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
    if (!myId || !players[myId] || !gameStarted || !initialized) return;

    let moveX = 0;
    let moveY = 0;

    // Support both Keyboard and Touch simultaneously
    if (keys['KeyW']) moveY -= 1;
    if (keys['KeyS']) moveY += 1;
    if (keys['KeyA']) moveX -= 1;
    if (keys['KeyD']) moveX += 1;

    if (isTouchDevice) {
        moveX += mobileControls.moveX || 0;
        moveY += mobileControls.moveY || 0;
    }

    if (moveX !== 0 || moveY !== 0) {
        const mag = Math.hypot(moveX, moveY);
        // Normalize and scale by speed (cap magnitude at 1.0)
        const normMag = Math.min(mag, 1.0);
        const dx = (moveX / mag) * normMag * localPlayer.speed;
        const dy = (moveY / mag) * normMag * localPlayer.speed;

        if (!isNaN(dx) && !isNaN(dy) && initialized) {
            localPlayer.x += dx;
            localPlayer.y += dy;
        }
    }

    // Local clamping
    localPlayer.x = Math.max(0, Math.min(arenaSize, localPlayer.x));
    localPlayer.y = Math.max(0, Math.min(arenaSize, localPlayer.y));

    socket.emit('update', {
        x: localPlayer.x,
        y: localPlayer.y,
        rotation: localPlayer.rotation
    });

    const isShooting = mobileControls.shootActive || mouseDown || keys['Space'];
    if (isShooting) {
        socket.emit('shoot', {
            x: localPlayer.x,
            y: localPlayer.y,
            rotation: localPlayer.rotation
        });
    }
}

let gridPattern = null;

function createGridPattern() {
    const gridSize = 50;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = gridSize;
    offCanvas.height = gridSize;
    const offCtx = offCanvas.getContext('2d');

    offCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    offCtx.lineWidth = 1;
    offCtx.beginPath();
    offCtx.moveTo(0, 0);
    offCtx.lineTo(gridSize, 0);
    offCtx.moveTo(0, 0);
    offCtx.lineTo(0, gridSize);
    offCtx.stroke();

    offCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    offCtx.beginPath();
    offCtx.arc(0, 0, 1.5, 0, Math.PI * 2);
    offCtx.fill();

    gridPattern = ctx.createPattern(offCanvas, 'repeat');
}

function drawGrid() {
    if (!gridPattern) createGridPattern();

    ctx.save();
    // Use an identity transform for the pattern so it aligns with world coordinates
    gridPattern.setTransform(new DOMMatrix());
    ctx.fillStyle = gridPattern;
    ctx.fillRect(0, 0, arenaSize, arenaSize);
    ctx.restore();
}

function drawBoundary() {
    ctx.strokeStyle = '#ff3e3e';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, arenaSize, arenaSize);
}

function draw() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!myId || !players[myId]) {
        requestAnimationFrame(draw);
        return;
    }

    // Dynamic FOV: Scale based on player size
    const playerSize = players[myId].stats.size || 1;
    const viewScale = 1 / playerSize;

    ctx.save();
    // 1. Center zoom on screen
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(viewScale, viewScale);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    // 2. Camera follow (camX/Y is the world coord of top-left of viewport)
    const camX = localPlayer.x - (canvas.width / viewScale) / 2;
    const camY = localPlayer.y - (canvas.height / viewScale) / 2;
    
    // 3. Shift into World Coordinates
    ctx.translate(-camX, -camY);

    drawGrid();
    drawBoundary();

    // Draw power-ups
    powerups.forEach(pu => {
        ctx.fillStyle = pu.color;

        // Floating effect
        const bob = Math.round(Math.sin(Date.now() / 200) * 5);
        const drawX = pu.x;
        const drawY = pu.y + bob;

        if (pu.isSpecial) {
            // Render as glowing circle
            ctx.beginPath();
            ctx.arc(drawX, drawY, 15, 0, Math.PI * 2);
            ctx.fill();

            // Outer ring
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(drawX, drawY, 18, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillRect(drawX - 10, drawY - 10, 20, 20);
        }

        // Label
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(pu.type, drawX, drawY - 20);
    });

    // Draw projectiles
    projectiles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw players
    for (const id in players) {
        const p = players[id];
        const isSelf = id === myId;

        // Use local prediction for self to ensure perfect smoothness
        const drawX = isSelf ? localPlayer.x : p.x;
        const drawY = isSelf ? localPlayer.y : p.y;
        const drawRot = isSelf ? localPlayer.rotation : p.rotation;

        // Draw Aura for special collectibles
        if (p.specialCollectibles && p.specialCollectibles.length > 0) {
            ctx.save();
            ctx.translate(drawX, drawY);

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
                ctx.beginPath();
                ctx.arc(0, 0, Math.round(40 + Math.sin(Date.now() / 100) * 5), 0, Math.PI * 2);
                ctx.stroke();
            } else {
                p.specialCollectibles.forEach((scId, index) => {
                    const color = colors[scId] || '#ffffff';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;

                    ctx.beginPath();
                    const radius = Math.round(25 + (index * 6) + Math.sin(Date.now() / 200 + index) * 3);
                    ctx.arc(0, 0, radius, 0, Math.PI * 2);
                    ctx.stroke();
                });
            }
            ctx.restore();
        }

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(drawRot);

        // Player Body
        ctx.fillStyle = p.color;

        // Square ship shape
        const s = Math.round(12 * p.stats.size);
        ctx.fillRect(-s, -s, s * 2, s * 2);

        // Direction indicator
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(Math.round(s / 2), Math.round(-s / 3));
        ctx.lineTo(Math.round(s / 2), Math.round(s / 3));
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Draw Name & Health Bar
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, drawX, drawY - 25);

        // Health bar background
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(drawX - 20, drawY - 20, 40, 5);
        // Health bar fill
        ctx.fillStyle = '#ff3e3e';
        ctx.fillRect(drawX - 20, drawY - 20, Math.round((p.health / p.stats.maxHealth) * 40), 5);
    }

    ctx.restore(); // End Dynamic FOV scale and World Coordinate shift

    drawMinimap();

    update();
    requestAnimationFrame(draw);
}

function drawMinimap() {
    const size = 100;
    const padding = 10;
    const x = Math.round(canvas.width - size - padding);
    const y = Math.round(canvas.height - size - padding);
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
        const px = Math.round(x + pu.x * scale);
        const py = Math.round(y + pu.y * scale);
        ctx.beginPath();
        ctx.arc(px, py, 1, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Players
    for (const id in players) {
        const p = players[id];
        const px = Math.round(x + p.x * scale);
        const py = Math.round(y + p.y * scale);

        if (id === myId) {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

draw();

window.onresize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
};
