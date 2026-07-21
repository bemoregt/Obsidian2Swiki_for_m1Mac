(function () {
  var btn = document.getElementById('tts-btn');
  var select = document.getElementById('tts-voice-select');
  var body = document.querySelector('.page-body');
  if (!btn || !body) return;

  if (!('speechSynthesis' in window)) {
    btn.style.display = 'none';
    if (select) select.style.display = 'none';
    return;
  }

  var STORAGE_KEY = 'wikiTtsVoice';
  var koreanVoices = [];

  function scoreVoice(v) {
    var n = v.name.toLowerCase();
    if (n.indexOf('premium') !== -1 || n.indexOf('고급') !== -1 || n.indexOf('프리미엄') !== -1) return 3;
    if (n.indexOf('enhanced') !== -1 || n.indexOf('neural') !== -1) return 2;
    return 1;
  }

  function bestVoice() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      var match = koreanVoices.find(function (v) { return v.name === saved; });
      if (match) return match;
    }
    var sorted = koreanVoices.slice().sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
    return sorted[0] || null;
  }

  function populateVoices() {
    var all = window.speechSynthesis.getVoices();
    koreanVoices = all.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf('ko') === 0; });
    if (!select) return;

    if (koreanVoices.length <= 1) {
      select.style.display = 'none';
      return;
    }

    select.innerHTML = '';
    koreanVoices.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name;
      select.appendChild(opt);
    });
    var chosen = bestVoice();
    if (chosen) select.value = chosen.name;
    select.style.display = '';
  }

  populateVoices();
  if ('onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  if (select) {
    select.addEventListener('change', function () {
      localStorage.setItem(STORAGE_KEY, select.value);
    });
  }

  btn.addEventListener('click', function () {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      btn.textContent = '🔊';
      btn.classList.remove('speaking');
      return;
    }

    var text = body.innerText || body.textContent || '';
    if (!text.trim()) return;

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    var voice = select && select.value
      ? koreanVoices.find(function (v) { return v.name === select.value; })
      : bestVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = function () {
      btn.textContent = '🔊';
      btn.classList.remove('speaking');
    };
    utterance.onerror = function () {
      btn.textContent = '🔊';
      btn.classList.remove('speaking');
    };

    window.speechSynthesis.speak(utterance);
    btn.textContent = '⏹';
    btn.classList.add('speaking');
  });

  window.addEventListener('beforeunload', function () {
    window.speechSynthesis.cancel();
  });
})();
