(function () {
  var buttons = document.querySelectorAll('.jobsearch-btn');
  var status = document.getElementById('jobsearch-status');
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
      setStatus('채용사이트 검색 링크를 만드는 중입니다...');

      fetch('/page/' + encodeURIComponent(currentName) + '/job-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: period }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || '채용정보 검색 링크 생성 실패');
            return data;
          });
        })
        .then(function () {
          location.reload();
        })
        .catch(function (err) {
          setStatus(err.message || '채용정보 검색 링크 생성에 실패했습니다.');
          buttons.forEach(function (b) { b.disabled = false; });
        });
    });
  });
})();
