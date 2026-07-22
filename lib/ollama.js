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

module.exports = { defineTerm };
