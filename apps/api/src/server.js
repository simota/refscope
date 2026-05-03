import http from "node:http";

import { loadConfig } from "./config.js";
import { createGitService } from "./gitService.js";
import { createFleetService } from "./fleetService.js";
import { createRequestHandler } from "./http.js";

const config = loadConfig();
const gitService = createGitService(config);
const fleetService = createFleetService(config, gitService);
const server = http.createServer(createRequestHandler(config, gitService, fleetService));

server.listen(config.port, config.host, () => {
  console.log(`Realtime Git Viewer API listening on http://${config.host}:${config.port}`);
  console.log(`Allowlisted repositories: ${config.repositories.size}`);
});
