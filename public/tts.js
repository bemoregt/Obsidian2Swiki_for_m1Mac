(function () {
  var btn = document.getElementById('tts-btn');
  var body = document.querySelector('.page-body');
  if (!btn || !body) return;

  var state = 'idle'; // idle | loading | playing
  var chunks = [];
  var chunkIndex = 0;
  var currentAudio = null;
  var prefetch = null;
  var abort = false;

  function resetBtn() {
    btn.textContent = '🔊';
    btn.disabled = false;
    state = 'idle';
  }

  // Split into sentence-sized pieces so playback can start on the first
  // sentence instead of waiting for the whole page to synthesize.
  function splitIntoChunks(text) {
    var parts = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    var merged = [];
    var buf = '';
    parts.forEach(function (p) {
      buf = buf ? buf + ' ' + p : p;
      if (buf.length >= 20) {
        merged.push(buf);
        buf = '';
      }
    });
    if (buf) merged.push(buf);
    return merged;
  }

  function fetchChunk(text) {
    return fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    }).then(function (r) {
      if (!r.ok) throw new Error('tts failed: ' + r.status);
      return r.blob();
    });
  }

  function playNext() {
    if (abort || chunkIndex >= chunks.length) {
      resetBtn();
      return;
    }
    var blobPromise = prefetch || fetchChunk(chunks[chunkIndex]);
    prefetch = null;

    blobPromise
      .then(function (blob) {
        if (abort) return;
        chunkIndex += 1;
        if (chunkIndex < chunks.length) {
          prefetch = fetchChunk(chunks[chunkIndex]);
        }
        currentAudio = new Audio(URL.createObjectURL(blob));
        currentAudio.addEventListener('ended', playNext);
        currentAudio.play();
        btn.textContent = '⏹';
        btn.disabled = false;
        state = 'playing';
      })
      .catch(function () {
        resetBtn();
        alert('음성 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      });
  }

  function stop() {
    abort = true;
    if (currentAudio) {
      currentAudio.removeEventListener('ended', playNext);
      currentAudio.pause();
      currentAudio = null;
    }
    resetBtn();
  }

  btn.addEventListener('click', function () {
    if (state === 'playing') {
      stop();
      return;
    }

    var text = (body.innerText || body.textContent || '').trim();
    if (!text) return;

    chunks = splitIntoChunks(text);
    if (!chunks.length) return;
    chunkIndex = 0;
    prefetch = null;
    abort = false;

    state = 'loading';
    btn.textContent = '⏳';
    btn.disabled = true;
    playNext();
  });

  window.addEventListener('beforeunload', function () {
    if (currentAudio) currentAudio.pause();
  });
})();
