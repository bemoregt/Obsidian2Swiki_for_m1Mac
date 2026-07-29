const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const PDF_EXT = /\.pdf$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i;

// Scans the page's raw markdown for `[label](/uploads/xxx)` /
// `![alt](/uploads/xxx)` links and returns the ones that exist on disk.
function findUploadRefs(body, uploadDir) {
  const re = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  const files = [];
  let m;
  while ((m = re.exec(body))) {
    const match = m[1].trim().match(/^\/uploads\/(.+)$/);
    if (!match) continue;
    const filename = decodeURIComponent(match[1]);
    const abs = path.join(uploadDir, filename);
    if (fs.existsSync(abs)) files.push({ filename, abs });
  }
  return files;
}

function findAudioAndPdf(body, uploadDir) {
  const files = findUploadRefs(body, uploadDir);
  return {
    audio: files.find((f) => AUDIO_EXT.test(f.filename)),
    pdf: files.find((f) => PDF_EXT.test(f.filename)),
  };
}

// Just the PDF half of findAudioAndPdf, for features (like the paper
// summarizer) that don't need an audio track at all.
function findPdf(body, uploadDir) {
  return findUploadRefs(body, uploadDir).find((f) => PDF_EXT.test(f.filename));
}

// First uploaded image referenced on the page (via either ![alt](url) or
// [label](url) - findUploadRefs doesn't care which), for the "코드로
// 테스트하기" feature's input image.
function findImage(body, uploadDir) {
  return findUploadRefs(body, uploadDir).find((f) => IMAGE_EXT.test(f.filename));
}

// First uploaded audio file referenced on the page, for the "코드로
// 테스트하기" feature's input audio (as opposed to findAudioAndPdf, which
// only cares about audio when it's paired with a PDF for slideshow videos).
function findAudio(body, uploadDir) {
  return findUploadRefs(body, uploadDir).find((f) => AUDIO_EXT.test(f.filename));
}

// Generated code shouldn't have to handle every audio format a user might
// upload (mp3/ogg/m4a/...) - this normalizes whatever was attached into a
// plain 16-bit PCM WAV first, so process_audio() can always rely on
// scipy.io.wavfile.read() working no matter what the original file was.
async function convertToWav(inputPath, outputPath) {
  await execFileAsync('ffmpeg', ['-y', '-i', inputPath, '-c:a', 'pcm_s16le', outputPath]);
}

async function getAudioDuration(audioPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('오디오 길이를 읽지 못했습니다.');
  return seconds;
}

async function pdfToImages(pdfPath, outDir) {
  await execFileAsync('pdftoppm', ['-png', '-r', '150', pdfPath, path.join(outDir, 'slide')]);
  return fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => path.join(outDir, f));
}

async function pdfText(pdfPath, maxChars = 4000) {
  const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-']);
  return stdout.trim().slice(0, maxChars);
}

// Builds an equal-time-per-slide slideshow (PDF pages) muxed with the audio
// track, sized/padded (black bars) to `width`x`height`. Pass `maxDuration` to
// cut the output short (used for the Shorts clip) - the per-slide pacing is
// still computed from the full `duration` so slides don't speed up.
async function buildSlideshow({ images, audioPath, duration, outPath, width = 1920, height = 1080, maxDuration }) {
  const perSlide = duration / images.length;
  const listPath = `${outPath}.list.txt`;
  const escape = (p) => p.replace(/'/g, "'\\''");
  const lines = images.map((img) => `file '${escape(img)}'\nduration ${perSlide.toFixed(3)}`);
  // The concat demuxer ignores the last entry's duration, so it must be repeated.
  lines.push(`file '${escape(images[images.length - 1])}'`);
  fs.writeFileSync(listPath, lines.join('\n'));

  const args = [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-i', audioPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    '-c:v', 'libx264', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
  ];
  if (maxDuration) args.push('-t', String(maxDuration));
  args.push(outPath);

  try {
    await execFileAsync('ffmpeg', args);
  } finally {
    fs.unlinkSync(listPath);
  }
}

module.exports = {
  findAudioAndPdf,
  findPdf,
  findImage,
  findAudio,
  convertToWav,
  getAudioDuration,
  pdfToImages,
  pdfText,
  buildSlideshow,
};
