(function () {
  var btn = document.getElementById('make-video-btn');
  var status = document.getElementById('video-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('영상을 만드는 중입니다... (PDF를 이미지로 변환하고, 오디오와 합치고, AI가 제목/설명을 씁니다. 몇 분 걸릴 수 있어요)');

    fetch('/page/' + encodeURIComponent(currentName) + '/make-video', { method: 'POST' })
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
        btn.disabled = false;
      });
  });
})();
