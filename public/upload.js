(function () {
  var editor = document.getElementById('editor');
  var status = document.getElementById('upload-status');
  var setStatus = function (text) {
    if (status) status.textContent = text;
  };

  function insertSnippetAtCursor(snippet, cursorStart, cursorEnd) {
    if (!editor || cursorStart === null || cursorStart === undefined) return false;
    var value = editor.value;
    editor.value = value.slice(0, cursorStart) + snippet + value.slice(cursorEnd);
    var newPos = cursorStart + snippet.length;
    editor.selectionStart = editor.selectionEnd = newPos;
    editor.focus();
    return true;
  }

  function currentViewPageName() {
    var m = location.pathname.match(/^\/page\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function appendToCurrentPage(pageName, snippet) {
    return fetch('/page/' + encodeURIComponent(pageName) + '/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: snippet }),
    }).then(function (r) {
      if (!r.ok) throw new Error('append failed');
      return r.json();
    });
  }

  function uploadFile(file, cursorStart, cursorEnd) {
    var formData = new FormData();
    formData.append('file', file);
    setStatus('업로드 중...');

    return fetch('/upload', { method: 'POST', body: formData })
      .then(function (r) {
        if (!r.ok) throw new Error('upload failed');
        return r.json();
      })
      .then(function (data) {
        var snippet = data.isImage
          ? '![' + data.filename + '](' + data.url + ')'
          : '[' + data.filename + '](' + data.url + ')';

        if (insertSnippetAtCursor(snippet, cursorStart, cursorEnd)) {
          setStatus('업로드 완료: ' + data.filename);
          return;
        }

        var pageName = currentViewPageName();
        if (pageName) {
          setStatus('업로드 완료, 문서 끝에 추가 중...');
          return appendToCurrentPage(pageName, snippet).then(function () {
            location.reload();
          });
        }

        setStatus('업로드 완료 (문서 보기/편집 화면에서 다시 시도해주세요): ' + data.filename);
      })
      .catch(function () {
        setStatus('업로드 실패');
      });
  }

  var input = document.getElementById('file-upload-input');
  if (input) {
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      var cursorStart = editor ? editor.selectionStart : null;
      var cursorEnd = editor ? editor.selectionEnd : null;
      uploadFile(file, cursorStart, cursorEnd).finally(function () {
        input.value = '';
      });
    });
  }

  // Paste an image straight from the clipboard at the cursor position.
  if (editor) {
    editor.addEventListener('paste', function (e) {
      var dt = e.clipboardData || window.clipboardData;
      if (!dt) return;

      // 1) Prefer actual image bytes when the clipboard has them (screenshots,
      // Preview.app copies, canvas copies) - upload straight to the vault.
      var items = dt.items;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
            var blob = item.getAsFile();
            if (!blob) continue;
            e.preventDefault();

            var ext = (item.type.split('/')[1] || 'png').split('+')[0];
            var filename = 'pasted-' + Date.now() + '.' + ext;
            uploadFile(new File([blob], filename, { type: item.type }), editor.selectionStart, editor.selectionEnd);
            return;
          }
        }
      }

      // 2) "Copy Image" from a webpage often hands over an <img> tag or a bare
      // URL instead of raw bytes (no file item at all) - link to it directly.
      var html = dt.getData ? dt.getData('text/html') : '';
      var uriList = dt.getData ? dt.getData('text/uri-list') : '';
      var plain = dt.getData ? dt.getData('text/plain') : '';
      var url = null;

      var htmlMatch = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (htmlMatch) url = htmlMatch[1];
      if (!url && uriList) url = uriList.split('\n')[0].trim();
      if (!url && /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp)(\?\S*)?$/i.test(plain.trim())) {
        url = plain.trim();
      }

      if (url) {
        e.preventDefault();
        insertSnippetAtCursor('![pasted-image](' + url + ')', editor.selectionStart, editor.selectionEnd);
        setStatus('외부 이미지 링크로 삽입했습니다');
      }
    });
  }
})();
