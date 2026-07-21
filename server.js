const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const wiki = require('./lib/wiki');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(wiki.VAULT_DIR, '_uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const original = path.basename(file.originalname).replace(/[/\\]/g, '_');
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
const upload = multer({ storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024 } });

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
  res.redirect(`/page/${encodeURIComponent(name)}`);
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
