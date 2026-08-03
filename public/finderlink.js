(function () {
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a.finder-link');
    if (!link) return;
    e.preventDefault();

    var path = link.getAttribute('data-path');
    if (!path) return;

    var original = link.textContent;
    link.textContent = '\u{1F4C1} 여는 중...';

    fetch('/open-in-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          alert('열기 실패: ' + (result.data && result.data.error ? result.data.error : '알 수 없는 오류'));
        }
      })
      .catch(function (err) {
        alert('열기 실패: ' + err.message);
      })
      .finally(function () {
        link.textContent = original;
      });
  });
})();
