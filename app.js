import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// PeerJS is loaded globally via <script> tag
const Peer = window.Peer;

// ---- DOM ----
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const remoteVideo = document.getElementById("remoteVideo");
const detectedBadge = document.getElementById("detectedBadge");
const rivalMoveBadge = document.getElementById("rivalMoveBadge");
const opponentPlaceholder = document.getElementById("opponentPlaceholder");
const playBtn = document.getElementById("playBtn");
const resetBtn = document.getElementById("resetBtn");
const countdownEl = document.getElementById("countdown");
const resultText = document.getElementById("resultText");
const scorePlayerEl = document.getElementById("scorePlayer");
const scoreCpuEl = document.getElementById("scoreCpu");
const statusEl = document.getElementById("status");
const youNameEl = document.getElementById("youName");
const rivalNameEl = document.getElementById("rivalName");

// Lobby DOM
const lobby = document.getElementById("lobby");
const lobbyTitle = document.getElementById("lobbyTitle");
const lobbySub = document.getElementById("lobbySub");
const nameInput = document.getElementById("nameInput");
const lobbyChoice = document.getElementById("lobbyChoice");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const joinArea = document.getElementById("joinArea");
const roomInput = document.getElementById("roomInput");
const joinGoBtn = document.getElementById("joinGoBtn");
const shareArea = document.getElementById("shareArea");
const shareLink = document.getElementById("shareLink");
const copyBtn = document.getElementById("copyBtn");
const waitingText = document.getElementById("waitingText");
const lobbyStatus = document.getElementById("lobbyStatus");

// ---- State ----
let handLandmarker = null;
let drawingUtils = null;
let localStream = null;
let lastVideoTime = -1;
let currentGesture = null;

let peer = null;
let dataConn = null;
let isHost = false;
let connected = false;
let myName = "You";
let rivalName = "Rival";

let score = { me: 0, opp: 0 };

// Round state
let roundActive = false;
let myMove = null;
let oppMove = null;
let haveMyMove = false;
let haveOppMove = false;

const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
const LABEL = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

const peerOptions = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  },
};

// =====================================================================
// Model + camera
// =====================================================================
async function initModel() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
    drawingUtils = new DrawingUtils(ctx);
    statusEl.textContent = "Model ready.";
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Failed to load hand-tracking model. Check your connection.";
  }
}

async function ensureCameraAndModel() {
  if (!handLandmarker) {
    setLobbyStatus("Loading hand-tracking model, please wait…");
    // wait briefly for model
    for (let i = 0; i < 40 && !handLandmarker; i++) await sleep(250);
    if (!handLandmarker) throw new Error("Model not ready");
  }
  if (!localStream) {
    setLobbyStatus("Starting camera…");
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = localStream;
    await video.play();
    requestAnimationFrame(predictLoop);
  }
  setLobbyStatus("");
}

// =====================================================================
// Gesture detection
// =====================================================================
function fingersUp(lm, handedness) {
  const up = [];
  const isRight = handedness === "Right";
  if (isRight) up.push(lm[4].x < lm[3].x ? 1 : 0);
  else up.push(lm[4].x > lm[3].x ? 1 : 0);

  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  for (const [tip, pip] of pairs) up.push(lm[tip].y < lm[pip].y ? 1 : 0);
  return up;
}

function classifyGesture(lm, handedness) {
  const [thumb, index, middle, ring, pinky] = fingersUp(lm, handedness);
  const count = thumb + index + middle + ring + pinky;
  if (count <= 1) return "rock";
  if (index && middle && !ring && !pinky) return "scissors";
  if (count >= 4) return "paper";
  return null;
}

function predictLoop() {
  if (!localStream) return;
  if (overlay.width !== video.videoWidth) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const results = handLandmarker.detectForVideo(video, performance.now());
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (results.landmarks && results.landmarks.length > 0) {
      const lm = results.landmarks[0];
      const handedness = results.handednesses?.[0]?.[0]?.categoryName || "Right";
      drawingUtils.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, {
        color: "#22d3ee",
        lineWidth: 3,
      });
      drawingUtils.drawLandmarks(lm, { color: "#7c5cff", radius: 3 });
      currentGesture = classifyGesture(lm, handedness);
      detectedBadge.textContent = currentGesture
        ? `${EMOJI[currentGesture]} ${LABEL[currentGesture]}`
        : "…";
    } else {
      currentGesture = null;
      detectedBadge.textContent = "No hand";
    }
  }
  requestAnimationFrame(predictLoop);
}

