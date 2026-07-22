const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:cloud';

async function defineTerm(term) {
  const prompt =
    `"${term}"이라는 용어를 위키 문서에 넣을 짧은 설명으로 써줘. ` +
    '3~5문장 정도의 한국어 평문으로, 마크다운 기호(#, *, `, - 등) 없이 순수 텍스트로만 답해. ' +
    '이 위키는 딥러닝/컴퓨터비전 등 기술 문서가 많으니, 그 분야 용어라면 그 맥락으로 설명해줘.';

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  return (data.response || '').trim();
}

// Generates a YouTube title + description for a page's slideshow video, from
// the wiki page text and the attached PDF's extracted text.
async function generateYoutubeMeta(pageTitle, context) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"의 내용과, 여기 첨부된 PDF에서 뽑은 텍스트야. ` +
    '이 내용을 소개하는 유튜브 영상에 쓸 제목과 설명을 만들어줘. ' +
    '아래 형식 그대로, 다른 말 없이 정확히 두 줄로만 답해:\n' +
    '제목: (한 줄, 60자 이내, 흥미를 끌 만한 한국어 제목)\n' +
    '설명: (2~4문장, 영상 내용을 요약하는 한국어 설명)\n\n' +
    `--- 문서 내용 ---\n${context}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const titleMatch = text.match(/제목\s*[:：]\s*(.+)/);
  const descMatch = text.match(/설명\s*[:：]\s*([\s\S]+)/);
  return {
    title: titleMatch ? titleMatch[1].trim() : pageTitle,
    description: descMatch ? descMatch[1].trim() : text,
  };
}

module.exports = { defineTerm, generateYoutubeMeta };
