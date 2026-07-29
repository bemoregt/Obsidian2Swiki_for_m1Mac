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

// Translates a short piece of text (the video title or description pulled
// out of a page) into English, steering clear of this wiki's own tag
// characters (*, !) so the result can't accidentally turn into a bogus link
// or emphasis run once it's appended back into the page.
async function translateToEnglish(pageTitle, text) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"에 첨부된 동영상의 제목 또는 설명 텍스트야. 이 텍스트를 자연스러운 영어로 번역해줘. ` +
    '조건: ' +
    '1) 별표(*)나 느낌표(!)로 단어를 감싸지 마라 (이 위키에서 링크/강조 문법으로 해석된다). ' +
    '2) 다른 설명이나 인사말 없이, 번역된 문장만 답해.\n\n' +
    `--- 원문 ---\n${text}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const translated = (data.response || '').trim();
  if (!translated) throw new Error('번역 결과가 비어 있습니다.');
  return translated;
}

// Batch-translates a list of { title, snippet } items (RSS feed entries)
// into Korean in a single request, rather than one call per item. Each
// field is asked to stay on one line so the reply can be parsed line by
// line; a sparse array is returned (missing indices just mean the model
// dropped that item, and the caller should keep the original text for it).
async function translateFeedItemsToKorean(items) {
  const numbered = items
    .map((it, i) => `${i + 1}. 제목: ${it.title || ''}\n   요약: ${it.snippet || '(없음)'}`)
    .join('\n');
  const prompt =
    `다음은 RSS 피드에서 가져온 뉴스 항목 ${items.length}개야. 각 항목의 "제목"과 "요약"을 자연스러운 한국어로 번역해줘. ` +
    '조건: ' +
    '1) 이미 한국어인 항목도 자연스럽게 다듬어서 같이 답해라. ' +
    '2) 별표(*)나 느낌표(!)로 단어를 감싸지 마라 (이 위키에서 링크/강조 문법으로 해석된다). ' +
    '3) 제목과 요약은 각각 줄바꿈 없이 한 줄로 써라. ' +
    `4) 아래와 정확히 같은 형식으로, 번호를 원문과 동일하게 ${items.length}개 그대로 유지해서 답해 (다른 설명 없이):\n` +
    '1. 제목: (번역된 제목)\n   요약: (번역된 요약)\n2. 제목: (번역된 제목)\n   요약: (번역된 요약)\n\n' +
    `--- 원문 ---\n${numbered}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const results = [];
  let currentIdx = null;
  for (const line of text.split('\n')) {
    const titleMatch = line.match(/^\s*(\d+)\.\s*제목\s*[:：]\s*(.+)$/);
    const snippetMatch = line.match(/^\s*요약\s*[:：]\s*(.+)$/);
    if (titleMatch) {
      currentIdx = Number(titleMatch[1]) - 1;
      results[currentIdx] = { title: titleMatch[2].trim(), snippet: '' };
    } else if (snippetMatch && currentIdx !== null && results[currentIdx]) {
      results[currentIdx].snippet = snippetMatch[1].trim();
    }
  }
  if (!results.some(Boolean)) throw new Error('번역 결과를 해석하지 못했습니다.');
  return results;
}

