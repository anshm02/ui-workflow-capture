import { BrowserController } from './browser-controller';
import { LLMService } from './llm-service';
import { WorkflowState } from './workflow-state';
import { WorkflowConfig, ActionExecuted, PageState } from './types';
import { promises as fs } from 'fs';

export class Agent {
  private browser: BrowserController;
  private llm: LLMService;
  private state: WorkflowState;
  private config: WorkflowConfig;

  constructor(openaiApiKey: string, config: Partial<WorkflowConfig> = {}) {
    this.config = {
      maxSteps: config.maxSteps ?? 20,
      screenshotDir: config.screenshotDir ?? 'dataset',
      slowMo: config.slowMo ?? 500,
      viewportWidth: config.viewportWidth ?? 1280,
      viewportHeight: config.viewportHeight ?? 720,
      userDataDir: config.userDataDir ?? 'user-data-dir',
    };

    this.browser = new BrowserController();
    this.llm = new LLMService(openaiApiKey);
    this.state = new WorkflowState('', this.config.screenshotDir, 'elements');
  }

  async execute(userTask: string): Promise<void> {
    console.log(`\nStarting Workflow...`);
    console.log(`Task: ${userTask}\n`);

    const taskDir = this.sanitizeTaskName(userTask);
    const taskPath = `${this.config.screenshotDir}/${taskDir}`;
    const elementsPath = `elements/${taskDir}`;
    
    this.state = new WorkflowState(userTask, taskPath, elementsPath);
    await this.state.initialize();

    await this.browser.initialize({
      headless: false,
      slowMo: this.config.slowMo,
      viewportWidth: this.config.viewportWidth,
      viewportHeight: this.config.viewportHeight,
      userDataDir: this.config.userDataDir,
    });

    try {
      console.log(`\nDetermining what URL to navigate to...`);
      const initialUrl = await this.llm.determineInitialUrl(userTask);
      console.log(`Navigating to: ${initialUrl}`);
      
      await this.browser.navigate(initialUrl);
      await this.captureInitialState();

      await this.executeWorkflowLoop(userTask);

      await this.state.exportSummary();
      console.log(`\nWorkflow Complete\n`);

      await this.browser.keepAlive(60);
    } catch (error) {
      console.error(`\nWorkflow Error:`, error);
      await this.browser.saveScreenshot(
        `${this.state.getTaskPath()}/error.png`
      );
      throw error;
    } finally {
      await this.browser.close();
    }
  }

  private async captureInitialState(): Promise<void> {
    const taskPath = this.state.getTaskPath();
    const elementsPath = this.state.getElementsPath();
    const screenshotPath = `${taskPath}/step-0-initial.png`;
    await this.browser.saveScreenshot(screenshotPath);

    const pageState = await this.browser.capturePageState();
    
    const initialAction: ActionExecuted = {
      type: 'navigate',
      url: pageState.url,
    };

    const uiStateData = {
      stepNumber: 0,
      action: initialAction,
      reasoning: 'Initial page load',
      description: `Navigate to ${pageState.url} to begin the task. This is the starting point for the workflow where we load the initial page.`,
      pageState: {
        url: pageState.url,
        title: pageState.title,
      },
      screenshotPath: screenshotPath,
      timestamp: new Date(),
    };

    const uiStatePath = `${taskPath}/ui-state-0.json`;
    await fs.writeFile(uiStatePath, JSON.stringify(uiStateData, null, 2), 'utf-8');

    const elementsFilePath = `${elementsPath}/elements-0.json`;
    await this.browser.saveElementsToJson(pageState.interactiveElements, elementsFilePath);

    this.state.addStep(
      initialAction,
      'Initial page load',
      screenshotPath
    );

    console.log(`[Step 0] Initial state captured`);
  }

