(function () {
  var buttons = document.querySelectorAll('.arxiv-btn');
  var status = document.getElementById('arxiv-status');
  if (!buttons.length) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentName) return;
      var period = btn.dataset.period === 'week' ? 'week' : 'month';
      buttons.forEach(function (b) { b.disabled = true; });
      setStatus('arXiv에서 논문을 찾고 PDF를 내려받는 중입니다... (시간이 걸릴 수 있습니다)');

      fetch('/page/' + encodeURIComponent(currentName) + '/arxiv-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: period }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || 'arXiv 논문 검색 실패');
            return data;
          });
        })
        .then(function (data) {
          if (!data.papers || !data.papers.length) {
            // Nothing appended to the page in this case, so a reload would
            // just lose the status message for no reason.
            setStatus(data.message || '관련 논문을 찾지 못했습니다.');
            buttons.forEach(function (b) { b.disabled = false; });
            return;
          }
          location.reload();
        })
        .catch(function (err) {
          setStatus(err.message || 'arXiv 논문 검색에 실패했습니다.');
          buttons.forEach(function (b) { b.disabled = false; });
        });
    });
  });
})();
