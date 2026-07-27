(function () {
  var btn = document.getElementById('translate-btn');
  var status = document.getElementById('translate-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('AI가 동영상 제목과 설명을 영어로 번역하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/translate', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '번역 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '번역에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
