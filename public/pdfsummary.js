(function () {
  var btn = document.getElementById('pdfsummary-btn');
  var status = document.getElementById('pdfsummary-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('AI가 첨부된 PDF 논문을 읽고 요약하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/pdf-summary', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '논문 요약 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '논문 요약에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
