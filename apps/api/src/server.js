import http from "node:http";

import { loadConfig } from "./config.js";
import { createGitService } from "./gitService.js";
import { createRequestHandler } from "./http.js";

const config = loadConfig();
const gitService = createGitService(config);
const server = http.createServer(createRequestHandler(config, gitService));

server.listen(config.port, config.host, () => {
  console.log(`Realtime Git Viewer API listening on http://${config.host}:${config.port}`);
  console.log(`Allowlisted repositories: ${config.repositories.size}`);
});
