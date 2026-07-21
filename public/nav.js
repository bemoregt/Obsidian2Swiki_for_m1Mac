(function () {
  var currentMatch = location.pathname.match(/^\/page\/([^/]+)$/);
  var currentName = currentMatch ? decodeURIComponent(currentMatch[1]) : null;

  // Remember which page a wiki-link click came from, keyed by the target page name.
  // This survives the /new -> edit -> save round trip, which otherwise breaks
  // document.referrer (the save is a fresh form submission from the edit page,
  // not a navigation from the original parent page).
  document.querySelectorAll('.page-body a.wikilink, .page-body a.wikilink-new, table.calendar td a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (!currentName) return;
      var m = a.getAttribute('href').match(/^\/(?:page|new)\/([^/?]+)/);
      if (!m) return;
      var targetName = decodeURIComponent(m[1]);
      if (targetName === currentName) return;
      try {
        sessionStorage.setItem('wikiParentFor:' + targetName, currentName);
      } catch (e) {}
    });
  });

  var upBtn = document.getElementById('up-btn');
  if (!upBtn || !currentName) return;

  var parentName = null;
  try {
    parentName = sessionStorage.getItem('wikiParentFor:' + currentName);
  } catch (e) {}

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
})();
