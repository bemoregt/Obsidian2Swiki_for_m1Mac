(function () {
  var btn = document.getElementById('imagegen-btn');
  var status = document.getElementById('imagegen-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('그림을 생성하는 중입니다... (보통 10~30초 정도 걸립니다)');

    fetch('/page/' + encodeURIComponent(currentName) + '/generate-image', { method: 'POST' })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || 'failed'); });
        return r.json();
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus('그림 생성에 실패했습니다: ' + err.message);
        btn.disabled = false;
      });
  });
})();
