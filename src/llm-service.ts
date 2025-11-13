import OpenAI from 'openai';
import { LLMDecision, PageState, WorkflowStep } from './types';

export class LLMService {
  private client: OpenAI;
  private model: string = 'gpt-4o-mini';

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async determineNextAction(
    userTask: string,
    currentState: PageState,
    history: WorkflowStep[]
  ): Promise<LLMDecision> {
    const historyContext = this.formatHistory(history);
    
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(userTask, currentState, historyContext);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${currentState.screenshotBase64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No response from LLM');
    }

    return JSON.parse(content) as LLMDecision;
  }

  async determineInitialUrl(userTask: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You determine which web application to navigate to based on the user\'s intended task. Return only a JSON object with "url" field.',
        },
        {
          role: 'user',
          content: `Task: "${userTask}"\n\nReturn the login or main URL for the application. Response format: {"url": "https://..."}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No response from LLM');
    }

    const result = JSON.parse(content) as { url: string };
    return result.url;
  }

  private buildSystemPrompt(): string {
    return `You are an expert UI automation agent. Analyze the current page state and determine the next action to complete the user's task.
  
  You must respond with a JSON object containing:
  {
    "action": "click" | "type" | "navigate" | "complete",
    "selector": "Selector for the element to interact with (required for click/type)",
    "reasoning selector": "brief explanation of why this selector is the best choice for the action",
    "text": "text to type (required for type action)",
    "reasoning": "brief explanation of why this action advances toward the goal",
    "completed": boolean indicating if the task is fully completed
  }
  
  CRITICAL SELECTOR RULES:
  - You MUST copy the EXACT "selector" value from the interactive elements list
  - DO NOT construct your own selectors based on role, tag name, or attributes
  - DO NOT create selectors like div[role="textbox"] or button[role="button"]
  - ONLY use selectors that appear in the "selector" field of the provided elements
  - The "role" field is for YOUR understanding only - never use it to build a selector
  - Example: If element has {"selector": "h1[contenteditable=\\"true\\"]", "role": "textbox"}
    then you MUST use "h1[contenteditable=\\"true\\"]" NOT "h1[role=\\"textbox\\"]"
  
  Selector Priority (all must be EXACT copies from the list):
  1. Elements with data-testid attributes (most stable)
  2. Elements with aria-label attributes (semantic)
  3. Elements with placeholder attributes (for inputs)
  4. Elements with :has-text() (for buttons/links)
  5. Contenteditable elements with [contenteditable="true"]
  6. Other provided selectors
  
  - For contenteditable title fields, look for selectors like h1[contenteditable="true"]
  - For text areas, look for selectors with aria-label like div[aria-label="Start typing to edit text"]
  - When multiple similar elements exist, choose the one most relevant to your task
  - Take incremental steps toward the goal
  - Set completed=true only when the task is fully accomplished`;
  }

  private buildUserPrompt(
    userTask: string,
    state: PageState,
    historyContext: string
  ): string {
    const elementsJson = JSON.stringify(
      state.interactiveElements.slice(0, 50),
      null,
      2
    );

    return `TASK: ${userTask}

CURRENT PAGE:
- URL: ${state.url}
- Title: ${state.title}

INTERACTIVE ELEMENTS:
${elementsJson}

${historyContext}

Determine the next action to progress toward completing the task. Use the screenshot for visual context.`;
  }

  private formatHistory(history: WorkflowStep[]): string {
    if (history.length === 0) {
      return 'HISTORY: This is the first step.';
    }

    const steps = history
      .map(
        (step) =>
          `Step ${step.stepNumber}: ${step.action.type} ${
            step.action.selector || step.action.url || ''
          } - ${step.reasoning}`
      )
      .join('\n');

    return `PREVIOUS ACTIONS:\n${steps}`;
  }
}

