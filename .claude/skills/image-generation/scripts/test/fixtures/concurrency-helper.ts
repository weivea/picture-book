#!/usr/bin/env bun
// .claude/skills/image-generation/scripts/test/fixtures/concurrency-helper.ts
//
// Acquires a slot, sleeps for N ms (argv[2]), then releases.
// Used by concurrency-gate.test.ts to verify cross-process serialization.

import { acquireSlot } from "../../lib/concurrency-gate";

const sleepMs = parseInt(process.argv[2] ?? "300", 10);
const release = await acquireSlot();
try {
  await new Promise((r) => setTimeout(r, sleepMs));
} finally {
  await release();
}
