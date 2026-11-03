// Minimal declarations for the vendored XState 5.33.3 build (see VENDOR.json); only what the review gate uses.
export function setup(config: { guards?: Record<string, (args: { context: any }) => boolean>; actions?: Record<string, unknown> }): { createMachine(config: Record<string, unknown>): any };
export function createActor(logic: any, options?: Record<string, unknown>): any;
export function assign(assignment: any): any;
