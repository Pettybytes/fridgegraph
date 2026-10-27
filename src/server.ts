import express, { type Request, type Response } from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { buildSubgraphSchema } from '@apollo/subgraph';
import type { DocumentNode } from 'graphql';
import { makeContext } from './context';
import { resetStore } from './store';

export type SubgraphDef = {
  name: string;
  port: number;
  typeDefs: DocumentNode;
  resolvers: Record<string, unknown>;
};

const jsonBody = express.json();

/**
 * Starts one federated subgraph on its own port. All seven live inside the one Node process
 * started by src/main.ts, so they share the single in-memory store.
 */
export async function startSubgraph(def: SubgraphDef): Promise<void> {
  const server = new ApolloServer({
    // @apollo/subgraph 2.15 takes an array of { typeDefs, resolvers } modules.
    schema: buildSubgraphSchema([{ typeDefs: def.typeDefs, resolvers: def.resolvers as never }]),
    introspection: true,
    includeStacktraceInErrorResponses: true,
  });

  await server.start();

  const app = express();

  // Control endpoint used by `npm run reset` (same process, shared store).
  app.post('/__reset', jsonBody, (_req: Request, res: Response) => {
    resetStore();
    res.json({ ok: true, reset: true });
  });

  app.use(
    '/',
    jsonBody,
    expressMiddleware(server, {
      context: async ({ req }) => makeContext({ req }),
    }),
  );

  await new Promise<void>((resolve) => {
    app.listen(def.port, '127.0.0.1', () => resolve());
  });

  console.log(`[fridgegraph] ${def.name} subgraph ready on http://127.0.0.1:${def.port}/`);
}
