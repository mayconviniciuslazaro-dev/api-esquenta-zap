const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../services/database');
const { authMiddleware } = require('../middleware/auth');

// Todos os endpoints de mídia requerem autenticação
router.use(authMiddleware);

// Garante que todas as pastas de mídia existam (Railway não persiste entre deploys)
const MEDIA_DIRS = {
  audio:   path.join(__dirname, '../../audios'),
  sticker: path.join(__dirname, '../../stickers'),
  image:   path.join(__dirname, '../../images'),
  video:   path.join(__dirname, '../../videos'),
};
Object.values(MEDIA_DIRS).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

function makeStorage(folder) {
  return multer.diskStorage({
    destination: folder,
    filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
  });
}

const UPLOAD_LIMITS = { fileSize: 64 * 1024 * 1024 }; // 64 MB

const uploadAudio   = multer({ storage: makeStorage(MEDIA_DIRS.audio),   limits: UPLOAD_LIMITS });
const uploadSticker = multer({ storage: makeStorage(MEDIA_DIRS.sticker), limits: UPLOAD_LIMITS });
const uploadImage   = multer({ storage: makeStorage(MEDIA_DIRS.image),   limits: UPLOAD_LIMITS });
const uploadVideo   = multer({ storage: makeStorage(MEDIA_DIRS.video),   limits: UPLOAD_LIMITS });

// GET /api/media?type=audio|sticker|image|video
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    res.json(await db.getAllMedia(type || null, req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/audio
router.post('/audio', uploadAudio.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'audio',
      filename: req.file.filename,
      userId: req.user.userId,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/sticker
router.post('/sticker', uploadSticker.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'sticker',
      filename: req.file.filename,
      userId: req.user.userId,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/image
router.post('/image', uploadImage.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'image',
      filename: req.file.filename,
      userId: req.user.userId,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/video
router.post('/video', uploadVideo.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'video',
      filename: req.file.filename,
      userId: req.user.userId,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/media/:id
router.delete('/:id', async (req, res) => {
  try {
    const media = await db.getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Mídia não encontrada' });

    const folder = MEDIA_DIRS[media.type] || MEDIA_DIRS.audio;
    const filePath = path.join(folder, media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await db.deleteMedia(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


// GET /api/media?type=audio|sticker
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    res.json(await db.getAllMedia(type || null));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/audio
router.post('/audio', uploadAudio.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'audio',
      filename: req.file.filename,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/media/sticker
router.post('/sticker', uploadSticker.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const media = await db.createMedia({
      name: req.body.name || req.file.originalname,
      type: 'sticker',
      filename: req.file.filename,
    });
    res.json(media);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/media/:id
router.delete('/:id', async (req, res) => {
  try {
    const media = await db.getMediaById(req.params.id);
    if (!media) return res.status(404).json({ error: 'Mídia não encontrada' });

    const folder = media.type === 'audio' ? 'audios' : 'stickers';
    const filePath = path.join(__dirname, `../../${folder}`, media.filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await db.deleteMedia(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