// Summarizes an attached paper's extracted PDF text into three fixed
// Korean sections (핵심 기여/방법론/실험 결과) rather than a free-form
// summary, so the result is consistently structured no matter what shape
// the source paper takes.
async function summarizePaper(pageTitle, pdfText) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"에 첨부된 논문 PDF에서 추출한 텍스트야. 이 논문을 한국어로 구조화해서 요약해줘. ` +
    '조건: ' +
    '1) 반드시 "핵심 기여", "방법론", "실험 결과" 이 세 항목으로만 나눠서 답해라. ' +
    '2) 각 항목은 2~4문장의 자연스러운 한국어 평문으로, 줄바꿈 없이 한 줄로 써라. ' +
    '3) 별표(*)나 느낌표(!)로 단어를 감싸지 마라 (이 위키에서 링크/강조 문법으로 해석된다). ' +
    '4) 다른 설명이나 인사말 없이, 아래 형식 그대로 정확히 답해:\n' +
    '핵심 기여: (내용)\n방법론: (내용)\n실험 결과: (내용)\n\n' +
    `--- 논문 텍스트 ---\n${pdfText}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const contribution = text.match(/핵심\s*기여\s*[:：]\s*([\s\S]*?)(?=\n\s*방법론\s*[:：]|$)/);
  const methodology = text.match(/방법론\s*[:：]\s*([\s\S]*?)(?=\n\s*실험\s*결과\s*[:：]|$)/);
  const results = text.match(/실험\s*결과\s*[:：]\s*([\s\S]*)$/);
  const summary = {
    contribution: contribution ? contribution[1].trim() : '',
    methodology: methodology ? methodology[1].trim() : '',
    results: results ? results[1].trim() : '',
  };
  if (!summary.contribution && !summary.methodology && !summary.results) {
    throw new Error('논문 요약 결과를 해석하지 못했습니다.');
  }
  return summary;
}

// One-line "why are these related" explanation for the related-pages
// recommendation feature. The candidate pages themselves come from the real
// link graph (lib/wiki.js's findRelatedPages), never from the model - this
// only asks Ollama to explain a connection that's already established,
// rather than to invent one.
async function explainRelation(currentTitle, currentExcerpt, relatedTitle, relatedExcerpt) {
  const prompt =
    `다음은 위키의 두 문서에서 뽑은 내용 일부야. 이 두 문서 "${currentTitle}"과 "${relatedTitle}"가 ` +
    '왜 서로 관련 있는지 한국어로 한 문장만 설명해줘. ' +
    '조건: ' +
    '1) 20~60자 정도의 한 문장으로, 마크다운이나 위키 기호(#, *, `, - 등) 없이 순수 텍스트로만 답해라. ' +
    '2) 다른 설명이나 인사말 없이 그 한 문장만 답해라.\n\n' +
    `--- 문서 A: "${currentTitle}" ---\n${currentExcerpt}\n\n--- 문서 B: "${relatedTitle}" ---\n${relatedExcerpt}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  return (data.response || '').trim().replace(/\s+/g, ' ');
}

// Summarizes an attached YouTube video from its caption/transcript text
// (the model can't watch the video itself - the transcript, fetched
// separately via lib/youtube.js, is the only actual video content it sees).
async function summarizeYoutubeVideo(pageTitle, videoTitle, transcript) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"에 첨부된 유튜브 영상 "${videoTitle}"의 자막(자동 생성 자막 포함) 텍스트야. ` +
    '이 영상 내용을 한국어로 요약해줘. ' +
    '조건: ' +
    '1) 먼저 "요약:" 뒤에 2~4문장의 자연스러운 한국어 평문 요약을 줄바꿈 없이 한 줄로 써라. ' +
    '2) 그다음 "핵심 포인트:" 를 쓰고, 그 아래 줄부터 이 영상의 핵심 내용을 3~5개의 "- " 로 시작하는 목록으로 써라 (각 항목은 한 줄, 20~50자 정도). ' +
    '3) 별표(*)나 느낌표(!)로 단어를 감싸지 마라 (이 위키에서 링크/강조 문법으로 해석된다). ' +
    '4) 다른 설명이나 인사말 없이, 위 형식 그대로만 답해.\n\n' +
    `--- 자막 텍스트 ---\n${transcript}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const summaryMatch = text.match(/요약\s*[:：]\s*(.+)/);
  const pointsMatch = text.match(/핵심\s*포인트\s*[:：]\s*([\s\S]*)$/);
  const points = pointsMatch ? [...pointsMatch[1].matchAll(/^-\s*(.+)$/gm)].map((m) => m[1].trim()) : [];
  const summary = summaryMatch ? summaryMatch[1].trim() : '';

  if (!summary && !points.length) throw new Error('영상 요약 결과를 해석하지 못했습니다.');
  return { summary, points };
}

// Generates the ONE function this page's algorithm needs to actually run,
// for the "코드로 테스트하기" feature, plus a schema for any tunable
// parameters (thresholds, kernel sizes, filter modes, ...) so the page can
// expose them as live slider/dropdown controls. Deliberately asks for a
// single function with keyword parameters (not a whole script) so the
// caller (server.js) controls the entry point/CLI args itself - the model
// only ever supplies the algorithm body and what its own tunable inputs
// are, never how it's invoked.
//
// The page's own content decides the modality, not what happens to be
// attached: a document describing a spectrogram/phase/filtering algorithm
// gets process_audio(...) even if an image also happens to be on the page,
// and vice versa. server.js is responsible for then finding the matching
// attachment and erroring out if it isn't there.
async function generateImageProcessingCode(pageTitle, pageBody) {
  const prompt =
    `다음은 위키 문서 "${pageTitle}"의 내용이야. 이 문서가 설명하는 알고리즘을 실제로 동작하는 파이썬 코드로 구현하려고 해. ` +
    '조건: ' +
    '1) 먼저, 이 알고리즘이 근본적으로 다루는 데이터가 이미지인지 오디오인지, 그리고 그 결과를 보여주기에 가장 적절한 형태가 이미지인지 오디오인지 판단해서 아래 JSON으로 답해줘. ' +
    '(예: 스펙트로그램·위상·주파수 필터·노이즈 제거처럼 소리/신호를 다루는 내용이면 input_type은 "audio", 사진·화소·윤곽선·색상처럼 그림을 다루는 내용이면 input_type은 "image". ' +
    'output_type은 결과를 가장 잘 보여주는 형태를 골라줘 - 스펙트로그램 시각화나 위상 분석 그래프처럼 눈으로 봐야 하는 결과는 "image", 필터링/노이즈 제거된 소리 자체가 결과라면 "audio".) ' +
    '조절할 만한 핵심 파라미터(임계값, 커널 크기, 반복 횟수, 필터 종류, 컷오프 주파수 등)가 있으면 함께 나열하고, 없으면 빈 배열로 답해:\n' +
    '```json\n' +
    '{\n' +
    '  "input_type": "image 또는 audio",\n' +
    '  "output_type": "image 또는 audio",\n' +
    '  "params": [\n' +
    '    { "name": "영문_파라미터명", "label": "한국어 설명", "type": "slider", "min": 최소값, "max": 최대값, "step": 증가폭, "default": 기본값 },\n' +
    '    { "name": "영문_파라미터명", "label": "한국어 설명", "type": "combobox", "options": ["값1", "값2"], "default": "기본값" }\n' +
    '  ]\n' +
    '}\n' +
    '```\n' +
    '2) input_type이 "image"면 정확히 이 형태의 함수 하나만 작성해: def process_image(input_path: str, output_path: str, 파라미터1=기본값1, ...) -> None: ' +
    '이 함수는 input_path의 이미지 파일을 PIL 또는 cv2로 열어서 처리하고, 결과 이미지를 output_path에 PNG로 저장해야 해. PIL(Pillow), numpy, cv2(OpenCV), scipy 라이브러리만 사용해. ' +
    '3) input_type이 "audio"면 정확히 이 형태의 함수 하나만 작성해: def process_audio(input_path: str, output_path: str, 파라미터1=기본값1, ...) -> None: ' +
    'input_path는 항상 16비트 PCM WAV 파일이야 - scipy.io.wavfile.read(input_path)로 (sample_rate, samples)를 얻어서 처리해 (samples는 모노면 1차원, 스테레오면 (N,2) 형태의 int16 배열). ' +
    'output_type이 "audio"면 결과를 scipy.io.wavfile.write(output_path, sample_rate, result)로 저장해(result는 int16 또는 float32 numpy 배열). ' +
    'output_type이 "image"면 matplotlib을 반드시 Agg 백엔드로 설정한 뒤(import matplotlib 바로 다음 줄에 matplotlib.use("Agg")) 스펙트로그램/그래프를 그려서 plt.savefig(output_path)로 저장해. numpy, scipy(scipy.io.wavfile, scipy.signal 등), matplotlib만 사용해. ' +
    '4) 함수의 키워드 인자 이름은 JSON의 "params" 각 항목 "name" 값과 정확히 똑같아야 해 (파라미터가 없으면 input_path, output_path만 받는 함수를 작성해). ' +
    '5) 화면에 띄우거나 재생하는 동작(cv2.imshow, plt.show, Image.show, sounddevice 재생 등)은 절대 쓰지 마 - 반드시 output_path에 파일로 저장만 해. ' +
    '6) pip install, 네트워크 요청, 다른 파일 시스템 접근은 절대 쓰지 마. ' +
    '7) 뼈대나 pass, "...생략..." 없이 설명된 내용을 실제로 전부 동작하도록 구현해. ' +
    '8) 함수 정의 위에 필요한 import문을 전부 포함시켜. ' +
    '9) 다른 설명 문장 없이, 먼저 위 JSON 코드블록(```json ... ```) 하나, 그다음 파이썬 코드블록(```python ... ```) 하나, 이렇게 정확히 두 개만 답해.\n\n' +
    `--- 문서 내용 ---\n${pageBody}`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = await res.json();
  const text = (data.response || '').trim();

  const pythonFenced = text.match(/```python\s*\n([\s\S]*?)```/i);
  const code = (pythonFenced ? pythonFenced[1] : '').trim();

  // Trust whichever function name the code actually defines over the JSON's
  // own input_type claim - that's what's really going to run, and the two
  // could in principle disagree if the model was inconsistent.
  const hasProcessImage = /def\s+process_image\s*\(/.test(code);
  const hasProcessAudio = /def\s+process_audio\s*\(/.test(code);
  if (!code || (!hasProcessImage && !hasProcessAudio)) {
    throw new Error('process_image 또는 process_audio 함수를 생성하지 못했습니다.');
  }
  const inputType = hasProcessAudio ? 'audio' : 'image';
  const funcName = hasProcessAudio ? 'process_audio' : 'process_image';

  // The JSON metadata (output type + tunable params) is a nice-to-have, not
  // a hard requirement - if it doesn't parse, fall back to sensible
  // defaults rather than failing the whole feature, since the function
  // itself still works fine on its own built-in defaults either way.
  let outputType = 'image';
  let params = [];
  const jsonFenced = text.match(/```json\s*\n([\s\S]*?)```/i);
  if (jsonFenced) {
    try {
      const parsed = JSON.parse(jsonFenced[1]);
      if (parsed && typeof parsed === 'object') {
        if (parsed.output_type === 'audio') outputType = 'audio';
        if (Array.isArray(parsed.params)) {
          // Only keep entries whose "name" genuinely appears as a keyword
          // parameter in the generated function signature - a schema entry
          // for a parameter the function doesn't actually accept would just
          // cause a TypeError when the live-preview control tries to use it.
          const sigMatch = code.match(new RegExp(`def\\s+${funcName}\\s*\\(([^)]*)\\)`));
          const sigNames = new Set(
            sigMatch
              ? sigMatch[1]
                  .split(',')
                  .map((p) => p.split('=')[0].split(':')[0].trim())
                  .filter(Boolean)
              : []
          );
          params = parsed.params.filter((p) => p && typeof p.name === 'string' && sigNames.has(p.name));
        }
      }
    } catch {
      params = [];
    }
  }

  return { code, inputType, outputType, params };
}

module.exports = {
  defineTerm,
  generateYoutubeMeta,
  generateCoreFunctions,
  generateFlowDiagram,
  translateToEnglish,
  translateFeedItemsToKorean,
  summarizePaper,
  explainRelation,
  summarizeYoutubeVideo,
  generateImageProcessingCode,
};
