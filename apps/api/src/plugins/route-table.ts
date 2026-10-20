import type { FastifyInstance, FastifySchema, RouteOptions } from 'fastify';

export interface RouteEntry {
  method: string;
  url: string;
  schema: FastifySchema | undefined;
  config: unknown;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every registered route, for the route-table tests (SEC-04, ORG-14, AUD-04). */
    routeTable: RouteEntry[];
  }
}

export function registerRouteTable(app: FastifyInstance): void {
  const table: RouteEntry[] = [];
  app.decorate('routeTable', table);
  app.addHook('onRoute', (r: RouteOptions) => {
    for (const method of [r.method].flat()) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      table.push({ method, url: r.url, schema: r.schema, config: r.config });
    }
  });
}
