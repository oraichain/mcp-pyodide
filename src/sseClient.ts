import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  JSONRPCMessage,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync } from "fs";

async function main() {
  // const receivedMessages = [];
  const transport = new SSEClientTransport(
    new URL("http://localhost:3020/sse")
  );

  // Listen for SSE events
  transport.onmessage = (_event: JSONRPCMessage | JSONRPCResponse) => {
    const event = _event as JSONRPCResponse;
    console.log(JSON.stringify(event.result));
  };

  await transport.start();
  // console.log("transport started");

  const testMessage: JSONRPCMessage = {
    jsonrpc: "2.0",
    id: "test-1",
    method: "tools/call",
    params: {
      _meta: { progressToken: 0 },
      name: "pyodide_list-mounted-directory",
      arguments: {
        sessionId: "local-testing",
        timeout: 30000,
        code: `
import matplotlib.pyplot as plt
import pandas as pd
import markdown
import numpy

# Data provided by you
categories = ['Apples', 'Bananas', 'Oranges', 'Grapes']
values = [25, 30, 15, 20]

# Set title and labels
plt.title('Fruit Sales')
plt.xlabel('Fruit Type')
plt.ylabel('Sales (in units)')

# Use skyblue color for the bars
plt.bar(categories, values, color='#87CEEB')  # Assuming '#87CEEB' is the skyblue color code

# Save the chart as /workspace/local-testing/sse-chart.png
plt.savefig('/workspace/local-testing/sse-chart.png')`,
      },
    },
  };

  await transport.send(testMessage);
}

main();
