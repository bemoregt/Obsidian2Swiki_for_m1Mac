(function () {
  var btn = document.getElementById('resumeoptimize-btn');
  var status = document.getElementById('resumeoptimize-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('AI가 첨부된 이력서를 채용 공고에 맞춰 최적화하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/resume-optimize', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '이력서 최적화 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '이력서 최적화에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
