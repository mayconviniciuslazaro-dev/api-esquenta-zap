const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { authMiddleware } = require('../middleware/auth');

// Configurações são globais mas exigem autenticação
router.use(authMiddleware);

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    res.json(await db.getSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  const allowed = [
    'min_delay_ms',
    'max_delay_ms',
    'engine_threshold',
    'default_engine',
    'daily_msg_limit',
    'typing_simulation',
  ];

  try {
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await db.setSetting(key, req.body[key]);
      }
    }
    res.json(await db.getSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
