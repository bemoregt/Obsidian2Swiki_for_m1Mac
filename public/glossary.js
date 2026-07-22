(function () {
  var btn = document.getElementById('glossary-btn');
  var panel = document.getElementById('glossary-panel');
  var list = document.getElementById('glossary-list');
  var generateBtn = document.getElementById('glossary-generate');
  var cancelBtn = document.getElementById('glossary-cancel');
  var status = document.getElementById('glossary-status');
  var body = document.querySelector('.page-body');
  if (!btn || !panel || !body) return;

  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  var STOPWORDS = [
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'of', 'in', 'on', 'at', 'to', 'for', 'with', 'as', 'by', 'from',
    'this', 'that', 'these', 'those', 'it', 'its', 'and', 'or', 'but',
    'if', 'then', 'else', 'not', 'no', 'yes', 'you', 'your', 'we', 'our',
    'i', 'my', 'he', 'she', 'they', 'them', 'his', 'her', 'their',
    'so', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'than', 'also', 'very',
    'just', 'more', 'most', 'some', 'any', 'all', 'each', 'other',
    'such', 'only', 'own', 'same', 'too', 'again',
  ];

  function isStopword(text) {
    return STOPWORDS.indexOf(text.toLowerCase()) !== -1;
  }

  // Adjacent foreign-word spans separated by nothing but a single space are
  // merged into one compound term (e.g. "Vision" + "Transformer" ->
  // "Vision Transformer", but also lowercase runs like "self attention").
  // The chain breaks at a stopword ("the", "is", ...) so ordinary sentences
  // don't get swallowed into one giant "term" - just real multi-word terms.
  function collectTerms() {
    var spans = Array.prototype.slice.call(body.querySelectorAll('.foreign-word'));
    var used = spans.map(function () { return false; });
    var seen = {};
    var terms = [];

    spans.forEach(function (span, i) {
      if (used[i]) return;
      used[i] = true;
      var words = [span.textContent.trim()];

      var cursor = span;
      if (!isStopword(words[0])) {
        for (;;) {
          var gap = cursor.nextSibling;
          if (!gap || gap.nodeType !== Node.TEXT_NODE || !/^ $/.test(gap.textContent)) break;
          var next = gap.nextSibling;
          if (!next || next.nodeType !== Node.ELEMENT_NODE || !next.classList.contains('foreign-word')) break;
          var nextText = next.textContent.trim();
          if (isStopword(nextText)) break;
          var nextIdx = spans.indexOf(next);
          if (nextIdx === -1 || used[nextIdx]) break;
          words.push(nextText);
          used[nextIdx] = true;
          cursor = next;
        }
      }

      var text = words.join(' ');
      if (!text) return;
      var key = text.toLowerCase();
      if (words.length === 1 && isStopword(words[0])) return;
      if (seen[key]) return;
      seen[key] = true;
      terms.push(text);
    });

    return terms;
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  btn.addEventListener('click', function () {
    var terms = collectTerms();
    if (!terms.length) {
      panel.style.display = '';
      list.innerHTML = '<p class="glossary-hint">이 페이지에는 전문용어로 보이는 파란색 단어가 없습니다.</p>';
      generateBtn.style.display = 'none';
      return;
    }
    generateBtn.style.display = '';
    list.innerHTML = '';
    terms.forEach(function (term) {
      var label = document.createElement('label');
      label.className = 'glossary-item';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = term;
      checkbox.checked = true;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' ' + term));
      list.appendChild(label);
    });
    setStatus('');
    panel.style.display = '';
  });

  cancelBtn.addEventListener('click', function () {
    panel.style.display = 'none';
  });

  generateBtn.addEventListener('click', function () {
    if (!currentName) return;
    var checked = Array.prototype.slice
      .call(list.querySelectorAll('input[type=checkbox]:checked'))
      .map(function (c) { return c.value; });
    if (!checked.length) {
      setStatus('선택된 단어가 없습니다.');
      return;
    }

    generateBtn.disabled = true;
    cancelBtn.disabled = true;
    setStatus('생성 중입니다... (' + checked.length + '개 단어, 새 페이지는 AI가 설명을 채웁니다)');

    fetch('/page/' + encodeURIComponent(currentName) + '/glossarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms: checked }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('glossarize failed');
        return r.json();
      })
      .then(function () {
        location.reload();
      })
      .catch(function () {
        setStatus('생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        generateBtn.disabled = false;
        cancelBtn.disabled = false;
      });
  });
})();
