const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

// One persistent `python3 lib/kernel_worker.py` process per page, keyed by
// page name - this is what makes "run cell 3, then later run cell 1 again"
// see the same variables/imports cell 2 left behind, which a fresh
// subprocess-per-request model (like lib/notebook.js's executeNotebook)
// fundamentally can't do. Kept in memory only; a server restart or idle
// timeout drops it, and the next run-cell call transparently starts a new
// one (with a now-empty namespace - the caller is responsible for deciding
// whether that's acceptable or whether to re-run earlier cells first).
const kernels = new Map();

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const CELL_TIMEOUT_MS = 360000;

function killKernel(name) {
  const k = kernels.get(name);
  if (!k) return;
  clearTimeout(k.idleTimer);
  try {
    k.proc.kill();
  } catch {
    /* already dead */
  }
  kernels.delete(name);
}

function touchIdleTimer(name) {
  const k = kernels.get(name);
  if (!k) return;
  clearTimeout(k.idleTimer);
  k.idleTimer = setTimeout(() => killKernel(name), IDLE_TIMEOUT_MS);
}

function startKernel(name) {
  killKernel(name);
  const workerPath = path.join(__dirname, 'kernel_worker.py');
  const proc = spawn('python3', ['-u', workerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: proc.stdout });
  const k = { proc, rl, queue: [], idleTimer: null, dead: false, stderrBuf: '' };

  proc.stderr.on('data', (chunk) => {
    k.stderrBuf = (k.stderrBuf + chunk.toString()).slice(-4000);
  });

  rl.on('line', (line) => {
    const pending = k.queue.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      pending.reject(new Error('커널 응답을 해석하지 못했습니다.'));
      return;
    }
    pending.resolve(parsed);
  });

  proc.on('exit', () => {
    k.dead = true;
    const err = new Error(
      k.stderrBuf.trim() ? `파이썬 커널이 예기치 않게 종료되었습니다:\n${k.stderrBuf.trim()}` : '파이썬 커널이 예기치 않게 종료되었습니다.'
    );
    while (k.queue.length) {
      const pending = k.queue.shift();
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    kernels.delete(name);
  });

  kernels.set(name, k);
  touchIdleTimer(name);
  return k;
}

function hasKernel(name) {
  return kernels.has(name) && !kernels.get(name).dead;
}

// The kernel object itself doubles as this page's session state - callers
// (server.js) stash the current parsed cell list on it directly (`k.cells`)
// so /run-cell can look up "cell 3's source" without re-parsing the page
// body on every call, staying consistent even if the page is edited
// mid-session.
function getKernel(name) {
  const k = kernels.get(name);
  return k && !k.dead ? k : null;
}

// Runs one cell's code in this page's persistent kernel, starting a fresh
// kernel first if none exists yet. Calls are queued per-kernel (the
// readline 'line' handler pairs each response with the oldest pending
// request), so two run-cell calls for the same page never interleave their
// output even if the client fires them close together.
function runCell(name, code) {
  let k = kernels.get(name);
  if (!k || k.dead) k = startKernel(name);
  touchIdleTimer(name);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // A stuck cell leaves the kernel in an unknown/unrecoverable state
      // (Python has no clean way to interrupt a running exec() from the
      // outside) - kill it so the next call starts clean rather than
      // silently queuing behind a cell that will never finish.
      killKernel(name);
      reject(new Error(`셀 실행이 ${CELL_TIMEOUT_MS / 1000}초를 넘어 중단되었습니다. 커널을 초기화했습니다.`));
    }, CELL_TIMEOUT_MS);

    k.queue.push({ resolve, reject, timer });
    k.proc.stdin.write(`${JSON.stringify({ code })}\n`);
  });
}

module.exports = { startKernel, killKernel, hasKernel, getKernel, runCell };
