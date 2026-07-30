function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellSourceText(cell) {
  const src = cell.source;
  return Array.isArray(src) ? src.join('') : src || '';
}

function outputsToHtml(outputs) {
  return (outputs || [])
    .map((o) => {
      if (o.output_type === 'stream') {
        const text = Array.isArray(o.text) ? o.text.join('') : o.text || '';
        const cls = o.name === 'stderr' ? 'ipynb-stream ipynb-stderr' : 'ipynb-stream';
        return `<pre class="${cls}">${escapeHtml(text)}</pre>`;
      }
      if (o.output_type === 'error') {
        const tb = Array.isArray(o.traceback) ? o.traceback.join('\n') : String(o.traceback || '');
        return `<pre class="ipynb-error">${escapeHtml(tb)}</pre>`;
      }
      if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
        const data = o.data || {};
        const text = Array.isArray(data['text/plain']) ? data['text/plain'].join('') : data['text/plain'];
        if (text) return `<pre class="ipynb-result">${escapeHtml(text)}</pre>`;
      }
      return '';
    })
    .join('');
}

// Renders a notebook object (nbformat-4, whether built by this feature or
// any other .ipynb someone attaches directly) as an inline, *editable*
// Jupyter-style view - In[n]/Out[n] prompts and each code cell's real
// captured output, with the source shown in a plain <textarea> rather than
// read-only highlighted code, so it can be edited in place before running.
// Each code cell gets a "▶ 실행" button and a `data-cell-index` matching its
// position among code cells (0-based) - public/tonotebook.js reads the
// textarea's *current* value (not necessarily the original source) and
// POSTs it to /page/:name/notebook/run-cell, which also makes that edit the
// cell's new persisted source going forward.
function renderNotebookHtml(nb) {
  const parts = ['<div class="ipynb-viewer">'];
  let codeIndex = 0;

  for (const cell of nb.cells || []) {
    if (cell.cell_type === 'markdown') {
      parts.push(`<div class="ipynb-md-cell">${escapeHtml(cellSourceText(cell))}</div>`);
      continue;
    }
    if (cell.cell_type !== 'code') continue;

    const idx = codeIndex;
    codeIndex += 1;
    const source = cellSourceText(cell);
    const count = cell.execution_count != null ? cell.execution_count : ' ';
    const outHtml = outputsToHtml(cell.outputs);
    const rows = Math.min(Math.max(source.split('\n').length, 1), 25);

    parts.push(`<div class="ipynb-cell" data-cell-index="${idx}">`);
    parts.push(
      `<div class="ipynb-input"><span class="ipynb-prompt ipynb-in-prompt">In&nbsp;[${count}]:</span>` +
        `<button type="button" class="ipynb-run-btn" data-cell-index="${idx}">▶ 실행</button>` +
        `<textarea class="ipynb-editor" data-cell-index="${idx}" rows="${rows}" spellcheck="false">${escapeHtml(source)}</textarea></div>`
    );
    parts.push(
      `<div class="ipynb-output"${outHtml ? '' : ' style="display:none"'}>` +
        `<span class="ipynb-prompt">Out[${count}]:</span>${outHtml}</div>`
    );
    parts.push('</div>');
  }

  parts.push('</div>');
  return parts.join('\n');
}

// Splits a flat Python script into a list of cell source strings. No AST
// parsing or code rewriting happens here - the exact source text is
// preserved, just cut at boundaries, so nothing about the script's actual
// behavior can change in the process.
//
// Preferred boundary: a top-level comment that looks like a numbered
// section header ("# 1. ...", "# 2) ..."), since that's a common style for
// tutorial/demo scripts (and matches what a human would naturally paste
// into separate notebook cells by hand). Falls back to splitting on runs of
// 2+ blank lines between top-level statements when no such headers exist.
// A script with neither ends up as a single cell - still valid, just not
// subdivided.
function parseCodeIntoCells(code) {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const sectionHeaderRe = /^#\s*\d+[.)]\s+\S/;

  const headerIndexes = [];
  lines.forEach((line, i) => {
    if (sectionHeaderRe.test(line)) headerIndexes.push(i);
  });

  let chunks;
  if (headerIndexes.length > 0) {
    chunks = [];
    let start = 0;
    for (const idx of headerIndexes) {
      if (idx > start) chunks.push(lines.slice(start, idx).join('\n'));
      start = idx;
    }
    chunks.push(lines.slice(start).join('\n'));
  } else {
    // Fall back to blank-line-run boundaries between top-level (non-indented)
    // statements - indented blank lines inside a function body don't count,
    // so a function definition never gets split down the middle.
    chunks = [];
    let current = [];
    let blankRun = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isBlank = line.trim() === '';
      const nextNonBlank = lines.slice(i + 1).find((l) => l.trim() !== '');
      const atTopLevelBoundary = nextNonBlank !== undefined && /^\S/.test(nextNonBlank);

      current.push(line);
      if (isBlank) {
        blankRun += 1;
      } else {
        blankRun = 0;
      }
      if (blankRun >= 2 && atTopLevelBoundary) {
        chunks.push(current.join('\n'));
        current = [];
        blankRun = 0;
      }
    }
    if (current.length) chunks.push(current.join('\n'));
  }

  return chunks
    .map((c) => c.replace(/^\n+/, '').replace(/\n+$/, ''))
    .filter((c) => c.trim() !== '');
}

// Builds a plain nbformat-4.5 notebook object by hand (no nbformat package
// installed in this environment - the format is just documented JSON, so
// there's nothing a library adds here beyond validation) from a page's
// current cell-state list: `[{ source, execution_count, outputs }, ...]`.
// A markdown title cell is prepended so the notebook is self-identifying
// when opened outside the wiki.
function buildNotebookJson(pageTitle, cellStates) {
  const cells = [
    { cell_type: 'markdown', metadata: {}, source: [`# ${pageTitle}`] },
    ...cellStates.map((c) => ({
      cell_type: 'code',
      execution_count: c.execution_count != null ? c.execution_count : null,
      metadata: {},
      outputs: c.outputs || [],
      source: c.source.split('\n').map((l, i, arr) => (i < arr.length - 1 ? `${l}\n` : l)),
    })),
  ];

  return {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', pygments_lexer: 'ipython3' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

module.exports = { parseCodeIntoCells, buildNotebookJson, renderNotebookHtml };
