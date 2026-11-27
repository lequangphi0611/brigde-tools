import type { UnitOfWork } from "../../ports/unit-of-work.port.ts";
import type { Database } from "./open-database.ts";

/** `UnitOfWork` trên một transaction SQLite (`BEGIN IMMEDIATE`), ADR-0011. */
export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
}
