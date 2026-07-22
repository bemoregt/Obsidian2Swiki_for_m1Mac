(function () {
  var STACK_KEY = 'wikiNavStack';
  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  function getStack() {
    try {
      var raw = sessionStorage.getItem(STACK_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function setStack(arr) {
    try {
      sessionStorage.setItem(STACK_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  // Clicking a link inside the page content is "going forward": remember the
  // page we're leaving so the destination can offer a way back to it. This is
  // a real stack (not a per-target "last parent" map), so A <-> B mutual
  // links can't turn the up-button into an infinite ping-pong loop - each
  // hop is pushed once and only popped when actually followed back.
  if (currentName) {
    document
      .querySelectorAll('.page-body a.wikilink, .page-body a.wikilink-new, table.calendar td a')
      .forEach(function (a) {
        a.addEventListener('click', function () {
          var m = a.getAttribute('href').match(/^\/(?:page|new)\/([^/?]+)/);
          if (!m) return;
          var targetName = decodeURIComponent(m[1]);
          if (targetName === currentName) return;
          var stack = getStack();
          stack.push(currentName);
          setStack(stack);
        });
      });
  }

  // Any other navigation (sidebar history/all-pages/help/brand) leaves the
  // current trail behind - start fresh rather than showing a stale "up".
  // Edit/view-mode switching for the SAME page is exempt: that round trip is
  // exactly what the stack needs to survive.
  document.querySelectorAll('.sidebar a').forEach(function (a) {
    if (a.closest('.page-mode-actions')) return;
    a.addEventListener('click', function () {
      setStack([]);
    });
  });

  var upBtn = document.getElementById('up-btn');
  if (!upBtn || !currentName) return;

  var stack = getStack();
  var parentName = stack.length ? stack[stack.length - 1] : null;

  if (!parentName && document.referrer) {
    try {
      var ref = new URL(document.referrer);
      if (ref.origin === location.origin) {
        var refMatch = ref.pathname.match(/^\/page\/([^/]+)$/);
        if (refMatch) parentName = decodeURIComponent(refMatch[1]);
      }
    } catch (e) {}
  }

  if (!parentName || parentName === currentName) return;

  upBtn.href = '/page/' + encodeURIComponent(parentName);
  upBtn.textContent = '↑ 상위 페이지 보기: ' + parentName;
  upBtn.style.display = '';
  upBtn.addEventListener('click', function () {
    // Consume this hop so the trail doesn't dangle behind after going back.
    var s = getStack();
    s.pop();
    setStack(s);
  });
})();
