(function () {
  var status = document.getElementById('video-status');
  var videoBtn = document.getElementById('make-video-btn');
  var shortsBtn = document.getElementById('make-shorts-btn');
  var buttons = [videoBtn, shortsBtn].filter(Boolean);
  if (!buttons.length) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function setBusy(busy) {
    buttons.forEach(function (b) { b.disabled = busy; });
  }

  function run(endpoint, busyMessage) {
    if (!currentName) return;
    setBusy(true);
    setStatus(busyMessage);

    fetch('/page/' + encodeURIComponent(currentName) + endpoint, { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '영상 생성 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '영상 생성에 실패했습니다.');
        setBusy(false);
      });
  }

  if (videoBtn) {
    videoBtn.addEventListener('click', function () {
      run('/make-video', '유튜브 영상을 만드는 중입니다... (PDF를 이미지로 변환하고, 오디오와 합치고, AI가 제목/설명을 씁니다. 몇 분 걸릴 수 있어요)');
    });
  }

  if (shortsBtn) {
    shortsBtn.addEventListener('click', function () {
      run('/make-shorts', '쇼츠 영상을 만드는 중입니다... (초반 3분 구간을 세로 화면으로 만듭니다)');
    });
  }
})();
