const db = require('./database');
const { BaileysEngine } = require('../engines/baileys');
const fs = require('fs');
const path = require('path');

/**
 * SessionManager
 * Manages multiple WhatsApp sessions using Baileys engine.
 * Emits real-time events via Socket.IO.
 */
class SessionManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string, BaileysEngine>} */
    this.sessions = new Map();
    this._startExpiryWatcher();
  }

  /**
   * Returns the appropriate engine class based on engine type string.
   */
  _getEngineClass(engine) {
    return BaileysEngine;
  }

  /**
   * Emite evento apenas para o usuário dono, ou broadcast se não há userId.
   */
  _emitToUser(userId, event, data) {
    if (userId) {
      this.io.to(`user:${userId}`).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }

  /**
   * Connect (or reconnect) a number by its DB id.
   * Engine is chosen from the number's saved setting.
   */
  async connectNumber(numberId) {
    const number = await db.getNumberById(numberId);
    if (!number) throw new Error(`Número ${numberId} não encontrado`);

    // Destrói sessão existente se houver
    if (this.sessions.has(numberId)) {
      await this.disconnectNumber(numberId);
    }

    const EngineClass = this._getEngineClass(number.engine);
    const instance = new EngineClass(numberId, number.engine, this.io, number.userId);

    this.sessions.set(numberId, instance);
    await db.updateNumberStatus(numberId, 'connecting');
    this._emitToUser(number.userId, 'number:status', { id: numberId, status: 'connecting' });

    // Inicia em background — erros são tratados via WebSocket, não HTTP
    instance.initialize().catch(async (e) => {
      console.error(`[SessionManager] Erro ao inicializar ${number.engine} para ${numberId}:`, e.message);
      instance.lastError = e.message; // guarda para debug via /status
      this.sessions.delete(numberId);
      await db.updateNumberStatus(numberId, 'auth_failure').catch(() => {});
      this._emitToUser(number.userId, 'number:status', { id: numberId, status: 'error', error: e.message });
    });
  }

  /**
   * Reconecta um número com engine baileys.
   */
  async switchEngine(numberId, newEngine) {
    await db.updateNumberEngine(numberId, newEngine);
    await this.connectNumber(numberId);
  }

  /**
   * Desconecta um número.
   */
  async disconnectNumber(numberId) {
    const session = this.sessions.get(numberId);
    const userId = session?.userId || (await db.getNumberById(numberId).catch(() => null))?.userId;
    if (session) {
      await session.destroy().catch(() => {});
      this.sessions.delete(numberId);
    }
    await db.updateNumberStatus(numberId, 'disconnected');
    this._emitToUser(userId, 'number:status', { id: numberId, status: 'disconnected' });
  }

  /**
   * Desconecta todas as sessões WhatsApp de um usuário (ex: troca de máquina).
   */
  async disconnectUserSessions(userId) {
    const numbers = await db.getNumbersByUserId(userId);
    for (const number of numbers) {
      await this.disconnectNumber(number.id).catch(() => {});
    }
  }

  /**
   * Envia mensagem de texto de um número para outro.
   * Aplica delay aleatório e simulação de digitação.
   */
  async sendText(fromId, toPhone, text) {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Número ${fromId} não está conectado`);
    }

    const settings = await db.getSettings();
    const minDelay = parseInt(settings.min_delay_ms || '5000');
    const maxDelay = parseInt(settings.max_delay_ms || '15000');
    const typingEnabled = settings.typing_simulation === '1';

    // Random delay to simulate human behavior
    await _randomDelay(minDelay, maxDelay);

    if (typingEnabled) {
      await session.sendTyping(toPhone, text.length * 60);
    }

    await session.sendMessage(toPhone, text);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * Send an audio message from a number.
   */
  async sendAudio(fromId, toPhone, audioPath) {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Número ${fromId} não está conectado`);
    }
    const settings = await db.getSettings();
    await _randomDelay(
      parseInt(settings.min_delay_ms || '5000'),
      parseInt(settings.max_delay_ms || '15000')
    );
    await session.sendAudio(toPhone, audioPath);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * Envia uma figurinha de um número.
   */
  async sendSticker(fromId, toPhone, stickerPath) {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Número ${fromId} não está conectado`);
    }
    const settings = await db.getSettings();
    await _randomDelay(
      parseInt(settings.min_delay_ms || '5000'),
      parseInt(settings.max_delay_ms || '15000')
    );
    await session.sendSticker(toPhone, stickerPath);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * Envia uma imagem de um número.
   */
  async sendImage(fromId, toPhone, imagePath, caption = '') {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Número ${fromId} não está conectado`);
    }
    const settings = await db.getSettings();
    await _randomDelay(
      parseInt(settings.min_delay_ms || '5000'),
      parseInt(settings.max_delay_ms || '15000')
    );
    await session.sendImage(toPhone, imagePath, caption);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * Envia um vídeo de um número.
   */
  async sendVideo(fromId, toPhone, videoPath, caption = '') {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Número ${fromId} não está conectado`);
    }
    const settings = await db.getSettings();
    await _randomDelay(
      parseInt(settings.min_delay_ms || '5000'),
      parseInt(settings.max_delay_ms || '15000')
    );
    await session.sendVideo(toPhone, videoPath, caption);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * React to a message with an emoji.
   */
  async sendReaction(fromId, toPhone, emoji) {
    const session = this.sessions.get(fromId);
    if (!session || session.status !== 'connected') {
      throw new Error(`Number ${fromId} is not connected`);
    }
    await session.sendReaction(toPhone, emoji);
    await db.updateNumberLastActivity(fromId).catch(() => {});
  }

  /**
   * Verifica a cada hora se há sessões conectadas sem atividade por mais de 7 dias.
   * Quando encontrada, encerra a sessão e limpa a pasta local para forçar novo QR.
   */
  _startExpiryWatcher() {
    const EXPIRY_DAYS = 7;
    const CHECK_INTERVAL_MS = 60 * 60 * 1000; // a cada hora

    setInterval(async () => {
      try {
        const threshold = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const expired = await db.getExpiredSessions(threshold);

        for (const number of expired) {
          console.log(`[SessionManager] Sessão expirada (${EXPIRY_DAYS} dias sem atividade): ${number.name || number.id}`);

          const session = this.sessions.get(number.id);
          if (session) {
            await session.destroy().catch(() => {});
            this.sessions.delete(number.id);
          }

          this._clearSessionFolder(number.id, number.engine);
          await db.updateNumberStatus(number.id, 'disconnected');
          this._emitToUser(number.userId, 'number:status', { id: number.id, status: 'disconnected', reason: 'session_expired' });
        }
      } catch (e) {
        console.error('[SessionManager] Erro no watcher de expiração:', e.message);
      }
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Remove a pasta de sessão do filesystem para forçar QR novo na próxima conexão.
   */
  _clearSessionFolder(numberId, engine) {
    try {
      const folderPath = path.join(__dirname, '../../sessions', `baileys_${numberId}`);

      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`[SessionManager] Pasta de sessão removida: ${folderPath}`);
      }
    } catch (e) {
      console.warn(`[SessionManager] Erro ao remover pasta de sessão ${numberId}:`, e.message);
    }
  }

  /**
   * Get all currently active session statuses.
   */
  getStatuses() {
    const result = {};
    for (const [id, session] of this.sessions) {
      result[id] = session.status;
    }
    return result;
  }

  /**
   * Get a specific session.
   */
  getSession(numberId) {
    return this.sessions.get(numberId);
  }
}

function _randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { SessionManager };
