import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const EXECUTE_PYTHON_TOOL: Tool = {
  name: 'python_execute',
  description: 'Execute Python code with output capture.',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute'
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (default: 5000)'
      }
    },
    required: ['code']
  }
};

export const INSTALL_PYTHON_PACKAGES_TOOL: Tool = {
  name: 'pyodide_install-packages',
  description:
    'Install Python packages using Pyodide. Multiple packages can be specified using space-separated format.',
  inputSchema: {
    type: 'object',
    properties: {
      package: {
        type: 'string',
        description:
          "Python package(s) to install. For multiple packages, use space-separated format (e.g., 'numpy matplotlib pandas')."
      }
    },
    required: ['package']
  }
};

export const GET_MOUNT_POINTS_TOOL: Tool = {
  name: 'python_get_dirs',
  description: 'List mounted directories',
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

export const LIST_MOUNTED_DIRECTORY_TOOL: Tool = {
  name: 'pyodide_list-mounted-directory',
  description: 'List contents of a mounted directory',
  inputSchema: {
    type: 'object',
    properties: {
      mountName: {
        type: 'string',
        description: 'Name of the mount point'
      }
    },
    required: ['mountName']
  }
};

export const READ_IMAGE_TOOL: Tool = {
  name: 'pyodide_read-image',
  description: 'Read an image from a mounted directory',
  inputSchema: {
    type: 'object',
    properties: {
      mountName: {
        type: 'string',
        description: 'Name of the mount point'
      },
      imagePath: {
        type: 'string',
        description: 'Path of the image file'
      }
    },
    required: ['mountName', 'imagePath']
  }
};
