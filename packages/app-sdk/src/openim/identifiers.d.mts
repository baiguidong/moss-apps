export function openIMConversationScope(userId: string): string
export function openIMDefaultConversationId(userId: string): string
export function openIMDirectConversationId(userId: string, peerUserId: string): string
export function parseOpenIMDirectConversationId(value: unknown): { userId: string; peerUserId: string } | null
export function openIMDefaultConversationIdFor(value: unknown): string | null
