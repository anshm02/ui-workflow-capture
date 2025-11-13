import { BrowserController } from './browser-controller';
import { LLMService } from './llm-service';
import { WorkflowState } from './workflow-state';
import { WorkflowConfig, ActionExecuted } from './types';

export class Agent {
  private browser: BrowserController;
  private llm: LLMService;
  private state: WorkflowState;
  private config: WorkflowConfig;

  constructor(openaiApiKey: string, config: Partial<WorkflowConfig> = {}) {
    this.config = {
      maxSteps: config.maxSteps ?? 20,
      screenshotDir: config.screenshotDir ?? 'screenshots',
      slowMo: config.slowMo ?? 500,
      viewportWidth: config.viewportWidth ?? 1280,
      viewportHeight: config.viewportHeight ?? 720,
      userDataDir: config.userDataDir ?? 'user-data-dir',
    };

    this.browser = new BrowserController();
    this.llm = new LLMService(openaiApiKey);
    this.state = new WorkflowState('', this.config.screenshotDir);
  }

  async execute(userTask: string): Promise<void> {
    console.log(`\nStarting Workflow...`);
    console.log(`Task: ${userTask}\n`);

    this.state = new WorkflowState(userTask, this.config.screenshotDir);
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
        `${this.config.screenshotDir}/error.png`
      );
      throw error;
    } finally {
      await this.browser.close();
    }
  }

  private async captureInitialState(): Promise<void> {
    const screenshotPath = `${this.config.screenshotDir}/step-0-initial.png`;
    await this.browser.saveScreenshot(screenshotPath);

    const pageState = await this.browser.capturePageState();
    
    const elementsPath = `${this.config.screenshotDir}/step-0-elements.json`;
    await this.browser.saveElementsToJson(pageState.interactiveElements, elementsPath);

    const initialAction: ActionExecuted = {
      type: 'navigate',
      url: pageState.url,
    };

    this.state.addStep(
      initialAction,
      'Initial page load',
      screenshotPath
    );

    console.log(`[Step 0] Initial state captured`);
  }

  private async executeWorkflowLoop(userTask: string): Promise<void> {
    let completed = false;

    while (!completed && this.state.getCurrentStepNumber() < this.config.maxSteps) {
      const pageState = await this.browser.capturePageState();
      const history = this.state.getHistory();

      console.log('Determining next action...');
      const decision = await this.llm.determineNextAction(
        userTask,
        pageState,
        history
      );

      console.log('Decision:', decision);

      const stepNumber = this.state.getCurrentStepNumber();
      const screenshotPath = `${this.config.screenshotDir}/step-${stepNumber}-${decision.action}.png`;

      let executedAction: ActionExecuted;

      switch (decision.action) {
        case 'click':
          if (!decision.selector) {
            throw new Error('Click action requires selector');
          }
          const coordinates = await this.browser.click(decision.selector);
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
      const elementsPath = `${this.config.screenshotDir}/step-${stepNumber}-elements.json`;
      await this.browser.saveElementsToJson(postActionState.interactiveElements, elementsPath);
      
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
}

