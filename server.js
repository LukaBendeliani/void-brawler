const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
let projectiles = [];
let powerups = [];
const ARENA_SIZE = 10000;
const MAX_POWERUPS = 50; // Increased to match map size

const POWERUP_TYPES = {
    SPEED: { color: '#ffea00', label: 'Speed' },
    ATTACK_SPEED: { color: '#00ffff', label: 'Atk Speed' },
    DAMAGE: { color: '#ff3e3e', label: 'Damage' },
    DEFENSE: { color: '#3e3eff', label: 'Defense' },
    HEALTH: { color: '#3eff3e', label: 'Health' }
};

const SPECIAL_COLLECTIBLES = {
    PURPLE: { id: 'PURPLE', color: '#a020f0', label: 'Multi-shot' },
    GREEN: { id: 'GREEN', color: '#00ff00', label: 'Tankiness' },
    RED: { id: 'RED', color: '#ff0000', label: 'Berserker' },
    BLUE: { id: 'BLUE', color: '#0000ff', label: 'All-rounder' }
};

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Don't broadcast yet, wait for 'join'
    players[socket.id] = {
        id: socket.id,
        x: Math.random() * (ARENA_SIZE - 200) + 100,
        y: Math.random() * (ARENA_SIZE - 200) + 100,
        rotation: 0,
        health: 100,
        color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        name: 'Connecting...',
        joined: false,
        lastShot: 0,
        killCount: 0,
        stats: {
            damage: 10,
            speed: 10.0,
            defense: 1, // Multiplier for damage taken (1 = normal)
            attackSpeed: 1, // Multiplier for fire rate (1 = 1 shot per 500ms)
            health: 100,
            maxHealth: 100,
            size: 1
        },
        activeEffects: [],
        specialCollectibles: []
    };

    socket.emit('init', { id: socket.id, players, arenaSize: ARENA_SIZE });

    socket.on('join', (username) => {
        if (players[socket.id]) {
            players[socket.id].name = username || `Player ${socket.id.substr(0, 4)}`;
            players[socket.id].joined = true;
            socket.broadcast.emit('newPlayer', players[socket.id]);
        }
    });

    socket.on('update', (data) => {
        if (players[socket.id] && players[socket.id].joined) {
            players[socket.id].x = Math.max(0, Math.min(ARENA_SIZE, data.x));
            players[socket.id].y = Math.max(0, Math.min(ARENA_SIZE, data.y));
            players[socket.id].rotation = data.rotation;
        }
    });

    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (player && player.joined) {
            const now = Date.now();
            const cooldown = 500 / player.stats.attackSpeed;

            if (now - player.lastShot >= cooldown) {
                player.lastShot = now;

                const hasMultiShot = player.specialCollectibles.includes('PURPLE');
                const angles = hasMultiShot
                    ? [data.rotation, data.rotation + Math.PI / 2, data.rotation + Math.PI, data.rotation - Math.PI / 2]
                    : [data.rotation];

                angles.forEach(angle => {
                    projectiles.push({
                        ownerId: socket.id,
                        x: data.x,
                        y: data.y,
                        vx: Math.cos(angle) * 20,
                        vy: Math.sin(angle) * 20,
                        color: player.color,
                        life: 100,
                        damage: player.stats.damage
                    });
                });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const player = players[socket.id];
        if (player) {
            // Drop special collectibles on disconnect too? 
            // The requirement says "When a player holding collectibles dies".
            // But usually in games, disconnect counts as death for drops.
            player.specialCollectibles.forEach(scId => {
                const special = Object.values(SPECIAL_COLLECTIBLES).find(s => s.id === scId);
                powerups.push({
                    id: scId,
                    type: scId,
                    x: Math.random() * (ARENA_SIZE - 200) + 100,
                    y: Math.random() * (ARENA_SIZE - 200) + 100,
                    color: special ? special.color : '#ffffff',
                    isSpecial: true
                });
            });
        }
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

// Power-up spawner
setInterval(() => {
    // Standard powerups
    if (powerups.filter(pu => !SPECIAL_COLLECTIBLES[pu.type]).length < MAX_POWERUPS) {
        const types = Object.keys(POWERUP_TYPES);
        const type = types[Math.floor(Math.random() * types.length)];
        powerups.push({
            id: Math.random().toString(36).substr(2, 9),
            type,
            x: Math.random() * (ARENA_SIZE - 200) + 100,
            y: Math.random() * (ARENA_SIZE - 200) + 100,
            color: POWERUP_TYPES[type].color,
            isSpecial: false
        });
    }

    // Special collectibles
    Object.keys(SPECIAL_COLLECTIBLES).forEach(key => {
        const special = SPECIAL_COLLECTIBLES[key];
        const isHeld = Object.values(players).some(p => p.specialCollectibles.includes(special.id));
        const isInArena = powerups.some(pu => pu.type === special.id);

        if (!isHeld && !isInArena) {
            powerups.push({
                id: special.id,
                type: special.id,
                x: Math.random() * (ARENA_SIZE - 200) + 100,
                y: Math.random() * (ARENA_SIZE - 200) + 100,
                color: special.color,
                isSpecial: true
            });
        }
    });
}, 5000); // Check every 5 seconds

setInterval(() => {
    const now = Date.now();
    const nextProjectiles = [];

    // Update Player Effects & Stats
    for (const id in players) {
        const player = players[id];
        if (!player.joined) continue;

        const oldMaxHealth = player.stats.maxHealth;

        // Reset base stats
        player.stats.speed = 10.0;
        player.stats.attackSpeed = 1;
        player.stats.damage = 10;
        player.stats.defense = 1;
        player.stats.maxHealth = 100;
        player.stats.size = Math.pow(1.25, player.killCount || 0);

        // Apply temporary active effects
        player.activeEffects = player.activeEffects.filter(effect => effect.expiry > now);
        player.activeEffects.forEach(effect => {
            if (effect.type === 'SPEED') player.stats.speed *= 1.5;
            if (effect.type === 'ATTACK_SPEED') player.stats.attackSpeed *= 1.5;
            if (effect.type === 'DAMAGE') player.stats.damage *= 1.5;
            if (effect.type === 'DEFENSE') player.stats.defense *= 0.5;
        });

        // Apply special collectibles
        player.specialCollectibles.forEach(id => {
            if (id === 'GREEN') {
                player.stats.maxHealth *= 1.5;
                player.stats.defense *= 0.5;
            }
            if (id === 'RED') {
                player.stats.damage *= 1.5;
                player.stats.attackSpeed *= 1.5;
            }
            if (id === 'BLUE') {
                player.stats.damage *= 1.25;
                player.stats.attackSpeed *= 1.25;
                player.stats.maxHealth *= 1.25;
                player.stats.defense *= 0.75;
            }
            // Purple is handled in shoot logic
        });

        // God Mode (Full Set Bonus)
        if (player.specialCollectibles.length === 4) {
            player.stats.damage *= 2;
            player.stats.attackSpeed *= 2;
            player.stats.maxHealth *= 2;
            player.stats.defense *= 0.5;
            player.stats.speed *= 2;
            player.stats.size *= 2;
        }

        // Adjust current health if maxHealth changed (proportionally or just clamp)
        if (player.stats.maxHealth !== oldMaxHealth) {
            // If it increased, we might want to heal?
            // Requirement 2.2 says: "+50% maxHealth (and heal current health by 50%)"
            // This is tricky to do in the loop every frame.
            // I should probably handle the "heal" part at the moment of pickup.
        }
        player.health = Math.min(player.health, player.stats.maxHealth);

        // Collision with power-ups
        for (let i = powerups.length - 1; i >= 0; i--) {
            const pu = powerups[i];
            const dist = Math.hypot(player.x - pu.x, player.y - pu.y);
            if (dist < 30) {
                if (pu.isSpecial) {
                    if (!player.specialCollectibles.includes(pu.type)) {
                        player.specialCollectibles.push(pu.type);
                        // Special immediate effects on pickup
                        if (pu.type === 'GREEN') {
                            // +50% maxHealth (and heal current health by 50%)
                            // We'll heal by 50 points (50% of base max health)
                            player.health += 50;
                        }
                        if (pu.type === 'BLUE') {
                            // heal current health by 25% for consistency
                            player.health += 25;
                        }
                    }
                } else if (pu.type === 'HEALTH') {
                    player.health = Math.min(player.stats.maxHealth, player.health + 25);
                } else {
                    player.activeEffects.push({
                        type: pu.type,
                        expiry: now + 10000
                    });
                }
                powerups.splice(i, 1);
            }
        }
    }

    projectiles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        let hit = false;
        if (p.life > 0) {
            for (const id in players) {
                if (id === p.ownerId || !players[id].joined) continue;
                const player = players[id];
                const dist = Math.hypot(p.x - player.x, p.y - player.y);

                if (dist < 20 * player.stats.size) {
                    player.health -= p.damage * player.stats.defense;
                    hit = true;
                    if (player.health <= 0) {
                        // Death Drop: Respawn special collectibles
                        player.specialCollectibles.forEach(scId => {
                            // Find the color from SPECIAL_COLLECTIBLES
                            const special = Object.values(SPECIAL_COLLECTIBLES).find(s => s.id === scId);
                            powerups.push({
                                id: scId,
                                type: scId,
                                x: Math.random() * (ARENA_SIZE - 200) + 100,
                                y: Math.random() * (ARENA_SIZE - 200) + 100,
                                color: special ? special.color : '#ffffff',
                                isSpecial: true
                            });
                        });

                        player.health = 100;
                        player.x = Math.random() * (ARENA_SIZE - 200) + 100;
                        player.y = Math.random() * (ARENA_SIZE - 200) + 100;
                        player.activeEffects = []; // Clear effects on death
                        player.specialCollectibles = []; // Clear special ones on death
                        player.killCount = 0; // Reset progression on death

                        if (players[p.ownerId]) {
                            players[p.ownerId].killCount++;
                        }

                        io.emit('playerKilled', { victim: id, killer: p.ownerId });
                    }
                    break;
                }
            }
        }

        if (!hit && p.life > 0) {
            nextProjectiles.push(p);
        }
    });

    // Only send players who have joined
    const joinedPlayers = {};
    for (const id in players) {
        if (players[id].joined) {
            joinedPlayers[id] = players[id];
        }
    }

    projectiles = nextProjectiles;
    io.emit('state', { players: joinedPlayers, projectiles, powerups });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
