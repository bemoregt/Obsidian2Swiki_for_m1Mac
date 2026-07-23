(function () {
  var btn = document.getElementById('copy-btn');
  var status = document.getElementById('copy-status');
  var body = document.querySelector('.page-body');
  if (!btn || !body) return;

  function setStatus(text) {
    if (!status) return;
    status.textContent = text;
    if (text) setTimeout(function () { if (status.textContent === text) status.textContent = ''; }, 2000);
  }

  btn.addEventListener('click', function () {
    var text = (body.innerText || body.textContent || '').trim();
    if (!text) {
      setStatus('복사할 내용이 없습니다.');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { setStatus('복사되었습니다.'); },
        function () { setStatus('복사에 실패했습니다.'); }
      );
      return;
    }

    // Fallback for browsers without the async Clipboard API.
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      setStatus('복사되었습니다.');
    } catch (e) {
      setStatus('복사에 실패했습니다.');
    }
    document.body.removeChild(textarea);
  });
})();
