const ARXIV_API_URL = 'http://export.arxiv.org/api/query';

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// arXiv IDs can contain a slash (old-style category-prefixed IDs like
// "cond-mat/9901001v1"), which is unsafe to drop straight into a filename -
// this collapses anything but the safe filename characters to "_".
function sanitizeArxivId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_');
}

function parseEntry(entryXml) {
  const idMatch = entryXml.match(/<id>([^<]*)<\/id>/);
  const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
  const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
  const publishedMatch = entryXml.match(/<published>([^<]*)<\/published>/);
  if (!idMatch || !titleMatch || !publishedMatch) return null;

  // <link .../> tags are self-closing and unordered - find the one tagged as
  // the PDF variant rather than assuming a fixed attribute order/position.
  const linkTags = [...entryXml.matchAll(/<link\b[^>]*\/>/g)].map((m) => m[0]);
  const pdfTag = linkTags.find((t) => /title="pdf"/.test(t));
  const pdfHrefMatch = pdfTag && pdfTag.match(/href="([^"]+)"/);

  const absUrl = idMatch[1].trim();
  const idPart = absUrl.match(/abs\/(.+)$/);
  const arxivId = idPart ? idPart[1] : absUrl;

  const authors = [...entryXml.matchAll(/<author>\s*<name>([^<]*)<\/name>/g)]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter((a) => a && a !== ':');

  return {
    arxivId,
    title: decodeXmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim(),
    summary: summaryMatch ? decodeXmlEntities(summaryMatch[1]).replace(/\s+/g, ' ').trim() : '',
    authors,
    published: publishedMatch[1].trim(),
    absUrl,
    pdfUrl: pdfHrefMatch ? pdfHrefMatch[1] : `https://arxiv.org/pdf/${arxivId}`,
  };
}

// Searches arXiv for `keyword`, newest first, keeping only papers submitted
// within the last `periodKey` ('week' = 7 days, otherwise 30 days). arXiv's
// query API has no server-side date-range filter, so this fetches a batch
// sorted by submission date and filters client-side - a "what's new" digest,
// not an exhaustive literature search.
async function searchRecent(keyword, { periodKey = 'month', maxResults = 5, fetchBatch = 30 } = {}) {
  const cutoffDays = periodKey === 'week' ? 7 : 30;
  const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;

  // Quoting a multi-word keyword as an exact phrase matters a lot here -
  // arXiv's query parser otherwise treats "diffusion model" as loosely
  // matching either word anywhere, which (sorted purely by recency) surfaces
  // mostly unrelated recent papers that just happen to contain "model".
  const phrase = keyword.replace(/"/g, '').trim();
  const q = encodeURIComponent(`all:"${phrase}"`);
  const url = `${ARXIV_API_URL}?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=${fetchBatch}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv API 요청 실패: ${res.status}`);
  const xml = await res.text();

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const papers = [];
  for (const entryXml of entries) {
    const paper = parseEntry(entryXml);
    if (!paper) continue;
    if (new Date(paper.published).getTime() < cutoff) continue;
    papers.push(paper);
    if (papers.length >= maxResults) break;
  }
  return papers;
}

async function downloadPdf(pdfUrl) {
  const res = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; obsidian-squeak-wiki)' } });
  if (!res.ok) throw new Error(`PDF 다운로드 실패: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('다운로드된 PDF가 비정상적으로 작습니다.');
  return buf;
}

module.exports = { searchRecent, downloadPdf, sanitizeArxivId };
