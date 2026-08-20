const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const convertHeic = require('heic-convert');

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heif'
]);
const MIME_TYPE_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-heic': 'image/heic',
  'image/x-heif': 'image/heif'
};

function asString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const result = String(value).trim();
  return result || fallback;
}

function normalizeProfileId(value) {
  const normalized = asString(value, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) {
    const error = new Error('A valid message profile ID is required');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function parseImageDataUrl(value, declaredMimeType = '') {
  const raw = asString(value, '');
  const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) {
    const error = new Error('Image upload must be a base64 data URL');
    error.statusCode = 400;
    throw error;
  }

  const requestedMimeType = asString(declaredMimeType, match[1]).toLowerCase();
  const mimeType = MIME_TYPE_ALIASES[requestedMimeType] || requestedMimeType;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const error = new Error(`Unsupported image type: ${mimeType || 'unknown'}`);
    error.statusCode = 415;
    throw error;
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image must be between 1 byte and 20 MB');
    error.statusCode = 413;
    throw error;
  }

  return { buffer, mimeType };
}

function isHeicInput(mimeType, fileName) {
  const extension = path.extname(asString(fileName, '')).toLowerCase();
  return mimeType === 'image/heic' || mimeType === 'image/heif' || extension === '.heic' || extension === '.heif';
}

function createMessageImageStore(config) {
  const configuredDir = asString(config && config.messageImageDir, '');
  const profileStorePath = asString(config && config.profileStorePath, '');
  const uploadDir = configuredDir
    ? (path.isAbsolute(configuredDir) ? configuredDir : path.resolve(process.cwd(), configuredDir))
    : path.join(path.dirname(profileStorePath || path.resolve(process.cwd(), 'output', 'profiles.json')), 'uploads');

  const getPath = (profileId) => path.join(uploadDir, `${normalizeProfileId(profileId)}.png`);

  return {
    getUploadDir() {
      return uploadDir;
    },
    getPath(profileId) {
      return getPath(profileId);
    },
    async save(input) {
      const source = input && typeof input === 'object' ? input : {};
      const profileId = normalizeProfileId(source.profileId);
      const fileName = asString(source.fileName, 'message-image');
      const parsed = parseImageDataUrl(source.dataUrl, source.mimeType);
      let imageBuffer = parsed.buffer;

      if (isHeicInput(parsed.mimeType, fileName)) {
        try {
          imageBuffer = Buffer.from(await convertHeic({
            buffer: imageBuffer,
            format: 'PNG'
          }));
        } catch (error) {
          const convertedError = new Error(`Could not decode HEIC image: ${error.message}`);
          convertedError.statusCode = 400;
          throw convertedError;
        }
      }

      fs.mkdirSync(uploadDir, { recursive: true });
      const imagePath = getPath(profileId);
      const temporaryPath = `${imagePath}.${Date.now()}.tmp`;
      try {
        await sharp(imageBuffer, {
          animated: false,
          limitInputPixels: 50_000_000
        })
          .rotate()
          .flatten({ background: '#ffffff' })
          .resize({ width: 1200, height: 2400, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toFile(temporaryPath);
        fs.renameSync(temporaryPath, imagePath);
      } catch (error) {
        try {
          if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
          }
        } catch (_cleanupError) {
          // Preserve the original conversion error.
        }
        const convertedError = new Error(`Could not process image: ${error.message}`);
        convertedError.statusCode = 400;
        throw convertedError;
      }

      return {
        profileId,
        path: imagePath,
        name: fileName,
        mimeType: 'image/png'
      };
    },
    remove(profileId) {
      const imagePath = getPath(profileId);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
      return { profileId: normalizeProfileId(profileId), path: imagePath, removed: true };
    }
  };
}

module.exports = {
  createMessageImageStore,
  parseImageDataUrl
};