// =====================================================================
// Networking (PeerJS)
// =====================================================================
const ADJECTIVES = ["brave", "calm", "swift", "lucky", "sly", "bold", "keen", "wild", "cosmic", "royal"];
const ANIMALS = ["otter", "tiger", "panda", "hawk", "fox", "wolf", "koala", "raven", "lynx", "orca"];
function makeRoomId() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const n = Math.floor(Math.random() * 90 + 10);
  return `rps-${a}-${b}-${n}`;
}

function parseRoomId(raw) {
  const v = raw.trim();
  if (!v) return "";
  const m = v.match(/[?&]room=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return v;
}

function send(obj) {
  if (dataConn && dataConn.open) dataConn.send(obj);
}

function hostGame() {
  isHost = true;
  const roomId = makeRoomId();
  peer = new Peer(roomId, peerOptions);

  peer.on("open", (id) => {
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(id)}`;
    shareLink.value = link;
    showShareArea();
    setLobbyStatus(`Game code: ${id}`);
  });
  peer.on("connection", (conn) => setupDataConn(conn));
  peer.on("call", (call) => {
    call.answer(localStream);
    call.on("stream", setRemoteStream);
  });
  peer.on("error", handlePeerError);
}

function joinGame(roomId) {
  isHost = false;
  peer = new Peer(peerOptions);
  peer.on("open", () => {
    setLobbyStatus("Connecting to host…");
    const conn = peer.connect(roomId, { reliable: true });
    setupDataConn(conn);
    const call = peer.call(roomId, localStream);
    call.on("stream", setRemoteStream);
  });
  peer.on("error", handlePeerError);
}

function setupDataConn(conn) {
  dataConn = conn;
  conn.on("open", () => {
    send({ type: "hello", name: myName });
    onConnected();
  });
  conn.on("data", handleData);
  conn.on("close", () => onPeerLost("Opponent left the game."));
  conn.on("error", (e) => console.error("data conn error", e));
}

function setRemoteStream(stream) {
  remoteVideo.srcObject = stream;
  remoteVideo.play().catch(() => {});
  opponentPlaceholder.classList.add("hidden");
}

function handlePeerError(err) {
  console.error("Peer error:", err);
  if (err.type === "unavailable-id" && isHost) {
    // Room id collision — pick a new one and retry
    try { peer.destroy(); } catch (_) {}
    hostGame();
    return;
  }
  if (err.type === "peer-unavailable") {
    setLobbyStatus("No game found with that code. Check the link and try again.", true);
    return;
  }
  setLobbyStatus(`Connection error: ${err.type || err.message}`, true);
}

function onConnected() {
  connected = true;
  lobby.classList.add("hidden");
  playBtn.disabled = false;
  resetBtn.disabled = false;
  resultText.className = "result-text";
  resultText.textContent = "Connected! Press Play round.";
  statusEl.textContent = "Connected — good luck!";
}

function onPeerLost(msg) {
  connected = false;
  playBtn.disabled = true;
  resetBtn.disabled = true;
  roundActive = false;
  statusEl.textContent = msg;
  resultText.className = "result-text lose";
  resultText.textContent = msg + " Reload to start a new game.";
  remoteVideo.srcObject = null;
  opponentPlaceholder.querySelector("p").textContent = "Opponent disconnected";
  opponentPlaceholder.classList.remove("hidden");
}

function handleData(data) {
  switch (data.type) {
    case "hello":
      rivalName = data.name || "Rival";
      rivalNameEl.textContent = rivalName;
      break;
    case "start":
      if (!roundActive) beginRound(false);
      break;
    case "move":
      oppMove = data.move;
      haveOppMove = true;
      resolveIfReady();
      break;
    case "reset":
      applyReset();
      break;
  }
}

// =====================================================================
// Round flow
// =====================================================================
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function onPlayClick() {
  if (!connected || roundActive) return;
  send({ type: "start" });
  beginRound(true);
}

async function beginRound() {
  roundActive = true;
  myMove = null;
  oppMove = null;
  haveMyMove = false;
  haveOppMove = false;
  playBtn.disabled = true;
  resultText.className = "result-text";
  resultText.textContent = "Get ready…";
  rivalMoveBadge.textContent = "…";

  const words = ["Rock", "Paper", "Scissors", "Shoot!"];
  for (const w of words) {
    countdownEl.textContent = w;
    countdownEl.classList.remove("pop");
    void countdownEl.offsetWidth;
    countdownEl.classList.add("pop");
    await sleep(650);
  }
  countdownEl.textContent = "";

  myMove = currentGesture;
  haveMyMove = true;
  send({ type: "move", move: myMove });
  resultText.textContent = "Waiting for opponent…";
  resolveIfReady();
}

function resolveIfReady() {
  if (!haveMyMove || !haveOppMove) return;
  resolveRound();
}

function resolveRound() {
  rivalMoveBadge.textContent = oppMove
    ? `${EMOJI[oppMove]} ${LABEL[oppMove]}`
    : "No move";

  if (!myMove || !oppMove) {
    resultText.className = "result-text draw";
    const who = !myMove && !oppMove ? "Both players" : !myMove ? "You" : rivalName;
    resultText.textContent = `${who} showed no clear gesture — round void.`;
  } else {
    const outcome = judge(myMove, oppMove);
    if (outcome === "win") {
      score.me++;
      resultText.className = "result-text win";
      resultText.textContent = `Your ${EMOJI[myMove]} beats ${EMOJI[oppMove]} — You win! 🎉`;
    } else if (outcome === "lose") {
      score.opp++;
      resultText.className = "result-text lose";
      resultText.textContent = `${EMOJI[oppMove]} beats your ${EMOJI[myMove]} — You lose 😅`;
    } else {
      resultText.className = "result-text draw";
      resultText.textContent = `Both ${EMOJI[myMove]} — It's a draw 🤝`;
    }
  }

  scorePlayerEl.textContent = score.me;
  scoreCpuEl.textContent = score.opp;

  roundActive = false;
  haveMyMove = false;
  haveOppMove = false;
  playBtn.disabled = false;
}

