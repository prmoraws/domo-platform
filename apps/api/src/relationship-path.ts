import type {
  DatabaseRelationship,
} from './database.js';

export interface RelationshipPathStep {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export const findRelationshipPathInGraph = (
  relationships: readonly DatabaseRelationship[],
  fromTable: string,
  toTable: string,
): RelationshipPathStep[] | null => {
  if (fromTable === toTable) return [];

  const queue: Array<{
    table: string;
    path: RelationshipPathStep[];
  }> = [{ table: fromTable, path: [] }];
  const visited = new Set([fromTable]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;

    for (const relationship of relationships) {
      const forward = relationship.table === current.table;
      const reverse =
        relationship.referencedTable === current.table;

      if (!forward && !reverse) continue;

      const step: RelationshipPathStep = forward
        ? {
          fromTable: relationship.table,
          fromColumn: relationship.column,
          toTable: relationship.referencedTable,
          toColumn: relationship.referencedColumn,
        }
        : {
          fromTable: relationship.referencedTable,
          fromColumn: relationship.referencedColumn,
          toTable: relationship.table,
          toColumn: relationship.column,
        };

      if (visited.has(step.toTable)) continue;

      const path = [...current.path, step];
      if (step.toTable === toTable) return path;

      visited.add(step.toTable);
      queue.push({ table: step.toTable, path });
    }
  }

  return null;
};
