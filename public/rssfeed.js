(function () {
  var btn = document.getElementById('rssfeed-btn');
  var status = document.getElementById('rssfeed-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('관련 RSS Feed 링크를 만드는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/rss-search', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'RSS Feed 링크 생성 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || 'RSS Feed 링크 생성에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