function judge(p, c) {
  if (p === c) return "draw";
  const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[p] === c ? "win" : "lose";
}

function onResetClick() {
  applyReset();
  send({ type: "reset" });
}

function applyReset() {
  score = { me: 0, opp: 0 };
  scorePlayerEl.textContent = "0";
  scoreCpuEl.textContent = "0";
  resultText.className = "result-text";
  resultText.textContent = "Score reset. Press Play round!";
  rivalMoveBadge.textContent = "—";
}

// =====================================================================
// Lobby wiring
// =====================================================================
function setLobbyStatus(msg, isError = false) {
  lobbyStatus.textContent = msg;
  lobbyStatus.classList.toggle("error", isError);
}

function showShareArea() {
  lobbyChoice.classList.add("hidden");
  joinArea.classList.add("hidden");
  shareArea.classList.remove("hidden");
  document.getElementById("nameRow").classList.add("hidden");
}

function readName() {
  const n = nameInput.value.trim();
  myName = n || (isHost ? "Player 1" : "Player 2");
  youNameEl.textContent = myName;
}

createBtn.addEventListener("click", async () => {
  try {
    isHost = true;
    readName();
    await ensureCameraAndModel();
    hostGame();
  } catch (e) {
    setLobbyStatus("Camera or model unavailable. Allow camera access and retry.", true);
  }
});

joinBtn.addEventListener("click", () => {
  lobbyChoice.classList.add("hidden");
  joinArea.classList.remove("hidden");
  roomInput.focus();
});

joinGoBtn.addEventListener("click", async () => {
  const roomId = parseRoomId(roomInput.value);
  if (!roomId) {
    setLobbyStatus("Enter a game code or link.", true);
    return;
  }
  try {
    isHost = false;
    readName();
    await ensureCameraAndModel();
    joinGame(roomId);
  } catch (e) {
    setLobbyStatus("Camera or model unavailable. Allow camera access and retry.", true);
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  } catch (_) {
    shareLink.select();
    document.execCommand("copy");
  }
});

playBtn.addEventListener("click", onPlayClick);
resetBtn.addEventListener("click", onResetClick);

// If opened via an invite link, jump straight to the join flow.
(function checkInvite() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) {
    lobbyTitle.textContent = "You're invited! 🎮";
    lobbySub.textContent = "Enter your name and join the game.";
    lobbyChoice.classList.add("hidden");
    joinArea.classList.remove("hidden");
    roomInput.value = room;
  }
})();

initModel();
