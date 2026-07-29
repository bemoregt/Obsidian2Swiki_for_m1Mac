(function () {
  var btn = document.getElementById('relatedpages-btn');
  var status = document.getElementById('relatedpages-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('링크 그래프에서 관련 문서를 찾고 AI가 이유를 설명하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/related-pages', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '관련 문서 추천 실패');
          return data;
        });
      })
      .then(function (data) {
        if (!data.related || !data.related.length) {
          // Nothing appended to the page in this case, so a reload would
          // just lose the status message for no reason.
          setStatus(data.message || '관련 문서를 찾지 못했습니다.');
          btn.disabled = false;
          return;
        }
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '관련 문서 추천에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
