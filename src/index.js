require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const db = require('./services/database');
const { SessionManager } = require('./services/sessionManager');
const { Scheduler } = require('./services/scheduler');

const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const numbersRouter = require('./routes/numbers');
const groupsRouter = require('./routes/groups');
const schedulerRouter = require('./routes/scheduler');
const settingsRouter = require('./routes/settings');
const mediaRouter = require('./routes/media');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use('/uploads/audios',    express.static(path.join(__dirname, '../audios')));
app.use('/uploads/stickers',  express.static(path.join(__dirname, '../stickers')));
app.use('/uploads/images',    express.static(path.join(__dirname, '../images')));
app.use('/uploads/videos',    express.static(path.join(__dirname, '../videos')));

// Inject io, sessionManager e scheduler nas requisições
const sessionManager = new SessionManager(io);
const scheduler = new Scheduler(sessionManager, io);

app.use((req, _res, next) => {
  req.io = io;
  req.sessionManager = sessionManager;
  req.scheduler = scheduler;
  next();
});

// Rota pública de autenticação (sem middleware de auth)
app.use('/api/auth', (req, _res, next) => { req.sessionManager = sessionManager; next(); }, authRouter);

// Rota de administração (auth + admin middleware aplicados internamente)
app.use('/api/admin', adminRouter);

// Rotas protegidas (authMiddleware aplicado internamente em cada router)
app.use('/api/numbers', numbersRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/media', mediaRouter);

// Socket.IO — autenticação via JWT no handshake
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Não autenticado: token ausente'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch {
    next(new Error('Token inválido ou expirado'));
  }
});

io.on('connection', async (socket) => {
  console.log('[Socket.IO] Cliente conectado:', socket.id, '| userId:', socket.userId);

  // Entra na sala privada do usuário — todos os eventos são emitidos para esta sala
  socket.join(`user:${socket.userId}`);

  socket.on('disconnect', () => {
    console.log('[Socket.IO] Cliente desconectado:', socket.id);
  });

  // Envia estado atual apenas para este usuário
  const [numbers, settings] = await Promise.all([
    db.getAllNumbers(socket.userId),
    db.getSettings(),
  ]);

  // Mescla status ao vivo nas sessões ativas
  const liveStatuses = sessionManager.getStatuses();
  const numbersWithStatus = numbers.map((n) => ({
    ...n,
    status: liveStatuses[n.id] || n.status,
  }));
  socket.emit('numbers:list', numbersWithStatus);
  socket.emit('settings:current', settings);

  // Re-envia QR pendente apenas para sessões deste usuário
  for (const [id, session] of sessionManager.sessions) {
    if (session.userId !== socket.userId) continue;
    if (session.status === 'qr_pending' && session.lastQr) {
      socket.emit('number:qr', { id, qr: session.lastQr, engine: session.engineType });
    }
    if (session.status === 'connecting' || session.status === 'qr_pending' || session.status === 'connected') {
      socket.emit('number:status', { id, status: session.status });
    }
  }
});

const PORT = process.env.PORT || 3001;

async function bootstrap() {
  // 1. Conecta ao PostgreSQL
  await db.connect();

  // 2. Inicializa o scheduler (carrega tarefas do banco)
  await scheduler.init();

  // 3. Sobe o servidor
  server.listen(PORT, async () => {
    console.log(`\n🚀 WhatsApp Warmer Backend rodando na porta ${PORT}`);

    // Auto-reconectar números que estavam conectados antes do restart
    const numbers = await db.getAllNumbers();
    numbers
      .filter((n) => n.autoReconnect)
      .forEach((n) => {
        console.log(`[Auto-reconnect] Reconectando: ${n.name || n.id}`);
        sessionManager.connectNumber(n.id).catch((e) =>
          console.error(`[Auto-reconnect] Erro ao reconectar ${n.id}:`, e.message)
        );
      });
  });
}

bootstrap().catch((e) => {
  console.error('[Bootstrap] Erro fatal ao iniciar:', e);
  process.exit(1);
});

module.exports = { io };
