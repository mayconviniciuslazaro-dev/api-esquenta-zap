const express = require('express');
const router = express.Router();
const db = require('../services/database');
const { authMiddleware } = require('../middleware/auth');

// Todos os endpoints do scheduler requerem autenticação
router.use(authMiddleware);

// GET /api/scheduler
router.get('/', async (req, res) => {
  try {
    res.json(await db.getAllTasks(req.user.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scheduler
router.post('/', async (req, res) => {
  try {
    const task = await req.scheduler.addTask(_normalizeTaskBody(req.body, req.user.userId));
    res.json(task);
  } catch (e) {
    console.error('[Scheduler POST] Erro:', e.message, '\nBody recebido:', JSON.stringify(req.body));
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/scheduler/:id
router.put('/:id', async (req, res) => {
  try {
    const task = await req.scheduler.updateTask(req.params.id, _normalizeTaskBody(req.body));
    res.json(task);
  } catch (e) {
    console.error('[Scheduler PUT] Erro:', e.message, '\nBody recebido:', JSON.stringify(req.body));
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scheduler/:id
router.delete('/:id', async (req, res) => {
  try {
    await req.scheduler.removeTask(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scheduler/:id/trigger — executa uma tarefa manualmente
router.post('/:id/trigger', async (req, res) => {
  try {
    await req.scheduler.triggerTask(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

/**
 * Mapa de possíveis valores enviados pelo frontend → valor do enum Prisma TaskType.
 * Cobre nomes em português, inglês e variantes com espaço/underline.
 */
const TYPE_MAP = {
  // warm_group
  'warm_group':         'warm_group',
  'Conversa em Grupo':  'warm_group',
  'conversa em grupo':  'warm_group',
  'warm-group':         'warm_group',
  // warm_pair
  'warm_pair':          'warm_pair',
  'Conversa em Par':    'warm_pair',
  'conversa em par':    'warm_pair',
  'warm-pair':          'warm_pair',
  // send_audio
  'send_audio':         'send_audio',
  'Enviar Áudio':       'send_audio',
  'enviar audio':       'send_audio',
  'send-audio':         'send_audio',
  // send_sticker
  'send_sticker':       'send_sticker',
  'Enviar Figurinha':   'send_sticker',
  'enviar figurinha':   'send_sticker',
  'send-sticker':       'send_sticker',
  // send_reaction
  'send_reaction':      'send_reaction',
  'Enviar Reação':      'send_reaction',
  'enviar reacao':      'send_reaction',
  'send-reaction':      'send_reaction',  // send_image
  'send_image':         'send_image',
  'Enviar Imagem':      'send_image',
  'enviar imagem':      'send_image',
  'send-image':         'send_image',
  // send_video
  'send_video':         'send_video',
  'Enviar V\u00eddeo':        'send_video',
  'enviar video':       'send_video',
  'send-video':         'send_video',};

/**
 * Normaliza o body enviado pelo frontend:
 * O frontend pode enviar campos como groupId, messagesPerCycle, fromId, etc.
 * diretamente no body. O banco espera que esses campos fiquem dentro de `config`.
 */
function _normalizeTaskBody(body, userId = null) {
  const { name, type, cronExpression, enabled, config, ...rest } = body;

  // Converte o tipo (display name ou variante) para o valor do enum Prisma
  const resolvedType = TYPE_MAP[type] ?? type;

  // Se `config` já veio preenchido, usa direto; senão monta a partir dos campos extras
  const resolvedConfig = (config && Object.keys(config).length > 0)
    ? config
    : _buildConfig(resolvedType, rest);

  const result = { name, type: resolvedType, cronExpression, enabled, config: resolvedConfig };
  if (userId) result.userId = userId;
  return result;
}

function _buildConfig(type, fields) {
  switch (type) {
    case 'warm_group':
      return {
        groupId:          fields.groupId          ?? null,
        messagesPerCycle: fields.messagesPerCycle  ?? 3,
      };
    case 'warm_pair':
      return {
        fromId:   fields.fromId   ?? null,
        toId:     fields.toId     ?? null,
        messages: fields.messages ?? 2,
      };
    case 'send_audio':
      return {
        groupId: fields.groupId ?? null,
        audioId: fields.audioId ?? null,
      };
    case 'send_sticker':
      return {
        groupId:   fields.groupId   ?? null,
        stickerId: fields.stickerId ?? null,
      };
    case 'send_reaction':
      return {
        groupId: fields.groupId ?? null,
      };
    case 'send_image':
      return {
        groupId: fields.groupId ?? null,
        imageId: fields.imageId ?? null,
        caption: fields.caption ?? '',
      };
    case 'send_video':
      return {
        groupId:  fields.groupId  ?? null,
        videoId:  fields.videoId  ?? null,
        caption:  fields.caption  ?? '',
      };
    default:
      return fields;
  }
}
