const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;
const PDF_EXT = /\.pdf$/i;

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
// track, sized/padded to a standard 1080p YouTube frame.
async function buildSlideshow({ images, audioPath, duration, outPath }) {
  const perSlide = duration / images.length;
  const listPath = `${outPath}.list.txt`;
  const escape = (p) => p.replace(/'/g, "'\\''");
  const lines = images.map((img) => `file '${escape(img)}'\nduration ${perSlide.toFixed(3)}`);
  // The concat demuxer ignores the last entry's duration, so it must be repeated.
  lines.push(`file '${escape(images[images.length - 1])}'`);
  fs.writeFileSync(listPath, lines.join('\n'));

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-i', audioPath,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
      '-c:v', 'libx264', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest',
      outPath,
    ]);
  } finally {
    fs.unlinkSync(listPath);
  }
}

module.exports = { findAudioAndPdf, getAudioDuration, pdfToImages, pdfText, buildSlideshow };
