/**
 * download-model.js
 * Called by eas.json preBuildCommand before every EAS cloud build.
 * Downloads the Llama GGUF if it is not already present in src/assets/models/.
 * Skips the download when the file already exists (e.g., local dev builds
 * where the developer placed the file manually).
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const MODEL_FILENAME = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
const MODEL_DIR  = path.join(__dirname, '..', 'src', 'assets', 'models');
const MODEL_PATH = path.join(MODEL_DIR, MODEL_FILENAME);

// Public HuggingFace repo (bartowski's GGUF conversions of Meta's Llama 3.2 1B).
// Verify the URL is still live before triggering a build:
// https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF
const MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/' +
  MODEL_FILENAME;

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) {
      return reject(new Error('Too many redirects'));
    }

    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, (res) => {
      // Follow redirects (HuggingFace CDN issues several)
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect with no Location header'));
        res.resume(); // drain
        return resolve(downloadFile(location, dest, redirectCount + 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;

      const file = fs.createWriteStream(dest);

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            process.stdout.write(`\r  ${pct}%  (${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB)`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        process.stdout.write('\n');
        file.close(resolve);
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {}); // remove incomplete file
        reject(err);
      });
    });

    req.on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(MODEL_PATH)) {
    const size = fs.statSync(MODEL_PATH).size;
    console.log(`Model already present (${(size / 1e6).toFixed(0)} MB) — skipping download.`);
    return;
  }

  fs.mkdirSync(MODEL_DIR, { recursive: true });

  console.log(`Downloading ${MODEL_FILENAME} from HuggingFace...`);
  console.log(`URL: ${MODEL_URL}`);
  console.log('This is ~800 MB — may take several minutes on a build server.\n');

  try {
    await downloadFile(MODEL_URL, MODEL_PATH);
    const size = fs.statSync(MODEL_PATH).size;
    console.log(`Download complete: ${(size / 1e6).toFixed(0)} MB saved to ${MODEL_PATH}`);
  } catch (err) {
    // Remove partial file so the next run retries
    if (fs.existsSync(MODEL_PATH)) fs.unlinkSync(MODEL_PATH);
    console.error('\nModel download failed:', err.message);
    console.error('EAS build will continue but offline AI will not work in this build.');
    // Exit 0 so the build isn't hard-failed — the app just won't have offline AI.
    // Change to process.exit(1) if you want a hard failure instead.
    process.exit(0);
  }
}

main();
