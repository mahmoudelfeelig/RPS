const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadsDir = process.env.UPLOAD_STORAGE_DIR
  ? path.resolve(process.env.UPLOAD_STORAGE_DIR)
  : path.join(__dirname, '..', 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const extensionByMime = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = extensionByMime.get(file.mimetype) || '.bin';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safeName);
  },
});

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const imageSignatures = {
  'image/jpeg': (buffer) =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (buffer) =>
    buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
  'image/webp': (buffer) =>
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP',
};

function imageFileFilter(_req, file, cb) {
  if (!allowedImageTypes.has(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, WebP, and GIF uploads are allowed'));
  }
  return cb(null, true);
}

async function validateImageUpload(req, res, next) {
  if (!req.file?.path) return next();
  try {
    const handle = await fs.promises.open(req.file.path, 'r');
    const header = Buffer.alloc(16);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const valid = imageSignatures[req.file.mimetype]?.(header) === true;
    if (!valid) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res
        .status(400)
        .json({ message: 'Uploaded file contents do not match an allowed image type' });
    }
    return next();
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return next(error);
  }
}

function publicUploadUrl(file) {
  return `/uploads/${path.basename(file.filename || file.path || '')}`;
}

module.exports = {
  imageFileFilter,
  validateImageUpload,
  publicUploadUrl,
  storage,
  uploadsDir,
};
