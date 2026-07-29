const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Best-effort defense-in-depth, not a real sandbox: this app has no OS-level
// isolation (containers, seccomp, restricted user) to actually confine what
// generated Python can do, so this blocklist exists to catch the most
// obvious ways generated code could run arbitrary commands, touch the
// filesystem outside the two paths it's given, or reach the network -
// before it ever executes. It is not airtight (a determined adversarial
// prompt could still get past regex matching), so it only makes sense
// alongside the timeout and scratch working directory below, and this
// feature should stay something the machine's own owner runs against their
// own notes, not something exposed to untrusted input.
const DANGEROUS_PATTERNS = [
  /\bos\.system\b/,
  /\bsubprocess\b/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\b__import__\s*\(/,
  /\brequests\b/,
  /\burllib\b/,
  /\bsocket\b/,
  /\bhttp\.client\b/,
  /\bshutil\.rmtree\b/,
  /\bos\.remove\b/,
  /\bos\.unlink\b/,
  /\bos\.rmdir\b/,
  /\bpip\b/,
  /\bctypes\b/,
];

function checkCodeSafety(code) {
  const hit = DANGEROUS_PATTERNS.find((re) => re.test(code));
  if (hit) {
    throw new Error(
      `생성된 코드에 안전하지 않을 수 있는 구문(${hit.source})이 포함되어 있어 실행을 거부했습니다. 문서 내용을 조금 다르게 써서 다시 시도해주세요.`
    );
  }
}

// Wraps the model's process_image(...) or process_audio(...) function
// (whichever the generation actually defined - see lib/ollama.js) with a
// fixed entry point WE control - the model never writes its own argv
// handling or __main__ block, so it can't smuggle extra top-level behavior
// in under the guise of "setup code". Parameter values (from the page's
// slider/dropdown controls) are passed as a JSON blob on argv[3] and
// unpacked as keyword arguments, so the wrapper doesn't need to know their
// names or types ahead of time. Checking which name actually got defined
// (rather than try/except NameError around calling it) means a genuine bug
// inside process_image itself - say, a stray NameError from a typo - still
// surfaces as that real error instead of being swallowed and misreported as
// "process_audio is missing too". Keeps old saved pages (which only ever
// defined process_image) working unchanged.
function buildScript(code) {
  return (
    `${code}\n\n` +
    'if __name__ == "__main__":\n' +
    '    import sys, json\n' +
    '    _params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}\n' +
    '    _fn = process_image if "process_image" in dir() else process_audio\n' +
    '    _fn(sys.argv[1], sys.argv[2], **_params)\n'
  );
}

const RUN_TIMEOUT_MS = 60000;

// Runs the generated function against a real input file in an ephemeral
// working directory and returns the resulting file (PNG or WAV, matching
// outputExt) as a Buffer - the directory itself (script, output file) is
// torn down before this returns, so nothing about a single run lingers on
// disk. outputExt matters beyond cosmetics: matplotlib's savefig() infers
// its output format from the file extension, so an image-output algorithm
// needs ".png" and an audio-output one needs ".wav" (scipy.io.wavfile.write
// itself ignores the extension, but keeping it consistent avoids confusion).
// Throws with the actual stderr (truncated) on failure so the caller can
// show the reader why it broke instead of a generic error. Re-checks code
// safety on every call, including live parameter-preview re-runs, since
// those resubmit the code from the browser rather than fetching it fresh
// from Ollama each time.
async function runProcess({ code, inputPath, params, outputExt = '.png' }) {
  checkCodeSafety(code);

  const workDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'o2s-codetest-'));
  const scriptPath = path.join(workDir, 'script.py');
  const outputPath = path.join(workDir, `output${outputExt}`);
  fs.writeFileSync(scriptPath, buildScript(code));

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'python3',
        [scriptPath, inputPath, outputPath, JSON.stringify(params || {})],
        { cwd: workDir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const reason = err.killed
              ? `실행 시간이 ${RUN_TIMEOUT_MS / 1000}초를 넘어 중단되었습니다.`
              : (stderr || err.message || '').trim().slice(-1500) || err.message;
            reject(new Error(`코드 실행 중 오류가 발생했습니다:\n${reason}`));
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('코드가 오류 없이 끝났지만 결과 파일을 만들지 않았습니다.');
    }
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

module.exports = { checkCodeSafety, runProcess };
