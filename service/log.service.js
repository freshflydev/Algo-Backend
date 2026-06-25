import { getDb } from '../db/database.js';

export function logEvent(level, scope, message, raw = null) {
  getDb().prepare(`
    INSERT INTO system_logs(level, scope, message, raw_json)
    VALUES (?, ?, ?, ?)
  `).run(level, scope, message, raw ? JSON.stringify(raw) : null);
  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer(`[${scope}] ${message}`);
}

export function listLogs(filters = {}) {
  const params = [];
  const conditions = [];
  if (filters.level) {
    conditions.push('level = ?');
    params.push(filters.level);
  }
  if (filters.scope) {
    conditions.push('scope = ?');
    params.push(filters.scope);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit || 300), 1000);
  return getDb().prepare(`
    SELECT * FROM system_logs
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);
}

