/**
 * Soul auto-learner IPC handler (P5).
 */
import { soulLearnerSync } from '@shared/channels/soul-learner'
import { getActiveCharacter } from '../services/character-store'
import { syncLearnedTraits } from '../services/soul-learner'
import { handleInvoke } from './channel-helpers'

export function registerSoulLearnerIpc(): void {
  handleInvoke(soulLearnerSync, (payload) => {
    const id = payload?.character_id ?? getActiveCharacter()?.id
    if (!id) return { ok: false, reason: 'no active character' }
    return syncLearnedTraits(id)
  })
}
