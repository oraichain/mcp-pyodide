import { PyodideManager } from "./src/lib/pyodide/pyodide-manager.js";

(async () => {
  const pyodideManager = new PyodideManager("local-testing");
  const scriptContent = `
  import matplotlib.pyplot as plt
  import pandas as pd
  import numpy
  import scipy
  import sympy
  import matplotlib
  import seaborn
  import plotly
  import os
  import pathlib
  import mistune
  import PyPDF2

  # Data provided by you
  categories = ['Apples', 'Bananas', 'Oranges', 'Grapes']
  values = [25, 30, 15, 20]

  # Set title and labels
  plt.title('Fruit Sales')
  plt.xlabel('Fruit Type')
  plt.ylabel('Sales (in units)')

  # Use skyblue color for the bars
  plt.bar(categories, values, color='#87CEEB')  # Assuming '#87CEEB' is the skyblue color code

  # Save the chart as /workspace/local-testing/chart.png
  plt.savefig('/workspace/local-testing/chart.png')
  `;
  const ret = await pyodideManager.runCode(scriptContent, 30000);
  console.log(ret);
  process.exit();
})();
