import type { AutomationBrowser, AutomationPage } from "@/lib/automation/types";

export class MockPage implements AutomationPage {
  readonly operations: string[] = [];

  constructor(private readonly pageText: string) {}

  async goto(url: string) {
    this.operations.push(`goto:${url}`);
  }

  async fill(selector: string, value: string) {
    this.operations.push(`fill:${selector}=${value}`);
  }

  async selectOption(selector: string, value: string | string[]) {
    this.operations.push(`select:${selector}=${Array.isArray(value) ? value.join("|") : value}`);
  }

  async click(selector: string) {
    this.operations.push(`click:${selector}`);
  }

  async waitForTimeout(timeout: number) {
    this.operations.push(`wait:${timeout}`);
  }

  async content() {
    return `<html><body>${this.pageText}</body></html>`;
  }

  async innerText(selector: string) {
    return selector === "body" ? this.pageText : null;
  }

  async screenshot() {
    return Buffer.from("automation-site-shot");
  }

  async close() {
    this.operations.push("close:page");
  }
}

export class MockBrowser implements AutomationBrowser {
  constructor(private readonly page: AutomationPage) {}

  async newPage() {
    return this.page;
  }

  async close() {
    return;
  }
}
