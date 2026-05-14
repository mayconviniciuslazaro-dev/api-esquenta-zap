const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../services/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const TOKEN_EXPIRY = '7d';

// POST /api/auth/register — cria o primeiro usuário (admin)
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (password.length < 6)
    return res.status(400).json({ error: 'password deve ter ao menos 6 caracteres' });

  try {
    // Só permite registro público se ainda não existe nenhum usuário (primeiro = admin)
    const userCount = await db.getUserCount();
    if (userCount > 0) {
      return res.status(403).json({ error: 'Registro público desabilitado. Peça ao admin para criar sua conta.' });
    }

    const existing = await db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Usuário já existe' });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.createUser({
      username,
      password: hash,
      role: 'admin',
      modules: 'numbers,groups,scheduler,media,logs,settings',
    });

    // Primeiro usuário assume todos os dados órfãos (migração de sistema sem auth)
    await db.claimOrphanedData(user.id);
    console.log(`[Auth] Primeiro usuário admin '${username}' criado — dados existentes atribuídos.`);

    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  } catch (e) {
    console.error('[Auth Register]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, machineId } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (!machineId)
    return res.status(400).json({ error: 'machineId é obrigatório' });

  try {
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    // Verifica se a conta está ativa
    if (!user.enabled) {
      return res.status(403).json({ error: 'Conta desativada. Contate o administrador.' });
    }

    // Verifica mudança de máquina
    const machineChanged = !!(user.machineId && user.machineId !== machineId);
    if (machineChanged) {
      // Desconecta todas as sessões WhatsApp do usuário na máquina antiga
      const numbers = await db.getNumbersByUserId(user.id);
      for (const number of numbers) {
        await req.sessionManager.disconnectNumber(number.id).catch(() => {});
      }
      console.log(`[Auth] Máquina alterada para '${username}' — ${numbers.length} sessão(ões) desconectada(s).`);
    }

    await db.updateUserMachineId(user.id, machineId);

    const token = jwt.sign(
      { userId: user.id, username: user.username, machineId },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        modules: user.modules ? user.modules.split(',') : [],
      },
      machineChanged,
    });
  } catch (e) {
    console.error('[Auth Login]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me — retorna usuário atual
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      modules: user.modules ? user.modules.split(',') : [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/logout — JWT é stateless, frontend descarta o token
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ success: true });
});

module.exports = router;
