document.querySelectorAll('.tagbar button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var ta = document.getElementById('editor');
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var wrap = btn.getAttribute('data-wrap');
    var linePrefix = btn.getAttribute('data-line');

    if (wrap) {
      var selected = value.slice(start, end) || '텍스트';
      var inserted = wrap + selected + wrap;
      ta.value = value.slice(0, start) + inserted + value.slice(end);
      ta.selectionStart = start + wrap.length;
      ta.selectionEnd = start + wrap.length + selected.length;
    } else if (linePrefix) {
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      ta.value = value.slice(0, lineStart) + linePrefix + value.slice(lineStart);
      ta.selectionStart = ta.selectionEnd = start + linePrefix.length;
    }
    ta.focus();
  });
});
