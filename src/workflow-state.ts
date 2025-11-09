import { promises as fs } from 'fs';
import { WorkflowStep, ActionExecuted } from './types';

export class WorkflowState {
  private steps: WorkflowStep[] = [];
  private userTask: string;
  private screenshotDir: string;

  constructor(userTask: string, screenshotDir: string) {
    this.userTask = userTask;
    this.screenshotDir = screenshotDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.screenshotDir, { recursive: true });
  }

  addStep(
    action: ActionExecuted,
    reasoning: string,
    screenshotPath: string
  ): void {
    const step: WorkflowStep = {
      stepNumber: this.steps.length,
      screenshotPath,
      action,
      reasoning,
      timestamp: new Date(),
    };

    this.steps.push(step);
  }

  getHistory(): WorkflowStep[] {
    return [...this.steps];
  }

  getCurrentStepNumber(): number {
    return this.steps.length;
  }

  async exportSummary(): Promise<void> {
    const summary = {
      task: this.userTask,
      totalSteps: this.steps.length,
      startTime: this.steps[0]?.timestamp,
      endTime: this.steps[this.steps.length - 1]?.timestamp,
      steps: this.steps.map((step) => ({
        stepNumber: step.stepNumber,
        action: step.action.type,
        selector: step.action.selector,
        coordinates: step.action.coordinates,
        reasoning: step.reasoning,
        screenshot: step.screenshotPath,
      })),
    };

    const summaryPath = `${this.screenshotDir}/workflow-summary.json`;
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    console.log(`\nWorkflow Summary:`);
    console.log(`Task: ${this.userTask}`);
    console.log(`Total Steps: ${this.steps.length}`);
    console.log(`Summary saved to: ${summaryPath}`);
  }

  printStep(stepNumber: number, reasoning: string, action: ActionExecuted): void {
    console.log(`\n[Step ${stepNumber}]`);
    console.log(`Action: ${action.type}`);
    if (action.selector) {
      console.log(`Selector: ${action.selector}`);
    }
    if (action.coordinates) {
      console.log(`Clicked at: (${action.coordinates.x}, ${action.coordinates.y})`);
    }
    if (action.text) {
      console.log(`Text: ${action.text}`);
    }
    console.log(`Reasoning: ${reasoning}`);
  }
}

