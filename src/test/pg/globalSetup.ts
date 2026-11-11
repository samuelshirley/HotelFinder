import type { TestProject } from 'vitest/node';
import { schemaDdl } from './ddl';

declare module 'vitest' {
  export interface ProvidedContext {
    pgSchemaDdl: string[];
  }
}

/** Builds the DDL once per run; each test file replays it into its own PGlite. */
export default async function setup(project: TestProject) {
  project.provide('pgSchemaDdl', await schemaDdl());
}