  private async executeWorkflowLoop(userTask: string): Promise<void> {
    let completed = false;

    console.log('Determining minimum end state for task...');
    const endState = await this.llm.determineEndState(userTask);
    console.log(`End state: ${endState}\n`);

    while (!completed && this.state.getCurrentStepNumber() < this.config.maxSteps) {
      const pageState = await this.browser.capturePageState();
      const history = this.state.getHistory();

      console.log('Determining next action...');
      const decision = await this.llm.determineNextAction(
        userTask,
        pageState,
        history,
        endState
      );

      console.log('Decision:', decision);

      const stepNumber = this.state.getCurrentStepNumber();
      const taskPath = this.state.getTaskPath();
      const screenshotPath = `${taskPath}/step-${stepNumber}-${decision.action}.png`;

      let executedAction: ActionExecuted;

      switch (decision.action) {
        case 'click':
          if (!decision.selector) {
            throw new Error('Click action requires selector');
          }
          // Find the element's bounding box from the scraped page state
          const targetElement = pageState.interactiveElements.find(
            el => el.selector === decision.selector
          );
          const targetBox = targetElement?.boundingBox;
          
          const coordinates = await this.browser.click(decision.selector, targetBox);
          executedAction = {
            type: 'click',
            selector: decision.selector,
            coordinates,
          };
          break;

        case 'type':
          if (!decision.selector || !decision.text) {
            throw new Error('Type action requires selector and text');
          }
          await this.browser.type(decision.selector, decision.text);
          executedAction = {
            type: 'type',
            selector: decision.selector,
            text: decision.text,
          };
          break;

        case 'navigate':
          executedAction = {
            type: 'navigate',
            url: pageState.url,
          };
          break;

        case 'complete':
          executedAction = {
            type: 'complete',
          };
          completed = true;
          break;

        default:
          throw new Error(`Unknown action type: ${decision.action}`);
      }

      await this.browser.saveScreenshot(screenshotPath);
      
      const postActionState = await this.browser.capturePageState();
      
      const actionDescription = this.generateActionDescription(executedAction, decision.reasoning, postActionState);
      
      const uiStateData = {
        stepNumber: stepNumber,
        action: executedAction,
        reasoning: decision.reasoning,
        description: actionDescription,
        pageState: {
          url: postActionState.url,
          title: postActionState.title,
        },
        screenshotPath: screenshotPath,
        timestamp: new Date(),
      };

      const uiStatePath = `${taskPath}/ui-state-${stepNumber}.json`;
      await fs.writeFile(uiStatePath, JSON.stringify(uiStateData, null, 2), 'utf-8');

      const elementsPath = this.state.getElementsPath();
      const elementsFilePath = `${elementsPath}/elements-${stepNumber}.json`;
      await this.browser.saveElementsToJson(postActionState.interactiveElements, elementsFilePath);
      
      this.state.addStep(executedAction, decision.reasoning, screenshotPath);
      this.state.printStep(stepNumber, decision.reasoning, executedAction);

      if (decision.completed) {
        completed = true;
      }
    }

    if (!completed) {
      console.log(`\nWarning: Reached max steps (${this.config.maxSteps}) without completion`);
    }
  }

  private sanitizeTaskName(task: string): string {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50);
  }

  private generateActionDescription(action: ActionExecuted, reasoning: string, pageState: PageState): string {
    let description = '';

    switch (action.type) {
      case 'click':
        const clickedElement = pageState.interactiveElements.find(
          el => el.selector === action.selector
        );
        description = `Click on the element with selector "${action.selector}"`;
        if (clickedElement?.text) {
          description += ` (text: "${clickedElement.text}")`;
        }
        if (clickedElement?.role) {
          description += ` which is a ${clickedElement.role}`;
        }
        description += `. ${reasoning}`;
        if (action.coordinates) {
          description += ` The element is located at coordinates (${action.coordinates.x}, ${action.coordinates.y}).`;
        }
        break;

      case 'type':
        const typedElement = pageState.interactiveElements.find(
          el => el.selector === action.selector
        );
        description = `Type "${action.text}" into the input field with selector "${action.selector}"`;
        if (typedElement?.placeholder) {
          description += ` (placeholder: "${typedElement.placeholder}")`;
        }
        description += `. ${reasoning}`;
        break;

      case 'navigate':
        description = `Navigate to ${action.url}. ${reasoning}`;
        break;

      case 'complete':
        description = `Task completed successfully. ${reasoning}`;
        break;
    }

    return description;
  }
}

