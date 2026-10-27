'use client';

import { useCallback } from 'react';
import { useConfirm, useToast } from '@/components/projects/ui';
import { papi } from '@/components/projects/lib';

/**
 * Change one ticket from any view. A 409 means "blocked by …": ask, then retry with
 * confirm_blocked. Other errors become a toast. Resolves true when saved.
 */
export function useTicketPatch(onChange: () => void) {
  const confirm = useConfirm();
  const toast = useToast();
  return useCallback(async (id: number, body: Record<string, unknown>): Promise<boolean> => {
    try {
      await papi(`/api/tickets/${id}`, { method: 'PATCH', body });
      onChange();
      return true;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && (await confirm({ title: 'This ticket is blocked', body: err.message, confirmLabel: 'Move anyway' }))) {
        try {
          await papi(`/api/tickets/${id}`, { method: 'PATCH', body: { ...body, confirm_blocked: true } });
          onChange();
          return true;
        } catch (e2) { toast((e2 as Error).message, 'error'); }
      } else if (err.status !== 409) toast(err.message, 'error');
      onChange();
      return false;
    }
  }, [confirm, toast, onChange]);
}

export async function putAssignees(id: number, userIds: (number | string)[]) {
  return papi(`/api/tickets/${id}/assignees`, { method: 'PUT', body: { user_ids: userIds.map(Number) } });
}
