import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { readScopedContextSource } from '../context/scopedContextReader.ts';

type TutorContextToolOptions = {
  allowedSourceIds: string[];
  componentPartIds: string[];
  simulationPrimitiveIds: string[];
};

export function createTutorContextTools({
  allowedSourceIds,
  componentPartIds,
  simulationPrimitiveIds
}: TutorContextToolOptions) {
  return [
    tool(async () => JSON.stringify({
      allowedSourceIds,
      componentPartIds,
      simulationPrimitiveIds
    }, null, 2), {
      name: 'list_tutor_context_sources',
      description: 'List current selected-target context source ids the tutor may cite.',
      schema: z.object({})
    }),
    tool(async ({ id }) => readScopedContextSource(id, { allowedSourceIds }), {
      name: 'read_tutor_context_doc',
      description: 'Read one selected-target context source projection. Item-level ids return only one item.',
      schema: z.object({ id: z.string().min(1).max(240) })
    })
  ];
}
