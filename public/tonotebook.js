(function () {
  var mainBtn = document.getElementById('tonotebook-btn');
  var status = document.getElementById('tonotebook-status');
  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  // Main button: (re)starts a fresh interactive session - parses the page's
  // current code into cells, starts a brand new kernel process, and saves
  // an "all cells un-run" notebook. Reloads so the freshly rendered HTML
  // (with a ▶ 실행 button per cell) shows up via the normal page render.
  if (mainBtn) {
    mainBtn.addEventListener('click', function () {
      if (!currentName) return;
      mainBtn.disabled = true;
      setStatus('노트북을 시작하는 중입니다...');

      fetch('/page/' + encodeURIComponent(currentName) + '/to-notebook', { method: 'POST' })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || '노트북 시작 실패');
            return data;
          });
        })
        .then(function () {
          location.reload();
        })
        .catch(function (err) {
          setStatus(err.message || '노트북 시작에 실패했습니다.');
          mainBtn.disabled = false;
        });
    });
  }

  // Per-cell run buttons, rendered server-side by lib/notebook.js's
  // renderNotebookHtml for any already-attached .ipynb (from a previous
  // session or this page's last save). Delegated on the document so it
  // still works after the main button's location.reload().
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.ipynb-run-btn') : null;
    if (!btn || !currentName) return;

    var cellEl = btn.closest('.ipynb-cell');
    var index = Number(btn.getAttribute('data-cell-index'));
    if (!cellEl || !Number.isInteger(index)) return;

    var editor = cellEl.querySelector('.ipynb-editor');
    var outputEl = cellEl.querySelector('.ipynb-output');
    var inPrompt = cellEl.querySelector('.ipynb-in-prompt');
    var origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 실행 중...';

    fetch('/page/' + encodeURIComponent(currentName) + '/notebook/run-cell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: index, code: editor ? editor.value : undefined }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error(data.error || '셀 실행 실패');
          return data;
        });
      })
      .then(function (data) {
        if (inPrompt) inPrompt.innerHTML = 'In&nbsp;[' + data.execution_count + ']:';
        if (outputEl) {
          outputEl.innerHTML = '<span class="ipynb-prompt">Out[' + data.execution_count + ']:</span>' + renderOutputs(data.outputs);
          outputEl.style.display = data.outputs && data.outputs.length ? '' : 'none';
        }
      })
      .catch(function (err) {
        if (outputEl) {
          outputEl.innerHTML =
            '<span class="ipynb-prompt">Out:</span><pre class="ipynb-error">' + escapeHtml(err.message || '셀 실행에 실패했습니다.') + '</pre>';
          outputEl.style.display = '';
        }
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = origLabel;
      });
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderOutputs(outputs) {
    if (!outputs || !outputs.length) return '';
    return outputs
      .map(function (o) {
        if (o.output_type === 'stream') {
          var text = Array.isArray(o.text) ? o.text.join('') : o.text || '';
          var cls = o.name === 'stderr' ? 'ipynb-stream ipynb-stderr' : 'ipynb-stream';
          return '<pre class="' + cls + '">' + escapeHtml(text) + '</pre>';
        }
        if (o.output_type === 'error') {
          var tb = Array.isArray(o.traceback) ? o.traceback.join('\n') : String(o.traceback || '');
          return '<pre class="ipynb-error">' + escapeHtml(tb) + '</pre>';
        }
        if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
          var data = (o.data || {})['text/plain'];
          var resultText = Array.isArray(data) ? data.join('') : data;
          if (resultText) return '<pre class="ipynb-result">' + escapeHtml(resultText) + '</pre>';
        }
        return '';
      })
      .join('');
  }
})();
