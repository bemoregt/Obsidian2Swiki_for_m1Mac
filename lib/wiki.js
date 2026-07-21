const fs = require('fs');
const path = require('path');
const hljs = require('highlight.js/lib/core');
hljs.registerLanguage('python', require('highlight.js/lib/languages/python'));

const VAULT_DIR = process.env.VAULT_PATH
  ? path.resolve(process.env.VAULT_PATH)
  : path.join(process.env.HOME, 'Documents', 'Jungok_Stone');

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Page names come from Express route params, which are already URL-decoded.
// Reject anything that could escape the vault directory.
function sanitizeName(name) {
  const base = path.basename(String(name || '').trim());
  if (!base || base === '.' || base === '..' || base.includes('/') || base.includes('\\')) {
    throw new Error(`Invalid page name: ${name}`);
  }
  return base;
}

function filePath(name) {
  return path.join(VAULT_DIR, sanitizeName(name) + '.md');
}

function listPages() {
  return fs
    .readdirSync(VAULT_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.slice(0, -3))
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

function listPagesWithMtime() {
  return fs
    .readdirSync(VAULT_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const stat = fs.statSync(path.join(VAULT_DIR, e.name));
      return { name: e.name.slice(0, -3), mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function pageExists(name) {
  try {
    return fs.existsSync(filePath(name));
  } catch {
    return false;
  }
}

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) return { frontmatter: m[0], body: raw.slice(m[0].length) };
  return { frontmatter: '', body: raw };
}

function readPage(name) {
  const raw = fs.readFileSync(filePath(name), 'utf8');
  return splitFrontmatter(raw);
}

function writePage(name, body) {
  let frontmatter = '';
  if (pageExists(name)) {
    frontmatter = splitFrontmatter(fs.readFileSync(filePath(name), 'utf8')).frontmatter;
  }
  fs.writeFileSync(filePath(name), frontmatter + body, 'utf8');
}

function createEmptyPage(name) {
  if (pageExists(name)) return;
  fs.writeFileSync(filePath(name), '', 'utf8');
}

// --- Squeak-style simple-tag rendering ---
// Convention for this wiki (distinct from standard Markdown):
//   *Some Page*     -> wiki link; creates the page on click if it doesn't exist yet
//   !text!          -> emphasis (italic)
//   `code`          -> inline code (Python-highlighted); <code>code</code> also works
//   ```             -> fenced code block, e.g. ```python ... ``` (defaults to python)
//   <code>          -> same as ```, if <code> and </code> each sit alone on their own line
//   # / ## / ###    -> headings (line must start with it)
//   - item          -> bullet list item (line must start with it)
//   <calendar>      -> swiki-style calendar; each day links to its YYYY-MM-DD page
//   ![alt](url)     -> uploaded image, shown inline
//   [name](url)     -> uploaded file, shown as a download link
//   blank line      -> paragraph break, single newline -> <br>

function highlightCode(code, lang) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'python';
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthWeeks(year, month) {
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = new Array(startDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function renderCalendar(yearMonthStr, existingPages) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  if (yearMonthStr && /^\d{4}-\d{2}$/.test(yearMonthStr)) {
    const [y, m] = yearMonthStr.split('-').map(Number);
    year = y;
    month = m - 1;
  }
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const prevYm = `${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}`;
  const nextYm = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;

  let html = '<table class="calendar">\n';
  html += `<caption><a class="cal-nav" href="?cal=${prevYm}">&laquo;</a> ${year}년 ${month + 1}월 <a class="cal-nav" href="?cal=${nextYm}">&raquo;</a></caption>\n`;
  html += '<thead><tr><th>일</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>토</th></tr></thead>\n<tbody>\n';
  for (const week of monthWeeks(year, month)) {
    html += '<tr>';
    for (const day of week) {
      if (day === null) {
        html += '<td></td>';
        continue;
      }
      const dateStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
      const exists = existingPages.has(dateStr);
      const classes = ['cal-day'];
      if (dateStr === todayStr) classes.push('cal-today');
      if (exists) classes.push('cal-exists');
      const href = `/${exists ? 'page' : 'new'}/${encodeURIComponent(dateStr)}`;
      html += `<td class="${classes.join(' ')}"><a href="${href}">${day}</a></td>`;
    }
    html += '</tr>\n';
  }
  html += '</tbody>\n</table>\n';
  return html;
}

// Placeholder markers used while shuffling tokens (links, code) through the
// escaping/formatting passes below. Plain text won't realistically contain
// these, so a naive string search-and-replace is safe.
function inline(rawText, existingPages) {
  // Keep both the raw code text (for building hrefs/exists-checks) and its
  // highlighted HTML (for display) - a link name that happens to contain a
  // code span must not have "@@CODE0@@" leak into the URL.
  const codeTokens = [];
  const resolveCode = (text, useHtml) =>
    text.replace(/@@CODE(\d+)@@/g, (_, idx) => {
      const tok = codeTokens[Number(idx)];
      return useHtml ? tok.html : tok.raw;
    });

  // Uploaded images/files: ![alt](url) shows an <img>, [label](url) is a download link.
  const imgTokens = [];
  let out = rawText.replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_, alt, url) => {
    const idx = imgTokens.length;
    imgTokens.push(`<img class="wiki-img" src="${escapeHtml(url.trim())}" alt="${escapeHtml(alt.trim())}">`);
    return `@@IMG${idx}@@`;
  });

  const fileTokens = [];
  out = out.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, url) => {
    const idx = fileTokens.length;
    fileTokens.push(`<a class="file-link" href="${escapeHtml(url.trim())}" download>\u{1F4CE} ${escapeHtml(label.trim())}</a>`);
    return `@@FILE${idx}@@`;
  });

  // Accept both `code` (backtick) and a literal <code>...</code> tag typed as
  // plain text - either way it becomes highlighted inline code.
  out = out.replace(/`([^`\n]+?)`|<code>([^<\n]*?)<\/code>/gi, (_, backtickCode, tagCode) => {
    const code = backtickCode !== undefined ? backtickCode : tagCode;
    const idx = codeTokens.length;
    codeTokens.push({ raw: code, html: `<code class="hljs-inline">${highlightCode(code, 'python')}</code>` });
    return `@@CODE${idx}@@`;
  });

  out = escapeHtml(out);

  const linkTokens = [];
  out = out.replace(/\*([^*\n]+?)\*/g, (_, name) => {
    const trimmed = name.trim();
    const plainName = resolveCode(trimmed, false);
    const displayName = resolveCode(trimmed, true);
    const exists = existingPages.has(plainName);
    const href = `/${exists ? 'page' : 'new'}/${encodeURIComponent(plainName)}`;
    const cls = exists ? 'wikilink' : 'wikilink-new';
    const label = exists ? displayName : displayName + '?';
    const idx = linkTokens.length;
    linkTokens.push(`<a class="${cls}" href="${href}">${label}</a>`);
    return `@@LINK${idx}@@`;
  });
  out = out.replace(/!([^!\n]+?)!/g, (_, em) => `<em>${em}</em>`);
  out = out.replace(/@@LINK(\d+)@@/g, (_, idx) => linkTokens[Number(idx)]);
  out = resolveCode(out, true);
  out = out.replace(/@@IMG(\d+)@@/g, (_, idx) => imgTokens[Number(idx)]);
  out = out.replace(/@@FILE(\d+)@@/g, (_, idx) => fileTokens[Number(idx)]);
  return out;
}

function renderBody(raw, existingPages, calOverride) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let paragraphBuf = [];
  let listBuf = [];
  let inCodeBlock = false;
  let codeBuf = [];
  let codeLang = 'python';
  let codeFlavor = null; // 'fence' (```) or 'tag' (<code> on its own line)

  const flushParagraph = () => {
    if (paragraphBuf.length) {
      html += `<p>${paragraphBuf.map((l) => inline(l, existingPages)).join('<br>\n')}</p>\n`;
      paragraphBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length) {
      html += `<ul>\n${listBuf
        .map((l) => `<li>${inline(l, existingPages)}</li>`)
        .join('\n')}\n</ul>\n`;
      listBuf = [];
    }
  };
  const flushCodeBlock = () => {
    html += `<pre class="hljs"><code class="language-${codeLang}">${highlightCode(codeBuf.join('\n'), codeLang)}</code></pre>\n`;
    codeBuf = [];
  };

  for (const line of lines) {
    if (inCodeBlock) {
      // Accept either </code> or a bare <code> line as the closer - people often
      // bookend a block with <code> on both ends and forget the closing slash.
      const closing =
        codeFlavor === 'tag'
          ? /^<\/code>\s*$/i.test(line.trim()) || /^<code>\s*$/i.test(line.trim())
          : /^```\s*$/.test(line.trim());
      if (closing) {
        flushCodeBlock();
        inCodeBlock = false;
        codeFlavor = null;
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    const tagFenceOpen = /^<code>\s*$/i.test(line.trim());

    if (fence) {
      flushParagraph();
      flushList();
      inCodeBlock = true;
      codeFlavor = 'fence';
      codeLang = fence[1] || 'python';
      continue;
    }

    if (tagFenceOpen) {
      flushParagraph();
      flushList();
      inCodeBlock = true;
      codeFlavor = 'tag';
      codeLang = 'python';
      continue;
    }

    const calendarTag = line.trim().match(/^<calendar(?::(\d{4}-\d{2}))?>$/i);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const listItem = line.match(/^-\s+(.*)$/);
    if (calendarTag) {
      flushParagraph();
      flushList();
      html += renderCalendar(calOverride || calendarTag[1], existingPages);
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html += `<h${level}>${inline(heading[2], existingPages)}</h${level}>\n`;
    } else if (listItem) {
      flushParagraph();
      listBuf.push(listItem[1]);
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphBuf.push(line);
    }
  }
  flushParagraph();
  flushList();
  if (inCodeBlock && codeBuf.length) flushCodeBlock();
  return html;
}

function render(name, calOverride) {
  const { body } = readPage(name);
  const existingPages = new Set(listPages());
  return renderBody(body, existingPages, calOverride);
}

module.exports = {
  VAULT_DIR,
  listPages,
  listPagesWithMtime,
  pageExists,
  readPage,
  writePage,
  createEmptyPage,
  render,
  renderBody,
  sanitizeName,
};
