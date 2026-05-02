import { spawn } from "node:child_process";

/**
 * Best-effort browser launch. Returns a resolved promise even on failure so
 * callers can ignore the result without unhandled rejections; the printed URL
 * remains the canonical recovery path.
 *
 * @param {string} url
 */
export function openBrowser(url) {
  return new Promise((resolve) => {
    const command = browserCommand();
    if (!command) {
      resolve();
      return;
    }

    try {
      const child = spawn(command.exe, [...command.args, url], {
        stdio: "ignore",
        detached: true,
        shell: false,
      });
      child.on("error", () => resolve());
      child.unref();
      resolve();
    } catch {
      resolve();
    }
  });
}

function browserCommand() {
  switch (process.platform) {
    case "darwin":
      return { exe: "open", args: [] };
    case "win32":
      // `start` is a cmd.exe builtin, not a binary. The empty title argument
      // prevents `start` from interpreting a quoted URL as the window title.
      return { exe: "cmd", args: ["/c", "start", ""] };
    default:
      return { exe: "xdg-open", args: [] };
  }
}
