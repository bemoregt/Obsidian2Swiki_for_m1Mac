import hashlib
import io
import os
import sys

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scipy.io.wavfile as wav
import torch
import uroman as ur
from transformers import AutoTokenizer, VitsModel

DEVICE = 'mps' if torch.backends.mps.is_available() else 'cpu'
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

print(f'[tts] loading facebook/mms-tts-kor on {DEVICE}...', file=sys.stderr)
model = VitsModel.from_pretrained('facebook/mms-tts-kor').to(DEVICE)
tokenizer = AutoTokenizer.from_pretrained('facebook/mms-tts-kor')
romanizer = ur.Uroman()

# Calmer, steadier delivery for reading technical text - lower pitch/duration
# variance than the model's default, and a touch slower.
model.noise_scale = 0.3
model.noise_scale_duration = 0.3
model.speaking_rate = 0.9

# First MPS call pays a one-time kernel-compile cost - eat it now, not on the
# first real user request.
with torch.no_grad():
    warmup_inputs = tokenizer(romanizer.romanize_string('안녕하세요'), return_tensors='pt').to(DEVICE)
    model(**warmup_inputs)
    if DEVICE == 'mps':
        torch.mps.synchronize()
print('[tts] model loaded and warmed up', file=sys.stderr)


def synthesize(text):
    cache_path = os.path.join(CACHE_DIR, hashlib.sha1(text.encode('utf-8')).hexdigest() + '.wav')
    if os.path.exists(cache_path):
        with open(cache_path, 'rb') as f:
            return f.read()

    romanized = romanizer.romanize_string(text)
    inputs = tokenizer(romanized, return_tensors='pt').to(DEVICE)
    with torch.no_grad():
        waveform = model(**inputs).waveform
    buf = io.BytesIO()
    wav.write(buf, rate=model.config.sampling_rate, data=waveform.squeeze().to('cpu').numpy())
    audio = buf.getvalue()

    with open(cache_path, 'wb') as f:
        f.write(audio)
    return audio


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/synthesize':
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', 0))
        text = self.rfile.read(length).decode('utf-8').strip()
        if not text:
            self.send_response(400)
            self.end_headers()
            return
        try:
            audio = synthesize(text)
        except Exception as exc:
            print(f'[tts] error: {exc}', file=sys.stderr)
            self.send_response(500)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Content-Length', str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5005
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'[tts] listening on {port}', file=sys.stderr)
    server.serve_forever()
