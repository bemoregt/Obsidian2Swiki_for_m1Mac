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

  function pushCurrent() {
    if (!currentName) return;
    var stack = getStack();
    stack.push(currentName);
    setStack(stack);
  }

  // Leaving this page - whether by clicking a wiki-link/calendar day inside
  // the content, or by using a sidebar tool (히스토리/모든 페이지/검색/도움말) -
  // remembers this page so whatever page you land on can offer a way back to
  // it. This is a real stack (not a per-target "last parent" map), so A <-> B
  // mutual links can't turn the up-button into an infinite ping-pong loop -
  // each hop is pushed once and only popped when actually followed back.
  // Edit/view-mode switching for the SAME page is exempt: that round trip
  // must not push this page as its own parent.
  document.querySelectorAll('.page-body a.wikilink, .page-body a.wikilink-new, table.calendar td a').forEach(function (a) {
    a.addEventListener('click', function () {
      var m = a.getAttribute('href').match(/^\/(?:page|new)\/([^/?]+)/);
      if (!m) return;
      var targetName = decodeURIComponent(m[1]);
      if (targetName === currentName) return;
      pushCurrent();
    });
  });

  document.querySelectorAll('.sidebar a').forEach(function (a) {
    if (a.closest('.page-mode-actions')) return;
    a.addEventListener('click', pushCurrent);
  });

  var searchForm = document.querySelector('.side-section form[action="/search"]');
  if (searchForm) searchForm.addEventListener('submit', pushCurrent);

  // Fallback for when sessionStorage has nothing (e.g. opened in a new tab):
  // only a genuine wiki-page referrer counts as a parent page.
  function parentFromReferrer() {
    if (!document.referrer) return null;
    try {
      var ref = new URL(document.referrer);
      if (ref.origin !== location.origin) return null;
      var pageMatch = ref.pathname.match(/^\/page\/([^/]+)$/);
      if (!pageMatch) return null;
      var name = decodeURIComponent(pageMatch[1]);
      return name === currentName ? null : name;
    } catch (e) {
      return null;
    }
  }

  var upBtn = document.getElementById('up-btn');
  if (!upBtn || !currentName) return;

  var stack = getStack();
  var parentName = stack.length ? stack[stack.length - 1] : null;
  var poppable = Boolean(parentName && parentName !== currentName);
  if (!poppable) parentName = parentFromReferrer();

  if (!parentName || parentName === currentName) return;

  upBtn.href = '/page/' + encodeURIComponent(parentName);
  upBtn.textContent = '↑ 상위 페이지 보기: ' + parentName;
  upBtn.style.display = '';
  upBtn.addEventListener('click', function () {
    if (!poppable) return;
    // Consume this hop so the trail doesn't dangle behind after going back.
    var s = getStack();
    s.pop();
    setStack(s);
  });
})();
