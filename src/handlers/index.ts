import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type } from "arktype";

import * as tools from "../tools/index.js";
import { ResourceClient } from "../resources/index.js";
import { PyodideManager } from "../lib/pyodide/pyodide-manager.js";
import { formatCallToolError } from "../formatters/index.js";

// Function to extract Python packages from a Python script
function extractPythonPackages(pythonCode: string): string[] {
  const regex = /^\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  let match: RegExpExecArray | null;
  const packages = new Set<string>();

  while ((match = regex.exec(pythonCode)) !== null) {
    packages.add(match[1]);
  }

  return Array.from(packages);
}

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
    tools.GET_MOUNT_POINTS_TOOL,
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
    mountName: "string",
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
          const { code, timeout = 5000 } = executePythonArgs;
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
        case "pyodide_get-mount-points": {
          const results = await pyodideManager.getMountPoints();
          return results;
        }
        // NOTE: This case should only be called by trusted clients.
        case "pyodide_list-mounted-directory": {
          const listMountedDirectoryArgs = isListMountedDirectoryArgs(args);
          if (listMountedDirectoryArgs instanceof type.errors) {
            throw listMountedDirectoryArgs;
          }
          const { mountName } = listMountedDirectoryArgs;
          const results = await pyodideManager.listMountedDirectory(mountName);
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
  const dataDir = process.env.PYODIDE_DATA_DIR || "./data";

  if (!(await pyodideManager.initialize(cacheDir))) {
    throw new Error("Failed to initialize Pyodide");
  }

  await pyodideManager.mountDirectory("data", dataDir);
  pyodideManager.chdir("data");
}

export { createMCPServer, initializePyodide };
