(function () {
  if (typeof katex === 'undefined') return;
  document.querySelectorAll('[data-katex]').forEach(function (el) {
    var expr = el.getAttribute('data-katex');
    var displayMode = el.tagName === 'DIV';
    try {
      katex.render(expr, el, { throwOnError: false, displayMode: displayMode });
    } catch (e) {
      el.textContent = expr;
    }
  });
})();
