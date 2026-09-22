// @ts-check

/** Check the actual primitive before an installation can change managed files. */
export async function assertLockRuntimeAvailable() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    try { database.exec("BEGIN IMMEDIATE; ROLLBACK;"); }
    finally { database.close(); }
  } catch {
    throw new Error("Development System requires working node:sqlite support (Node.js 22.13+ on the 22.x line, or 23.4+). Installation has not started.");
  }
}
