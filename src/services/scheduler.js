const cron = require('node-cron');
const db = require('./database');
const path = require('path');

// Warming conversation templates
const WARMING_TEXTS = [
  'Oi, tudo bem?',
  'Olá! Como você está?',
  'Ei, sumiu! Tudo certo?',
  'Boa tarde! 😊',
  'Oi! Estava pensando em você haha',
  'E aí, novidades?',
  'Passando para dar um oi!',
  'Oi! Tudo bem por aí?',
  'Fala! Como vai?',
  'Ei! Tudo bem contigo?',
];

const REPLIES = [
  'Tudo ótimo! E você?',
  'Oi! Também tô bem 😄',
  'Olá! Tudo certo por aqui',
  'Tô bem sim! Obrigado por perguntar!',
  'Aqui tá ótimo! E aí?',
  'Tudo bem! Que saudade!',
  'Sim, tudo bem! 😊',
  'Tudo certo aqui! E você?',
];

/**
 * Scheduler
 * Manages cron-based tasks for warming conversations, group interactions, etc.
 */
class Scheduler {
  constructor(sessionManager, io) {
    this.sessionManager = sessionManager;
    this.io = io;
    /** @type {Map<string, cron.ScheduledTask>} */
    this.jobs = new Map();
  }

  /** Chamado pelo bootstrap após o banco estar conectado */
  async init() {
    const tasks = await db.getAllTasks();
    tasks
      .filter((t) => t.enabled)
      .forEach((t) => this._startJob(t));
    console.log(`[Scheduler] ${tasks.filter((t) => t.enabled).length} tarefas carregadas.`);
  }

  _startJob(task) {
    if (this.jobs.has(task.id)) {
      this.jobs.get(task.id).stop();
    }

    if (!cron.validate(task.cronExpression)) {
      console.warn(`[Scheduler] Expressão cron inválida para tarefa ${task.id}: ${task.cronExpression}`);
      return;
    }

    const job = cron.schedule(task.cronExpression, async () => {
      console.log(`[Scheduler] Executando tarefa: ${task.name}`);
      try {
        await this._runTask(task);
        await db.updateTaskLastRun(task.id);
        this.io.emit('task:ran', { id: task.id, name: task.name, ran_at: new Date().toISOString() });
      } catch (e) {
        console.error(`[Scheduler] Erro na tarefa (${task.name}):`, e.message);
        this.io.emit('task:error', { id: task.id, error: e.message });
      }
    });

    this.jobs.set(task.id, job);
    console.log(`[Scheduler] Job iniciado: ${task.name} [${task.cronExpression}]`);
  }

  async _runTask(task) {
    switch (task.type) {
      case 'warm_group':
        await this._warmGroup(task.config);
        break;
      case 'warm_pair':
        await this._warmPair(task.config);
        break;
      case 'send_audio':
        await this._sendAudioToGroup(task.config);
        break;
      case 'send_sticker':
        await this._sendStickerToGroup(task.config);
        break;
      case 'send_reaction':
        await this._sendReactionInGroup(task.config);
        break;
      case 'send_image':
        await this._sendImageToGroup(task.config);
        break;
      case 'send_video':
        await this._sendVideoToGroup(task.config);
        break;
      default:
        console.warn(`[Scheduler] Unknown task type: ${task.type}`);
    }
  }

  /**
   * Aquece um grupo: os números trocam mensagens entre si.
   */
  async _warmGroup(config) {
    const { groupId, messagesPerCycle = 3 } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    // Prisma retorna members como GroupMember[] com { number: Number }
    const allMembers = group.members.map((m) => m.number);

    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );

    if (connected.length < 2) {
      console.warn(`[Scheduler] Membros conectados insuficientes no grupo ${group.name}`);
      return;
    }

