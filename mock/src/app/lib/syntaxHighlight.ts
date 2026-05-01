/**
 * Syntax highlighting for the diff viewer.
 *
 * Why Prism: lightweight, synchronous, runs per line without needing the full
 * file body. We only ever see hunks (a few context lines around each change),
 * so multi-line constructs like template literals or block comments may be
 * tokenized imperfectly — that's an accepted trade-off vs. shipping a full
 * editor-grade highlighter (Shiki/WASM) for a local dev tool.
 */

import Prism from "prismjs";
// Register additional languages. Order matters: Prism components mutate the
// global `Prism.languages` map at import time and some have inter-component
// dependencies (e.g. tsx → jsx + typescript, cpp → c).
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-php.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-scss.js";
import "prismjs/components/prism-swift.js";

/**
 * Map a file path to a Prism language id, or `null` when no grammar applies
 * (binary, unknown extension, etc.). The renderer falls back to plain text in
 * that case.
 */
export function detectLanguage(path: string | null | undefined): string | null {
  if (!path) return null;
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  // Match by full filename first for files that have no extension or use a
  // conventional name.
  switch (base) {
    case "dockerfile":
    case "containerfile":
      return "bash";
    case "makefile":
    case "gnumakefile":
      return "bash";
    case ".bashrc":
    case ".zshrc":
    case ".profile":
    case ".bash_profile":
      return "bash";
  }

  const dotIndex = base.lastIndexOf(".");
  if (dotIndex < 0) return null;
  const ext = base.slice(dotIndex + 1);

  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "json":
    case "jsonc":
    case "json5":
      return "json";
    case "py":
    case "pyi":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "swift":
      return "swift";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hh":
    case "hpp":
    case "hxx":
      return "cpp";
    case "cs":
      return "csharp";
    case "rb":
    case "rake":
      return "ruby";
    case "php":
    case "phtml":
      return "php";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "sql":
      return "sql";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "html":
    case "htm":
    case "xml":
    case "svg":
    case "vue":
      return "markup";
    default:
      return null;
  }
}

/**
 * Tokenize a single line of source against `lang`. Returns the raw Prism token
 * stream (string | Token | array). Callers walk this tree to render.
 *
 * Returns `null` when the language is unknown to Prism — callers should
 * render plain text in that case.
 */
export function tokenizeLine(
  text: string,
  lang: string | null,
): Array<string | Prism.Token> | null {
  if (!lang) return null;
  const grammar = Prism.languages[lang];
  if (!grammar) return null;
  return Prism.tokenize(text, grammar);
}

/** A flat run of characters that share the same Prism token type chain. */
export type HighlightedRun = {
  /** Space-separated Prism token classes, e.g. `"token keyword"`. Empty for plain text. */
  className: string;
  text: string;
};

/**
 * Flatten Prism's recursive token tree into a list of runs. Each run carries
 * the deepest applicable token type as a class — matching Prism's own
 * `<span class="token keyword">` HTML output.
 */
export function flattenTokens(
  tokens: Array<string | Prism.Token>,
  parentType?: string,
): HighlightedRun[] {
  const out: HighlightedRun[] = [];
  for (const token of tokens) {
    if (typeof token === "string") {
      out.push({ className: parentType ? `token ${parentType}` : "", text: token });
      continue;
    }
    const type = token.type;
    if (Array.isArray(token.content)) {
      out.push(...flattenTokens(token.content, type));
    } else if (typeof token.content === "string") {
      out.push({ className: `token ${type}`, text: token.content });
    } else {
      // Nested single token (Prism's Token has Token | string content).
      out.push(...flattenTokens([token.content as unknown as Prism.Token], type));
    }
  }
  return out;
}
