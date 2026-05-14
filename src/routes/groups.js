const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { authMiddleware } = require('../middleware/auth');

// Todos os endpoints de grupos requerem autenticação
router.use(authMiddleware);

// GET /api/groups
router.get('/', async (req, res) => {
  try {
    res.json(await db.getAllGroups(req.user.userId)); 
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/groups
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name é obrigatório' });
  try {
    const group = await db.createGroup(name, req.user.userId);
    res.json(group);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.deleteGroup(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/groups/:id/members
router.post('/:id/members', async (req, res) => {
  const { numberId } = req.body;
  if (!numberId) return res.status(400).json({ error: 'numberId é obrigatório' });
  try {
    await db.addMemberToGroup(req.params.id, numberId);
    res.json(await db.getGroupById(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/groups/:id/members/:numberId
router.delete('/:id/members/:numberId', async (req, res) => {
  try {
    await db.removeMemberFromGroup(req.params.id, req.params.numberId);
    res.json(await db.getGroupById(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
