# UI Workflow Capture

AI-driven browser automation framework that learns and documents UI workflows through natural language instructions. This system uses GPT-4o with vision capabilities to autonomously navigate web applications, execute tasks, and generate detailed workflow documentation with screenshots and interaction data.

## Overview

The system generates comprehensive datasets including:
- Step-by-step screenshots
- UI element metadata and selectors
- Action reasoning and descriptions
- Complete workflow summaries

## Features

- **Natural Language Task Execution**: Describe tasks in plain English (e.g., "How do I create a new database in Notion?")
- **Intelligent Navigation**: Automatically determines which web application to use based on task description
- **Vision-Guided Interaction**: Uses GPT-4o with vision to understand page layouts and identify interactive elements
- **Persistent Authentication**: Maintains browser sessions between runs using a persistent user data directory
- **Comprehensive Documentation**: Generates detailed workflow artifacts including screenshots, element data, and action logs
- **Adaptive Selector Generation**: Creates stable, human-readable selectors for UI elements
- **Workflow State Management**: Tracks complete history of actions and page states
- **Error Recovery**: Implements retry logic with exponential backoff for API rate limits

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- OpenAI API key with access to GPT-4o
- Google Chrome (for Playwright automation)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd ui-workflow-capture
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

To create from the example template (if available):

```bash
cp .env.example .env
```

Then edit `.env` and add your OpenAI API key.

## Usage

### Basic Usage

Run a workflow task using natural language:

```bash
npm run dev "How do I create a new page in Notion?"
```

### Using Compiled JavaScript

Build and run the production version:

```bash
npm run build
npm start "Your task description here"
```

### Example Tasks

```bash
# Create a new page
npm run dev "How do I create a new page in Notion?"

# Create a database
npm run dev "How do I create a new database in Notion?"

# Filter content
npm run dev "How do I filter a database in Notion?"
```

### Configuration

The agent can be configured in `src/index.ts` with the following options:

```typescript
const agent = new Agent(openaiApiKey, {
  maxSteps: 20,              // Maximum number of steps before stopping
  screenshotDir: 'dataset',   // Directory for workflow artifacts
  slowMo: 500,                // Milliseconds to slow down Playwright operations
  viewportWidth: 1280,        // Browser viewport width
  viewportHeight: 720,        // Browser viewport height
  userDataDir: 'user-data-dir' // Persistent browser data directory (auth state)
});
```

## Architecture

The system consists of four main components that work together to execute and document workflows:

### Core Components

#### Agent (`src/agent.ts`)
The main orchestrator that manages the workflow execution loop. Responsibilities include:
- Initializing browser and LLM services
- Coordinating the workflow execution loop
- Capturing page state at each step
- Managing screenshot and data artifact generation
- Generating human-readable action descriptions
- Exporting workflow summaries

#### LLMService (`src/llm-service.ts`)
Handles all interactions with OpenAI's GPT-4o model. Provides:
- **Initial URL determination**: Identifies which website to navigate to based on task
- **End state definition**: Determines the minimum completion criteria for tasks
- **Next action reasoning**: Analyzes current page state and determines next action using vision
- **Retry logic**: Implements exponential backoff for rate limit handling

#### BrowserController (`src/browser-controller.ts`)
Playwright-based browser automation wrapper. Features:
- Persistent browser context management (maintains authentication)
- Page state capture with interactive element extraction
- Smart selector generation (data-testid, aria-label, text-based)
- Precise element clicking with bounding box matching
- Screenshot capture and element metadata export
- Comprehensive interactive element detection (buttons, links, inputs, contenteditable)

#### WorkflowState (`src/workflow-state.ts`)
Manages workflow execution state and history. Handles:
- Step-by-step action history
- Directory structure management
- Workflow summary generation
- Step logging and console output

## Project Structure

```
ui-workflow-capture/
├── src/
│   ├── index.ts              # Entry point and CLI interface
│   ├── agent.ts              # Main workflow orchestration
│   ├── browser-controller.ts # Browser automation and element extraction
│   ├── llm-service.ts        # OpenAI GPT-4o integration
│   ├── workflow-state.ts     # State management and history tracking
│   └── types.ts              # TypeScript type definitions
├── dataset/                  # Generated workflow artifacts
│   └── [task-name]/
│       ├── step-N-[action].png       # Screenshot at each step
│       ├── ui-state-N.json           # Complete state snapshot
│       └── workflow-summary.json     # Complete workflow summary
├── elements/                 # Extracted UI element data
│   └── [task-name]/
│       └── elements-N.json           # Interactive elements per step
├── user-data-dir/            # Persistent browser data (sessions, auth)
├── dist/                     # Compiled JavaScript output
├── package.json              # Project dependencies and scripts
├── tsconfig.json             # TypeScript compiler configuration
└── README.md                 # This file
```

### File Descriptions

#### Source Files

**`src/index.ts`**
- Application entry point
- Parses command-line arguments for task description
- Configures and initializes the Agent
- Handles environment variable validation
- Error handling and process exit management

