const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../services/database');
const { authMiddleware } = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/admin');

// Todos os endpoints exigem auth + admin
router.use(authMiddleware);
router.use(adminMiddleware);

// GET /api/admin/users — Listar todos os usuários
router.get('/users', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const result = users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      enabled: u.enabled,
      modules: u.modules ? u.modules.split(',') : [],
      createdAt: u.createdAt,
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users — Criar usuário
router.post('/users', async (req, res) => {
  const { username, password, role, enabled, modules } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'password deve ter ao menos 6 caracteres' });

  try {
    const existing = await db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Usuário já existe' });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.createUser({
      username,
      password: hash,
      role: role || 'user',
      enabled: enabled !== false,
      modules: Array.isArray(modules) ? modules.join(',') : 'numbers,groups,scheduler,media,logs,settings',
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      enabled: user.enabled,
      modules: user.modules ? user.modules.split(',') : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/users/:id — Atualizar usuário (role, enabled, modules, password)
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { role, enabled, modules, password } = req.body;

  try {
    const user = await db.getUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updateData = {};
    if (role !== undefined) updateData.role = role;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (modules !== undefined) updateData.modules = Array.isArray(modules) ? modules.join(',') : modules;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'password deve ter ao menos 6 caracteres' });
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updated = await db.updateUser(id, updateData);

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      enabled: updated.enabled,
      modules: updated.modules ? updated.modules.split(',') : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/users/:id — Excluir usuário
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;

  if (id === req.user.userId) {
    return res.status(400).json({ error: 'Não é possível excluir o próprio usuário' });
  }

  try {
    const user = await db.getUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    await db.deleteUser(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
