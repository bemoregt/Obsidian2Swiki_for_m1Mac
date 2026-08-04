// Sidebar "AI 엔진" indicator: shows which Ollama model answers this wiki's
// AI buttons (glossary, core-function, translate, summaries, code
// generation, etc.), and lights up while any of those requests are
// in-flight, by wrapping window.fetch and matching known AI endpoint paths.
(function () {
  var dot = document.getElementById('ai-status-dot');
  var modelLabel = document.getElementById('ai-status-model');
  if (!dot || !modelLabel) return;

  var modelName = '';
  var inFlight = 0;

  var AI_PATH_SUFFIXES = [
    '/glossarize',
    '/core-function',
    '/translate',
    '/pdf-summary',
    '/resume-optimize',
    '/related-pages',
    '/youtube-summary',
    '/code-test',
    '/openframeworks-code',
    '/swift-code',
    '/make-video',
    '/rss-translate',
  ];

  function isAiRequest(url, method) {
    if ((method || 'GET').toUpperCase() !== 'POST') return false;
    var path;
    try {
      path = new URL(url, window.location.origin).pathname;
    } catch (e) {
      path = String(url);
    }
    return AI_PATH_SUFFIXES.some(function (suffix) {
      return path.indexOf(suffix) === path.length - suffix.length;
    });
  }

  function render() {
    if (inFlight > 0) {
      dot.classList.add('active');
      modelLabel.textContent = '작동 중 · ' + modelName;
    } else {
      dot.classList.remove('active');
      modelLabel.textContent = '대기 중 · ' + modelName;
    }
  }

  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
    var tracked = isAiRequest(url, method);

    if (tracked) {
      inFlight += 1;
      render();
    }

    var result = originalFetch.apply(this, arguments);
    if (tracked) {
      result.finally(function () {
        inFlight = Math.max(0, inFlight - 1);
        render();
      });
    }
    return result;
  };

  fetch('/api/ai-model')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      modelName = data.model || '알 수 없음';
      render();
    })
    .catch(function () {
      modelName = '알 수 없음';
      render();
    });
})();
