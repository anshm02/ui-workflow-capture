# UI Workflow Capture

AI-driven browser automation that learns and documents UI workflows through natural language instructions.

## Setup

```bash
npm install
cp .env.example .env
# Add your OpenAI API key to .env
```

## Usage

```bash
npm run dev "How do I create a new page in Notion?"
```

## Architecture

- `Agent`: Main orchestrator executing the workflow loop
- `LLMService`: Handles GPT-4o reasoning for UI interactions
- `BrowserController`: Playwright wrapper for browser automation
- `WorkflowState`: Manages action history and artifacts
