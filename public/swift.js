(function () {
  var btn = document.getElementById('swiftapp-btn');
  var status = document.getElementById('swiftapp-status');
  if (!btn) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    if (!currentName) return;
    btn.disabled = true;
    setStatus('AI가 이 문서의 앱을 만드는 SwiftUI(iOS) 프로젝트 코드를 작성하는 중입니다... (1~2분 정도 걸릴 수 있습니다)');

    fetch('/page/' + encodeURIComponent(currentName) + '/swift-code', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Swift 코드 생성 실패');
          return data;
        });
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || 'Swift 코드 생성에 실패했습니다.');
        btn.disabled = false;
      });
  });
})();