**`src/agent.ts`**
- Orchestrates the complete workflow execution
- Manages the main workflow loop
- Coordinates browser, LLM, and state components
- Captures and saves page state at each step
- Generates action descriptions and reasoning
- Creates workflow artifacts (screenshots, JSON state files)
- Exports final workflow summary

**`src/browser-controller.ts`**
- Wraps Playwright for browser automation
- Implements persistent browser context (saves auth between runs)
- Extracts interactive elements from pages
- Generates stable, semantic selectors
- Handles element clicking with bounding box precision
- Captures screenshots and page metadata
- Detects and categorizes UI regions (header, nav, main, footer, sidebar)

**`src/llm-service.ts`**
- Manages OpenAI API interactions
- Determines initial URL from task description
- Defines minimum task completion criteria
- Analyzes page screenshots with vision model
- Decides next actions based on current state and history
- Implements retry logic with exponential backoff
- Formats prompts with element data and history context

**`src/workflow-state.ts`**
- Tracks workflow execution history
- Manages step counter and action log
- Creates directory structure for artifacts
- Exports workflow summaries in JSON format
- Provides console logging for step execution

**`src/types.ts`**
- TypeScript type definitions for the entire system
- Defines interfaces for workflow steps, actions, UI elements
- Specifies page state structure
- Documents LLM decision format
- Configuration type definitions

#### Configuration Files

**`tsconfig.json`**
- TypeScript compiler configuration
- Targets ES2020 with CommonJS modules
- Enables strict type checking
- Generates source maps and declarations
- Configures output directory structure

**`package.json`**
- Project metadata and dependencies
- NPM scripts for development and production
- Dependencies: OpenAI SDK, Playwright
- Dev dependencies: TypeScript, ts-node, Node types

## Generated Output Structure

Each workflow execution creates a structured dataset with the following artifacts:

### Dataset Directory (`dataset/[sanitized-task-name]/`)

**`step-0-initial.png`**
- Screenshot of the initial page load

**`step-N-[action].png`**
- Screenshot captured after each action
- Filename includes step number and action type

**`ui-state-N.json`**
- Complete state snapshot for each step
- Contains:
  - Step number
  - Action executed (type, selector, coordinates, text)
  - Reasoning for the action
  - Human-readable description
  - Page state (URL, title)
  - Screenshot path
  - Timestamp

**`workflow-summary.json`**
- High-level workflow summary
- Contains:
  - Original task description
  - Total number of steps
  - Start and end timestamps
  - Condensed step information

### Elements Directory (`elements/[sanitized-task-name]/`)

**`elements-N.json`**
- Complete list of interactive elements detected at each step
- For each element:
  - Selector (stable, semantic)
  - Text content
  - Role (button, link, textbox, etc.)
  - Visibility status
  - Bounding box coordinates
  - ARIA attributes
  - Parent relationships
  - DOM depth
  - Page region (header, nav, main, etc.)

## How It Works

1. **Task Initiation**: User provides a natural language task description
2. **URL Determination**: LLM analyzes the task and determines the appropriate website
3. **Initial Navigation**: Browser navigates to the URL and captures initial state
4. **End State Definition**: LLM defines the minimum criteria for task completion
5. **Workflow Loop**:
   - Capture current page state (screenshot + interactive elements)
   - Send state to LLM with vision for analysis
   - LLM determines next action (click, type, or complete)
   - Execute action in browser
   - Save screenshot and state data
   - Repeat until task is complete or max steps reached
6. **Documentation**: Generate comprehensive workflow summary with all artifacts
7. **Completion**: Keep browser alive briefly for verification, then close

### Selector Strategy

The system generates stable, human-readable selectors using the following priority:

1. `data-testid` attributes (most stable)
2. `aria-label` attributes (semantic)
3. `placeholder` attributes (for inputs)
4. Text-based selectors using `:has-text()` (for buttons/links)
5. `contenteditable` attributes
6. `role` attributes
7. ID or class-based selectors (fallback)

### Task Completion Detection

The agent determines task completion using:
- Predefined end state criteria from LLM
- Vision-based analysis of current page state
- Comparison with expected end state
- Boolean completion flag in LLM decisions

## Development

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

Output will be in the `dist/` directory.

### Run Development Mode

Run without building (uses ts-node):

```bash
npm run dev "Your task here"
```

## Troubleshooting

### Common Issues

**Browser Authentication Required**
- The system uses persistent browser context (`user-data-dir/`)
- On first run, you may need to manually log in to web applications
- Authentication state will be preserved for subsequent runs

**Element Not Found Errors**
- The LLM may select incorrect selectors if page structure changes
- Check that selectors in `elements-N.json` are valid
- Consider adjusting viewport size if elements are out of view

**Task Not Completing**
- Increase `maxSteps` in configuration if tasks are complex
- Review `workflow-summary.json` to debug where the workflow got stuck
- Check end state definition is appropriate for the task

