export interface DemoHarnessArtifact {
  kind: "page_text" | "html_snapshot" | "screenshot" | "execution_log";
  label: string;
  content?: string;
  ref?: string;
}

export interface DemoHarnessStep {
  action: string;
  targetUrl?: string;
}

export interface DemoHarnessRun {
  siteId: string;
  summary: {
    usedFixtureBrowser: boolean;
  };
  handoff: {
    payload: {
      fields: Record<string, string>;
    };
  };
  automationRecord: {
    handoff: {
      payload: {
        steps: DemoHarnessStep[];
      };
    };
    evidence: {
      artifacts: DemoHarnessArtifact[];
    };
  };
}

export interface DemoHarnessCaptchaSessionSnapshot {
  sessionId: string;
  siteId: string;
  instruction: string;
  browserHint: string;
  updatedAt: string;
  pageText?: string;
}
