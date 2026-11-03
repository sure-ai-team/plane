/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for framework-free logic (stores, services). Kept separate from
// vite.config.ts so the React Router plugin isn't loaded for tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["core/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./core"),
    },
  },
});
