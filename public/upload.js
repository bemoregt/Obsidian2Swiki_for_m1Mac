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

  // Uploads a single file and returns {snippet, filename}. The caller decides
  // where the snippet goes (cursor vs. page append).
  function requestUpload(file) {
    var formData = new FormData();
    formData.append('file', file);
    return fetch('/upload', { method: 'POST', body: formData }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || '업로드 실패');
        var snippet = data.isImage
          ? '![' + data.filename + '](' + data.url + ')'
          : '[' + data.filename + '](' + data.url + ')';
        return { snippet: snippet, filename: data.filename };
      });
    });
  }

  function uploadFile(file, cursorStart, cursorEnd) {
    setStatus('업로드 중...');
    requestUpload(file)
      .then(function (data) {
        if (insertSnippetAtCursor(data.snippet, cursorStart, cursorEnd)) {
          setStatus('업로드 완료: ' + data.filename);
          return;
        }

        var pageName = currentViewPageName();
        if (pageName) {
          setStatus('업로드 완료, 문서 끝에 추가 중...');
          return appendToCurrentPage(pageName, data.snippet).then(function () {
            location.reload();
          });
        }

        setStatus('업로드 완료 (문서 보기/편집 화면에서 다시 시도해주세요): ' + data.filename);
      })
      .catch(function (err) {
        setStatus(err.message || '업로드 실패');
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

  // --- Drag & drop ---
  // Drop files anywhere on the page. In edit mode the snippet goes into the
  // editor (at the caret, or at the end if the editor isn't focused); in view
  // mode it is appended to the current page - so an mp4 (or any file) dragged
  // in gets uploaded and attached just like choosing it via the 📤 button.

  var overlay = document.getElementById('drop-overlay');
  var dragDepth = 0;

  function hideOverlay() {
    dragDepth = 0;
    if (overlay) overlay.style.display = 'none';
  }

  function isFileDrag(e) {
    var dt = e.dataTransfer;
    return dt && dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
  }

  function insertionPoint() {
    if (editor) {
      if (document.activeElement === editor) {
        return { start: editor.selectionStart, end: editor.selectionEnd };
      }
      return { start: editor.value.length, end: editor.value.length };
    }
    return null;
  }

  function insertInEditor(items, pos) {
    var total = items.length;
    var failed = [];
    var cursor = { start: pos.start, end: pos.end };
    setStatus(total + '개 파일 업로드 중...');

    function next(i) {
      if (i >= total) {
        if (failed.length) {
          setStatus((total - failed.length) + '개 업로드 완료, ' + failed.length + '개 실패: ' + failed.join(', '));
        } else {
          setStatus(total + '개 파일 업로드 완료');
        }
        return;
      }
      requestUpload(items[i])
        .then(function (data) {
          var separator = i < total - 1 ? '\n' : '';
          if (insertSnippetAtCursor(data.snippet + separator, cursor.start, cursor.end)) {
            cursor.start = cursor.end = cursor.start + data.snippet.length + separator.length;
          }
          next(i + 1);
        })
        .catch(function (err) {
          failed.push(items[i].name);
          next(i + 1);
        });
    }

    next(0);
  }

  function appendInView(items) {
    var pageName = currentViewPageName();
    if (!pageName) {
      setStatus('문서 보기/편집 화면에서 파일을 놓아주세요');
      return;
    }
    setStatus(items.length + '개 파일 업로드 후 문서 끝에 추가 중...');
    Promise.all(items.map(requestUpload))
      .then(function (results) {
        return appendToCurrentPage(pageName, results.map(function (d) { return d.snippet; }).join('\n'));
      })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        setStatus(err.message || '업로드 실패');
      });
  }

  function handleDrop(files) {
    var items = Array.prototype.slice.call(files).filter(function (f) {
      return f && typeof f.size === 'number';
    });
    if (!items.length) return;

    var pos = insertionPoint();
    if (pos) insertInEditor(items, pos);
    else appendInView(items);
  }

  if (editor) {
    editor.addEventListener('dragover', function (e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      editor.classList.add('drop-active');
    });
    editor.addEventListener('dragleave', function () {
      editor.classList.remove('drop-active');
    });
    editor.addEventListener('drop', function (e) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      editor.classList.remove('drop-active');
      hideOverlay();
      handleDrop(e.dataTransfer.files);
    });
  }

  document.addEventListener('dragenter', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    if (overlay) overlay.style.display = 'flex';
  });
  document.addEventListener('dragover', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', function (e) {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && overlay) overlay.style.display = 'none';
  });
  document.addEventListener('drop', function (e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    hideOverlay();
    handleDrop(e.dataTransfer.files);
  });

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
