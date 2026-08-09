(() => {
"use strict";

/* =========================================================
   CONFIGURAZIONE
========================================================= */

const CONFIG = {
    SERVER: window.MP_SERVER || "wss://anime-multiplayer-server.onrender.com",

    MATCH_TIME: 180,

    FIELD_WIDTH: 1200,
    FIELD_HEIGHT: 680,

    PLAYER_RADIUS: 22,
    PLAYER_SPEED: 330,

    BALL_RADIUS: 12,

    BALL_FRICTION: 0.985,

    SHOT_MIN_POWER: 420,
    SHOT_MAX_POWER: 1050,

    PASS_POWER: 560,

    CHARGE_TIME: 900,

    SHOOT_COOLDOWN: 180,
    PASS_COOLDOWN: 140,

    SNAPSHOT_RATE: 30,

    GOAL_RESET_TIME: 1800
};

/* =========================================================
   CANVAS
========================================================= */

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let canvasWidth = 1200;
let canvasHeight = 680;

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    canvasWidth = rect.width;
    canvasHeight = rect.height;

    ctx.setTransform(
        canvas.width / CONFIG.FIELD_WIDTH,
        0,
        0,
        canvas.height / CONFIG.FIELD_HEIGHT,
        0,
        0
    );
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* =========================================================
   UI
========================================================= */

const redScoreEl = document.getElementById("redScore");
const blueScoreEl = document.getElementById("blueScore");
const timerEl = document.getElementById("timer");

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const finalScoreEl = document.getElementById("finalScore");

const readyButton = document.getElementById("readyButton");
const backButton = document.getElementById("backButton");

const statusText = document.getElementById("statusText");
const connectionDot = document.getElementById("connectionDot");

const goalMessage = document.getElementById("goalMessage");
const countdownEl = document.getElementById("countdown");

/* =========================================================
   STATO
========================================================= */

let myId = null;
let myTeam = null;
let isHost = false;

let playersInRoom = {};

let gameStarted = false;
let gameOver = false;

let matchTime = CONFIG.MATCH_TIME;

let lastTime = performance.now();
let accumulator = 0;

let lastSnapshot = 0;

let goalResetTimer = null;

let mouseX = CONFIG.FIELD_WIDTH / 2;
let mouseY = CONFIG.FIELD_HEIGHT / 2;

let input = {
    up: false,
    down: false,
    left: false,
    right: false,

    shoot: false,
    pass: false,

    shootPressed: false,
    passPressed: false
};

let previousShoot = false;
let previousPass = false;

/* =========================================================
   STATO DI GIOCO
========================================================= */

const game = {
    players: {},

    ball: {
        x: CONFIG.FIELD_WIDTH / 2,
        y: CONFIG.FIELD_HEIGHT / 2,
        vx: 0,
        vy: 0
    },

    score: {
        red: 0,
        blue: 0
    },

    time: CONFIG.MATCH_TIME,

    phase: "waiting",

    lastGoal: null
};

/* =========================================================
   RANDOM / UTILITY
========================================================= */

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function length(x, y) {
    return Math.sqrt(x * x + y * y);
}

function normalize(x, y) {
    const l = Math.sqrt(x * x + y * y);

    if (l < 0.0001) {
        return { x: 0, y: 0 };
    }

    return {
        x: x / l,
        y: y / l
    };
}

function distance(a, b) {
    return Math.sqrt(
        (a.x - b.x) ** 2 +
        (a.y - b.y) ** 2
    );
}

function formatTime(seconds) {
    seconds = Math.max(0, Math.ceil(seconds));

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/* =========================================================
   PLAYER
========================================================= */

function createPlayer(id, team) {

    const isRed = team === "red";

    return {
        id,
        team,

        x: isRed
            ? CONFIG.FIELD_WIDTH * 0.25
            : CONFIG.FIELD_WIDTH * 0.75,

        y: CONFIG.FIELD_HEIGHT / 2,

        vx: 0,
        vy: 0,

        charging: false,
        chargeStart: 0,

        lastShoot: 0,
        lastPass: 0,

        input: {
            up: false,
            down: false,
            left: false,
            right: false,
            shoot: false,
            pass: false
        },

        direction: {
            x: isRed ? 1 : -1,
            y: 0
        }
    };
}

/* =========================================================
   SPAWN
========================================================= */

function resetPositions() {

    const red = Object.values(game.players)
        .find(p => p.team === "red");

    const blue = Object.values(game.players)
        .find(p => p.team === "blue");

    if (red) {
        red.x = CONFIG.FIELD_WIDTH * 0.25;
        red.y = CONFIG.FIELD_HEIGHT / 2;
        red.vx = 0;
        red.vy = 0;
    }

    if (blue) {
        blue.x = CONFIG.FIELD_WIDTH * 0.75;
        blue.y = CONFIG.FIELD_HEIGHT / 2;
        blue.vx = 0;
        blue.vy = 0;
    }

    game.ball.x = CONFIG.FIELD_WIDTH / 2;
    game.ball.y = CONFIG.FIELD_HEIGHT / 2;
    game.ball.vx = 0;
    game.ball.vy = 0;
}

/* =========================================================
   NETWORK
========================================================= */

function sendAction(action, data = {}) {
    if (!Multiplayer.isConnected) {
        return;
    }

    Multiplayer.sendAction(action, data);
}

/* =========================================================
   ROOM
========================================================= */

Multiplayer.init({
    debug: false,
    autoConnect: false
});

Multiplayer.on("connected", data => {

    myId = data.playerId;

    connectionDot.classList.add("connected");

    statusText.textContent = `Connesso • Stanza ${data.room}`;

    updateRoomPlayers(data.players || {});
});

Multiplayer.on("players", players => {
    updateRoomPlayers(players);
});

Multiplayer.on("playerJoined", player => {
    statusText.textContent = `${player.name} è entrato`;

    setTimeout(() => {
        updateRole();
    }, 50);
});

Multiplayer.on("playerLeft", playerId => {

    delete playersInRoom[playerId];

    updateRole();

    if (gameStarted && playerId !== myId) {
        stopGameBecauseOpponentLeft();
    }
});

Multiplayer.on("disconnected", () => {

    connectionDot.classList.remove("connected");
    connectionDot.classList.add("error");

    statusText.textContent = "Disconnesso";
});

Multiplayer.on("error", message => {

    console.error("[CALCIO]", message);

    statusText.textContent = message;
});

Multiplayer.on("ready", (playerId, ready) => {

    updateRoomPlayers(playersInRoom);

    updateReadyScreen();
});

Multiplayer.on("action", (playerId, action, data) => {

    /*
     * Gli input arrivano al client host.
     */
    if (action === "footballInput") {

        if (!isHost) {
            return;
        }

        const player = game.players[playerId];

        if (!player) {
            return;
        }

        player.input = {
            ...player.input,
            ...data
        };

        return;
    }

    /*
     * Gli snapshot arrivano al client non-host.
     */
    if (action === "footballState") {

        if (isHost) {
            return;
        }

        applySnapshot(data);

        return;
    }

    if (action === "footballGoal") {

        showGoal(data.team);

        return;
    }

    if (action === "footballStart") {

        startLocalGame(data);

        return;
    }

    if (action === "footballEnd") {

        finishGame(data);

        return;
    }
});

/* =========================================================
   ROOM / RUOLI
========================================================= */

function updateRoomPlayers(players) {

    playersInRoom = players || {};

    updateRole();
    updateReadyScreen();
}

function getRoomPlayerIds() {

    return Object.keys(playersInRoom)
        .filter(id => playersInRoom[id]);
}

function updateRole() {

    const ids = getRoomPlayerIds();

    /*
     * Il primo giocatore è rosso.
     * Il secondo è blu.
     */
    if (!myId) {
        return;
    }

    if (ids.length > 0) {

        const index = ids.indexOf(myId);

        if (index === 0) {
            myTeam = "red";
            isHost = true;
        } else if (index === 1) {
            myTeam = "blue";
            isHost = false;
        }
    }

    /*
     * Crea i giocatori locali.
     */
    game.players = {};

    ids.slice(0, 2).forEach((id, index) => {

        const team = index === 0 ? "red" : "blue";

        game.players[id] = createPlayer(id, team);
    });

    if (ids.length >= 2) {
        readyButton.classList.remove("hidden");
    } else {
        readyButton.classList.add("hidden");
    }

    if (myTeam === "red") {
        statusText.textContent = "Sei il giocatore ROSSO";
    }

    if (myTeam === "blue") {
        statusText.textContent = "Sei il giocatore BLU";
    }
}

/* =========================================================
   READY
========================================================= */

readyButton.addEventListener("click", () => {

    Multiplayer.setReady(true);

    readyButton.disabled = true;
    readyButton.textContent = "Pronto ✓";

    updateReadyScreen();
});

function bothReady() {

    const ids = getRoomPlayerIds();

    if (ids.length !== 2) {
        return false;
    }

    return ids.every(id => playersInRoom[id]?.ready === true);
}

function updateReadyScreen() {

    if (gameStarted) {
        return;
    }

    const ids = getRoomPlayerIds();

    if (ids.length < 2) {

        overlay.classList.remove("hidden");

        overlayTitle.textContent = "⚽ AniQuiz Football";

        overlayText.textContent =
            "In attesa del secondo giocatore...";

        return;
    }

    if (!bothReady()) {

        overlay.classList.remove("hidden");

        overlayTitle.textContent = "⚽ Pronti a giocare?";

        overlayText.textContent =
            "Entrambi i giocatori devono premere PRONTO.";

        return;
    }

    /*
     * Solo l'host avvia la partita.
     */
    if (isHost) {
        startGame();
    }
}

/* =========================================================
   START GAME
========================================================= */

function startGame() {

    if (!isHost || gameStarted) {
        return;
    }

    gameStarted = true;
    gameOver = false;

    game.time = CONFIG.MATCH_TIME;
    game.score.red = 0;
    game.score.blue = 0;
    game.phase = "countdown";

    resetPositions();

    sendAction("footballStart", {
        time: CONFIG.MATCH_TIME,
        score: game.score
    });

    startCountdown();
}

function startLocalGame(data) {

    gameStarted = true;
    gameOver = false;

    game.time = data.time || CONFIG.MATCH_TIME;

    game.score.red = data.score?.red || 0;
    game.score.blue = data.score?.blue || 0;

    game.phase = "countdown";

    resetPositions();

    startCountdown();
}

function startCountdown() {

    overlay.classList.add("hidden");

    let count = 3;

    countdownEl.classList.remove("hidden");
    countdownEl.textContent = count;

    const timer = setInterval(() => {

        count--;

        if (count <= 0) {

            clearInterval(timer);

            countdownEl.textContent = "GO!";

            setTimeout(() => {
                countdownEl.classList.add("hidden");

                game.phase = "playing";
            }, 500);

            return;
        }

        countdownEl.textContent = count;

    }, 700);
}

/* =========================================================
   INPUT KEYBOARD
========================================================= */

const keyMap = {
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    W: "up",
    A: "left",
    S: "down",
    D: "right"
};

window.addEventListener("keydown", event => {

    const action = keyMap[event.key];

    if (action) {

        input[action] = true;

        event.preventDefault();
    }
});

window.addEventListener("keyup", event => {

    const action = keyMap[event.key];

    if (action) {

        input[action] = false;

        event.preventDefault();
    }
});

/* =========================================================
   MOUSE
========================================================= */

canvas.addEventListener("mousemove", event => {

    const rect = canvas.getBoundingClientRect();

    mouseX =
        (event.clientX - rect.left) /
        rect.width *
        CONFIG.FIELD_WIDTH;

    mouseY =
        (event.clientY - rect.top) /
        rect.height *
        CONFIG.FIELD_HEIGHT;
});

/*
 * Tasto sinistro = tiro
 */
canvas.addEventListener("mousedown", event => {

    if (event.button === 0) {
        input.shoot = true;
        input.shootPressed = true;
        event.preventDefault();
    }

    if (event.button === 2) {
        input.pass = true;
        input.passPressed = true;
        event.preventDefault();
    }
});

window.addEventListener("mouseup", event => {

    if (event.button === 0) {
        input.shoot = false;
    }

    if (event.button === 2) {
        input.pass = false;
    }
});

canvas.addEventListener("contextmenu", event => {
    event.preventDefault();
});

/* =========================================================
   CONTROLLER
========================================================= */

function readController() {

    const pads = navigator.getGamepads
        ? navigator.getGamepads()
        : [];

    let pad = null;

    for (const p of pads) {

        if (p && p.connected) {
            pad = p;
            break;
        }
    }

    if (!pad) {
        return;
    }

    const deadzone = 0.18;

    let ax = pad.axes[0] || 0;
    let ay = pad.axes[1] || 0;

    if (Math.abs(ax) < deadzone) ax = 0;
    if (Math.abs(ay) < deadzone) ay = 0;

    input.left = ax < -deadzone;
    input.right = ax > deadzone;
    input.up = ay < -deadzone;
    input.down = ay > deadzone;

    /*
     * RT = tiro.
     * Alcuni controller espongono il trigger come axes.
     * Altri come button 7.
     */
    let shootValue = 0;

    if (pad.buttons[7]) {
        shootValue = pad.buttons[7].value || 0;
    }

    if (pad.axes[5] !== undefined) {
        shootValue = Math.max(
            shootValue,
            (pad.axes[5] + 1) / 2
        );
    }

    input.shoot = shootValue > 0.15;

    /*
     * LT = passaggio.
     */
    let passValue = 0;

    if (pad.buttons[6]) {
        passValue = pad.buttons[6].value || 0;
    }

    if (pad.axes[4] !== undefined) {
        passValue = Math.max(
            passValue,
            (pad.axes[4] + 1) / 2
        );
    }

    input.pass = passValue > 0.15;
}

/* =========================================================
   LOCAL INPUT
========================================================= */

function updateLocalInput() {

    readController();

    /*
     * Il giocatore locale viene controllato
     * solamente dal proprio client.
     */
    const me = game.players[myId];

    if (!me) {
        return;
    }

    me.input = {
        up: input.up,
        down: input.down,
        left: input.left,
        right: input.right,
        shoot: input.shoot,
        pass: input.pass
    };

    /*
     * Il client NON-host manda gli input all'host.
     */
    if (!isHost && gameStarted && game.phase === "playing") {

        sendAction("footballInput", {
            up: input.up,
            down: input.down,
            left: input.left,
            right: input.right,
            shoot: input.shoot,
            pass: input.pass
        });
    }
}

/* =========================================================
   DIREZIONE
========================================================= */

function getPlayerDirection(player) {

    let dx = 0;
    let dy = 0;

    if (player.input.left) dx--;
    if (player.input.right) dx++;
    if (player.input.up) dy--;
    if (player.input.down) dy++;

    if (dx !== 0 || dy !== 0) {

        const n = normalize(dx, dy);

        player.direction.x = n.x;
        player.direction.y = n.y;

        return n;
    }

    /*
     * Se non ci si muove, usa la direzione
     * verso il mouse per il giocatore locale.
     */
    if (player.id === myId && !isHost) {

        const n = normalize(
            mouseX - player.x,
            mouseY - player.y
        );

        if (length(n.x, n.y) > 0) {
            player.direction = n;
        }
    }

    return player.direction;
}

/* =========================================================
   MOVIMENTO GIOCATORE
========================================================= */

function updatePlayer(player, dt) {

    const dir = getPlayerDirection(player);

    let speed = CONFIG.PLAYER_SPEED;

    /*
     * Caricamento tiro = rallentamento.
     */
    if (player.charging) {

        const charge =
            clamp(
                (performance.now() - player.chargeStart) /
                CONFIG.CHARGE_TIME,
                0,
                1
            );

        speed *= 1 - charge * 0.65;
    }

    player.vx = dir.x * speed;
    player.vy = dir.y * speed;

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    /*
     * Limiti campo.
     */
    player.x = clamp(
        player.x,
        CONFIG.PLAYER_RADIUS,
        CONFIG.FIELD_WIDTH - CONFIG.PLAYER_RADIUS
    );

    player.y = clamp(
        player.y,
        CONFIG.PLAYER_RADIUS,
        CONFIG.FIELD_HEIGHT - CONFIG.PLAYER_RADIUS
    );
}

/* =========================================================
   COLLISIONE PALLA / GIOCATORE
========================================================= */

function collideBallWithPlayer(player) {

    const ball = game.ball;

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;

    const dist = Math.sqrt(dx * dx + dy * dy);

    const minDist =
        CONFIG.PLAYER_RADIUS +
        CONFIG.BALL_RADIUS;

    if (dist >= minDist) {
        return;
    }

    const n = normalize(dx, dy);

    /*
     * Sposta la palla fuori dal giocatore.
     */
    ball.x =
        player.x +
        n.x * minDist;

    ball.y =
        player.y +
        n.y * minDist;

    /*
     * Piccolo trasferimento di velocità.
     */
    ball.vx += player.vx * 0.15;
    ball.vy += player.vy * 0.15;

    /*
     * Limita velocità.
     */
    const maxSpeed = 1250;

    const ballSpeed = length(ball.vx, ball.vy);

    if (ballSpeed > maxSpeed) {

        const factor = maxSpeed / ballSpeed;

        ball.vx *= factor;
        ball.vy *= factor;
    }
}

/* =========================================================
   TIRO
========================================================= */

function shootBall(player) {

    const now = performance.now();

    if (now - player.lastShoot < CONFIG.SHOOT_COOLDOWN) {
        return;
    }

    const dir = getPlayerDirection(player);

    const charge =
        clamp(
            (now - player.chargeStart) /
            CONFIG.CHARGE_TIME,
            0,
            1
        );

    const power =
        CONFIG.SHOT_MIN_POWER +
        (CONFIG.SHOT_MAX_POWER - CONFIG.SHOT_MIN_POWER) *
        charge;

    const ball = game.ball;

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;

    const dist = Math.sqrt(dx * dx + dy * dy);

    /*
     * Devi essere abbastanza vicino alla palla.
     */
    if (dist > CONFIG.PLAYER_RADIUS + 38) {
        return;
    }

    ball.vx = dir.x * power;
    ball.vy = dir.y * power;

    /*
     * Sposta leggermente la palla davanti al giocatore.
     */
    ball.x =
        player.x +
        dir.x *
        (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);

    ball.y =
        player.y +
        dir.y *
        (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);

    player.lastShoot = now;
    player.charging = false;
}

/* =========================================================
   PASSAGGIO
========================================================= */

function passBall(player) {

    const now = performance.now();

    if (now - player.lastPass < CONFIG.PASS_COOLDOWN) {
        return;
    }

    const ball = game.ball;

    const dx = ball.x - player.x;
    const dy = ball.y - player.y;

    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > CONFIG.PLAYER_RADIUS + 38) {
        return;
    }

    const dir = getPlayerDirection(player);

    ball.vx = dir.x * CONFIG.PASS_POWER;
    ball.vy = dir.y * CONFIG.PASS_POWER;

    ball.x =
        player.x +
        dir.x *
        (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);

    ball.y =
        player.y +
        dir.y *
        (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 3);

    player.lastPass = now;
}

/* =========================================================
   INPUT AZIONI
========================================================= */

function updatePlayerActions(player) {

    const shooting = player.input.shoot;
    const passing = player.input.pass;

    /*
     * Inizio caricamento.
     */
    if (shooting && !player.charging) {

        const ballDist = distance(
            player,
            game.ball
        );

        if (ballDist <= CONFIG.PLAYER_RADIUS + 38) {

            player.charging = true;
            player.chargeStart = performance.now();
        }
    }

    /*
     * Rilascio del tiro.
     */
    if (!shooting && player.charging) {

        shootBall(player);
    }

    /*
     * Passaggio.
     */
    if (passing && !previousPassFor(player)) {

        passBall(player);
    }
}

const previousPassStates = {};

function previousPassFor(player) {

    return previousPassStates[player.id] || false;
}

function updatePreviousInputStates() {

    for (const id in game.players) {

        previousPassStates[id] =
            game.players[id].input.pass;
    }
}

/* =========================================================
   PALLA
========================================================= */

function updateBall(dt) {

    const ball = game.ball;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    /*
     * Attrito.
     */
    const friction =
        Math.pow(CONFIG.BALL_FRICTION, dt * 60);

    ball.vx *= friction;
    ball.vy *= friction;

    if (Math.abs(ball.vx) < 2) ball.vx = 0;
    if (Math.abs(ball.vy) < 2) ball.vy = 0;

    /*
     * Pareti verticali.
     */
    if (ball.y < CONFIG.BALL_RADIUS) {

        ball.y = CONFIG.BALL_RADIUS;
        ball.vy *= -0.75;
    }

    if (ball.y > CONFIG.FIELD_HEIGHT - CONFIG.BALL_RADIUS) {

        ball.y =
            CONFIG.FIELD_HEIGHT -
            CONFIG.BALL_RADIUS;

        ball.vy *= -0.75;
    }

    /*
     * Pareti laterali / porte.
     */
    const goalTop =
        CONFIG.FIELD_HEIGHT / 2 - 100;

    const goalBottom =
        CONFIG.FIELD_HEIGHT / 2 + 100;

    const insideGoal =
        ball.y >= goalTop &&
        ball.y <= goalBottom;

    /*
     * Porta sinistra.
     */
    if (ball.x < CONFIG.BALL_RADIUS) {

        if (insideGoal) {

            scoreGoal("blue");
            return;
        }

        ball.x = CONFIG.BALL_RADIUS;
        ball.vx *= -0.8;
    }

    /*
     * Porta destra.
     */
    if (ball.x > CONFIG.FIELD_WIDTH - CONFIG.BALL_RADIUS) {

        if (insideGoal) {

            scoreGoal("red");
            return;
        }

        ball.x =
            CONFIG.FIELD_WIDTH -
            CONFIG.BALL_RADIUS;

        ball.vx *= -0.8;
    }
}

/* =========================================================
   GOAL
========================================================= */

function scoreGoal(team) {

    if (game.phase !== "playing") {
        return;
    }

    game.score[team]++;

    game.lastGoal = team;

    game.phase = "goal";

    sendAction("footballGoal", {
        team
    });

    showGoal(team);

    clearTimeout(goalResetTimer);

    goalResetTimer = setTimeout(() => {

        if (gameOver) {
            return;
        }

        resetPositions();

        game.phase = "playing";

    }, CONFIG.GOAL_RESET_TIME);
}

function showGoal(team) {

    goalMessage.textContent =
        team === "red"
            ? "🔴 GOOOOL!"
            : "🔵 GOOOOL!";

    goalMessage.classList.remove("show");

    /*
     * Forza reflow per riavviare animazione.
     */
    void goalMessage.offsetWidth;

    goalMessage.classList.add("show");
}

/* =========================================================
   GAME UPDATE HOST
========================================================= */

function updateHost(dt) {

    if (!isHost) {
        return;
    }

    if (!gameStarted || gameOver) {
        return;
    }

    if (game.phase === "playing") {

        /*
         * Timer.
         */
        game.time -= dt;

        if (game.time <= 0) {

            game.time = 0;

            finishMatch();

            return;
        }

        /*
         * Giocatori.
         */
        for (const id in game.players) {

            const player = game.players[id];

            updatePlayer(player, dt);
            updatePlayerActions(player);
        }

        /*
         * Palla.
         */
        updateBall(dt);

        /*
         * Collisioni.
         */
        for (const id in game.players) {

            collideBallWithPlayer(
                game.players[id]
            );
        }
    }

    /*
     * Snapshot.
     */
    const now = performance.now();

    if (now - lastSnapshot >= 1000 / CONFIG.SNAPSHOT_RATE) {

        lastSnapshot = now;

        sendSnapshot();
    }
}

/* =========================================================
   SNAPSHOT
========================================================= */

function createSnapshot() {

    return {
        time: game.time,

        phase: game.phase,

        score: {
            red: game.score.red,
            blue: game.score.blue
        },

        ball: {
            x: game.ball.x,
            y: game.ball.y,
            vx: game.ball.vx,
            vy: game.ball.vy
        },

        players: Object.fromEntries(
            Object.entries(game.players).map(
                ([id, p]) => [
                    id,
                    {
                        x: p.x,
                        y: p.y,
                        vx: p.vx,
                        vy: p.vy,
                        team: p.team,
                        charging: p.charging,
                        chargeStart: p.chargeStart,
                        direction: p.direction
                    }
                ]
            )
        )
    };
}

function sendSnapshot() {

    sendAction(
        "footballState",
        createSnapshot()
    );
}

function applySnapshot(snapshot) {

    if (!snapshot) {
        return;
    }

    game.time = snapshot.time ?? game.time;

    game.phase = snapshot.phase || game.phase;

    if (snapshot.score) {

        game.score.red =
            snapshot.score.red || 0;

        game.score.blue =
            snapshot.score.blue || 0;
    }

    if (snapshot.ball) {

        game.ball.x = snapshot.ball.x;
        game.ball.y = snapshot.ball.y;
        game.ball.vx = snapshot.ball.vx;
        game.ball.vy = snapshot.ball.vy;
    }

    if (snapshot.players) {

        for (const id in snapshot.players) {

            const remote = snapshot.players[id];

            if (!game.players[id]) {

                game.players[id] =
                    createPlayer(
                        id,
                        remote.team
                    );
            }

            const player =
                game.players[id];

            player.x = remote.x;
            player.y = remote.y;
            player.vx = remote.vx;
            player.vy = remote.vy;
            player.team = remote.team;
            player.charging = remote.charging;
            player.chargeStart = remote.chargeStart;

            if (remote.direction) {
                player.direction = remote.direction;
            }
        }
    }
}

/* =========================================================
   MATCH END
========================================================= */

function finishMatch() {

    if (!isHost || gameOver) {
        return;
    }

    gameOver = true;
    game.phase = "finished";

    let winner = "draw";

    if (game.score.red > game.score.blue) {
        winner = "red";
    }

    if (game.score.blue > game.score.red) {
        winner = "blue";
    }

    const result = {
        winner,
        score: {
            red: game.score.red,
            blue: game.score.blue
        }
    };

    sendAction(
        "footballEnd",
        result
    );

    showGameOver(result);
}

function finishGame(result) {

    gameOver = true;
    game.phase = "finished";

    showGameOver(result);
}

function showGameOver(result) {

    overlay.classList.remove("hidden");

    overlayTitle.textContent =
        result.winner === "draw"
            ? "🤝 Pareggio!"
            : result.winner === myTeam
                ? "🏆 Hai vinto!"
                : "💀 Hai perso!";

    overlayText.textContent =
        "La partita è terminata.";

    finalScoreEl.textContent =
        `${result.score.red} - ${result.score.blue}`;

    readyButton.classList.add("hidden");
}

/* =========================================================
   OPPONENT LEFT
========================================================= */

function stopGameBecauseOpponentLeft() {

    gameStarted = false;
    gameOver = true;

    overlay.classList.remove("hidden");

    overlayTitle.textContent =
        "🏃 L'avversario ha lasciato";

    overlayText.textContent =
        "La partita è terminata.";

    finalScoreEl.textContent = "";

    readyButton.classList.add("hidden");
}

/* =========================================================
   HUD
========================================================= */

function updateHUD() {

    redScoreEl.textContent = game.score.red;
    blueScoreEl.textContent = game.score.blue;

    timerEl.textContent =
        formatTime(game.time);
}

/* =========================================================
   DISEGNO CAMPO
========================================================= */

function drawField() {

    /*
     * Campo.
     */
    ctx.fillStyle = "#16863d";
    ctx.fillRect(
        0,
        0,
        CONFIG.FIELD_WIDTH,
        CONFIG.FIELD_HEIGHT
    );

    /*
     * Strisce del campo.
     */
    const stripeWidth = CONFIG.FIELD_WIDTH / 12;

    for (let i = 0; i < 12; i++) {

        if (i % 2 === 0) {

            ctx.fillStyle = "rgba(255,255,255,.035)";

            ctx.fillRect(
                i * stripeWidth,
                0,
                stripeWidth,
                CONFIG.FIELD_HEIGHT
            );
        }
    }

    /*
     * Linee.
     */
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 4;

    ctx.strokeRect(
        3,
        3,
        CONFIG.FIELD_WIDTH - 6,
        CONFIG.FIELD_HEIGHT - 6
    );

    /*
     * Linea centrale.
     */
    ctx.beginPath();

    ctx.moveTo(
        CONFIG.FIELD_WIDTH / 2,
        0
    );

    ctx.lineTo(
        CONFIG.FIELD_WIDTH / 2,
        CONFIG.FIELD_HEIGHT
    );

    ctx.stroke();

    /*
     * Cerchio centrale.
     */
    ctx.beginPath();

    ctx.arc(
        CONFIG.FIELD_WIDTH / 2,
        CONFIG.FIELD_HEIGHT / 2,
        90,
        0,
        Math.PI * 2
    );

    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
        CONFIG.FIELD_WIDTH / 2,
        CONFIG.FIELD_HEIGHT / 2,
        5,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    /*
     * Aree di rigore.
     */

    const penaltyWidth = 150;
    const penaltyHeight = 310;

    ctx.strokeRect(
        0,
        CONFIG.FIELD_HEIGHT / 2 - penaltyHeight / 2,
        penaltyWidth,
        penaltyHeight
    );

    ctx.strokeRect(
        CONFIG.FIELD_WIDTH - penaltyWidth,
        CONFIG.FIELD_HEIGHT / 2 - penaltyHeight / 2,
        penaltyWidth,
        penaltyHeight
    );

    /*
     * Piccole aree.
     */

    const smallWidth = 60;
    const smallHeight = 170;

    ctx.strokeRect(
        0,
        CONFIG.FIELD_HEIGHT / 2 - smallHeight / 2,
        smallWidth,
        smallHeight
    );

    ctx.strokeRect(
        CONFIG.FIELD_WIDTH - smallWidth,
        CONFIG.FIELD_HEIGHT / 2 - smallHeight / 2,
        smallWidth,
        smallHeight
    );

    /*
     * Porte.
     */

    const goalWidth = 42;
    const goalHeight = 200;

    ctx.fillStyle = "rgba(240,240,240,.18)";
    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;

    ctx.fillRect(
        -goalWidth,
        CONFIG.FIELD_HEIGHT / 2 - goalHeight / 2,
        goalWidth,
        goalHeight
    );

    ctx.strokeRect(
        -goalWidth,
        CONFIG.FIELD_HEIGHT / 2 - goalHeight / 2,
        goalWidth,
        goalHeight
    );

    ctx.fillRect(
        CONFIG.FIELD_WIDTH,
        CONFIG.FIELD_HEIGHT / 2 - goalHeight / 2,
        goalWidth,
        goalHeight
    );

    ctx.strokeRect(
        CONFIG.FIELD_WIDTH,
        CONFIG.FIELD_HEIGHT / 2 - goalHeight / 2,
        goalWidth,
        goalHeight
    );
}

/* =========================================================
   DISEGNO GIOCATORE
========================================================= */

function drawPlayer(player) {

    /*
     * Ombra.
     */
    ctx.beginPath();

    ctx.ellipse(
        player.x,
        player.y + 18,
        22,
        9,
        0,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fill();

    /*
     * Colore squadra.
     */
    const color =
        player.team === "red"
            ? "#ed3946"
            : "#3189ff";

    /*
     * Corpo.
     */
    ctx.beginPath();

    ctx.arc(
        player.x,
        player.y,
        CONFIG.PLAYER_RADIUS,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 3;
    ctx.stroke();

    /*
     * Direzione.
     */
    ctx.beginPath();

    ctx.moveTo(
        player.x,
        player.y
    );

    ctx.lineTo(
        player.x +
        player.direction.x * 17,

        player.y +
        player.direction.y * 17
    );

    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;
    ctx.stroke();

    /*
     * Indicatore del giocatore locale.
     */
    if (player.id === myId) {

        ctx.beginPath();

        ctx.arc(
            player.x,
            player.y,
            CONFIG.PLAYER_RADIUS + 7,
            0,
            Math.PI * 2
        );

        ctx.strokeStyle = "rgba(255,255,255,.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /*
     * Barra caricamento.
     */
    if (player.charging) {

        const charge =
            clamp(
                (performance.now() - player.chargeStart) /
                CONFIG.CHARGE_TIME,
                0,
                1
            );

        const width = 50;
        const height = 7;

        const x =
            player.x - width / 2;

        const y =
            player.y - 40;

        ctx.fillStyle =
            "rgba(0,0,0,.65)";

        ctx.fillRect(
            x,
            y,
            width,
            height
        );

        ctx.fillStyle =
            charge < .5
                ? "#f7d43b"
                : charge < .8
                    ? "#ff8a32"
                    : "#ff3945";

        ctx.fillRect(
            x,
            y,
            width * charge,
            height
        );
    }
}

/* =========================================================
   DISEGNO PALLA
========================================================= */

function drawBall() {

    const ball = game.ball;

    /*
     * Ombra.
     */
    ctx.beginPath();

    ctx.ellipse(
        ball.x,
        ball.y + 10,
        12,
        5,
        0,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fill();

    /*
     * Palla.
     */
    ctx.beginPath();

    ctx.arc(
        ball.x,
        ball.y,
        CONFIG.BALL_RADIUS,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.stroke();

    /*
     * Piccolo dettaglio.
     */
    ctx.beginPath();

    ctx.arc(
        ball.x - 3,
        ball.y - 3,
        3,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "#222";
    ctx.fill();
}

/* =========================================================
   RENDER
========================================================= */

function render() {

    ctx.clearRect(
        0,
        0,
        CONFIG.FIELD_WIDTH,
        CONFIG.FIELD_HEIGHT
    );

    drawField();

    /*
     * Disegna prima i giocatori...
     */
    for (const id in game.players) {
        drawPlayer(game.players[id]);
    }

    /*
     * ...poi la palla.
     */
    drawBall();

    updateHUD();
}

/* =========================================================
   GAME LOOP
========================================================= */

function gameLoop(now) {

    let dt =
        (now - lastTime) / 1000;

    lastTime = now;

    /*
     * Evita esplosioni fisiche dopo tab switch.
     */
    dt = Math.min(dt, 0.05);

    updateLocalInput();

    updateHost(dt);

    /*
     * Se siamo il client non-host,
     * manteniamo il giocatore locale leggermente
     * responsive tra uno snapshot e l'altro.
     *
     * La posizione reale viene comunque dal server/host.
     */
    if (!isHost && gameStarted && game.phase === "playing") {

        const me = game.players[myId];

        if (me) {
            updatePlayerVisualPrediction(me, dt);
        }
    }

    render();

    /*
     * Azioni mouse one-shot.
     */
    input.shootPressed = false;
    input.passPressed = false;

    previousShoot = input.shoot;
    previousPass = input.pass;

    requestAnimationFrame(gameLoop);
}

/* =========================================================
   PREDIZIONE CLIENT
========================================================= */

function updatePlayerVisualPrediction(player, dt) {

    /*
     * Piccola predizione locale soltanto per rendere
     * il movimento del client non troppo "scattoso".
     *
     * Non viene utilizzata per la fisica della palla.
     */

    let dx = 0;
    let dy = 0;

    if (player.input.left) dx--;
    if (player.input.right) dx++;
    if (player.input.up) dy--;
    if (player.input.down) dy++;

    if (dx === 0 && dy === 0) {
        return;
    }

    const dir = normalize(dx, dy);

    let speed = CONFIG.PLAYER_SPEED;

    if (player.charging) {
        speed *= .55;
    }

    /*
     * Molto limitato per evitare divergenza.
     */
    player.x +=
        dir.x * speed * dt * .35;

    player.y +=
        dir.y * speed * dt * .35;

    player.x = clamp(
        player.x,
        CONFIG.PLAYER_RADIUS,
        CONFIG.FIELD_WIDTH - CONFIG.PLAYER_RADIUS
    );

    player.y = clamp(
        player.y,
        CONFIG.PLAYER_RADIUS,
        CONFIG.FIELD_HEIGHT - CONFIG.PLAYER_RADIUS
    );
}

/* =========================================================
   BACK
========================================================= */

backButton.addEventListener("click", () => {

    Multiplayer.leave();

    /*
     * Torna indietro.
     */
    if (history.length > 1) {
        history.back();
    } else {
        window.location.href = "/";
    }
});

/* =========================================================
   CONNECT
========================================================= */

function connectToRoom() {

    /*
     * Cerca eventuali parametri URL.
     *
     * Esempio:
     * calcio.html?room=ABC&name=Angelo
     */
    const params =
        new URLSearchParams(
            window.location.search
        );

    const room =
        params.get("room") ||
        window.currentRoom ||
        "default";

    const name =
        params.get("name") ||
        window.playerName ||
        "Giocatore";

    Multiplayer.connect({
        server: CONFIG.SERVER,
        room,
        playerName: name
    });
}

/* =========================================================
   INIT
========================================================= */

function init() {

    overlayTitle.textContent =
        "⚽ AniQuiz Football";

    overlayText.textContent =
        "Connessione al server...";

    connectToRoom();

    requestAnimationFrame(gameLoop);
}

init();

})();
