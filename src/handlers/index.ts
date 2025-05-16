import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { type } from "arktype";

import * as tools from "../tools/index.js";
// import { ResourceClient } from "../resources/index.js";
import { PyodideManager } from "../lib/pyodide/pyodide-manager.js";
import { formatCallToolError } from "../formatters/index.js";

function createMCPServer(): Server {
  // Create a server instance
  const server = new Server(
    {
      name: "mcp-pyodide",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  const TOOLS: Tool[] = [
    tools.EXECUTE_PYTHON_TOOL,
    // tools.INSTALL_PYTHON_PACKAGES_TOOL,
    // tools.GET_MOUNT_POINTS_TOOL,
    tools.LIST_MOUNTED_DIRECTORY_TOOL,
    // tools.READ_IMAGE_TOOL,
  ];

  const isExecutePythonArgs = type({
    code: "string",
    sessionId: "string",
    "timeout?": "number",
  });

  const isInstallPythonPackagesArgs = type({
    package: "string",
  });

  const isListMountedDirectoryArgs = type({
    sessionId: "string",
  });

  const isReadImageArgs = type({
    mountName: "string",
    imagePath: "string",
  });

  // server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  //   const pyodideManager = PyodideManager.getInstance();
  //   const resourceClient = new ResourceClient(pyodideManager);
  //   const resources = await resourceClient.listResources();
  //   return { resources };
  // });

  // server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  //   const pyodideManager = PyodideManager.getInstance();
  //   const resourceClient = new ResourceClient(pyodideManager);
  //   const resource = await resourceClient.readResource(request.params.uri);
  //   return { contents: [resource] };
  // });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;
      const { sessionId } = args as { sessionId: string };
      const pyodideManager = PyodideManager.getInstance(sessionId);

      if (!args) {
        throw new Error("No arguments provided");
      }

      switch (name) {
        case "python_execute": {
          console.time("python_execute");
          const executePythonArgs = isExecutePythonArgs(args);
          if (executePythonArgs instanceof type.errors) {
            throw executePythonArgs;
          }
          const { code, timeout = 30000 } = executePythonArgs;
          // Don't allow to install packages. Only pre-installed packages are allowed.
          // // install required packages
          // await Promise.all(
          //   extractPythonPackages(code).map((pkg) =>
          //     pyodideManager.installPackage(pkg)
          //   )
          // );
          const results = await pyodideManager.runCode(code, timeout);
          console.timeEnd("python_execute");
          return results;
        }
        // case "pyodide_install-packages": {
        //   const installPythonPackagesArgs = isInstallPythonPackagesArgs(args);
        //   if (installPythonPackagesArgs instanceof type.errors) {
        //     throw installPythonPackagesArgs;
        //   }
        //   const { package: packageName } = installPythonPackagesArgs;
        //   const results = await pyodideManager.installPackage(packageName);
        //   return results;
        // }

        // NOTE: This case should only be called by trusted clients.
        // case "pyodide_get-mount-points": {
        //   if (!pyodideManager.getPyodide()) {
        //     await pyodideManager.initialize(
        //       process.env.PYODIDE_CACHE_DIR || "./cache"
        //     );
        //   }
        //   const results = await pyodideManager.getMountPoints();
        //   return results;
        // }
        // NOTE: This case should only be called by trusted clients.
        case "pyodide_list-mounted-directory": {
          if (!pyodideManager.getPyodide()) {
            await pyodideManager.initialize(
              process.env.PYODIDE_CACHE_DIR || "./cache"
            );
            await pyodideManager.mountDirectory();
          }
          const listMountedDirectoryArgs = isListMountedDirectoryArgs(args);
          if (listMountedDirectoryArgs instanceof type.errors) {
            throw listMountedDirectoryArgs;
          }
          const results = await pyodideManager.listMountedDirectory();
          return results;
        }
        // case "pyodide_read-image": {
        //   const readImageArgs = isReadImageArgs(args);
        //   if (readImageArgs instanceof type.errors) {
        //     throw readImageArgs;
        //   }
        //   const { mountName, imagePath } = readImageArgs;
        //   const results = await pyodideManager.readImage(mountName, imagePath);
        //   return results;
        // }
        default: {
          return formatCallToolError(`Unknown tool: ${name}`);
        }
      }
    } catch (error) {
      return formatCallToolError(error);
    }
  });
  return server;
}

async function initializePyodide(sessionId: string) {
  const pyodideManager = PyodideManager.getInstance(sessionId);
  const cacheDir = process.env.PYODIDE_CACHE_DIR || "./cache";

  if (!(await pyodideManager.initialize(cacheDir))) {
    throw new Error("Failed to initialize Pyodide");
  }

  await pyodideManager.mountDirectory();
}

export { createMCPServer, initializePyodide };
