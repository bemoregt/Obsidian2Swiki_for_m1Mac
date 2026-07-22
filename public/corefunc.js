(function () {
  var btn = document.getElementById('core-function-btn');
  var status = document.getElementById('core-function-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('AI가 이 문서의 핵심 함수(최대 3개)를 고르고 파이썬 코드로 구현하는 중입니다...');

    fetch('/page/' + encodeURIComponent(currentName) + '/core-function', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '핵심 함수 생성 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '핵심 함수 생성에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
