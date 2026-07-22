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

// Picks exactly `count` essential functions for implementing whatever
// algorithm/concept the page describes, each one fully working (not a
// skeleton), and returns { code, explanation } for each - `explanation` is a
// one-line description meant to sit right under that function's code block.
async function generateCoreFunctions(pageTitle, pageBody, count = 3) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"의 내용이야. ` +
    '이 문서가 설명하는 알고리즘이나 개념을 실제로 동작하는 코드로 완전히 구현하려고 해. ' +
    `이 구현을 정확히 ${count}개의 함수로 나눠서 각각 파이썬으로 작성해줘 (내용이 단순해 보여도 반드시 ${count}개로 나눠라 - 예를 들어 핵심 계산 함수, 그 계산을 반복/적용하는 함수, 전체를 실행하는 함수처럼 역할을 나누면 돼). ` +
    '조건: ' +
    '1) 문서에 설명된 로직을 뼈대만 만들지 말고, 설명된 내용을 실제로 전부 동작하도록 구현해 (pass, TODO, "...생략..." 같은 자리표시자 금지). ' +
    `2) 함수는 정확히 ${count}개여야 하고, 서로 실제로 호출하며 이어지는 하나의 구현이 되게 해 (의미 없이 쪼개지 말고, 각자 뚜렷한 역할이 있어야 해). ` +
    '3) 꼭 필요한 경우에만 import를 써. ' +
    `4) 함수마다 아래 형식을 정확히 지켜서, 다른 설명 문장 없이 이 형식만 ${count}번 반복해서 답해:\n` +
    '```python\n(코드)\n```\n' +
    '설명: (그 함수가 하는 일을 한 줄로, 마크다운 기호 없이 평문으로)\n\n' +
    `--- 문서 내용 ---\n${pageBody}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const pairs = [...text.matchAll(/```(?:python)?\s*\n([\s\S]*?)```\s*설명\s*[:：]\s*(.+)/gi)]
    .map((m) => ({ code: m[1].trim(), explanation: m[2].trim() }))
    .filter((f) => f.code);

  let functions = pairs.slice(0, count);
  if (!functions.length) {
    // Model didn't follow the code+설명 pairing - fall back to code-only blocks.
    functions = [...text.matchAll(/```(?:python)?\s*\n([\s\S]*?)```/gi)]
      .map((m) => ({ code: m[1].trim(), explanation: '' }))
      .filter((f) => f.code)
      .slice(0, count);
  }
  if (!functions.length) throw new Error('핵심 함수 코드를 생성하지 못했습니다.');
  return functions;
}

// Draws a Mermaid flowchart of the overall algorithm's execution order, with
// the given function names placed at the step(s) where they're actually
// called, so the reader can see where each core function fits in the whole.
// The nodes for those steps are then deterministically highlighted (not left
// to the model to style correctly).
async function generateFlowDiagram(pageTitle, pageBody, funcNames) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"의 내용이고, 이 알고리즘을 구현하기 위해 고른 핵심 함수들이야: ${funcNames.join(', ')}. ` +
    '이 알고리즘이 처음부터 끝까지 실행되는 전체 순서를 Mermaid 플로우차트(flowchart TD)로 그려줘. ' +
    '조건: ' +
    `1) 위 함수들이 실제로 호출되는 단계는 반드시 노드로 넣고, 그 노드의 ID를 함수 이름과 정확히 똑같은 글자로 써라 (예를 들어 ${funcNames[0]} 함수가 호출되는 단계면 노드를 ${funcNames[0]}[${funcNames[0]} 설명] 처럼 적어라 - 괄호 앞 식별자가 함수 이름과 한 글자도 달라선 안 돼). ` +
    '2) 함수 호출과 무관한 단계(데이터 준비, 반복 조건 판단, 종료 등)의 노드는 함수 이름과 겹치지 않는 다른 ID를 써라. ' +
    '3) 다른 설명 문장 없이 mermaid 코드블록만 답해 (```mermaid ... ```).\n\n' +
    `--- 문서 내용 ---\n${pageBody}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const fenced = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/i);
  let diagram = (fenced ? fenced[1] : text).trim();
  if (!diagram) throw new Error('흐름도를 생성하지 못했습니다.');

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const present = funcNames.filter((n) => new RegExp(`(^|\\s)${escapeRe(n)}[[({]`).test(diagram));
  if (present.length) {
    diagram +=
      '\n\n    classDef corefunc fill:#ffd43b,stroke:#e8590c,stroke-width:3px,color:#000;\n' +
      `    class ${present.join(',')} corefunc;`;
  }

  return diagram;
}

module.exports = { defineTerm, generateYoutubeMeta, generateCoreFunctions, generateFlowDiagram };
