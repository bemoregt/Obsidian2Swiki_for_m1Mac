(function () {
  var btn = document.getElementById('codetest-btn');
  var status = document.getElementById('codetest-status');
  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  if (btn) {
    btn.addEventListener('click', function () {
      if (!currentName) return;
      btn.disabled = true;
      setStatus('AI가 코드를 생성하고 첨부된 이미지/오디오로 실행하는 중입니다... (최대 1분 정도 걸릴 수 있습니다)');

      fetch('/page/' + encodeURIComponent(currentName) + '/code-test', { method: 'POST' })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || '코드 테스트 실패');
            return data;
          });
        })
        .then(function () {
          // Reload rather than build the panel inline - scanExistingResults()
          // below then picks the freshly-saved section straight back up from
          // the page itself, which is exactly the same code path a later
          // visit uses. One path instead of two.
          location.reload();
        })
        .catch(function (err) {
          setStatus(err.message || '코드 테스트에 실패했습니다.');
          btn.disabled = false;
        });
    });
  }

  // --- Live parameter controls for any already-saved "코드로 테스트하기"
  // result on this page. Runs on every load, not just right after a fresh
  // click, so revisiting a page later still gets interactive sliders: the
  // parameter schema travels with the saved code itself, embedded as a
  // harmless "# CODETEST_PARAMS: [...]" comment on its first line (see
  // server.js embedParamsComment) that this recovers straight from the
  // rendered code block's own text.
  var PARAMS_COMMENT_RE = /^#\s*CODETEST_PARAMS:\s*(.+)$/m;

  function coerceValue(param, raw) {
    return param.type === 'slider' ? Number(raw) : raw;
  }

  function buildControls(container, params, values, onChange) {
    params.forEach(function (param) {
      var row = document.createElement('div');
      row.className = 'codetest-control-row';

      var label = document.createElement('label');
      label.textContent = param.label || param.name;
      row.appendChild(label);

      var input;
      if (param.type === 'combobox' && Array.isArray(param.options)) {
        input = document.createElement('select');
        param.options.forEach(function (opt) {
          var optionEl = document.createElement('option');
          optionEl.value = opt;
          optionEl.textContent = opt;
          if (opt === values[param.name]) optionEl.selected = true;
          input.appendChild(optionEl);
        });
      } else {
        input = document.createElement('input');
        input.type = 'range';
        if (param.min !== undefined) input.min = param.min;
        if (param.max !== undefined) input.max = param.max;
        if (param.step !== undefined) input.step = param.step;
        input.value = values[param.name];
      }

      var valueLabel = document.createElement('span');
      valueLabel.className = 'codetest-control-value';
      valueLabel.textContent = String(values[param.name]);

      var handler = function () {
        var value = coerceValue(param, input.value);
        valueLabel.textContent = String(value);
        values[param.name] = value;
        onChange();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);

      row.appendChild(input);
      row.appendChild(valueLabel);
      container.appendChild(row);
    });
  }

  // mediaEl is whichever element actually shows the saved result - an
  // <img class="wiki-img"> for image output, or an <audio class="wiki-audio">
  // for audio output. Both expose a plain .src property, so swapping in a
  // fresh data: URL from the preview endpoint works identically either way -
  // this function doesn't otherwise need to know or care which one it is.
  function setupLivePanel(pageName, codeText, mediaEl, params) {
    var values = {};
    params.forEach(function (p) {
      values[p.name] = p.type === 'slider' ? Number(p.default) : p.default;
    });

    var wrapper = document.createElement('div');
    wrapper.className = 'codetest-live-controls';

    var controlsEl = document.createElement('div');
    controlsEl.className = 'codetest-controls';
    wrapper.appendChild(controlsEl);

    var statusEl = document.createElement('p');
    statusEl.className = 'side-hint';
    wrapper.appendChild(statusEl);

    var afterEl = mediaEl.closest('p') || mediaEl;
    afterEl.parentNode.insertBefore(wrapper, afterEl.nextSibling);

    var previewTimer = null;
    var previewToken = 0;

    function schedulePreview() {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(runPreview, 300);
    }

    function runPreview() {
      var token = ++previewToken;
      statusEl.textContent = '파라미터를 반영해 다시 실행하는 중입니다...';

      fetch('/page/' + encodeURIComponent(pageName) + '/code-test/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeText, values: values }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) throw new Error(data.error || '미리보기 실행 실패');
            return data;
          });
        })
        .then(function (data) {
          if (token !== previewToken) return; // a newer request already landed
          mediaEl.src = data.dataUrl;
          statusEl.textContent = '';
        })
        .catch(function (err) {
          if (token !== previewToken) return;
          statusEl.textContent = err.message || '미리보기 실행에 실패했습니다.';
        });
    }

    buildControls(controlsEl, params, values, schedulePreview);
  }

  function scanExistingResults() {
    if (!currentName) return;
    var codeBlocks = document.querySelectorAll('.page-body pre.hljs code.language-python');
    codeBlocks.forEach(function (codeEl) {
      var text = codeEl.textContent || '';
      var match = text.match(PARAMS_COMMENT_RE);
      if (!match) return;

      var parsedRaw;
      try {
        parsedRaw = JSON.parse(match[1]);
      } catch (e) {
        return;
      }
      // Old saved pages only ever held a bare params array (image-in/
      // image-out was the only mode that existed then); newer ones hold
      // { input_type, output_type, params }.
      var params = Array.isArray(parsedRaw) ? parsedRaw : parsedRaw.params;
      if (!Array.isArray(params) || !params.length) return;

      var pre = codeEl.closest('pre');
      var afterEl = pre && pre.nextElementSibling;
      var mediaEl =
        afterEl && afterEl.querySelector
          ? afterEl.querySelector('img.wiki-img') || afterEl.querySelector('audio.wiki-audio')
          : null;
      if (!mediaEl) return;

      setupLivePanel(currentName, text, mediaEl, params);
    });
  }

  scanExistingResults();
})();
