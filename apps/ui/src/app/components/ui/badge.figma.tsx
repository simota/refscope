// Code Connect mapping for the shadcn-style Badge primitive.
//
// Status: SCAFFOLD. The Figma node URL below is a placeholder; replace it
// with the real one once the design-system file in Figma defines the Badge
// component. Activation also requires installing `@figma/code-connect` as a
// dev dependency. See `figma.config.json` at the repo root for the include
// glob and `docs/brand/CODE_CONNECT.md` for the activation runbook.
//
// Why this scaffold ships before the Figma file is ready:
//   The D3 verdict (docs/magi-verdict-2026-05-08-r7-designer.md) treats
//   tokens.json ↔ Figma sync as Phase 3. Code Connect mappings for the
//   primitive components are part of that scope. Putting the scaffold in
//   place now means a designer activating Code Connect only has to fill
//   in real Figma node IDs — they don't have to design the props mapping
//   from scratch.

// @ts-expect-error — `@figma/code-connect` is intentionally not installed yet.
// The import is here so the file activates as a Code Connect template the
// moment the package is added; until then the file is scaffold documentation.
import figma from "@figma/code-connect";
import { Badge } from "./badge";

const PLACEHOLDER_NODE_URL =
  "https://www.figma.com/file/REPLACE_FILE_KEY/Refscope-DS?node-id=REPLACE_NODE_ID";

figma.connect(Badge, PLACEHOLDER_NODE_URL, {
  // Refscope's Badge has a single `variant` enum (default | secondary |
  // destructive | outline). The Figma component is expected to expose a
  // matching `Variant` property — when the Figma file is built, mirror these
  // variant names exactly so this map stays a 1:1 enum.
  props: {
    variant: figma.enum("Variant", {
      Default: "default",
      Secondary: "secondary",
      Destructive: "destructive",
      Outline: "outline",
    }),
    children: figma.children("*"),
  },
  example: ({ variant, children }) => <Badge variant={variant}>{children}</Badge>,
});
