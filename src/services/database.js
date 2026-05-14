const { PrismaClient } = require('@prisma/client');

/**
 * DatabaseService
 *
 * Singleton que encapsula todas as operações Prisma do sistema.
 * Use `DatabaseService.getInstance()` para obter a instância única,
 * ou simplesmente faça `require('./database')` — o módulo já exporta
 * a instância pronta.
 */
class DatabaseService {
  static #instance = null;

  /** @type {PrismaClient} */
  #prisma;

  constructor() {
    this.#prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  /** @returns {DatabaseService} */
  static getInstance() {
    if (!DatabaseService.#instance) {
      DatabaseService.#instance = new DatabaseService();
    }
    return DatabaseService.#instance;
  }

  get prisma() {
    return this.#prisma;
  }

  async connect() {
    await this.#prisma.$connect();
    await this.#seedDefaultSettings();
    console.log('[DB] Conectado ao PostgreSQL via Prisma');
  }

  async disconnect() {
    await this.#prisma.$disconnect();
  }

  async #seedDefaultSettings() {
    const defaults = [
      { key: 'min_delay_ms',      value: '5000'  },
      { key: 'max_delay_ms',      value: '15000' },
      { key: 'engine_threshold',  value: '10'    },
      { key: 'default_engine',    value: 'baileys'  },
      { key: 'daily_msg_limit',   value: '50'    },
      { key: 'typing_simulation', value: '1'     },
    ];
    for (const s of defaults) {
      await this.#prisma.setting.upsert({
        where:  { key: s.key },
        update: {},
        create: s,
      });
    }
  }

  // --- Numbers ---------------------------------------------------------------

  async getAllNumbers(userId = null) {
    return this.#prisma.number.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'asc' },
    });
  }

  async getNumberById(id) {
    return this.#prisma.number.findUnique({ where: { id } });
  }

  async createNumber({ name, phone, engine, autoReconnect, userId = null }) {
    return this.#prisma.number.create({
      data: {
        name:          name          ?? null,
        phone:         phone         ?? null,
        engine:        engine        ?? 'wwjs',
        autoReconnect: autoReconnect ?? true,
        userId:        userId        ?? null,
      },
    });
  }

  async updateNumberStatus(id, status, phone = null) {
    return this.#prisma.number.update({
      where: { id },
      data: {
        status,
        ...(phone ? { phone, lastConnected: new Date() } : {}),
      },
    });
  }

  async updateNumberEngine(id, engine) {
    return this.#prisma.number.update({ where: { id }, data: { engine } });
  }

  async updateNumberLastActivity(id) {
    return this.#prisma.number.update({
      where: { id },
      data:  { lastActivity: new Date() },
    });
  }

  async getNumbersByUserId(userId) {
    return this.#prisma.number.findMany({ where: { userId } });
  }

  /**
   * Retorna números conectados cuja última atividade (ou conexão) é anterior ao threshold.
   * Usado para expirar sessões inativas após N dias.
   */
  async getExpiredSessions(thresholdDate) {
    return this.#prisma.number.findMany({
      where: {
        status: 'connected',
        OR: [
          { lastActivity:  { lt: thresholdDate } },
          { lastActivity:  null, lastConnected: { lt: thresholdDate } },
          { lastActivity:  null, lastConnected: null },
        ],
      },
    });
  }

  async deleteNumber(id) {
    return this.#prisma.number.delete({ where: { id } });
  }

  // --- Groups ----------------------------------------------------------------

  async getAllGroups(userId = null) {
    return this.#prisma.group.findMany({
      where:   userId ? { userId } : {},
      orderBy: { createdAt: 'asc' },
      include: { members: { include: { number: true } } },
    });
  }

  async getGroupById(id) {
    return this.#prisma.group.findUnique({
      where: { id },
      include: { members: { include: { number: true } } },
    });
  }

  async createGroup(name, userId = null) {
    return this.#prisma.group.create({
      data: { name, userId: userId ?? null },
      include: { members: { include: { number: true } } },
    });
  }

  async addMemberToGroup(groupId, numberId) {
    return this.#prisma.groupMember.upsert({
      where:  { groupId_numberId: { groupId, numberId } },
      update: {},
      create: { groupId, numberId },
    });
  }

  async removeMemberFromGroup(groupId, numberId) {
    return this.#prisma.groupMember.delete({
      where: { groupId_numberId: { groupId, numberId } },
    });
  }

  async deleteGroup(id) {
    return this.#prisma.group.delete({ where: { id } });
  }

  // --- Conversation Logs -----------------------------------------------------

  async logConversation(fromNumberId, toNumberId, message, type = 'text') {
    return this.#prisma.conversationLog.create({
      data: { fromNumberId, toNumberId, message, type },
    });
  }

  async getRecentLogs(limit = 100, userId = null) {
    let where = {};
    if (userId) {
      const numbers = await this.#prisma.number.findMany({ where: { userId }, select: { id: true } });
      const ids = numbers.map((n) => n.id);
      where = { OR: [{ fromNumberId: { in: ids } }, { toNumberId: { in: ids } }] };
    }
    return this.#prisma.conversationLog.findMany({
      take:    limit,
      where,
      orderBy: { sentAt: 'desc' },
      include: {
        fromNumber: { select: { id: true, name: true, phone: true } },
        toNumber:   { select: { id: true, name: true, phone: true } },
      },
    });
  }

  // --- Scheduled Tasks -------------------------------------------------------

  async getAllTasks(userId = null) {
    return this.#prisma.scheduledTask.findMany({
      where:   userId ? { userId } : {},
      orderBy: { createdAt: 'asc' },
    });
  }

  async getTaskById(id) {
    return this.#prisma.scheduledTask.findUnique({ where: { id } });
  }

  async createTask({ name, type, cronExpression, enabled, config, userId = null }) {
    return this.#prisma.scheduledTask.create({
      data: {
        name,
        type,
        cronExpression,
        enabled: enabled ?? true,
        config:  config  ?? {},
        userId:  userId  ?? null,
      },
    });
  }

  async updateTask(id, { name, type, cronExpression, enabled, config }) {
    return this.#prisma.scheduledTask.update({
      where: { id },
      data:  { name, type, cronExpression, enabled, config: config ?? {} },
    });
  }

  async updateTaskLastRun(id) {
    return this.#prisma.scheduledTask.update({
      where: { id },
      data:  { lastRun: new Date() },
    });
  }

  async deleteTask(id) {
    return this.#prisma.scheduledTask.delete({ where: { id } });
  }

  // --- Settings --------------------------------------------------------------

  async getSettings() {
    const rows = await this.#prisma.setting.findMany();
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  async setSetting(key, value) {
    return this.#prisma.setting.upsert({
      where:  { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }

  // --- Media -----------------------------------------------------------------

  async getAllMedia(type = null, userId = null) {
    return this.#prisma.mediaFile.findMany({
      where:   { ...(type ? { type } : {}), ...(userId ? { userId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMediaById(id) {
    return this.#prisma.mediaFile.findUnique({ where: { id } });
  }

  async createMedia({ name, type, filename, userId = null }) {
    return this.#prisma.mediaFile.create({
      data: { name, type, filename, userId: userId ?? null },
    });
  }

  async deleteMedia(id) {
    return this.#prisma.mediaFile.delete({ where: { id } });
  }

  // --- Users ----------------------------------------------------------------

  async createUser({ username, password, role, modules, enabled }) {
    return this.#prisma.user.create({
      data: {
        username,
        password,
        role: role || 'user',
        enabled: enabled !== undefined ? enabled : true,
        modules: modules || 'numbers,groups,scheduler,media,logs,settings',
      },
    });
  }

  async getUserByUsername(username) {
    return this.#prisma.user.findUnique({ where: { username } });
  }

  async getUserById(id) {
    return this.#prisma.user.findUnique({ where: { id } });
  }

  async updateUserMachineId(id, machineId) {
    return this.#prisma.user.update({ where: { id }, data: { machineId } });
  }

  async getUserCount() {
    return this.#prisma.user.count();
  }

  async getAllUsers() {
    return this.#prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async updateUser(id, data) {
    return this.#prisma.user.update({ where: { id }, data });
  }

  async deleteUser(id) {
    // Remove dados relacionados antes de excluir o usuário
    await this.#prisma.number.updateMany({ where: { userId: id }, data: { userId: null } });
    await this.#prisma.group.updateMany({ where: { userId: id }, data: { userId: null } });
    await this.#prisma.scheduledTask.updateMany({ where: { userId: id }, data: { userId: null } });
    await this.#prisma.mediaFile.updateMany({ where: { userId: id }, data: { userId: null } });
    return this.#prisma.user.delete({ where: { id } });
  }

  /**
   * Primeiro usuário criado assume todos os registros sem dono (migração de sistema pré-auth).
   */
  async claimOrphanedData(userId) {
    await this.#prisma.number.updateMany({ where: { userId: null }, data: { userId } });
    await this.#prisma.group.updateMany({ where: { userId: null }, data: { userId } });
    await this.#prisma.scheduledTask.updateMany({ where: { userId: null }, data: { userId } });
    await this.#prisma.mediaFile.updateMany({ where: { userId: null }, data: { userId } });
  }
}

module.exports = DatabaseService.getInstance();