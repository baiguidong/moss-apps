import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type PairedUser = {
  userId: string
  displayName: string
  pairedAt: number
}

type PairingState = {
  codeHash: string | null
  createdAt: number | null
  expiresAt: number | null
}

type PersistedState = {
  schemaVersion: 1
  pairedUsers: PairedUser[]
  pairing: PairingState
}

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const PAIRING_CODE_LENGTH = 6
const PAIRING_TTL_MS = 60 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 5

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUser(value: unknown): PairedUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const userId = text(candidate.userId)
  if (!userId) return null
  return {
    userId,
    displayName: text(candidate.displayName).slice(0, 120) || 'Feishu User',
    pairedAt: Number(candidate.pairedAt) || Date.now(),
  }
}

function emptyState(): PersistedState {
  return {
    schemaVersion: 1,
    pairedUsers: [],
    pairing: { codeHash: null, createdAt: null, expiresAt: null },
  }
}

function hashCode(value: string): string {
  return createHash('sha256').update(value.trim().toUpperCase()).digest('hex')
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function generateCode(): string {
  let code = ''
  while (code.length < PAIRING_CODE_LENGTH) {
    code += SAFE_ALPHABET[randomInt(SAFE_ALPHABET.length)]
  }
  return code
}

export function createFeishuStateStore(dataDir: string, options: { now?: () => number } = {}) {
  const now = options.now || (() => Date.now())
  const statePath = path.join(dataDir, 'feishu-state.json')
  const failedAttempts = new Map<string, { count: number; startedAt: number }>()

  function read(): PersistedState {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<PersistedState>
      return {
        schemaVersion: 1,
        pairedUsers: Array.isArray(parsed.pairedUsers)
          ? parsed.pairedUsers.map(normalizeUser).filter((entry): entry is PairedUser => Boolean(entry))
          : [],
        pairing: {
          codeHash: text(parsed.pairing?.codeHash) || null,
          createdAt: Number(parsed.pairing?.createdAt) || null,
          expiresAt: Number(parsed.pairing?.expiresAt) || null,
        },
      }
    } catch {
      return emptyState()
    }
  }

  function write(state: PersistedState): void {
    fs.mkdirSync(dataDir, { recursive: true })
    const temporaryPath = `${statePath}.${process.pid}.${now()}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporaryPath, statePath)
  }

  function listPairedUsers(): PairedUser[] {
    return read().pairedUsers
  }

  function isPaired(userId: string): boolean {
    const normalized = text(userId)
    return Boolean(normalized) && listPairedUsers().some((entry) => entry.userId === normalized)
  }

  function pairingStatus(state = read()) {
    const active = Boolean(state.pairing.codeHash && state.pairing.expiresAt && state.pairing.expiresAt > now())
    return {
      active,
      createdAt: active ? state.pairing.createdAt : null,
      expiresAt: active ? state.pairing.expiresAt : null,
    }
  }

  function issuePairingCode() {
    const state = read()
    const code = generateCode()
    const createdAt = now()
    state.pairing = {
      codeHash: hashCode(code),
      createdAt,
      expiresAt: createdAt + PAIRING_TTL_MS,
    }
    write(state)
    return { code, ...pairingStatus(state) }
  }

  function pairingFailure(userId: string) {
    const current = failedAttempts.get(userId)
    if (!current || now() - current.startedAt > RATE_LIMIT_WINDOW_MS) {
      failedAttempts.delete(userId)
      return null
    }
    return current
  }

  function tryPair(code: string, user: { userId: string; displayName?: string }) {
    const userId = text(user.userId)
    if (!userId) return { paired: false, alreadyPaired: false, rateLimited: false }
    if (isPaired(userId)) return { paired: true, alreadyPaired: true, rateLimited: false }

    const failure = pairingFailure(userId)
    if (failure && failure.count >= RATE_LIMIT_MAX_ATTEMPTS) {
      return { paired: false, alreadyPaired: false, rateLimited: true }
    }

    const state = read()
    const providedHash = hashCode(code)
    const valid = Boolean(
      state.pairing.codeHash
      && state.pairing.expiresAt
      && state.pairing.expiresAt > now()
      && safeHashEqual(providedHash, state.pairing.codeHash),
    )
    if (!valid) {
      const current = pairingFailure(userId)
      if (current) current.count += 1
      else failedAttempts.set(userId, { count: 1, startedAt: now() })
      return { paired: false, alreadyPaired: false, rateLimited: false }
    }

    failedAttempts.delete(userId)
    state.pairedUsers.push({
      userId,
      displayName: text(user.displayName).slice(0, 120) || 'Feishu User',
      pairedAt: now(),
    })
    state.pairing = { codeHash: null, createdAt: null, expiresAt: null }
    write(state)
    return { paired: true, alreadyPaired: false, rateLimited: false }
  }

  function revoke(userId: string): boolean {
    const normalized = text(userId)
    const state = read()
    const remaining = state.pairedUsers.filter((entry) => entry.userId !== normalized)
    if (remaining.length === state.pairedUsers.length) return false
    state.pairedUsers = remaining
    write(state)
    return true
  }

  return {
    listPairedUsers,
    isPaired,
    pairingStatus,
    issuePairingCode,
    tryPair,
    revoke,
  }
}
