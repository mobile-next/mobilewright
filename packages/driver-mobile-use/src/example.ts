import { writeFileSync } from 'node:fs';
import { MobileUseDriver } from './driver.js';

const API_KEY = "mob_Z2WFuDmQR3v7A5HJN1bJ18UjETPr4cDueZEt";

async function main() {
  const driver = new MobileUseDriver({
    // region: 'us-west-2',
    // apiKey: 'your-api-key',
    apiKey: API_KEY,
  });

  // Connect to a device
  const session = await driver.connect({
    platform: 'ios',
  });

  console.log('Connected:', session);

  // Get screen size
  const screenSize = await driver.getScreenSize();
  console.log('Screen size:', screenSize);

  // Get orientation
  const orientation = await driver.getOrientation();
  console.log('Orientation:', orientation);

  // Take a screenshot and save to file
  const screenshot = await driver.screenshot();
  writeFileSync('screenshot.png', screenshot);
  console.log('Screenshot saved to screenshot.png (%d bytes)', screenshot.length);

  // List elements on screen
  const elements = await driver.getViewHierarchy();
  console.log('Elements on screen:', JSON.stringify(elements, null, 2));

  // Type text
  await driver.typeText('Hello from mobile-use driver!');
  console.log('Typed text on screen');

  // Disconnect
  await driver.disconnect();
  console.log('Disconnected');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
