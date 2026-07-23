import type { NextConfig } from "next";
import { SERVER_ACTION_BODY_LIMIT } from "./src/lib/documents/limits";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  experimental: {
    serverActions: {
      /**
       * Next's default is 1 MB (node_modules/next/dist/docs/01-app/
       * 03-api-reference/05-config/01-next-config-js/serverActions.md).
       * Nothing set it before, so the framework rejected any upload over 1 MB
       * BEFORE lib/documents/actions.ts's own 10 MB check could run — making
       * the friendly "File exceeds the 10MB size limit." message unreachable
       * and failing an ordinary 2 MB scanned PDF, the single most common thing
       * a CA firm uploads, with a raw framework error instead. See the
       * app-layer security audit, finding L5.
       *
       * Imported, never restated: SERVER_ACTION_BODY_LIMIT is derived from
       * MAX_DOCUMENT_SIZE in the same module the action checks against, so the
       * framework limit and the app limit cannot drift apart again. It carries
       * a deliberate 1 MB of slack over MAX_DOCUMENT_SIZE for the multipart
       * envelope and the sibling form fields, so a file of exactly the allowed
       * size does not trip the framework limit and reproduce the same problem
       * one byte later.
       */
      bodySizeLimit: SERVER_ACTION_BODY_LIMIT,
    },
  },
};

export default nextConfig;
