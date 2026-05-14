const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const db = require('../services/database');

/**
 * BaileysEngine
 * Wraps @whiskeysockets/baileys for a single number session.
 * Extremely lightweight — no browser needed.
 */
class BaileysEngine {
  constructor(numberId, engineType, io, userId = null) {
    this.numberId = numberId;
    this.engineType = engineType || 'baileys';
    this.io = io;
    this.userId = userId;
    this.status = 'disconnected';
    this.sock = null;
    this._destroyed = false;
    this.lastQr = null;
    this._lastMessages = new Map();
    this._authPath = path.join(__dirname, '../../sessions', `baileys_${this.numberId}`);
  }

  // Emite evento apenas para o usuário dono, ou broadcast se não há userId
  _emit(event, data) {
    if (this.userId) {
      this.io.to(`user:${this.userId}`).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }

  async initialize() {
    this._destroyed = false;
    fs.mkdirSync(this._authPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this._authPath);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      generateHighQualityLinkPreview: false,
      browser: ['Esquenta Zap', 'Chrome', '120.0.0'],
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[Baileys ${this.numberId}] QR recebido`);
        this.status = 'qr_pending';
        await db.updateNumberStatus(this.numberId, 'qr_pending');
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          this.lastQr = qrDataUrl;
          this._emit('number:qr', { id: this.numberId, qr: qrDataUrl, engine: 'baileys' });
          this._emit('number:status', { id: this.numberId, status: 'qr_pending' });
        } catch (e) {
          console.error(`[Baileys ${this.numberId}] Erro no QR:`, e.message);
        }
      }

      if (connection === 'open') {
        const phone = this.sock.user?.id?.split(':')[0] || null;
        console.log(`[Baileys ${this.numberId}] Conectado! Telefone: ${phone}`);
        this.status = 'connected';
        this.lastQr = null;
        await db.updateNumberStatus(this.numberId, 'connected', phone);
        this._emit('number:status', { id: this.numberId, status: 'connected', phone, engine: 'baileys' });
        this._emit('number:qr_clear', { id: this.numberId });
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        console.log(`[Baileys ${this.numberId}] Conexão fechada. Motivo: ${reason}`);
        this.status = 'disconnected';
        await db.updateNumberStatus(this.numberId, 'disconnected');
        this._emit('number:status', { id: this.numberId, status: 'disconnected', reason });

        if (shouldReconnect && !this._destroyed) {
          console.log(`[Baileys ${this.numberId}] Reconectando...`);
          setTimeout(() => {
            if (!this._destroyed) this.initialize();
          }, 5000);
        }
      }
    });

    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.key.remoteJid) {
          this._lastMessages.set(msg.key.remoteJid, msg.key);
        }
      }
    });
  }

  async sendMessage(toPhone, text) {
    const jid = _formatJid(toPhone);
    const result = await this.sock.sendMessage(jid, { text });
    this._lastMessages.set(jid, result.key);
    return result;
  }

  async sendTyping(toPhone, durationMs = 3000) {
    const jid = _formatJid(toPhone);
    await this.sock.sendPresenceUpdate('composing', jid);
    await _delay(Math.min(durationMs, 5000));
    await this.sock.sendPresenceUpdate('paused', jid);
  }

  async sendAudio(toPhone, audioPath) {
    const jid = _formatJid(toPhone);
    const buffer = fs.readFileSync(audioPath);
    return this.sock.sendMessage(jid, {
      audio: buffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true, // send as voice note
    });
  }

  async sendSticker(toPhone, stickerPath) {
    const jid = _formatJid(toPhone);
    const buffer = fs.readFileSync(stickerPath);
    return this.sock.sendMessage(jid, {
      sticker: buffer,
    });
  }

  async sendImage(toPhone, imagePath, caption = '') {
    const jid = _formatJid(toPhone);
    const buffer = fs.readFileSync(imagePath);
    const mimetype = _getMimetype(imagePath, 'image/jpeg');
    return this.sock.sendMessage(jid, {
      image: buffer,
      mimetype,
      caption,
    });
  }

  async sendVideo(toPhone, videoPath, caption = '') {
    const jid = _formatJid(toPhone);
    const buffer = fs.readFileSync(videoPath);
    const mimetype = _getMimetype(videoPath, 'video/mp4');
    return this.sock.sendMessage(jid, {
      video: buffer,
      mimetype,
      caption,
    });
  }

  async sendReaction(toPhone, emoji) {
    const jid = _formatJid(toPhone);
    const msgKey = this._lastMessages.get(jid);
    if (!msgKey) return;
    return this.sock.sendMessage(jid, {
      react: { text: emoji, key: msgKey },
    });
  }

  async destroy() {
    this._destroyed = true;
    if (this.sock) {
      // Remove listeners ANTES de fechar para evitar disparar reconexão
      this.sock.ev.removeAllListeners();
      try {
        this.sock.ws?.close();
      } catch (_) {}
      this.sock = null;
    }
    this.status = 'disconnected';
  }
}

function _formatJid(phone) {
  if (phone.includes('@')) return phone;
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

function _getMimetype(filePath, fallback) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  };
  return map[ext] || fallback;
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { BaileysEngine };
