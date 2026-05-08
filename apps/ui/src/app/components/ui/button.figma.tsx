// Code Connect mapping for the shadcn-style Button primitive.
//
// Status: SCAFFOLD. See sibling `badge.figma.tsx` for activation context.

// @ts-expect-error — `@figma/code-connect` is intentionally not installed yet.
import figma from "@figma/code-connect";
import { Button } from "./button";

const PLACEHOLDER_NODE_URL =
  "https://www.figma.com/file/REPLACE_FILE_KEY/Refscope-DS?node-id=REPLACE_NODE_ID";

figma.connect(Button, PLACEHOLDER_NODE_URL, {
  // Mirrors the cva variants in `button.tsx`. The Figma component is expected
  // to expose `Variant` and `Size` properties with matching enum names so this
  // map stays 1:1.
  props: {
    variant: figma.enum("Variant", {
      Default: "default",
      Destructive: "destructive",
      Outline: "outline",
      Secondary: "secondary",
      Ghost: "ghost",
      Link: "link",
    }),
    size: figma.enum("Size", {
      Default: "default",
      Sm: "sm",
      Lg: "lg",
      Icon: "icon",
    }),
    children: figma.children("*"),
    disabled: figma.boolean("Disabled"),
  },
  example: ({ variant, size, children, disabled }) => (
    <Button variant={variant} size={size} disabled={disabled}>
      {children}
    </Button>
  ),
});
