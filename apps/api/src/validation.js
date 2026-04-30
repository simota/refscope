const REPO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OBJECT_ID_PATTERN = /^[A-Fa-f0-9]{40}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,199}$/;
const POSITIVE_INTEGER_PATTERN = /^[0-9]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function isValidRepoId(value) {
  return typeof value === "string" && REPO_ID_PATTERN.test(value);
}

export function isValidObjectId(value) {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

export function isValidGitRef(value) {
  if (
    typeof value !== "string" ||
    !REF_PATTERN.test(value) ||
    value === "@" ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.startsWith("-")
  ) {
    return false;
  }

  return value.split("/").every((component) => {
    return (
      component.length > 0 &&
      !component.startsWith(".") &&
      !component.endsWith(".") &&
      !component.endsWith(".lock")
    );
  });
}

export function parseLimitQuery(value, fallback, max) {
  if (value == null || value === "") {
    return { ok: true, value: fallback };
  }

  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) {
    return { ok: false, error: "Invalid limit parameter" };
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: "Invalid limit parameter" };
  }

  return { ok: true, value: Math.min(parsed, max) };
}

export function parseSearchQuery(value) {
  return parseBoundedTextQuery(value, "Invalid search parameter");
}

export function parseAuthorQuery(value) {
  return parseBoundedTextQuery(value, "Invalid author parameter");
}

export function parsePathQuery(value) {
  if (value == null || value === "") {
    return { ok: true, value: "" };
  }

  const parsed = value.trim();
  if (!parsed) {
    return { ok: true, value: "" };
  }
  if (
    parsed.length > 200 ||
    CONTROL_CHARACTER_PATTERN.test(parsed) ||
    parsed.startsWith("/") ||
    parsed.startsWith("-") ||
    parsed.split("/").some((component) => component === "" || component === "." || component === "..")
  ) {
    return { ok: false, error: "Invalid path parameter" };
  }

  return { ok: true, value: parsed };
}

function parseBoundedTextQuery(value, error) {
  if (value == null || value === "") {
    return { ok: true, value: "" };
  }

  const parsed = value.trim();
  if (!parsed) {
    return { ok: true, value: "" };
  }
  if (parsed.length > 100 || CONTROL_CHARACTER_PATTERN.test(parsed)) {
    return { ok: false, error };
  }

  return { ok: true, value: parsed };
}
