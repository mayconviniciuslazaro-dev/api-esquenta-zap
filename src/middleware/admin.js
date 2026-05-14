const db = require('../services/database');

/**
 * Middleware que verifica se o usuário autenticado possui role 'admin'.
 * Deve ser usado APÓS authMiddleware.
 */
async function adminMiddleware(req, res, next) {
  try {
    const user = await db.getUserById(req.user.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = { adminMiddleware };
