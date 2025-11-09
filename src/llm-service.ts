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
  "selector": "CSS selector for the element to interact with (required for click/type)",
  "text": "text to type (required for type action)",
  "reasoning": "brief explanation of why this action advances toward the goal",
  "completed": boolean indicating if the task is fully completed
}

Rules:
- Always use the most specific selector from the provided interactive elements
- Prefer visible, interactive elements (buttons, inputs, links)
- Take incremental steps toward the goal
- Set completed=true only when the task is fully accomplished
- Be precise and deterministic in your selections`;
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

