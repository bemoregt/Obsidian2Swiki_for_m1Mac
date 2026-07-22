const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const multer = require('multer');
const wiki = require('./lib/wiki');
const ollama = require('./lib/ollama');

const app = express();

const TTS_PORT = 5005;
const ttsProcess = spawn(
  path.join(__dirname, 'tts_env', 'bin', 'python3'),
  [path.join(__dirname, 'tts', 'tts_server.py'), String(TTS_PORT)]
);
ttsProcess.stderr.on('data', (chunk) => process.stderr.write(`[tts] ${chunk}`));
ttsProcess.on('exit', (code) => console.log(`[tts] process exited (${code})`));
process.on('exit', () => ttsProcess.kill());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
  })
);

const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(wiki.VAULT_DIR, '_uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Busboy decodes multipart filenames as latin1 by default, but browsers
    // actually send them as raw UTF-8 bytes - re-decode to undo the mojibake.
    const utf8Name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const original = path.basename(utf8Name).replace(/[/\\]/g, '_');
    const ext = path.extname(original);
    const base = path.basename(original, ext) || 'file';
    let candidate = original;
    let i = 1;
    while (fs.existsSync(path.join(UPLOAD_DIR, candidate))) {
      candidate = `${base}-${i}${ext}`;
      i += 1;
    }
    cb(null, candidate);
  },
});
const upload = multer({ storage: uploadStorage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use('/uploads', express.static(UPLOAD_DIR));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const isImage = /^image\//.test(req.file.mimetype);
  res.json({
    url: `/uploads/${encodeURIComponent(req.file.filename)}`,
    filename: req.file.filename,
    isImage,
  });
});

app.get('/', (req, res) => {
  if (wiki.pageExists('index')) return res.redirect('/page/index');
  res.redirect('/pages');
});

app.get('/pages', (req, res) => {
  res.render('list', { pages: wiki.listPages() });
});

app.get('/changes', (req, res) => {
  res.render('changes', { pages: wiki.listPagesWithMtime() });
});

app.get('/help', (req, res) => {
  res.render('help', {});
});

app.post('/tts', express.text({ type: '*/*', limit: '200kb' }), (req, res) => {
  const text = (req.body || '').trim();
  if (!text) return res.status(400).end();

  const body = Buffer.from(text, 'utf8');
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: TTS_PORT,
      path: '/synthesize',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'audio/wav' });
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    console.error('[tts] proxy error', err.message);
    res.status(503).json({ error: 'tts server not ready' });
  });
  proxyReq.end(body);
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  let results = [];
  if (q) {
    const needle = q.toLowerCase();
    for (const name of wiki.listPages()) {
      const { body } = wiki.readPage(name);
      const idx = body.toLowerCase().indexOf(needle);
      if (name.toLowerCase().includes(needle) || idx !== -1) {
        const snippet = idx !== -1 ? body.slice(Math.max(0, idx - 30), idx + 60).trim() : '';
        results.push({ name, snippet });
      }
    }
  }
  res.render('search', { q, results });
});

app.get('/page/:name', (req, res) => {
  const { name } = req.params;
  if (!wiki.pageExists(name)) return res.redirect(`/new/${encodeURIComponent(name)}`);
  const html = wiki.render(name, req.query.cal);
  res.render('view', { name, html });
});

app.get('/page/:name/edit', (req, res) => {
  const { name } = req.params;
  const body = wiki.pageExists(name) ? wiki.readPage(name).body : '';
  res.render('edit', { name, body });
});

app.post('/page/:name', (req, res) => {
  const { name } = req.params;
  wiki.writePage(name, req.body.body || '');

  let finalName = name;
  const newTitle = (req.body.title || '').trim();
  if (newTitle && newTitle !== name) {
    wiki.renamePage(name, newTitle);
    finalName = newTitle;
  }

  res.redirect(`/page/${encodeURIComponent(finalName)}`);
});

// Used by the sidebar file upload widget when viewing (not editing) a page -
// there's no cursor to insert at, so the snippet goes at the very end.
app.post('/page/:name/append', (req, res) => {
  const { name } = req.params;
  const snippet = (req.body && req.body.snippet) || '';
  if (!snippet.trim()) return res.status(400).json({ error: 'no snippet' });

  const current = wiki.pageExists(name) ? wiki.readPage(name).body : '';
  const trimmed = current.replace(/\s+$/, '');
  const newBody = `${trimmed ? `${trimmed}\n\n` : ''}${snippet}\n`;
  wiki.writePage(name, newBody);
  res.json({ ok: true });
});

// "전문용어 페이지 만들기": for each selected foreign-word term, generate a
// short definition with a local Ollama (cloud) model if the term doesn't
// already have a page, then wrap its first occurrence in *term* link syntax.
app.post('/page/:name/glossarize', async (req, res) => {
  try {
    const { name } = req.params;
    const terms = Array.isArray(req.body.terms)
      ? req.body.terms.filter((t) => typeof t === 'string' && t.trim())
      : [];
    if (!terms.length) return res.status(400).json({ error: 'no terms' });
    if (!wiki.pageExists(name)) return res.status(404).json({ error: 'page not found' });

    const created = [];
    const failed = [];
    for (const term of terms) {
      if (wiki.pageExists(term)) continue;
      try {
        const definition = await ollama.defineTerm(term);
        wiki.writePage(term, definition || `(자동 설명 생성 실패: ${term})`);
        created.push(term);
      } catch (err) {
        console.error('[glossarize] failed for', term, err.message);
        failed.push(term);
      }
    }

    const current = wiki.readPage(name).body;
    const { body: linkedBody, linkedTerms } = wiki.linkTermsInBody(current, terms);
    wiki.writePage(name, linkedBody);

    res.json({ ok: true, created, failed, linked: linkedTerms });
  } catch (err) {
    console.error('[glossarize] error', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/new/:name', (req, res) => {
  const { name } = req.params;
  wiki.createEmptyPage(name);
  res.redirect(`/page/${encodeURIComponent(name)}/edit`);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(`<pre>${err.message}</pre>`);
});

app.listen(PORT, () => {
  console.log(`Squeak-style wiki running at http://localhost:${PORT}`);
  console.log(`Vault: ${wiki.VAULT_DIR}`);
});
