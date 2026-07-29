(function () {
  var btn = document.getElementById('youtubesummary-btn');
  var status = document.getElementById('youtubesummary-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('자막을 가져와 AI가 영상을 요약하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/youtube-summary', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '영상 요약 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '영상 요약에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
