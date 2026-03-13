import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto("data:text/html,<html><body>playwright-smoke</body></html>");
  const text = await page.locator("body").innerText();

  if (text !== "playwright-smoke") {
    throw new Error(`Unexpected smoke-test text: ${text}`);
  }

  console.log("playwright smoke ok");
} finally {
  await browser.close();
}