    for (let i = 0; i < messagesPerCycle; i++) {
      const shuffled = [...connected].sort(() => Math.random() - 0.5);
      const sender = shuffled[0];
      const receiver = shuffled[1];

      const text = _randomItem(WARMING_TEXTS);
      if (!receiver.phone) continue;

      try {
        await this.sessionManager.sendText(sender.id, receiver.phone, text);
        await db.logConversation(sender.id, receiver.id, text, 'text');
        this.io.emit('conversation:log', {
          from: sender.name || sender.id,
          to: receiver.name || receiver.id,
          message: text,
          type: 'text',
        });

        // Resposta aleatória
        await _delay(2000, 6000);
        const reply = _randomItem(REPLIES);
        await this.sessionManager.sendText(receiver.id, sender.phone, reply);
        await db.logConversation(receiver.id, sender.id, reply, 'text');
        this.io.emit('conversation:log', {
          from: receiver.name || receiver.id,
          to: sender.name || sender.id,
          message: reply,
          type: 'text',
        });
      } catch (e) {
        console.error('[Scheduler] Erro ao aquecer grupo:', e.message);
      }

      await _delay(3000, 8000);
    }
  }

  /**
   * Aquece um par específico de números.
   */
  async _warmPair(config) {
    const { fromId, toId, messages = 2 } = config;
    const fromNum = await db.getNumberById(fromId);
    const toNum = await db.getNumberById(toId);
    if (!fromNum || !toNum || !toNum.phone) return;

    for (let i = 0; i < messages; i++) {
      const text = _randomItem(i === 0 ? WARMING_TEXTS : REPLIES);
      try {
        await this.sessionManager.sendText(fromId, toNum.phone, text);
        await db.logConversation(fromId, toId, text, 'text');
        this.io.emit('conversation:log', {
          from: fromNum.name || fromId,
          to: toNum.name || toId,
          message: text,
          type: 'text',
        });
      } catch (e) {
        console.error('[Scheduler] Erro ao aquecer par:', e.message);
      }
      await _delay(4000, 10000);
    }
  }

  /**
   * Envia um áudio aleatório da biblioteca para membros do grupo.
   */
  async _sendAudioToGroup(config) {
    const { groupId, audioId } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    const media = await db.getAllMedia('audio');
    const audio = audioId ? media.find((m) => m.id === audioId) : _randomItem(media);
    if (!audio) return;

    const audioPath = path.join(__dirname, '../../audios', audio.filename);
    const allMembers = group.members.map((m) => m.number);
    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );
    if (connected.length < 2) return;

    const sender = _randomItem(connected);
    const receiver = _randomItem(connected.filter((m) => m.id !== sender.id));

    try {
      await this.sessionManager.sendAudio(sender.id, receiver.phone, audioPath);
      await db.logConversation(sender.id, receiver.id, `[audio: ${audio.name}]`, 'audio');
      this.io.emit('conversation:log', {
        from: sender.name || sender.id,
        to: receiver.name || receiver.id,
        message: `🎵 Áudio: ${audio.name}`,
        type: 'audio',
      });
    } catch (e) {
      console.error('[Scheduler] Erro ao enviar áudio:', e.message);
    }
  }

  /**
   * Envia uma figurinha aleatória da biblioteca dentro de um grupo.
   */
  async _sendStickerToGroup(config) {
    const { groupId, stickerId } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    const media = await db.getAllMedia('sticker');
    const sticker = stickerId ? media.find((m) => m.id === stickerId) : _randomItem(media);
    if (!sticker) return;

    const stickerPath = path.join(__dirname, '../../stickers', sticker.filename);
    const allMembers = group.members.map((m) => m.number);
    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );
    if (connected.length < 2) return;

    const sender = _randomItem(connected);
    const receiver = _randomItem(connected.filter((m) => m.id !== sender.id));

    try {
      await this.sessionManager.sendSticker(sender.id, receiver.phone, stickerPath);
      await db.logConversation(sender.id, receiver.id, `[sticker: ${sticker.name}]`, 'sticker');
      this.io.emit('conversation:log', {
        from: sender.name || sender.id,
        to: receiver.name || receiver.id,
        message: `🎭 Figurinha: ${sticker.name}`,
        type: 'sticker',
      });
    } catch (e) {
      console.error('[Scheduler] Erro ao enviar figurinha:', e.message);
    }
  }

  /**
   * Envia uma reação aleatória dentro de um grupo.
   */
  async _sendReactionInGroup(config) {
    const { groupId } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    const emojis = ['❤️', '😂', '👍', '🔥', '😍', '🙌', '💯', '😮'];
    const emoji = _randomItem(emojis);
    const allMembers = group.members.map((m) => m.number);
    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );
    if (connected.length < 2) return;

    const sender = _randomItem(connected);
    const receiver = _randomItem(connected.filter((m) => m.id !== sender.id));

    try {
      await this.sessionManager.sendReaction(sender.id, receiver.phone, emoji);
      await db.logConversation(sender.id, receiver.id, `[reaction: ${emoji}]`, 'reaction');
      this.io.emit('conversation:log', {
        from: sender.name || sender.id,
        to: receiver.name || receiver.id,
        message: `${emoji} Reação`,
        type: 'reaction',
      });
    } catch (e) {
      console.error('[Scheduler] Erro ao enviar reação:', e.message);
    }
  }

  /**
   * Envia uma imagem aleatória da biblioteca dentro de um grupo.
   */
  async _sendImageToGroup(config) {
    const { groupId, imageId, caption = '' } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    const media = await db.getAllMedia('image');
    const image = imageId ? media.find((m) => m.id === imageId) : _randomItem(media);
    if (!image) return;

    const imagePath = path.join(__dirname, '../../images', image.filename);
    const allMembers = group.members.map((m) => m.number);
    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );
    if (connected.length < 2) return;

    const sender   = _randomItem(connected);
    const receiver = _randomItem(connected.filter((m) => m.id !== sender.id));

    try {
      await this.sessionManager.sendImage(sender.id, receiver.phone, imagePath, caption);
      await db.logConversation(sender.id, receiver.id, `[image: ${image.name}]`, 'image');
      this.io.emit('conversation:log', {
        from: sender.name || sender.id,
        to:   receiver.name || receiver.id,
        message: `🖼️ Imagem: ${image.name}`,
        type: 'image',
      });
    } catch (e) {
      console.error('[Scheduler] Erro ao enviar imagem:', e.message);
    }
  }

  /**
   * Envia um vídeo aleatório da biblioteca dentro de um grupo.
   */
  async _sendVideoToGroup(config) {
    const { groupId, videoId, caption = '' } = config;
    const group = await db.getGroupById(groupId);
    if (!group || group.members.length < 2) return;

    const media = await db.getAllMedia('video');
    const video = videoId ? media.find((m) => m.id === videoId) : _randomItem(media);
    if (!video) return;

    const videoPath = path.join(__dirname, '../../videos', video.filename);
    const allMembers = group.members.map((m) => m.number);
    const connected = allMembers.filter(
      (m) => this.sessionManager.getSession(m.id)?.status === 'connected'
    );
    if (connected.length < 2) return;

    const sender   = _randomItem(connected);
    const receiver = _randomItem(connected.filter((m) => m.id !== sender.id));

    try {
      await this.sessionManager.sendVideo(sender.id, receiver.phone, videoPath, caption);
      await db.logConversation(sender.id, receiver.id, `[video: ${video.name}]`, 'video');
      this.io.emit('conversation:log', {
        from: sender.name || sender.id,
        to:   receiver.name || receiver.id,
        message: `🎥 Vídeo: ${video.name}`,
        type: 'video',
      });
    } catch (e) {
      console.error('[Scheduler] Erro ao enviar vídeo:', e.message);
    }
  }

  // ─── API Pública ─────────────────────────────────────────────────────────────

  async addTask(taskData) {
    const task = await db.createTask(taskData);
    if (task.enabled) this._startJob(task);
    return task;
  }

  async updateTask(id, taskData) {
    const task = await db.updateTask(id, taskData);
    if (task.enabled) {
      this._startJob(task);
    } else {
      this._stopJob(id);
    }
    return task;
  }

  async removeTask(id) {
    this._stopJob(id);
    await db.deleteTask(id);
  }

  _stopJob(id) {
    if (this.jobs.has(id)) {
      this.jobs.get(id).stop();
      this.jobs.delete(id);
    }
  }

  /** Dispara uma tarefa manualmente (para testes no dashboard). */
  async triggerTask(id) {
    const task = await db.getTaskById(id);
    if (!task) throw new Error(`Tarefa ${id} não encontrada`);
    await this._runTask(task);
    await db.updateTaskLastRun(id);
  }
}

function _randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _delay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Scheduler };
