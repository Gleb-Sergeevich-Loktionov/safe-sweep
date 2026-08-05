(() => {
  'use strict';

  /* ============================================================
     Safe Sweep - Reverse Minesweeper
     Vanilla JS game engine + UI controller + Web Audio sfx.
     ============================================================ */

  // ---------- Difficulty presets ----------
  const DIFFICULTIES = {
    easy:   { rows: 8,  cols: 8,  mines: 10, label: 'Easy',   gap: 4 },
    medium: { rows: 12, cols: 12, mines: 25, label: 'Medium', gap: 3 },
    hard:   { rows: 16, cols: 16, mines: 50, label: 'Hard',   gap: 2 },
  };

  // Classic minesweeper number colors (neon-tuned): 1..8
  const NUMBER_COLORS = [
    '', '#4d8bff', '#22e677', '#ff4d5e', '#c77dff',
    '#ff9e3d', '#2ee6d6', '#ff6ec7', '#b8c0cc',
  ];

  // ---------- Inline SVG icons (no external assets) ----------
  const MINE_SVG =
    '<svg class="mine-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
    '<circle cx="16" cy="19" r="8.5" fill="#1a0608" stroke="#3a0a10" stroke-width="1.2"/>' +
    '<path d="M16 10.8 C15 8 17.6 6.4 20 5.4" stroke="#ffce3a" stroke-width="2" stroke-linecap="round" fill="none"/>' +
    '<circle cx="20" cy="5" r="2.5" fill="#ff7a00"/>' +
    '<circle cx="20" cy="5" r="1.2" fill="#fff3b0"/>' +
    '<circle cx="12.4" cy="16" r="2.2" fill="#ff9aa2" opacity="0.55"/>' +
    '<rect x="15.2" y="9" width="1.7" height="3.2" rx="0.8" fill="#1a0608"/>' +
    '</svg>';

  const FLAG_SVG =
    '<svg class="flag-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
    '<path d="M8.5 4 L8.5 28" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
    '<path d="M8.5 5 L24 9.2 L8.5 13.4 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>' +
    '</svg>';

  // ---------- DOM references ----------
  const boardEl = document.getElementById('board');
  const timerEl = document.getElementById('timer');
  const mineCountEl = document.getElementById('mineCount');
  const flagCountEl = document.getElementById('flagCount');
  const bestTimesEl = document.getElementById('bestTimes');
  const winOverlay = document.getElementById('winOverlay');
  const loseOverlay = document.getElementById('loseOverlay');
  const winTimeEl = document.getElementById('winTime');
  const winBestEl = document.getElementById('winBest');
  const confettiEl = document.getElementById('confetti');
  const soundToggleBtn = document.getElementById('soundToggle');

  // ---------- Game state ----------
  let difficulty = 'easy';
  let grid = [];
  let rows = 0, cols = 0, mineCount = 0, totalSafe = 0;
  let revealedSafe = 0, flagsPlaced = 0;
  let gameState = 'ready'; // 'ready' | 'playing' | 'won' | 'lost'
  let timerInterval = null, elapsed = 0, timerStarted = false;
  let soundOn = true;
  let suppressClick = false; // guards against click firing right after a touch long-press flag
  let loseOverlayTimer = null; // setTimeout handle for the delayed lose overlay

  const BEST_KEY = 'safeSweep_best_';

  // ---------- Web Audio sound effects (generated, no files) ----------
  const Sfx = {
    ctx: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    play(type) {
      if (!soundOn) return;
      let ctx;
      try { ctx = this.ensure(); } catch (e) { return; }
      if (!ctx) return;
      switch (type) {
        case 'reveal':    this.tone(ctx, 660, 0.08, 'triangle', 0.16); break;
        case 'cascade':   this.tone(ctx, 920, 0.05, 'sine', 0.07); break;
        case 'flag':      this.tone(ctx, 520, 0.06, 'square', 0.12);
                          setTimeout(() => this.tone(ctx, 720, 0.06, 'square', 0.12), 55); break;
        case 'explosion': this.explosion(ctx); break;
        case 'win':       this.winChime(ctx); break;
      }
    },
    tone(ctx, freq, dur, type, gain) {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    explosion(ctx) {
      const t = ctx.currentTime;
      const dur = 0.6;
      const size = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < size; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, t);
      filter.frequency.exponentialRampToValueAtTime(80, t + dur);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      noise.connect(filter); filter.connect(ng); ng.connect(ctx.destination);
      noise.start(t);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      g.gain.setValueAtTime(0.45, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.55);
    },
    winChime(ctx) {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => setTimeout(() => this.tone(ctx, f, 0.28, 'triangle', 0.22), i * 130));
    },
  };

  // ---------- Persistence ----------
  function getBest(d) {
    try {
      const v = localStorage.getItem(BEST_KEY + d);
      return v === null ? null : parseInt(v, 10);
    } catch (e) { return null; }
  }
  function setBest(d, s) {
    try { localStorage.setItem(BEST_KEY + d, String(s)); } catch (e) {}
  }

  // ---------- Timer ----------
  function startTimer() {
    if (timerStarted) return;
    timerStarted = true;
    elapsed = 0;
    updateTimer();
    timerInterval = setInterval(() => { elapsed++; updateTimer(); }, 1000);
  }
  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
  function updateTimer() { timerEl.textContent = formatTime(elapsed); }
  function formatTime(s) {
    const m = Math.floor(s / 60);
    const x = s % 60;
    return String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  }

  // ---------- Board generation ----------
  function initBoard() {
    const cfg = DIFFICULTIES[difficulty];
    rows = cfg.rows;
    cols = cfg.cols;
    mineCount = cfg.mines;
    totalSafe = rows * cols - mineCount;
    revealedSafe = 0;
    flagsPlaced = 0;
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ isMine: false, isRevealed: false, isFlagged: false, adjacentMines: 0, el: null });
      }
      grid.push(row);
    }
    placeMines();
    computeAdjacency();
  }

  function placeMines() {
    let placed = 0;
    while (placed < mineCount) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      if (!grid[r][c].isMine) {
        grid[r][c].isMine = true;
        placed++;
      }
    }
  }

  function computeAdjacency() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].isMine) continue;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc].isMine) count++;
          }
        }
        grid[r][c].adjacentMines = count;
      }
    }
  }

  // ---------- Rendering ----------
  function renderBoard() {
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--cols', cols);
    boardEl.style.setProperty('--rows', rows);
    boardEl.style.setProperty('--gap', DIFFICULTIES[difficulty].gap + 'px');
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.row = r;
        el.dataset.col = c;
        el.setAttribute('role', 'gridcell');
        grid[r][c].el = el;
        paintCell(grid[r][c]);
        frag.appendChild(el);
      }
    }
    boardEl.appendChild(frag);
    mineCountEl.textContent = mineCount;
    updateFlagCount();
    updateTimer();
    updateBestTimes();
  }

  // Fully repaint a single cell to reflect its current state.
  function paintCell(cell) {
    const el = cell.el;
    if (!el) return;
    el.classList.toggle('mine', cell.isMine);
    el.classList.toggle('revealed', !cell.isMine && cell.isRevealed);
    el.classList.toggle('flagged', cell.isFlagged);
    el.classList.toggle('zero', !cell.isMine && cell.isRevealed && cell.adjacentMines === 0);
    let html = '';
    if (cell.isMine) {
      html = cell.isFlagged ? FLAG_SVG : MINE_SVG;
    } else if (cell.isFlagged) {
      html = FLAG_SVG;
    } else if (cell.isRevealed && cell.adjacentMines > 0) {
      el.style.setProperty('--num-color', NUMBER_COLORS[cell.adjacentMines]);
      html = '<span class="num">' + cell.adjacentMines + '</span>';
    }
    el.innerHTML = html;
  }

  function updateFlagCount() { flagCountEl.textContent = flagsPlaced; }

  function updateBestTimes() {
    bestTimesEl.innerHTML = Object.keys(DIFFICULTIES).map((d) => {
      const b = getBest(d);
      return '<span class="best ' + (d === difficulty ? 'active' : '') + '">' +
        DIFFICULTIES[d].label + ' <strong>' + (b !== null ? formatTime(b) : '--:--') + '</strong></span>';
    }).join('');
  }

  function forEachCell(fn) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) fn(grid[r][c], r, c);
    }
  }

  // ---------- Actions ----------
  function reveal(r, c) {
    if (gameState === 'won' || gameState === 'lost') return;
    const cell = grid[r][c];
    if (cell.isRevealed || cell.isFlagged) return;
    if (cell.isMine) { startTimerIfNeeded(); triggerLose(r, c); return; }
    startTimerIfNeeded();
    if (gameState === 'ready') gameState = 'playing';

    // BFS flood-fill: reveal the clicked cell, cascade through zero-adjacent cells,
    // and reveal the non-zero border. Staggered paint gives a ripple cascade.
    const queue = [[r, c, 0]];
    const seen = new Set([r + ',' + c]);
    let cascadeCount = 0;
    let maxDelay = 0;

    while (queue.length) {
      const [cr, cc, dist] = queue.shift();
      const ce = grid[cr][cc];
      if (ce.isRevealed || ce.isFlagged || ce.isMine) continue;
      ce.isRevealed = true;
      revealedSafe++;
      if (dist === 0) {
        paintCell(ce);
        Sfx.play('reveal');
      } else {
        const delay = Math.min(dist * 18, 420);
        if (delay > maxDelay) maxDelay = delay;
        const target = ce;
        setTimeout(() => paintCell(target), delay);
        cascadeCount++;
      }
      if (ce.adjacentMines === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr, nc = cc + dc;
            const key = nr + ',' + nc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen.has(key)) {
              const nb = grid[nr][nc];
              if (!nb.isRevealed && !nb.isFlagged && !nb.isMine) {
                seen.add(key);
                queue.push([nr, nc, dist + 1]);
              }
            }
          }
        }
      }
    }
    if (cascadeCount > 0) Sfx.play('cascade');
    setTimeout(checkWin, cascadeCount > 0 ? maxDelay + 90 : 0);
  }

  function toggleFlag(r, c) {
    if (gameState === 'won' || gameState === 'lost') return;
    const cell = grid[r][c];
    if (cell.isRevealed) return; // cannot flag an already-revealed cell
    startTimerIfNeeded();
    if (gameState === 'ready') gameState = 'playing';
    cell.isFlagged = !cell.isFlagged;
    flagsPlaced += cell.isFlagged ? 1 : -1;
    paintCell(cell);
    updateFlagCount();
    Sfx.play('flag');
    if (navigator.vibrate) navigator.vibrate(25);
  }

  function startTimerIfNeeded() {
    if (!timerStarted) startTimer();
  }

  function checkWin() {
    if (gameState === 'won' || gameState === 'lost') return;
    if (revealedSafe >= totalSafe) triggerWin();
  }

  function triggerLose(r, c) {
    gameState = 'lost';
    stopTimer();
    // Reveal mines: drop any flags placed on mines so the bombs show.
    forEachCell((cell) => {
      if (cell.isMine && cell.isFlagged) {
        cell.isFlagged = false;
        flagsPlaced--;
        paintCell(cell);
      }
    });
    updateFlagCount();
    const clicked = grid[r][c];
    if (clicked.el) clicked.el.classList.add('exploded');
    Sfx.play('explosion');
    boardEl.classList.add('shake');
    setTimeout(() => boardEl.classList.remove('shake'), 480);
    loseOverlayTimer = setTimeout(() => { loseOverlay.classList.add('show'); loseOverlayTimer = null; }, 620);
  }

  function triggerWin() {
    gameState = 'won';
    stopTimer();
    const seconds = elapsed;
    const best = getBest(difficulty);
    const isBest = best === null || seconds < best;
    if (isBest) setBest(difficulty, seconds);
    // Auto-flag remaining mines as a victory flourish.
    forEachCell((cell) => {
      if (cell.isMine && !cell.isFlagged) {
        cell.isFlagged = true;
        flagsPlaced++;
        paintCell(cell);
      }
    });
    updateFlagCount();
    updateBestTimes();
    Sfx.play('win');
    launchConfetti();
    winTimeEl.textContent = 'Time: ' + formatTime(seconds);
    winBestEl.textContent = isBest ? 'New Best Time!' : (best !== null ? 'Best: ' + formatTime(best) : '');
    winOverlay.classList.add('show');
  }

  function resetGame() {
    // Cancel any pending lose-overlay show so clicking restart during the
    // 620ms delay doesn't flash a stale overlay onto the fresh board.
    if (loseOverlayTimer) { clearTimeout(loseOverlayTimer); loseOverlayTimer = null; }
    stopTimer();
    elapsed = 0;
    timerStarted = false;
    gameState = 'ready';
    revealedSafe = 0;
    flagsPlaced = 0;
    winOverlay.classList.remove('show');
    loseOverlay.classList.remove('show');
    boardEl.classList.remove('shake');
    confettiEl.innerHTML = '';
    initBoard();
    renderBoard();
  }

  function setDifficulty(d) {
    if (!DIFFICULTIES[d]) return;
    difficulty = d;
    document.querySelectorAll('.diff-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.diff === d)
    );
    resetGame();
  }

  function launchConfetti() {
    confettiEl.innerHTML = '';
    const colors = ['#00e5ff', '#00ff9d', '#ff3355', '#ffd23f', '#c77dff', '#ff6ec7'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const size = 6 + Math.random() * 8;
      p.style.left = Math.random() * 100 + '%';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      p.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
      confettiEl.appendChild(p);
    }
    setTimeout(() => { confettiEl.innerHTML = ''; }, 4200);
  }

  // ---------- Events ----------
  function onBoardClick(e) {
    if (suppressClick) { suppressClick = false; return; }
    const cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    reveal(+cellEl.dataset.row, +cellEl.dataset.col);
  }

  function onBoardContextMenu(e) {
    e.preventDefault(); // suppress native menu (desktop right-click + mobile long-press)
    const cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    toggleFlag(+cellEl.dataset.row, +cellEl.dataset.col);
    // Only suppress the next click for touch-originated contextmenu (long-press),
    // where the browser may fire a synthetic click right after the flag toggle.
    // Desktop right-click has no following click, so arming suppressClick there
    // would wrongly swallow the next legitimate left-click.
    if (e.pointerType === 'touch') {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 300);
    }
  }

  // ---------- Init ----------
  function init() {
    document.querySelectorAll('.diff-btn').forEach((btn) =>
      btn.addEventListener('click', () => setDifficulty(btn.dataset.diff))
    );
    document.getElementById('restartBtn').addEventListener('click', resetGame);
    document.getElementById('winRestart').addEventListener('click', resetGame);
    document.getElementById('loseRestart').addEventListener('click', resetGame);

    soundToggleBtn.addEventListener('click', () => {
      soundOn = !soundOn;
      soundToggleBtn.textContent = soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07';
      soundToggleBtn.classList.toggle('off', !soundOn);
      if (soundOn) { try { Sfx.ensure(); Sfx.play('flag'); } catch (e) {} }
    });

    boardEl.addEventListener('click', onBoardClick);
    boardEl.addEventListener('contextmenu', onBoardContextMenu);

    // Create / resume the AudioContext on the first user gesture (browser policy).
    document.addEventListener('pointerdown', function resumeAudio() {
      try { Sfx.ensure(); } catch (e) {}
    }, { once: true });

    resetGame();
  }

  init();
})();
