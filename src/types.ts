export interface WorkflowStep {
  stepNumber: number;
  screenshotPath: string;
  action: ActionExecuted;
  reasoning: string;
  timestamp: Date;
}

export interface ActionExecuted {
  type: 'click' | 'type' | 'navigate' | 'complete';
  selector?: string;
  coordinates?: { x: number; y: number };
  text?: string;
  url?: string;
}

export interface UIElement {
  selector: string;
  text: string;
  role: string;
  isVisible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PageState {
  url: string;
  title: string;
  interactiveElements: UIElement[];
  screenshotBase64: string;
}

export interface LLMDecision {
  action: 'click' | 'type' | 'navigate' | 'complete';
  selector?: string;
  text?: string;
  reasoning: string;
  completed: boolean;
}

export interface WorkflowConfig {
  maxSteps: number;
  screenshotDir: string;
  slowMo: number;
  viewportWidth: number;
  viewportHeight: number;
}

