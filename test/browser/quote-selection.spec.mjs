import { test, expect } from '@playwright/test';

test('quote a selected passage into a draft and send it with the reply', async ({ page }) => {
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  const quote = page.getByRole('button', { name: 'Quote selection' }), prompt = page.locator('#prompt');
  const reply = 'Which checks should I run?';
  await prompt.fill(reply);
  await expect(quote).toBeHidden();
  const passage = page.locator('#transcript .message-text').filter({ hasText: 'The relay is ready.' }).first();
  await passage.locator('strong').click();
  await passage.evaluate(body => {
    const range = new Range();
    range.setStart(body.querySelector('strong').firstChild, 4);
    range.setEnd(body.querySelector('p:nth-child(2)').firstChild, 14);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await quote.tap();
  const draft = '> relay is ready.\n> \n> Run the checks\n\n' + reply;
  await expect(prompt).toHaveValue(draft);
  await expect(prompt).toBeFocused();
  await expect(quote).toBeHidden();
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect(prompt).toHaveValue('');
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(prompt).toHaveValue(draft);
  await page.locator('#send').tap();
  await expect(prompt).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#transcript .message.user .message-text').last()).toHaveJSProperty('textContent', draft);
});
