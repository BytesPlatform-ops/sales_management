/** Columns for board/list cards: the ticket plus who's on it and counts. */
export const CARD_SQL = `
  SELECT t.id, t.project_id, t.key, t.number, t.type, t.title, t.priority, t.status, t.triage_state, t.triage_due_at,
         t.snoozed_until, t.epic_id, t.parent_id, t.estimate_hours, t.start_date::text AS start_date, t.due_date::text AS due_date,
         t.rank, t.cr_status, t.created_by, t.created_at, t.updated_at, t.done_at,
         cu.full_name AS created_by_name,
         e.title AS epic_title, e.color AS epic_color,
         COALESCE((SELECT json_agg(json_build_object('id', a.user_id, 'name', u.full_name) ORDER BY u.full_name)
                     FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = t.id), '[]') AS assignees,
         COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.name)
                     FROM ticket_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.ticket_id = t.id), '[]') AS labels,
         (SELECT COUNT(*) FROM ticket_checklist_items c WHERE c.ticket_id = t.id)::int AS checklist_total,
         (SELECT COUNT(*) FROM ticket_checklist_items c WHERE c.ticket_id = t.id AND c.done)::int AS checklist_done,
         (SELECT COUNT(*) FROM tickets s WHERE s.parent_id = t.id AND s.deleted_at IS NULL)::int AS subtask_total,
         (SELECT COUNT(*) FROM tickets s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status IN ('done','closed'))::int AS subtask_done,
         (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id AND c.deleted_at IS NULL)::int AS comment_count,
         EXISTS (SELECT 1 FROM ticket_relations r JOIN tickets b ON b.id = r.from_ticket_id
                  WHERE r.to_ticket_id = t.id AND r.kind = 'blocks' AND b.deleted_at IS NULL
                    AND b.status NOT IN ('done','closed','declined')) AS blocked
    FROM tickets t
    LEFT JOIN users cu ON cu.id = t.created_by
    LEFT JOIN epics e ON e.id = t.epic_id`;
